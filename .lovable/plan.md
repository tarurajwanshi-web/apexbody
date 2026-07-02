# Wire Shield readiness enums into buildClosedLoop + surface red_recover from swap-plan-day

## FILE 1 — `src/lib/dashboard-data.ts`

1. Extend `DashboardReadiness` type with three new fields:
   - `training_permission: string | null`
   - `nutrition_modifier: string | null`
   - `confidence_level: string | null`
2. Extend the `readiness_scores` select to include those three columns.
3. Extend the `readiness` object construction to read them the same way as `final_score`.

## FILE 2 — `src/routes/_authenticated/dashboard.tsx`

1. Replace `buildClosedLoop` entirely with the new signature `(trainingPermission, nutritionModifier, confidenceLevel, trainingPlanned)` — branching on Shield enums `red_recover` / `orange_reduce` / `green_train`, `deficit_caution` / `fuel_more` / `recovery_day_refeed`, and `confidence_level === "LOW"`.
2. Update the call site to pass `data.readiness?.training_permission`, `data.readiness?.nutrition_modifier`, `data.readiness?.confidence_level`, `trainingPlanned`.
3. Leave `recovery`, `fuel`, `effort`, and the numeric `readiness` locals untouched — still used for Today row labels.

## FILE 3 — `supabase/functions/swap-plan-day/index.ts`

1. After the `sourceDay` validation block and before the transform comment, add a fetch of the latest `readiness_scores` row and derive `readinessWarning = training_permission === "red_recover" ? "red_recover" : null`.
2. Extend the final success response body to include `readiness_warning: readinessWarning`. No auth/validation/transform logic changes.

## Out of scope

Shield scoring, `calculate-score`, other consumers of `DashboardReadiness`, and how the client renders `readiness_warning` (this only adds it to the response payload).
