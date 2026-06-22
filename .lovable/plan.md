
## Phase 3B QA — Weekly Nutrition Insight

No code changes proposed. Verified `src/lib/macros.functions.ts` `getWeeklyNutritionInsight`.

### 1. Week date handling — PASS

`parseISO` builds the date via `Date.UTC(y, m-1, day)`, `mondayOf` uses `getUTCDay()`, `addDays` uses `setUTCDate`, and `toISO` slices the ISO string. The whole pipeline is UTC-anchored, so YYYY-MM-DD strings round-trip without TZ drift.

- anchor `2026-06-22` (Mon) → `getUTCDay()=1`, delta `0` → week_start `2026-06-22` ✅
- anchor `2026-06-21` (Sun) → `getUTCDay()=0`, delta `-6` → week_start `2026-06-15` ✅
- anchor `2026-06-23` (Tue) → `getUTCDay()=2`, delta `-1` → week_start `2026-06-22` ✅

Day iteration compares `m.entry_date === dateISO` and `t.effective_start_date <= dateISO` as strings — no JS Date timestamp comparisons that could shift across DST/TZ.

Minor note (not a Phase 3B regression): the `cap` derivation uses `today()` which returns UTC today, not local. `anchorDate` is passed from `selectedDate` (local), so the cap is min(local anchor, UTC today, week end). In far-negative UTC offsets near midnight this could trim/extend the window by one day. Pre-existing pattern shared with the daily summary; out of scope for this QA.

### 2. Server-side filtering — PASS

One DB query scoped to the window:
```
.from("shield_nutrition_logs")
.eq("user_id", context.userId)
.gte("entry_date", weekStartISO)
.lte("entry_date", cap)
.eq("deleted", false)
```
No client-side history scan.

### 3. Per-day target resolution — PASS

`targetFor(dateISO)` selects the row where `effective_start_date <= dateISO AND (effective_end_date IS NULL OR effective_end_date > dateISO)`. Each loop iteration calls `targetFor(dateISO)` — not "latest target only". The base SQL fetches all overlapping target rows in the window.

### 4. `manual_edited` inclusion — PASS

`counted = dayMeals.filter(m => ["estimated", "manual_edited"].includes(m.calorie_estimate_status))` is used for both the totals/averages and the adherence sub-scores.

### 5. No fake data — PASS

- `weekly_nutrition_score = avgN(sumDayScore, dayScoreDays)` and `avgN` returns `null` when `n === 0`.
- `avg_macro_adherence_score` and `avg_meal_quality_score` likewise null when zero contributing days.
- `logged_days === 0` → diagnosis `"No meals logged this week yet."`; `logged_days < 3` → `main_weekly_driver` flags low confidence.

### Scope confirmation

No changes were made to: schema, edge functions, weekly graph, calendar popup, macro adjustment engine, onboarding, training, hydration logic, `score-nutrition`, or `calculate-score`.

### Files changed
None.

### Overall: PASS
