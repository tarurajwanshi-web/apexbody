## Two surgical edits to `src/routes/workouts.tsx`

### 1. Persist volume choice to `pre_session_checks.volume_adjustment`
In `PreWorkoutCheckSheet.save()` (~line 705), extend the `.insert({...})` payload:

- Before: `{ user_id, entry_date, session_readiness, created_at }`
- After: `{ user_id, entry_date, session_readiness, volume_adjustment: volumeChoice ?? 'full', created_at }`

This requires `volumeChoice` to be accessible inside `PreWorkoutCheckSheet`. I'll verify whether it's already in scope (passed as prop / lifted state) or needs to be threaded down as a prop — if the latter, I'll add a `volumeChoice` prop to the sheet's signature and pass it from the parent.

### 2. Default-safe readiness gate (~line 250)
- Before: `if (todayReadiness !== null && todayReadiness < 45 && volumeChoice === null)`
- After:  `if ((todayReadiness ?? 50) < 45 && volumeChoice === null)`

Effect: when no readiness has been logged for today, the value defaults to 50 and the gate stays closed (no warning UI, no forced volume reduction).

### Assumptions / verification step during build
- The `pre_session_checks` table has a `volume_adjustment` column accepting strings like `'full' | 'reduced_70' | 'reduced_50'` (or whatever `volumeChoice` produces). I'll confirm via a quick schema read before writing, and if the column is missing or typed differently I'll surface that rather than guessing.
- No other call sites or types need changing.