## QA Report — Timezone & Streak Sync Patch

### Pass / Fail by area

| Area | Result | Notes |
| --- | --- | --- |
| 1. First-session TZ race | ⚠️ FAIL (race window exists) | `useUserTimezone` writes browser TZ to `profiles` async. Server log fns only read `profiles.timezone` → if user logs a meal in the ~100–500 ms before the write commits, `resolveUserTimezone` returns UTC. Real bug for users in non-UTC zones on first login. |
| 2. Server TZ resolution | ✅ PASS for getters | `getTodayMeals`, `getDayNutritionSummary`, `getWeeklyNutritionInsight`, `getMacroAdjustmentReview`, `getNutritionCoachContext`, `getActivityWeek` all call `resolveUserTimezone` → `getLocalDateISO`. ⚠️ Writers (`logMeal`, `upsertManualRecovery`, `upsertMood`, `logBodyMeasurement`) use the same path but have no client-TZ fallback (issue #1). `logHydration` uses the RPC `increment_hydration`, which hard-codes `(now() AT TIME ZONE 'UTC')::date` — out of scope (hydration), reported only. |
| 3. Weekly date math | ✅ PASS | `getLocalWeekRange` derives weekday from the ISO string via a UTC anchor; weekday-of-a-calendar-date is TZ-independent, so Mon–Sun is correct in Asia/Dubai, America/New_York, Pacific/Auckland. No UTC shift of `entry_date` strings anywhere in the read path. |
| 4. Coach day sync | ✅ PASS | `coach.tsx LockedHero` computes `Day X` from `unlockDate` + `getLocalDateISO(tz)`. Same `tz` on desktop/mobile (profile-driven) ⇒ same Day X. Rolls at local midnight. |
| 5. Streak semantics separation | ✅ PASS | Coach `getActivityWeek` unions meals (non-deleted) + training + manual + workout sets + body measurements + parsed device uploads. Nutrition weekly insight & last-7 strip count non-deleted meals only. Macro review gate uses prior-completed-local-week meals (non-deleted) + weigh-ins. Distinct sources. |
| 6. Deleted-log exclusion | ✅ PASS | `.eq("deleted", false)` (or `deleted` filter post-query) applied in: `getTodayMeals`, `getDayNutritionSummary`, `getWeeklyNutritionInsight` (logged-days set), `getMacroAdjustmentReview` (review-week + last-7), `getNutritionCoachContext` (recent + week + logged_days_last_7), `getActivityWeek`. |
| 7. ApexStreakStrip reuse for Macro Review | INFO only | `MacroReviewCard` in `src/routes/nutrition.tsx` (lines 1218–1234) still renders a bespoke `🔥 / ○` row from `review.last7_logged_days: boolean[]`. Safe to swap to `<ApexStreakStrip variant="macro_review" days={…} />` — `ApexStreakDay` shape (`{ date, logged, isToday }`) is trivially constructable from `last7_logged_days` + `addDaysISO(getLocalDateISO(tz), -6+i)`. Not implementing in this pass per scope. |

### Fixes (minimal, in-scope: TZ race only)

Close the first-session race by letting the client pass its resolved IANA timezone as a hint; server prefers stored profile TZ, falls back to the hint, then UTC. No new features.

1. **`src/lib/dates.ts`** — add `resolveUserTimezoneWithHint(supabase, userId, hint)` that returns `profile.timezone || sanitizedHint || UTC`. `sanitizedHint` validates against `Intl.supportedValuesOf?.('timeZone')` when available, else a strict `Area/Location` regex; rejects anything else.
2. **`src/lib/shield.functions.ts`** — extend `inputValidator` of `logMeal`, `upsertManualRecovery`, `upsertMood`, `logBodyMeasurement` with optional `client_timezone: z.string().max(64).optional()`. Replace `userToday(...)` call sites in those four handlers with a local helper that uses `resolveUserTimezoneWithHint`.
3. **`src/components/LogModals.tsx`** — call `const tz = useUserTimezone()` once at the top of each modal that submits, and include `client_timezone: tz` in the `logMeal` / `upsertManualRecovery` / `upsertMood` / `logBodyMeasurement` payloads.
4. **`src/routes/_authenticated/onboarding.tsx`** — pass `client_timezone: getBrowserTimezone()` to the `logBodyMeasurement` call (profile row may not exist yet).

No DB migration. No changes to: hydration RPC, weekly math, Coach gating, streak semantics, ApexStreakStrip, MacroReviewCard, nutrition feature surface, training, calendar, onboarding flow, macro auto-apply.

### Out-of-scope items observed (reported, not fixed)

- `increment_hydration` RPC computes `entry_date` from `now() AT TIME ZONE 'UTC'`. Will mis-bucket hydration around local midnight for non-UTC users. Excluded by scope.
- `MacroReviewCard` could share `ApexStreakStrip`. Excluded by scope; safe future swap.

### Files to be changed
- `src/lib/dates.ts`
- `src/lib/shield.functions.ts`
- `src/components/LogModals.tsx`
- `src/routes/_authenticated/onboarding.tsx`

Confirmation: no new features; only a defensive fallback that closes the first-session TZ race for log writes.
