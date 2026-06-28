# Plan: Nutrition page weekly-review tier display

## Already in place (from prior turns)

- `nutrition.tsx` already queries `nutrition_weekly_reviews` directly via `supabase.from(...)` (lines 178–187), filtered to unapplied actionable rows.
- `handleApplyReview` already calls `supabase.rpc('apply_existing_weekly_macro_review', { p_review_id })` (lines 196–211).
- `WeeklyReviewCard` (lines 1546–1617) renders decision, old → new kcal, delta, flag reason, days logged / weigh-ins, and an Apply button.
- `getMacroAdjustmentReview` from `macros.functions.ts` is no longer imported or used.

## Important callout — don't remove the other `macros.functions` imports

The remaining imports from `@/lib/macros.functions` are NOT the broken review engine:

- `getTodayMacroSummary` — today's intake + current daily targets (drives the rings and current-target row).
- `getWeeklyNutritionInsight` — 7-day chart data for the Weekly Preview sheet.

These are the canonical data sources for "current macro targets" and weekly history. Removing them would blank the page. I will leave them.

## What's still missing vs. your spec

Tier-specific display variants. Currently the card looks the same for every tier (just disables Apply for `low`). Spec wants:

1. **`confidence_tier = 'low'`** → "Collecting data (day X of 7)" progress bar, no decision/kcal block, no Apply.
2. **`confidence_tier = 'medium'`** → keep current layout, add "±150 kcal adjustment available" note above the delta, Apply enabled.
3. **`confidence_tier = 'high'`** → full synthesis (decision, old→new, delta, flag) + a **training load note** derived from `training_load_index` (e.g. "Heavy training load this week" when `training_load_index >= 1.1`, "Light week" when `<= 0.9`, otherwise omit).

Also: today the query excludes `decision = 'hold'` and only fetches unapplied rows. To show a `low`-tier "collecting data" state, I'll widen the query to fetch the latest review for the current week regardless of decision/applied state, and still gate the Apply button on tier ≠ low, not abnormal, and unapplied.

## Build steps

1. **Widen review query** (lines 178–187): drop the `.is("applied_target_id", null)` and `.in("decision", ...)` filters; keep `order("week_start_date", desc).limit(1)`. This lets the card render for low-tier "still collecting" weeks.
2. **Compute `daysLoggedThisWeek`** alongside the query: count distinct `entry_date` in `shield_nutrition_logs` for the user between `week_start_date` and today (local). Pass it to `WeeklyReviewCard` as a prop.
3. **Refactor `WeeklyReviewCard`** to branch on `tier`:
   - `low`: header + "Collecting data — day {daysLogged} of 7" + a thin progress bar (`daysLogged / 7`). No Apply button.
   - `medium`: existing layout + small helper line "±150 kcal adjustment available". Apply enabled if unapplied.
   - `high`: existing layout + training-load note line when `training_load_index` is outside 0.9–1.1. Apply enabled if unapplied.
4. **Hide Apply when already applied** (`review.applied_target_id != null`) — show "Applied" pill instead.
5. No new imports from `macros.functions.ts`; no removal of `getTodayMacroSummary` or `getWeeklyNutritionInsight`.

## Open question

Confirm: leave `getTodayMacroSummary` + `getWeeklyNutritionInsight` imports intact (they're the real data layer, not the parallel review engine), and only restructure the `WeeklyReviewCard` for the three-tier UX above?
