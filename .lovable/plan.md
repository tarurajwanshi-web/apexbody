# Nutrition MVP Stabilization — Diff Plan

Scope: tighten the existing capture → review → save → edit/delete → recalculate → expose-context loop. No new screens, no Coach chat, no auto-apply, no graph redesign.

## A. Fuel page IA (`src/routes/nutrition.tsx`)
- Enforce section order: Date selector → Daily Fuel → Weekly Preview → **Macro Adjustment Review** → Meals timeline → (Hydration where it currently sits).
- Remove any duplicate weekly card outside the Weekly Adherence sheet.
- Add bottom padding so `FloatingCoach` never overlaps the last meal row or the Save/Delete CTAs (`pb-44` confirmed; bump on small viewports if needed).

## B. Meal logging — capture → review → save (`src/components/LogModals.tsx`)
- Capture step copy: title "Log a meal", "Photo recommended", note label "Anything not visible?", placeholder "e.g. oil, sauce, drink, extra rice", primary button "Detect food".
- Detection calls `detectMealItems` only — never persists a row.
- Review step "Review meal" / "Adjust servings before saving." with totals on top, per-item rows showing name, serving size, serving count, grams, P/C/F/kcal, confidence chip, source chip (photo / your note / photo + note), uncertainty note.
- Structured serving controls: serving size enum (1 serving, 1 piece, 1 cup, 100g, full package, estimated portion, custom), numeric servings, editable grams.
- Recompute rules: grams edit → proportional macro recompute from per-gram base; servings edit → grams + macros recompute when base serving exists; serving-size text alone never changes macros.
- "Add item" opens an item editor sheet (no zero-row insertion). Validates non-empty name; warns "Add macros or estimate this item before saving." if grams set but all macros 0; requires explicit confirm for true zero-macro item.
- Inputs `text-base` (≥16px) to block iOS zoom; sticky Save bar with safe-area padding; focus-scroll into view; long names truncate.

## C. Anti-hallucination detection (`src/lib/shield.functions.ts` → `detectMealItems`)
- Tighten prompt: only visible foods, no invented sides/sauces/drinks/counts, generic names when uncertain, tag each item `source: photo | your note | photo + note`, attach `confidence` and `uncertainty_note`. Packaged-food rule: when net weight visible → `serving_size: full package`, grams = net weight, note when macros are estimated vs label-read.

## D. Save semantics (`logMeal` in `shield.functions.ts`)
- Only on Save: upsert `shield_nutrition_logs` with `confirmed_items`, derived `estimated_*` macros (sum of confirmed_items), `vision_detected_items` (raw), `user_confirmed_vision=true`, `calorie_estimate_status='manual_edited'`.
- Guard in `score-nutrition` consumer path: reviewed rows (`user_confirmed_vision=true` OR `calorie_estimate_status='manual_edited'`) keep their macros; scoring may update score fields only. (Server-side already respects `manual_edited`; verify and document — no edge-fn change.)

## E. Meal detail / edit / delete / undo
- `MealDetailModal.tsx`: prefer `confirmed_items`; show serving size / count / grams, confidence, source. Add "Edit portions" entry that reopens the Review sheet pre-filled; on save it recomputes macros and keeps `manual_edited`.
- `UnifiedTimeline` (in `nutrition.tsx`): trash icon → confirm dialog ("Delete this meal? This removes it from daily macros and weekly adherence."). Calls existing `softDeleteMeal` (ownership-checked, soft only, photo retained).
- Snackbar "Meal deleted" + "Undo" (5s) → `restoreMeal` restores `deleted=false` without rescoring.
- Centralize a `reloadNutrition(selectedDate)` helper that refetches: day meals, `getDayNutritionSummary`, `getTodayMacroSummary`, `getWeeklyNutritionInsight` (preview + sheet anchor), `getMacroAdjustmentReview`, pending/failed counters. Called after save/edit/delete/undo.

## F. Filter audit (`src/lib/macros.functions.ts`, `shield.functions.ts`)
- Every summary query filters `deleted=false`, includes statuses `('estimated','manual_edited')` for consumed totals, excludes `pending`/`failed` from consumed (counted separately).
- Deleted pending rows excluded from pending counter.
- Confirm weekly graph, macro review, readiness pillar consumers all share the filter.

## G. Macro Adjustment Review (`getMacroAdjustmentReview`)
- Window: previous completed local Mon–Sun only.
- Gates: ≥3 logged days, ≥3 weigh-ins, no abnormal-week flag, no major pending/failed, valid target row.
- Failing gates → `decision: 'locked' | 'insufficient_data'`, `can_apply: false`, `blockers: [...]`, `unlock_progress: { logged_days, required_logged_days, weigh_in_count, required_weigh_ins }`, `last_7_days: [{date, logged}]`.
- Safety: BMR floor, protein floor by goal/bodyweight, fat ≥ max(0.4 g/kg, 25% kcal), cap ±150 kcal/wk, no duplicate active targets.
- Apply remains **deferred** ("Review only" label). No call to `apply_weekly_macro_review` from UI in this patch.
- Return shape matches spec in section E6.

## H. MacroReviewCard UI (`nutrition.tsx`)
- Title "Next target review". Locked copy:
  "Macro adjustment locked" / "Need {N} more logged days and {M} more weigh-ins to unlock a reliable adjustment." / support line "Apex only changes targets after enough data to avoid bad adjustments." / progress rows "Nutrition logs X/3", "Weigh-ins X/3".
- Streak row: 7 evenly-spaced day cells, label under each, today marker aligned, 🔥 inside circle when logged, ○ when missing. Single header icon only.
- Ready state: shows recommended kcal delta and per-macro deltas, "Review only" / "Apply deferred" badge — no Apply button.

## I. Weekly Preview / Sheet consistency
- Both consume the same `getWeeklyNutritionInsight` result.
- Stacked graph kept; title "Macro calories by day", subtitle "Protein, carbs, and fat stacked against your calorie target.". Empty state when `logged_days===0`: "No meals logged this week yet." / "Log meals to see your macro pattern.". Low-confidence chip when `logged_days < 3`.

## J. Engine B context (`src/lib/coach.functions.ts` → `getNutritionCoachContext`)
- Pure aggregator over existing summaries — no LLM call. Excludes deleted, includes manual_edited. Returns: `selected_date_summary, today_summary, weekly_insight, macro_adjustment_review, recent_meals, logged_days_last_7, unlock_status, blockers, next_best_action`.
- Wired but not consumed by chat in this patch.

## K. Migration
- Only if columns missing from prior patch: `vision_detected_items jsonb`, `confirmed_items jsonb`, `vision_provider text`, `vision_confidence numeric`, `user_confirmed_vision bool default false` on `shield_nutrition_logs`. Verify first via `supabase--read_query`; skip if present.

## Out of scope (explicit)
Calendar, training, hydration/onboarding, barcode, frequent meals, graph redesign, Coach chat, auto-apply, new nutrition page redesign.

## Files touched
- `src/routes/nutrition.tsx`
- `src/components/LogModals.tsx`
- `src/components/MealDetailModal.tsx`
- `src/lib/shield.functions.ts`
- `src/lib/macros.functions.ts`
- `src/lib/coach.functions.ts` (new helper only)
- migration only if needed

Reply **approve** to implement, or send edits to revise the plan.
