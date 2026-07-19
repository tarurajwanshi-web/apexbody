## Fix: generate-plan enqueue silently fails against partial unique index

### Root cause (as diagnosed)
`plan_generation_queue` has a partial unique index (`WHERE status IN ('pending','processing')`). Postgres rejects `ON CONFLICT (user_id)` unless a matching **non-partial** unique constraint exists, so the current `upsert(..., { onConflict: "user_id" })` throws. The surrounding `try/catch` swallows the error, so the single-user path returns 202 without ever enqueueing — the drain has nothing to pick up, and every plan stays on the synchronous fallback.

### Change (one file, one block)
`supabase/functions/generate-plan/index.ts` — single-user path only.

Replace the `upsert` enqueue block with a check-then-insert:

1. `SELECT id FROM plan_generation_queue WHERE user_id = uid AND status IN ('pending','processing') LIMIT 1`.
2. If no row exists, `INSERT { user_id, status: 'pending', attempts: 0 }`.
3. If a row exists, do nothing (dedupe by pre-check — same semantics the partial index was intended to enforce).
4. Keep the outer `try/catch` as a soft-fail; log insert errors explicitly so a future regression is visible in edge logs instead of silent.

Nothing else changes: fallback floor write, 202 response shape, drain branch, fan-out branch, `generateForUser`, filler, clamp — all untouched.

### Not in scope
- No migration. Partial unique index stays; the pre-check enforces the same invariant at the application layer.
- No changes to other functions or the cron.
- No client changes.

### Deploy
Deploy `generate-plan` only.

### Verification
1. Dispatch `generate-plan` for a test user. Expect 202 `{status:"accepted", upgrade:"queued"}`.
2. Immediately query `plan_generation_queue` — expect exactly one `pending` row for that user (not zero).
3. Wait ≤2 min for the cron drain. Row flips to `done`; `weekly_plans.plan_data` hash changes off `ec4dc7e9`; `volume_gate_alert` is a real readiness message, not "Safe fallback".
4. Re-dispatch for the same user while the first job is still `pending`/`processing` — expect no second row inserted (pre-check dedupe works).
5. Edge logs show no `enqueue soft-fail` or `enqueue insert failed` warnings on the happy path.
