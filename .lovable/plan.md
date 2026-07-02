# Rolling 7-day cadence gate

Swap fixed weekday+hour gates in both weekly-cadence functions for a rolling "≥7 days since last card (or profile completion), fires at target hour local" gate.

## 1. `supabase/functions/_shared/time-helpers.ts`

Append the user's `isRollingCadenceDue(tz, now, lastCardAtIso, profileCompletedAtIso, targetHour=20, intervalDays=7)` verbatim. Uses existing `tsToLocalDate` and `addDays` from the same file.

## 2. `supabase/functions/generate-weekly-pattern/index.ts`

- Add `import { isRollingCadenceDue } from "../_shared/time-helpers.ts";`
- Profile `.select(...)` (line ~240–243): add `profile_completed_at`.
- Introduce `const now = new Date();` at the top of the per-profile loop (needed by the new helper).
- Before the current `if (!force && !isUserLocalFridayEvening(tz))` at line 261: insert the `lastCard` lookup on `daily_coaching_cards` filtered to `card_type = "weekly_pattern"`.
- Replace the condition with `!force && !isRollingCadenceDue(tz, now, lastCard?.created_at ?? null, profile.profile_completed_at, 20, 7)`.
- Delete the `isUserLocalFridayEvening` function (lines ~24–42, or whatever range it occupies).

## 3. `supabase/functions/generate-training-sync/index.ts`

Identical pattern:
- Add the same import.
- Profile `.select(...)`: add `profile_completed_at`.
- Introduce `const now = new Date();` at top of the per-profile loop.
- Insert `lastCard` lookup with `card_type = "training_sync"` just before line 92.
- Replace condition with `!force && !isRollingCadenceDue(tz, now, lastCard?.created_at ?? null, profile.profile_completed_at, 18, 7)`.
- Delete the `isUserLocalThursdayEvening` function.

## Not in scope

Prompt content, card writes, contradiction logic, idempotency check, macro/readiness queries, response payloads — all untouched.

## Verify after edit

- `rg -n "isUserLocalFridayEvening|isUserLocalThursdayEvening"` → no matches.
- `rg -n "isRollingCadenceDue" supabase/functions` → 3 hits (helper + two call sites).
- TypeScript builds clean for both edge functions.
