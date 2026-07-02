# Shared TZ helpers + per-user Monday gate for weekly macro cron

## 1. `supabase/functions/_shared/time-helpers.ts`
Append `DEFAULT_TIMEZONE = "Asia/Dubai"` and `userLocalDayOfWeek(tz, now)` verbatim.

## 2. `supabase/functions/trigger-weekly-macro-review/index.ts`
- Extend the `time-helpers.ts` import to include `userLocalDayOfWeek, DEFAULT_TIMEZONE`.
- Delete the local `userLocalDayOfWeek` function.
- Swap `|| "UTC"` → `|| DEFAULT_TIMEZONE` on the `tz` line.

## 3. `supabase/functions/evaluate-fuelling/index.ts`
- Add `import { DEFAULT_TIMEZONE } from "../_shared/time-helpers.ts";` right after the `authorize.ts` import.
- Swap `|| "UTC"` → `|| DEFAULT_TIMEZONE` on the `tz` line.

## 4. `supabase/functions/calculate-macros-weekly/index.ts`
- Add `import { userLocalDayOfWeek, DEFAULT_TIMEZONE } from "../_shared/time-helpers.ts";` after the macro-calculation import.
- Inside `for (const profile of profiles)` at line 72, as first lines inside `try {` (before `const result = await calculateMacrosForUser(`), insert the tz + `userLocalDayOfWeek(tz) !== 1` skip gate honoring `!force`. Uses the existing `force` variable (line 38).

## Not in scope
`calculateMacrosForUser`, macro math, week_start_date logic, cron schedule, any other files.

## Verify
- `rg -n "userLocalDayOfWeek|DEFAULT_TIMEZONE" supabase/functions` → helper + 3 call sites (trigger-weekly-macro-review, calculate-macros-weekly, plus DEFAULT_TIMEZONE in evaluate-fuelling).
- No `|| "UTC"` remaining in the three edited edge functions.
- No duplicate `userLocalDayOfWeek` local definition in trigger-weekly-macro-review.
