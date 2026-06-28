## Findings

The actual logic isn't in `calculate-macros-weekly/index.ts` — that file is a thin HTTP shell that delegates to `supabase/functions/_shared/macro-calculation.ts`. Both reported bugs map to that shared module.

### Bug 1 — strain query (already fixed, no change needed)

`macro-calculation.ts` lines 213–234 currently:

- queries `workout_set_logs` only for `id` (set count), and
- queries `shield_training_logs.strain_value` filtered by `user_id` + `entry_date` BETWEEN week_start and window_end.

That is exactly the shape requested. The only earlier code that read `workout_set_logs.strain_value` no longer exists. **Skip — already correct.**

### Bug 2 — apply RPC after insert

Current shape (lines 486–525, the `shouldApply` branch) calls a 22-parameter `apply_weekly_macro_review(...)` RPC that both inserts and applies in one go. That parallel monolithic RPC is the same one we already removed from the client in `nutrition.tsx`, where we switched to the atomic `apply_existing_weekly_macro_review(p_review_id)` flow.

We should align the engine with the same pattern, so insert + apply happen via the canonical row-then-RPC path that already exists in the database.

## Change

File: `supabase/functions/_shared/macro-calculation.ts`

Replace lines 486–525 (the `if (shouldApply) { ... }` block) with:

1. Insert the review row via `directInsertReview()` (the same path "hold" uses). Capture the returned `id` by switching `directInsertReview` to `.insert({...}).select("id").single()` and returning that id.
2. Call `await supa.rpc("apply_existing_weekly_macro_review", { p_review_id: <id>, p_effective_start_date: new_effective_start_date })`.
3. On RPC error, throw `apply_rpc_failed: <msg>` (preserve current error surface).
4. Return `{ user_id, status: "adjusted", decision, flag_reason: flagReason, applied_target_id: <returned uuid> }`.

Also drop the now-unused `review_id = crypto.randomUUID()` on line 453 (the DB generates the id; `applied_target_id` returned by the RPC is the new `daily_macro_targets.id`).

Result: one code path inserts the review (hold or adjust), and adjustments additionally call the atomic apply RPC — matching the client-side flow and the DB function definitions already in this project.

## Out of scope

- `index.ts` HTTP shell — no edits.
- Decision logic, abnormal-week rules, refeed flag — unchanged.
- DB migrations — `apply_existing_weekly_macro_review` already exists.  
  
