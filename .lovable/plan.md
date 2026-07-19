# B6.2c — Queue + Cron Drain for Plan Generation

## Problem (confirmed)
`EdgeRuntime.waitUntil` in B6.2b does not reliably survive on Supabase edge. The background Sonnet task is killed after the 202 returns — every plan for the last several hours is the fallback floor, never the real Sonnet upgrade. Synchronous engines (B1–B5.5) work fine; the async-in-request pattern is the regression.

## Fix
Stop running Sonnet inside a request that returns. Enqueue the upgrade and let a 1-minute cron drain it inside its own fresh function invocation — full wall-clock budget, no background-task teardown. Plan logic (`generateForUser`, filler, clamp, block_context) is unchanged; only delivery changes.

## Changes

### 1. Migration — new queue table + cron

`public.plan_generation_queue`:
- `id uuid pk`, `user_id uuid` (FK auth.users, cascade)
- `status text` — pending/processing/done/failed
- `attempts smallint default 0`, `last_error text`
- `created_at`, `updated_at`

Indexes:
- Unique partial on `(user_id) where status in ('pending','processing')` — dedupes rapid re-dispatch (one active job per user)
- `(status, created_at)` for drain ordering

Grants: `service_role` only. RLS enabled, no user policies (queue is internal).

Cron: `drain-plan-queue`, `* * * * *`, `net.http_post` to `/functions/v1/generate-plan` with `x-internal-secret` (vault `dispatch_secret`) and body `{"drain": true}`. Same shape as existing dispatch functions.

### 2. `supabase/functions/generate-plan/index.ts` — single-user path

Replace the `const upgrade = (async () => {...})(); rt.waitUntil(upgrade)` block with a queue upsert:
- Keep the synchronous `generateForUser(..., "fallback_only")` write exactly as is.
- `upsert` a row into `plan_generation_queue` with `onConflict: "user_id"`, `status: 'pending'`, `attempts: 0`. Never block the 202 on the enqueue (swallow enqueue errors).
- Return 202 `{status:"accepted", used_fallback:true, upgrade:"queued", ...dates}`.
- Delete the `EdgeRuntime.waitUntil` logic entirely.

### 3. `generate-plan/index.ts` — new `drain` branch

Add near the top of `Deno.serve`, before fan-out and single-user branches:
- Gate with `requireInternalSecret(req, supa)` (from `_shared/authorize.ts`) — cron-only.
- Claim ONE pending job: `select ... where status='pending' order by created_at asc limit 1`.
- If none → return `{drained: 0}`.
- Flip claimed job to `status='processing'`, `attempts++`.
- Call `generateForUser(supa, anth, job.user_id, undefined, "full")` — Sonnet + filler + clamp + upsert.
- On success: mark `done`. On error: mark `failed` if `attempts >= 3`, else back to `pending` with `last_error`.

**One job per tick (limit 1)** — keeps each drain well under wall-clock; 60 plans/hour is plenty at current scale. Raise later if throughput becomes a real bottleneck.

## Decisions locked in
- In-function drain branch (not a new `drain-plan-queue` function) — reuses `generateForUser` in the same file, no second deploy target. Three modes in one handler (fan-out, single-user, drain), cleanly branched.
- 3-attempt cap → `failed`. User is never stranded; the synchronous fallback floor is a complete filled+clamped plan.
- Unique partial index prevents duplicate stacked jobs when a user regens twice quickly.

## Verification

Baseline hash: `ec4dc7e9`.

1. Dispatch `generate-plan` for `1f83792a-5b77-4c6a-aafe-858f21380f14`. Expect 202 `{status:"accepted", upgrade:"queued"}` in <5s. Confirm one `pending` row in `plan_generation_queue`.
2. Wait ≤2 min. Query the queue row — expect `status='done'`.
3. Query `weekly_plans`:
   - `md5(plan_data::text)` differs from `ec4dc7e9`
   - `plan_data->>'volume_gate_alert'` is a real readiness message (NOT "Safe fallback")
   - Total sets summed across days ≈ 90–110
4. Run the per-muscle adherence query — most muscles on target (filler proven on a real Sonnet plan).
5. Edge logs show `[generate-plan] filled 1f83792a...` inside the drain invocation.

## Out of scope (deferred)
- Compound-first session sequencing (Nunes 2021).
- Onboarding delivery — falls out for free once single-user path is 202+queue; wire onboarding to navigate immediately after the 202.
- Phenotype priority-weight hooks.
- B7 day-1 ring dispatch.
