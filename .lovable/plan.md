## Fix — remove non-existent columns from `nutrition_weekly_reviews` insert

### Root cause

`supabase/functions/_shared/macro-calculation.ts` line 531 inserts `bmr: old_bmr` into `nutrition_weekly_reviews`. That table has no `bmr` column — PostgREST returns `Could not find the 'bmr' column ... in the schema cache`.

Cross-checking the full insert payload (lines 515–540) against the live `nutrition_weekly_reviews` schema, **four fields don't exist on the table**:

- `bmr` (line 531)
- `target_protein_g` (line 532)
- `target_carbs_g` (line 533)
- `target_fat_g` (line 534)

These belong on `daily_macro_targets`, which the `apply_existing_weekly_macro_review` RPC already populates from active target + review data. They should never have been on the review insert.

### Change

`supabase/functions/_shared/macro-calculation.ts` — delete lines 531–534 from the insert payload. Nothing else in the engine reads these fields back off the review row (the RPC re-derives macros from the active `daily_macro_targets`), so removal is safe.

### After edit

1. Re-run the same `net.http_post` to `calculate-macros-weekly` for user `00000000-0000-0000-0001-000000000006` with `force_recalculate: true` (Lovable auto-deploys the shared module along with `calculate-macros-weekly` and `trigger-weekly-macro-review` on next invocation, since it's imported by both).
2. Confirm via `edge_function_logs` (`status: adjusted | hold`) and `read_query` on `nutrition_weekly_reviews` that a new row for the current week exists with `decision` + `applied_target_id` populated.
3. If `applied_target_id` is set, read `daily_macro_targets` for that user to confirm the newly-active target row.

### Not in this change

- No migration. Not adding `bmr`/macro columns to the reviews table — the RPC design deliberately keeps macros on `daily_macro_targets`.
- No behavioral change to any of the E1 decision logic, weight-trend logic, TDEE blending, or applied-modifier surfacing.
- No touching of `trigger-weekly-macro-review` or `calculate-macros-weekly` HTTP shells.
