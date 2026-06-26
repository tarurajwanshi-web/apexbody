## Two surgical edits to `supabase/functions/_shared/macro-calculation.ts`

Single file. No other files touched. No schema changes.

### Edit 1 — Floor-aware abnormal week detection
Replace the single line:
```ts
const abnormal = p.user_marked_abnormal_week_start === week_start_date;
```
with the spec's block that:
- computes `sex_floor_kcal` (1500 male / 1200 female / 1350 neutral)
- derives `atCalorieFloor` from `old_target_calories <= sex_floor_kcal * 1.05`
- picks `abnormalThreshold` (0.70 at floor, else 0.45)
- treats either an explicit user mark OR `adherence_pct/100 < abnormalThreshold` as abnormal
- sets `flagReason` to `floor_aware_low_adherence` or `low_adherence` when the trigger was adherence (not the explicit user mark)

Note: `flagReason` is already declared earlier in the function as `let flagReason: string | null = null`, so the assignment is valid. The existing downstream `if (abnormal) { ... flagReason = "abnormal_week"; }` branch will still overwrite to `"abnormal_week"` only when the user explicitly marked the week — preserving current behaviour for that case while adding the new adherence-driven reasons for the implicit case.

### Edit 2 — Muscle gain under-eat guard + refeed candidate flag
Replace the single line:
```ts
const adjustment_kcal = new_target_calories - (old_target_calories || blended_tdee);
```
with the spec's block that:
1. Computes `adjustment_kcal_raw` from the capped raw target.
2. If `goal === "muscle_gain"` and `decision === "reduce"` and `adherence_pct < 75` and raw adjustment is negative → flip `decision` to `"hold"`, set `flagReason = "low_adherence_muscle_gain"`, restore `new_target_calories = old_target_calories`.
3. Queries the last 8 prior `nutrition_weekly_reviews` rows for this user, counts consecutive negative `adjustment_kcal` weeks from most recent backwards.
4. Sets `refeedCandidate` for `fat_loss` users meeting either the 8-week-at-floor or 4-week-tight-floor condition; assigns `flag_reason = "refeed_candidate"` only when no other flag is set.
5. Re-adds the original `const adjustment_kcal = ...` line at the end so downstream code is unchanged.

Both blocks reference `atCalorieFloor` and `sex_floor_kcal` declared in Edit 1, which sits earlier in the function — order is preserved.

### Verification
- `npm run lint:ui` (no UI changes expected, but cheap sanity).
- Confirm TypeScript still compiles via the existing build pipeline.
- Post-deploy, the user runs the provided SQL in Supabase to observe new `flag_reason` values surfacing on the next Monday review cycle.

### Out of scope
`calculate-macros-weekly/index.ts`, `trigger-weekly-macro-review/index.ts`, any other edge function, DB schema, and all frontend files remain untouched.
