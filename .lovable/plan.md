# Backend Safety Patch — APEX Coach

Single idempotent SQL migration. No UI changes, no data loss, no RLS weakening.

## A. Rewrite `public.apply_existing_weekly_macro_review`

`CREATE OR REPLACE FUNCTION` (security definer, search_path = public). Logic:

1. `SELECT ... FROM nutrition_weekly_reviews WHERE id = p_review_id FOR UPDATE INTO v_review`. Raise if not found or `applied_target_id IS NOT NULL`.
2. `SELECT ... FROM daily_macro_targets WHERE user_id = v_review.user_id AND effective_end_date IS NULL ORDER BY effective_start_date DESC LIMIT 1 FOR UPDATE INTO v_active`. Raise if none.
3. `UPDATE daily_macro_targets SET effective_end_date = p_effective_start_date - 1, updated_at = now() WHERE id = v_active.id`. Verify exactly one row closed.
4. Compose new target values:
  - `v_bmr := v_active.bmr`
  - `v_tdee := COALESCE(v_review.blended_tdee, v_active.tdee)`
  - `v_calories := COALESCE(v_review.new_target_calories, v_active.target_calories)`
  - `v_protein := v_active.target_protein_g`
  - `v_fat := v_active.target_fat_g`
  - `v_carbs := GREATEST(0, ROUND((v_calories - v_protein*4 - v_fat*9) / 4.0))` when calories/protein/fat are all non-null, else `v_active.target_carbs_g`
5. `INSERT INTO daily_macro_targets (...) VALUES (...) RETURNING id INTO v_new_id` with `formula_used = 'adaptive_weekly_tdee_reconciliation_v1'`, `source = 'weekly_review'`, `review_id = v_review.id`, `effective_start_date = p_effective_start_date`, `effective_end_date = NULL`, `calculated_at = now()`.
6. `UPDATE nutrition_weekly_reviews SET applied_target_id = v_new_id, applied_at = now() WHERE id = v_review.id`.
7. `RETURN v_new_id`.

Signature preserved: `(p_review_id uuid, p_effective_start_date date DEFAULT CURRENT_DATE) RETURNS uuid`.

## B. Add Shield v1.1 columns to `readiness_scores`

Each via `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`:

- `signal_quality jsonb DEFAULT '{}'::jsonb`
- `top_drivers jsonb DEFAULT '[]'::jsonb`
- `load_carryover jsonb DEFAULT '{}'::jsonb`
- `fuelling_status jsonb DEFAULT '{}'::jsonb`
- `training_permission text`
- `nutrition_modifier text`
- `reason_codes text[] DEFAULT '{}'`

## C. `engine_version` default left at `'v6.1'`.

## D. CHECK constraints on `readiness_scores` (guarded via `pg_constraint` lookup, wrapped in `DO $$ ... $$`):

- `readiness_scores_training_permission_check`: `training_permission IS NULL OR training_permission IN ('green_train','yellow_modify','orange_reduce','red_recover')`
- `readiness_scores_nutrition_modifier_check`: `nutrition_modifier IS NULL OR nutrition_modifier IN ('normal','fuel_more','protein_priority','hydration_priority','deficit_caution','recovery_day_refeed')`

NULL-tolerant so existing rows pass.

## E. Create `public.shield_signal_quality_events` (`IF NOT EXISTS`)

Columns exactly as specified: `id`, `user_id` FK `auth.users(id) ON DELETE CASCADE`, `signal_date`, `source_table`, `source_id`, `metric_name`, `raw_value`, `normalized_value`, `unit`, `source_type`, `device_source`, `freshness_status`, `validity_status`, `confidence_level`, `reason_codes`, `created_at`.

Followed in same migration by GRANTs:

- `GRANT SELECT ON public.shield_signal_quality_events TO authenticated`
- `GRANT ALL ON public.shield_signal_quality_events TO service_role`

## F. CHECK constraints on `shield_signal_quality_events` (guarded):

- `source_type IN ('device_screenshot','manual','workout_log','nutrition_log','mood_log','system')`
- `freshness_status IS NULL OR freshness_status IN ('fresh','stale','missing','future_date','unknown')`
- `validity_status IS NULL OR validity_status IN ('valid','suspicious','invalid','missing')`
- `confidence_level IS NULL OR confidence_level IN ('HIGH','MEDIUM','LOW')`

## G. Indexes (`CREATE INDEX IF NOT EXISTS`):

- `idx_shield_signal_quality_events_user_date (user_id, signal_date)`
- `idx_shield_signal_quality_events_user_metric_date (user_id, metric_name, signal_date)`
- `idx_readiness_scores_user_date (user_id, score_date)`

## H. RLS on `shield_signal_quality_events`:

- `ALTER TABLE ... ENABLE ROW LEVEL SECURITY`
- Policy `signal_quality_select_own` FOR SELECT TO authenticated USING `auth.uid() = user_id`
- No INSERT/UPDATE/DELETE policies for authenticated → blocked by default
- Service role bypasses RLS via its grant

Each policy created via `DROP POLICY IF EXISTS ... ; CREATE POLICY ...` for idempotency.

## Idempotency strategy

- `CREATE OR REPLACE FUNCTION` for the RPC
- `ADD COLUMN IF NOT EXISTS` / `CREATE TABLE IF NOT EXISTS` / `CREATE INDEX IF NOT EXISTS`
- CHECK constraints + policies wrapped in `DO $$ ... $$` blocks that test `pg_constraint` / `pg_policies` before creating

## Deliverable

Single `supabase--migration` call containing the full SQL. No code or UI changes in this patch.

Proceed? , yes but Small required fix before proceeding:

In apply_existing_weekly_macro_review, handle effective date edge cases:

1. If p_effective_start_date < v_active.effective_start_date:

   raise exception 'effective_start_before_active_target_start'.

2. If p_effective_start_date = v_active.effective_start_date:

   do not close the active row and insert a new row.

   Instead update the active daily_macro_targets row in place with:

   - tdee = v_tdee

   - target_calories = v_calories

   - target_protein_g = v_protein

   - target_carbs_g = v_carbs

   - target_fat_g = v_fat

   - formula_used = 'adaptive_weekly_tdee_reconciliation_v1'

   - source = 'weekly_review'

   - review_id = v_[review.id](http://review.id)

   - calculated_at = now()

   - updated_at = now()

   Then set v_new_id = v_[active.id](http://active.id).

3. If p_effective_start_date > v_active.effective_start_date:

   use the close-old-row and insert-new-row flow already described.

Then update nutrition_weekly_reviews.applied_target_id = v_new_id and applied_at = now() in both paths.