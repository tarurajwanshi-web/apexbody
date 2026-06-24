## Goal
Rewrite the per-user logic in `supabase/functions/calculate-macros-weekly/index.ts` to:
1. Compute and persist training metrics (`training_load_index`, `weekly_sets_avg`, `avg_strain_value`).
2. Replace the current eligibility + safety-cap + RPC flow with the pasted goal-specific decision tree and floor/ceiling caps.
3. Insert reviews directly into `nutrition_weekly_reviews` (no `apply_weekly_macro_review` RPC call).

## Known consequences (please confirm you accept these before I build)
- **Active macro target stops auto-updating.** Today the code calls `apply_weekly_macro_review`, which atomically closes the old `daily_macro_targets` row and inserts the new one. The pasted flow only writes a review row, so `daily_macro_targets` will go stale until a follow-up "Apply" path is built (you mentioned Prompt 2 will add a frontend Apply button — that flow does not exist yet).
- **Existing safety caps removed:** 25%/750 kcal deficit cap, BMR + sex-based + macro-floor minimum, and the 250/150 kcal weekly adjustment cap are dropped in favor of the per-goal floor/ceiling table (`*0.95`, `*1.05`, `*1.10`, `*1.20`, `weight_kg*10`).
- **Eligibility loosens** from (weigh_in ≥4 AND days_logged ≥5 AND adherence ≥70%) to (days_logged ≥3 AND weigh_in ≥2). Confidence tiers become: high (days ≥6 & weigh ≥3), medium (days ≥4 & weigh ≥2), else low.
- **Profile schema requirement:** existing `Profile` type doesn't include `goal` values `strength` / `athletic_performance` distinctly, but `goalMultiplier()` already handles them. Verified.
- **Weight trend interpretation:** pasted code uses `weightTrendPerWeek`. I will map that to the existing `trend_delta_kg` (kg over the 7‑day window) — i.e. treat the window delta as the per-week trend. No additional smoothing change.

## Implementation
Single file: `supabase/functions/calculate-macros-weekly/index.ts`.

Inside `processUser`, after the existing weigh-in / nutrition log / `current_weight_kg` / `observed_tdee` / `blended_tdee` block:

1. **Fetch training data** for `[week_start_date, window_end_exclusive)`:
   - `workout_set_logs` → `strain_value[]` → `totalSets`, `avgStrain`, `weeklySetAvg = totalSets / 7`.
   - `readiness_scores` (column `score_date`, `final_score`) → `avgReadiness` (default 50 when empty).
   - Compute `trainingLoadIndex` per pasted thresholds (0.85 / 1.0 / 1.1 / 1.15), apply readiness×high-volume scaledown, clamp to [0.7, 1.3].

2. **Confidence tier** from `days_logged` + `weigh_in_count` per pasted rules. Sets `flagReason = "insufficient_data"` when `days_logged < 3`.

3. **Decision tree** keyed on `profile.goal` (`fat_loss`, `muscle_gain`, `recomposition`, `strength`, `athletic_performance`) using `trend_delta_kg` as `weightTrendPerWeek`. Branches set `decision ∈ {reduce, increase, hold}` exactly as pasted.

4. **Compute target**: `newTargetBeforeCaps = blended_tdee * goalMultiplier(goal) * trainingLoadIndex`, then apply per-goal `safeFloor` / `safeCeiling` table. If clamped, set `decision = "capped"` and (floor case) `flagReason = "deficit_capped_for_safety"`.

5. **Abnormal week** short-circuit: `decision = "hold"`, `flagReason = "abnormal_week"`, `confidenceTier = "low"`, skip target math, still populate training metrics.

6. **Single INSERT** into `nutrition_weekly_reviews` with all fields including the three training columns, `applied_target_id: null`, `applied_at: null`. No RPC call.

7. **Remove** the now-unused codepaths: ineligible-hold INSERT (replaced by step 6), Step 8/9 safety-cap & decision blocks, Step 10 RPC `apply_weekly_macro_review` call, and `recomputeMacros` usage in this file (`recomputeMacros` and `apply_weekly_macro_review` will remain unused — left in place for the future Apply path).

8. Keep idempotency check, `insertHold("missing_required_profile_data", …)` early-exits, time helpers, `goalMultiplier`, weigh-in / intake / observed-TDEE math, and the per-user error/result envelope unchanged.

## Out of scope
- Frontend WeeklyReviewCard / Apply button (pasted as "Prompt 2").
- New migrations — all three columns already exist (`double precision`).
- Edits to `apply_weekly_macro_review` RPC.
- Tests / cron schedule changes.

## Verification
After deploy: invoke with `{ user_id, force_recalculate: true }`, then run the SELECT in your prompt against `nutrition_weekly_reviews` to confirm the three training columns are non-null and `decision` / `confidence_tier` reflect the new logic.
