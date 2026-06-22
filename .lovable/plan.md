## Goal
One user-local date system so Coach Day X, Fuel "Today", streaks, and meal entry_date are consistent on desktop and mobile.

## 1. Timezone source of truth
- Migration: make `profiles.timezone` nullable (drop NOT NULL + 'Asia/Dubai' default). Existing 'Asia/Dubai' rows stay as-is (no overwrite).
- Priority: `profiles.timezone` → `Intl.DateTimeFormat().resolvedOptions().timeZone` → `'UTC'`.
- On app load (in `_authenticated/route.tsx`): if profile row's `timezone` is NULL, write browser TZ once. Never overwrite an existing value.

## 2. Shared date utilities — `src/lib/dates.ts`
Pure, runtime-agnostic. All accept an optional `timezone` arg.
- `getBrowserTimezone()`
- `getLocalDateISO(timezone, at?)` → `YYYY-MM-DD` in that TZ (uses `Intl.DateTimeFormat` parts)
- `toLocalDateISO(timestamp, timezone)`
- `addDaysISO(iso, n)`
- `isTodayLocal(iso, timezone)` / `isYesterdayLocal(iso, timezone)`
- `getLocalWeekRange(anchorISO, timezone)` → Mon–Sun
- `getPreviousCompletedLocalWeek(timezone)`
- `formatNiceDate(iso, timezone)` / `formatShortDate(iso)`

Client hook (in `src/lib/dates.ts`): `useUserTimezone()` reads profile from Supabase (cached) with browser fallback. Synchronous fallback returns browser TZ.

## 3. Server-side timezone resolution
Add helper `resolveUserTimezone(supabase, userId)` co-located in `src/lib/dates.ts` (server-safe — no DOM). Every server fn that uses `today()` calls this first to compute `today` in the user's TZ:
- `getTodayMacroSummary`, `getDayNutritionSummary` (alias), `getTodayMeals` (via `getDayMeals`), `getWeeklyNutritionInsight`, `getMacroAdjustmentReview`, `getNutritionCoachContext` in `macros.functions.ts`
- `upsertManualRecovery`, `upsertMood`, `logHydration`-callers, `getTodayHydration`, `pollLatestDeviceUpload`, `logMeal`, `logBodyMeasurement`, `getActivityWeek` in `shield.functions.ts`
- `askCoach`/insight cache in `coach.functions.ts`

## 4. Replace scattered today logic
- `NutritionDateHeader.todayLocalISO` → delegate to shared util with profile TZ.
- `nutrition.tsx` selectedDate default & isToday checks → use `useUserTimezone()`.
- `dashboard.tsx` `todayIso`, insight-dismissed key, `today` checks → user TZ.
- `LogModals.tsx` `todayISO()` → user TZ.
- `coach.tsx` `LockedHero` builds date strip from user TZ.

## 5. Streak semantics (kept distinct)
- **Coach 7-day unlock (`getActivityWeek`)**: a day counts when any of: nutrition log (not deleted), training log, manual input, workout set, body measurement, parsed device upload. Compute "today" in user TZ.
- **Nutrition streak** (used by `MacroReviewCard` lock): non-deleted meal that day.
- **Macro adjustment unlock**: previous completed local week (Mon–Sun), ≥3 logged nutrition days, ≥3 weigh-ins, no blocking pending/failed meals, valid target. Already enforced; just retarget the date math to user TZ via `getPreviousCompletedLocalWeek`.

## 6. Coach locked screen
- `LockedHero` recomputes `dayOfJourney` from `unlockDate` + user TZ (not `Date.now()` UTC math).
- "Day X of 7 — personalized coaching unlocking" stays.
- Below strip: if today logged → "Today counted 🔥". Else → "Log today to keep your unlock streak alive."
- Caption: "Today counts when you log a meal, recovery, workout, measurement, or device data."

## 7. `ApexStreakStrip` shared component
`src/components/ApexStreakStrip.tsx`. Props as spec. Used by Coach locked screen and `MacroReviewCard` lock state (replaces ad-hoc grid).

## 8. Out of scope (untouched)
Nutrition features, training, calendar, hydration/onboarding flow, Coach chat behavior, macro auto-apply, page redesign.

## Files
- migration (timezone nullable)
- new `src/lib/dates.ts`
- new `src/components/ApexStreakStrip.tsx`
- edit `src/components/NutritionDateHeader.tsx`
- edit `src/lib/macros.functions.ts`
- edit `src/lib/shield.functions.ts`
- edit `src/lib/coach.functions.ts`
- edit `src/routes/coach.tsx`
- edit `src/routes/nutrition.tsx`
- edit `src/routes/_authenticated/dashboard.tsx`
- edit `src/routes/_authenticated/route.tsx` (one-time TZ write)
- edit `src/components/LogModals.tsx`
