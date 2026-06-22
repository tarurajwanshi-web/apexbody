# Nutrition Closeout Patch — Diff Plan

Scope = three sections (A meal review, B delete/undo, C+D macro adjustment review with lock). No calendar, training, hydration, coach, graph redesign, or auto-apply work.

## Section A — Review-before-save loop

**Migration** `supabase/migrations/<ts>_nutrition_review.sql`
- `ALTER TABLE shield_nutrition_logs ADD COLUMN vision_detected_items jsonb`
- `ADD COLUMN confirmed_items jsonb`
- `ADD COLUMN vision_provider text`
- `ADD COLUMN vision_confidence numeric`
- `ADD COLUMN user_confirmed_vision boolean NOT NULL DEFAULT false`
- No new GRANTs (existing table grants apply).

**Edge function** reuse existing `score-nutrition`. Add a new lightweight server function (no edge fn) `detectMealItems` in `src/lib/shield.functions.ts` that:
- Accepts `{ photo_url?, note?: string }`
- Calls Lovable AI Gateway (already wired) with an anti-hallucination system prompt: forbid invented sauces/drinks/sides/counts; use generic names ("chicken pieces" vs "chicken breast") unless visible or in user note; tag each item with `source` (`photo` / `your note` / `photo + note`), `confidence`, `uncertainty_note`, `gram_range_min/max`.
- Returns array of detected items (no DB write).

**Server fn** `logMeal` (`src/lib/shield.functions.ts`):
- Extend input to accept `confirmed_items`, `vision_detected_items`, `vision_provider`, `vision_confidence`.
- When `confirmed_items` is present: derive `estimated_calories/protein/carbs/fat` and `estimated_items` from confirmed_items sum, set `calorie_estimate_status='manual_edited'`, set `user_confirmed_vision=true`. Skip score-nutrition macro re-estimation (still trigger quality scoring for protein_tier/carb_quality/timing).
- `confirmed_items` becomes the source of truth; do NOT overwrite once set.

**UI** `src/components/LogModals.tsx` — replace 2-step (capture → confirm description) with 3-step (capture → review → save):
- Capture step copy: "Photo recommended", note label "Anything not visible?", placeholder "e.g. oil, sauce, drink, extra rice", primary button "Detect food".
- New Review step: sheet titled "Review meal" / "Adjust servings before saving."
  - Top macro summary (cal/P/C/F), recomputes live as user edits grams.
  - Item rows: editable name, quantity_description, grams, kcal/P/C/F; confidence badge; source chip; uncertainty note; remove (×) and "Add item" button.
  - Editing grams scales per-item macros proportionally from the per-gram density implied by the initial estimate.
  - Primary "Save meal" persists `confirmed_items` + computed totals via extended `logMeal`.
- Macros never persisted until "Save meal" tap.

**Meal detail modal** `src/components/MealDetailModal.tsx` — render `confirmed_items` when present (fallback to `estimated_items`) so names/portions stay consistent.

## Section B — Delete / undo in UnifiedTimeline

**`src/routes/nutrition.tsx` `UnifiedTimeline`**:
- Add small trash icon on each meal row → confirm dialog ("Delete this meal? This removes it from daily macros and weekly adherence." Cancel/Delete).
- On confirm: call existing `softDeleteMeal({ id })`; optimistically remove from list.
- Show snackbar "Meal deleted · Undo" (5s). Undo → `restoreMeal({ id })` then reload meals, daily fuel, weekly preview/sheet.

**Server fn** `src/lib/shield.functions.ts`:
- Add `restoreMeal` (mirror of `softDeleteMeal`: set `deleted=false`, RLS-scoped, no re-score needed).

**Filter audit** verify `deleted=false` already applied in:
- `getDayNutritionSummary`, `getTodayMacroSummary`, `getWeeklyNutritionInsight`, pending/failed counts in weekly insight, readiness nutrition signal in `calculate-score` if it reads nutrition logs. (Read-only check; patch any miss with a `.eq('deleted', false)`.)

## Section C+D — Macro adjustment review (locked-state, review-only)

**Server fn** `getMacroAdjustmentReview` in `src/lib/macros.functions.ts`:
- Window = previous completed local Mon–Sun week relative to today.
- Pull nutrition logs `deleted=false AND calorie_estimate_status IN ('estimated','manual_edited')`, weigh-ins from `body_measurement_events`, current `daily_macro_targets` for that week, profile (goal/sex/weight/BMR).
- Gates: ≥3 logged days, ≥3 weigh-ins, no pending/failed meals in window, no abnormal flag, valid target. If any gate fails → `decision='Insufficient data'`, `can_apply=false`, populated `blockers[]`.
- If gates pass: compute observed TDEE from avg intake + weight trend (7-day linear slope * 7700 kcal/kg). Apply decision rules per goal (fat-loss / muscle-gain / maintenance) with adherence + trend.
- Safety clamps: never below BMR, fat ≥ max(0.4 g/kg, 25% kcal), cap delta ±150 kcal/week (±250 only if existing weekly-review backend permits — keep at ±150 since current `apply_weekly_macro_review` semantics differ).
- Return full shape per spec including `recommended_protein_g/carbs_g/fat_g`, `coach_note`, `can_apply: false` (apply deferred — see below).

**No new edge fn**. `calculate-macros-weekly` stays untouched; we only read.

**Apply behavior**: **deferred**. `can_apply=false` always in this patch; no "Apply targets" button. Reasoning: existing `apply_weekly_macro_review` RPC requires exactly one active target row and a specific review-row contract — wiring it safely is out of MVP closeout scope.

**UI** `src/routes/nutrition.tsx` — new compact card "Next target review" below weekly preview AND inside Weekly Adherence sheet:
- **Locked state** (gates unmet): 🔒 "Target review locked" / "Log 3 nutrition days and 3 weigh-ins to unlock a reliable adjustment." Progress rows `Nutrition logs: X/3`, `Weigh-ins: X/3`. 7-day streak strip (🔥 filled / ○ empty / "Today" label).
- **Insufficient (weekly adherence early signal)**: 🧊 "Early signal · Log {n} more days to unlock a reliable weekly pattern." Shown inside weekly sheet header when `logged_days < 3`.
- **Unlocked / Ready**: 🔥 "Review unlocked" then decision card: title (Hold / Ready to adjust / Abnormal week), recommended kcal delta, reason, coach_note. No Apply button.
- **Applied**: not reachable in this patch (apply deferred).

## Files changed

- `supabase/migrations/<ts>_nutrition_review.sql` (new)
- `src/lib/shield.functions.ts` — `detectMealItems` (new), `logMeal` extended, `restoreMeal` (new), filter audit on read fns
- `src/lib/macros.functions.ts` — `getMacroAdjustmentReview` (new); audit `deleted=false` filter
- `src/components/LogModals.tsx` — 3-step review flow
- `src/components/MealDetailModal.tsx` — prefer `confirmed_items`
- `src/routes/nutrition.tsx` — UnifiedTimeline delete/undo, Next target review card (locked + unlocked states), 🧊 banner in weekly sheet
- `src/integrations/supabase/types.ts` — regenerated after migration

## What is NOT changed
Calendar, training, hydration, onboarding, frequent meals, weekly stacked graph layout, Coach/Engine B, automatic macro adjustment apply, score-nutrition core logic.

Awaiting approval before implementing.
