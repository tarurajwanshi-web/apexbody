## Phase 3A-polish QA — verification only

Source-of-truth check against `src/routes/nutrition.tsx` and `src/lib/macros.functions.ts`. No code changes proposed.

### Day Fuel card

- **No duplicate diagnosis copy** — PASS. The kcal gap line ("X kcal over target" / "X kcal remaining|under target") is the only place the calorie delta is shown. `main_driver` is suppressed in the UI when it begins with `Calories were` (line 213), so the calorie sentence never appears twice.
- **Main driver explains biggest issue without repeating calorie gap** — PASS. Priority in `macros.functions.ts`: fat > 130% → protein < 90% → carbs > 130% → cal > 105% → cal < 90% → "Macros were broadly aligned." A macro lever always wins over the calorie restatement; if only the calorie branch fires, the UI hides it.
- **Today + no meals shows "Start with 40–50g protein to anchor the day."** — PASS. When `isToday && !hasMeals`, the no-meal block renders `macros.coaching_line` (line 186–188), and the coaching branch for `isToday && counted.length === 0` returns exactly that string.
- **Past dates use lesson wording** — PASS. The non-today branch produces "Lesson: …" strings (high-fat / carb-heavy / protein front-loaded / portion size) or "Good adherence for this day." No next-meal copy can leak into past dates.
- **Card height reduced** — PASS. `p-5 → p-4`, calories `text-5xl → text-4xl`, bar `h-1.5 → h-1`, gaps `mt-4/mt-5 → mt-3`, coaching pill `py-1.5 → py-1`, score divider `pt-3 → pt-2.5`.
- **Scores still render when available** — PASS. The 3-up `ScorePill` row renders whenever any of quality / adherence / nutrition score is non-null; logic unchanged.

### Date behavior

- **selectedDate controls macros + timeline** — PASS. `reload()` passes `{ entryDate: selectedDate }` to `fetchMacros`, `fetchMeals`, `fetchHydrationEvents`; rerun is wired to a `selectedDate` effect.
- **Right chevron disabled on today** — PASS. `NutritionDateHeader` disables forward when `selectedDate === todayLocalISO()` (unchanged from Phase 2A).
- **Logging creates today-only meals** — PASS. `logMeal` hardcodes `entry_date: today()` server-side; viewing past dates cannot redirect the write.
- **Past-date copy** — PASS. Header right-side reads exactly `"Viewing this day. New meals log to today only."` (line 282).

### Meal impact tags

- **At most one tag per meal** — PASS. `mealImpactTag` returns a single label via if/else chain; first match wins.
- **No LLM call** — PASS. Pure local arithmetic over `estimated_calories / protein_g / carbs_g / fat_g`; no network/fetch in the helper.
- **Cards not too tall** — PASS. Tag is an inline pill `text-[10px]` with `mt-1 py-px px-1.5`, added inside the existing left column; outer card retains `p-4`.
- **Manual-edited meals counted** — PASS. `mealImpactTag` accepts both `estimated` and `manual_edited` statuses; macro totals in `getTodayMacroSummary` also include `manual_edited` (unchanged).

### Hydration placement

- **Missing target → prompt below meals** — PASS. `HydrationCard` only renders above when `isToday && hasHydrationTarget`. The compact prompt with "Add your weight in Settings…" renders after the meals `<section>` when `isToday && !hasHydrationTarget` (line 290–300).
- **Hydration calculation unchanged** — PASS. `getTodayHydration` server function untouched; `had_training_today`, `path`, ACSM target logic intact.

### Floating Coach button

- **No overlap of meal text / "Viewing this day…" copy** — PASS. Page wrapper bumped from `pb-32` to `pb-44` (line 132), which clears the floating "A" button (bottom 84px + 56px tall = ~140px footprint). The button is rendered globally via `__root.tsx` and was not moved/resized.
- **Bottom scroll padding sufficient** — PASS. `pb-44` (176px) > floating button footprint + BottomNav.

### No scope creep

Verified no edits to:

- weekly graph — n/a, not added
- calendar popup — `NutritionDateHeader` Calendar icon still decorative
- weekly macro adjustment (`calculate-macros-weekly/index.ts`) — untouched
- onboarding (`routes/_authenticated/onboarding.tsx`) — untouched
- training / workouts — untouched
- hydration calculation (`getTodayHydration` in `shield.functions.ts`) — untouched
- `score-nutrition/index.ts` — untouched
- `calculate-score/index.ts` — untouched

### Files changed in this QA pass

None.

### Notes / minor cosmetic observations (non-blocking)

- Pending-only days (no estimated meals yet) render the no-meal coaching line in the headline area. `hasMeals` is keyed on `meals_estimated`, so a single pending meal still shows the "Start with 40–50g protein…" line until estimation completes. The Verdict pill correctly shows "Incomplete" alongside it, so it's not misleading, but worth flagging for a future tweak.
- Two consecutive blank lines between the hydration prompt and `<BottomNav>` (lines 301–303). Pure whitespace; no render impact.

### Overall: PASS

All Phase 3A-polish checks pass against the current implementation. Approve this plan to acknowledge the QA report (no code will be written).