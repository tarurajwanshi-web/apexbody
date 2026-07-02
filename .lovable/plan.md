## E1 — Wire `nutrition_modifier` into weekly macro decision

### Verified live state (before editing)

- `readiness_scores` row already exposes `final_score`, `nutrition_modifier`, `training_permission` (types.ts lines 619/626). ✅
- `calculate-score/index.ts` writes exactly the six modifier values documented (lines 1030–1052). ✅
- `_shared/macro-calculation.ts` line 246–254 currently selects **only** `final_score` from `readiness_scores` and averages across the 7-day window. `nutrition_modifier` / `training_permission` are never read. ✅
- Return type is `CalculationResult = { user_id, status, decision?, flag_reason?, applied_target_id?, error? }` — no modifier field today.
- `nutrition_weekly_reviews` table has no `applied_modifier` column (only `flag_reason`).
- Weight-trend decision switch lives at lines ~307–325 (`fat_loss`/`muscle_gain`/`recomposition`/`strength`/`athletic_performance`).
- Abnormal-week + adherence-floor + muscle-gain under-eat guards (lines ~326–390) — untouched by this batch.

### Change (additive, `_shared/macro-calculation.ts` only)

1. **Extend readiness fetch (line 246–254)**
  - Add `nutrition_modifier, training_permission, score_date` to the select.
  - Keep the existing `avgReadiness` computation unchanged.
  - Separately, take the most recent row (max `score_date`) as `latestModifier` / `latestPermission`. Same-day directive, not blended.
2. **Decision override layer** (new block, placed **after** the weight-trend switch produces `decision`, and **before** the floor/ceiling capping — so caps still bound whatever we pick):
  ```
   const baseDecision = decision;
   let modifierOverride: null | "deficit_caution_hold" | "fuel_more_bias" = null;

   if (latestModifier === "deficit_caution" && decision === "reduce") {
     decision = "hold";
     modifierOverride = "deficit_caution_hold";
   } else if (latestModifier === "fuel_more") {
     if (decision === "reduce") { decision = "hold"; modifierOverride = "fuel_more_bias"; }
     else if (decision === "hold") {
       // bias toward increase only if goal + trend are compatible
       // (goal ∈ muscle_gain|strength|athletic_performance|recomposition, trend not already > threshold)
       if (goal !== "fat_loss" && weightTrendPerWeek < 0.5) {
         decision = "increase";
         modifierOverride = "fuel_more_bias";
       }
     }
   }
   // recovery_day_refeed | hydration_priority | protein_priority | normal → no decision change
  ```
  - Recompute `new_target_calories` from `raw_target_calories` only if `decision` changed to `increase` (hold uses `old_target_calories`; existing floor/ceiling capping continues to run).
  - For `deficit_caution_hold` we set `new_target_calories = old_target_calories` (mirrors existing hold branches).
3. **Surface reasoning (no schema change required)**
  - `flag_reason`: if currently `null` and an override fired, set to `deficit_caution_override` or `fuel_more_override` (preserves any existing higher-priority flag like `abnormal_week`, `insufficient_data`, `refeed_candidate`, `floor_aware_low_adherence` — those come first). Never overwrite an existing `flag_reason`.
  - `CalculationResult`: add two optional fields:
    - `applied_modifier?: "recovery_day_refeed" | "hydration_priority" | "protein_priority" | "deficit_caution" | "fuel_more" | "normal" | null`
    - `modifier_overrode_decision?: boolean`
  - Also carry `applied_modifier` into the row inserted into `nutrition_weekly_reviews` via the existing `flag_reason` channel only (no new column this pass). If we later want a dedicated column, that's a follow-up migration.
4. **Composition-only modifiers (`hydration_priority`, `protein_priority`, `recovery_day_refeed`)**
  - No calorie decision change.
  - Set `applied_modifier` on the return value so downstream coaching-card code (Engine 4) can pick it up. No new copy in this batch.

### Explicitly NOT in this batch

- No change to weight-trend thresholds, TDEE blending, `trainingLoadIndex`, abnormal-week detection, refeed-candidate flag, muscle-gain under-eat guard.
- No new column on `nutrition_weekly_reviews` (would be a separate migration + types regen).
- No change to `generate-plan` or coaching-card copy.
- No change to `calculate-macros-weekly` / `trigger-weekly-macro-review` callers — they just pass the extended result through.

### Test plan

- Type-check `_shared/macro-calculation.ts`.
- Unit-style smoke: fabricate readiness with each of the six modifiers + weight trend that would normally produce `reduce` and verify: `deficit_caution` → `hold`, `fuel_more` (non-fat-loss) → `hold`; with `hold` base + `fuel_more` + muscle_gain + flat trend → `increase`; `normal` → unchanged.
- Confirm `flag_reason` precedence: abnormal week still wins over override.

### Files touched

- `supabase/functions/_shared/macro-calculation.ts` (only)

### Follow-up (not this batch)

- Add `applied_modifier text` column to `nutrition_weekly_reviews` for structured audit, and surface it in review UI / coaching cards.  
  
**Two things to check before approving, not after:**
  1. **The** `new_target_calories` **recompute when decision flips to** `hold`**.** The doc says this "mirrors existing hold branches" in prose — but that's the one line most likely to have a bug that doesn't show up until a real calculation runs (e.g., if it accidentally reuses a stale value from the original `reduce` branch instead of properly falling back to `old_target_calories`). Ask Lovable to paste the actual diff for that specific block before you approve — not the summary, the code.
  2. **The test plan says "unit-style smoke" but doesn't show results.** That reads like a plan for what to test, not confirmation it was run. Ask for the actual output: fabricate a test user with each of the six `nutrition_modifier` values and a weight trend that would normally trigger `reduce`, run it, and paste the resulting `decision` + `applied_modifier` for each of the six cases. That's five minutes of work and it's the difference between "this should work" and "this works."
  One design choice worth knowing about, not blocking: the `weightTrendPerWeek < 0.5` threshold for escalating `hold → increase` under `fuel_more` is a number Lovable picked, not one either of us specified. It's not unreasonable, but it's an invented parameter — know that going in, don't assume it was derived from something.