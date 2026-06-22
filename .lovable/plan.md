# Phase 3B QA — Weekly Preview & Bottom Sheet

Verification of `getWeeklyNutritionInsight` (`src/lib/macros.functions.ts` L350–739) and the weekly UI in `src/routes/nutrition.tsx` (L654–1027).

## Pass / Fail

| Area | Result | Notes |
|---|---|---|
| `week_start_date` / `week_end_date` are plain `YYYY-MM-DD` | PASS | Built via `toISO(Date.UTC(...))`, no time component. Match `shield_nutrition_logs.entry_date` directly. |
| No UTC drift on week boundaries | PASS | `parseISO` → `Date.UTC(y, m-1, d)`, `mondayOf` uses `getUTCDay`/`setUTCDate`, `toISO` slices ISO. All round-trips stay UTC; entry_date compared as string. |
| Sheet anchors to `selectedDate` | PASS | `WeeklyGraphSheet` resets `anchor` to `initialAnchor` on each open (effect L748–750), passes anchor through `getWeeklyNutritionInsight`. |
| Right chevron disabled on current/future week | PASS | `isCurrentOrFutureWeek = data.week_end_date >= todayLocalISO()` (L776) wired to `disabled` on Next. |
| Color consistency w/ daily card | PASS | Daily macros use Protein `#F59E0B`, Carbs `#10B981`, Fat `#3B82F6` (L235–237). Chart legend + segments use the same hexes (L863–865, 981–983). App-wide convention is already amber/green/blue, not new. |
| Bottom sheet close: X, outside tap, Escape | PASS | Backdrop button (L784), X button (L802), Escape listener (L764–769). `role="dialog"` + `aria-modal`. |
| `manual_edited` meals count | PASS | `counted` filter includes `["estimated","manual_edited"]` (L453, 515, 668). |
| Pending/failed excluded from consumed, counted as incomplete | PASS | Excluded from `counted`; tracked via `pending_meal_count`/`failed_meal_count` (L447–457, 684–685). |
| Deleted meals excluded | PASS | Query filters `deleted=false` (L408). |
| No fake data for empty days | PASS | `weekly_nutrition_score = null` when no scorable days; empty-day bar renders a 4px neutral stub (L961–977), not a fabricated value. |
| Per-day target resolution | PASS (already verified Phase 3B) | `targetFor(dateISO)` picks the overlapping row. |
| Visual QA on 390px width | PASS | Margins `mx-5`, radius `rounded-3xl` (preview) / `rounded-2xl` (sub-cards), grid 2-col metric cards, SVG `viewBox` scales. Floating Apex button uses its existing offset and sits above bottom nav; sheet has its own z-80 layer so Apex sits below it. |

## Issue Found (material) — Stacked bar uses macro-derived kcal, summary uses `estimated_calories`

**Concern from spec:** bar heights use `p*4 + c*4 + f*9` while the summary card shows `avg_calories` from `estimated_calories`. The LLM's `estimated_calories` regularly diverges from the Atwater sum (rounding, fiber, alcohol, mixed dishes), so the graph and "Average calories" can disagree by 5–15%, and the dashed target line — calibrated against `avg_target_calories` (the user's calorie target, not a macro reconstruction) — sits in the wrong place relative to the bars.

**Fix (graph only, no logic/scoring changes):**

1. In `getWeeklyNutritionInsight` per-day builder, return both:
   - `consumed_calories` (already there, from `estimated_calories`)
   - `protein_calories`, `carb_calories`, `fat_calories`, `macro_total_calories` (already there, used only for proportions)
2. In `StackedBarChart`:
   - `barTotal = d.consumed_calories` (drives bar height)
   - For each segment: `segCal = barTotal * (s.v / d.macro_total_calories)` when `macro_total_calories > 0`
   - Fallback when `macro_total_calories === 0` but `consumed_calories > 0` (e.g. macros missing): render a single neutral-grey bar of height `consumed_calories` so the user still sees the day's calories.
   - Fallback when `consumed_calories === 0`: keep current empty-day placeholder.
3. `yMax = max(max(consumed_calories across days) * 1.05, avg_target_calories * 1.15, 800)` — replaces the current `maxStack` (which was macro-sum-based) so the target dashed line and bars share one calorie scale.

This keeps the macro color story (proportions still come from real macros) while making bar height = the same calories the summary, daily card, and target line use.

## Files to change

- `src/routes/nutrition.tsx` — `WeeklyGraphContent` (`yMax`) and `StackedBarChart` (segment math + zero-macro fallback). ~15 lines.

No changes to: `getWeeklyNutritionInsight` returned shape (all needed fields already present), schema, edge functions, calendar, macro adjustment, onboarding, hydration, training, `score-nutrition`, `calculate-score`.

## Final stacked bar formula (after fix)

```
barTotal      = day.consumed_calories            // from estimated_calories sum
macroTotal    = day.macro_total_calories         // p*4 + c*4 + f*9

if macroTotal > 0 and barTotal > 0:
    proteinH = innerH * barTotal / yMax * (day.protein_calories / macroTotal)
    carbH    = innerH * barTotal / yMax * (day.carb_calories    / macroTotal)
    fatH     = innerH * barTotal / yMax * (day.fat_calories     / macroTotal)
elif barTotal > 0:
    render single neutral bar of height innerH * barTotal / yMax
else:
    render empty-day placeholder

yMax = max( max(day.consumed_calories), avg_target_calories * 1.15, 800 ) * 1.05
```

## Final macro color mapping (unchanged, app-wide)

- Protein → `#F59E0B` (amber)
- Carbs   → `#10B981` (emerald)
- Fat     → `#3B82F6` (blue)
