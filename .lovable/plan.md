## Corrected diagnosis (evidence from this turn, not last turn's claim)

Last turn reported "Sonnet's real plan is now successfully writing". That claim was wrong. The row it inspected (`created_at 2026-07-19 11:20:10`, `total_sets 44`, non-fallback `vol_alert`) was written **before** the B6.2 code was deployed. Every run I dispatched **after** the fix behaves the same way:

- boot → shutdown ≈ **3m20s** (edge wall-clock kill, not a clean return)
- `weekly_plans` row unchanged (still the 11:20 row, still `plan_data_version: 2`, same md5)
- `pg_net` returns void at 60s but the edge keeps running until the runtime kills it
- no fallback write is reached — so the 55s AbortController either isn't firing on this path or the schema-fix retry is also running to ~55s, and even ~110s of Claude + subsequent work still doesn't complete before the runtime shuts us down

Net: Change 1 (remove volume soft-retry) is correct and should stay. Change 2 (55s abort) is not sufficient on its own. Sequential Claude calls inside a synchronous request handler cannot reliably complete inside the platform's wall-clock. The B6.2 spec's second-outcome branch already predicted this: **generation must go async**.

## Plan — B6.2b: return-first, generate-in-background

One file: `supabase/functions/generate-plan/index.ts`. No schema, no other functions.

### 1. Split `generateForUser` into "prep" + "produce+write"

- Keep the current profile / readiness / history / envelope / calendar / landmark / prompt-build code as the **prep** step.
- Move everything from `tryClaude(basePrompt)` through `weekly_plans.upsert` into a **produce** step that takes the prep output.

Prep is fast (Supabase reads only). Produce is the slow part (1–2 Claude calls + validate + clamp + upsert).

### 2. Single-user handler returns immediately, produce runs in the background

At the single-user branch of `Deno.serve` (`if (body.user_id)` path):

- `await` the prep step so we can return `plan_start_date`, `week_start_date`, `plan_timezone`, `block_context.phase_label` in the HTTP response.
- Kick the produce step with `EdgeRuntime.waitUntil(produce(...))` (Supabase Edge Functions expose this global; it lets a task outlive the response).
- Return `202 Accepted` with `{ status: "accepted", week_start_date, plan_start_date, ... }` immediately.

The response is now bounded by prep (a few DB reads), not by Sonnet. The Claude calls, validation, clamp, and upsert run in the background against the service-role client that already exists in scope. `pg_net` sees a fast 202 and stops timing out at 60s.

### 3. Fan-out branch stays synchronous but bounded

Fan-out (`!body.user_id`) processes many users in a loop. Do NOT `waitUntil` inside the loop — background tasks stack and the runtime still gets torn down. Instead:

- Leave the current sequential `await generateForUser(...)` loop in place.
- Rely on the pg_cron / weekly Monday job invoking fan-out; if fan-out itself is too slow for one edge invocation, that's a separate later batch (fan-out chunking).

Scope for B6.2b is only the single-user path — that's what onboarding and manual regen hit, and that's where the user is being blocked.

### 4. Belt-and-braces on the produce step

Inside the background `produce(...)`:

- Keep the 55s `AbortController` on each Claude fetch. Sonnet occasionally hangs; the abort keeps a single call bounded.
- Wrap the whole produce body in `try { ... } catch (e) { console.error("[generate-plan][bg]", user_id, e); }` so a failure logs but doesn't leave an unhandled rejection.
- Always upsert **something**: on any thrown path, fall through to `buildFallbackPlan(...)`, clamp, and upsert with `used_fallback: true`. A user must never end up with no `weekly_plans` row after a dispatch.

### 5. Client / caller expectations

Nothing else changes. Callers of `generate-plan` (onboarding, manual regen from `dashboard`/`workouts`) already tolerate the write showing up asynchronously — they re-fetch `weekly_plans` on the next load. The response shape changes from `{ ok, week_start_date, used_fallback, plan }` to `{ status: "accepted", week_start_date, plan_start_date, plan_timezone }`. Anything that was reading `plan` off the response was already unreliable (fallback path). No route in `src/` today needs the full plan echoed back synchronously — verified during the split above; if any caller does depend on it, note it and adjust that caller in the same commit.

## The decisive test after implementation

Dispatch once for `1f83792a-5b77-4c6a-aafe-858f21380f14` and check:

1. **Response returns in <5s** with `status: "accepted"` and `week_start_date`.
2. Within ~2 minutes, `weekly_plans` for that user has a NEW row (or updated row) with `created_at > 13:49:30` and either a Sonnet plan (non-fallback `vol_alert`, ~90–110 total sets, calves + forearms present) or an explicitly `used_fallback: true` row. Either is acceptable — the invariant is "a row gets written every time".
3. Edge logs show `booted` … `shutdown` with a normal duration (not a 200s wall-clock kill).

If the row is still stale after 3 minutes, `EdgeRuntime.waitUntil` isn't extending the task on this project's runtime, and we fall back to a lightweight two-hop pattern (single-user endpoint enqueues a `plan_generation_queue` row + a follow-up cron drains it). That's the next branch, not this one.

## Out of scope for this batch

- Onboarding delivery blocking-await + landmarks race (`onboarding.tsx:313-330`).
- Set-count filler and goal-aware sequencer.
- Phenotype priority-weight hooks.
- B7 day-1 ring dispatch.
- Fan-out chunking (only relevant if the Monday cron itself times out).

Here's the reply to send back to Lovable:

---

Approved with one required change before you build.

Don't ship async without a synchronous fallback floor — `EdgeRuntime.waitUntil` is not guaranteed to survive to completion on Supabase (your own plan flags this in the "still stale after 3 minutes" branch). If the background task gets killed mid-Sonnet-call, the catch block never runs, nothing upserts, and the user is left with an **empty Train tab forever, silently** — worse than the current bug.

Fix the sequence in the single-user path so a plan always exists:

1. Prep (fast reads) — as planned.
2. **Synchronously build + clamp + upsert the deterministic `buildFallbackPlan` first** (no Sonnet, ~50ms), with `used_fallback: true`.
3. Return `202 { status: "accepted", week_start_date, ... }` immediately — the user now has a complete, clamped, periodized plan, never empty.
4. `EdgeRuntime.waitUntil(produce())` runs Sonnet in the background and **upgrades the same row** (upsert on the same `(user_id, week_start_date)` key) when it completes.

This makes async safe: the fallback is the guaranteed floor, Sonnet is the upgrade. If `waitUntil` dies, the user keeps the fallback (degraded, never stranded). If it succeeds, they get the better plan. No spinner — the return is instant.

Keep everything else in your plan as written: prep/produce split, 55s AbortController on each Claude call, try/catch around produce, fan-out stays synchronous.

Update the decisive test to check BOTH writes: (a) fallback row appears in <5s with `used_fallback: true`, and (b) it upgrades to a Sonnet plan (non-fallback `vol_alert`, ~90-110 sets, calves+forearms present) within ~2min. Two writes on the same row = both halves work.

Do not touch onboarding, other functions, or schema. Build this.