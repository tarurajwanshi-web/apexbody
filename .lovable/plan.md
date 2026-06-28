# Plan: Three optional logging modals (energy, sleep quality, eating window)

Pure user-driven input. No AI. All three follow the existing `Sheet` modal pattern in `LogModals.tsx`.

## 1. Migration — `add_recovery_inputs.sql`

```sql
ALTER TABLE public.shield_manual_inputs
  ADD COLUMN IF NOT EXISTS post_session_energy_rating int
    CHECK (post_session_energy_rating BETWEEN 1 AND 5);

ALTER TABLE public.shield_manual_inputs
  ADD COLUMN IF NOT EXISTS sleep_quality_rating int
    CHECK (sleep_quality_rating BETWEEN 1 AND 5);

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS eating_pattern varchar(20) DEFAULT NULL;
```

No new tables — no GRANT/RLS changes needed (existing policies on `shield_manual_inputs` and `profiles` already cover these columns).

## 2. `src/lib/shield.functions.ts` — three new server fns

All `.middleware([requireSupabaseAuth])`, Zod-validated, RLS-scoped via `context.supabase`. All use `userTodayWithHint` for the `entry_date`.

### `upsertPostSessionEnergy`
Input: `{ energy_rating: 1..5, client_timezone?: string }`
Upsert on `shield_manual_inputs (user_id, entry_date)` with `post_session_energy_rating`.

### `upsertSleepQuality`
Input: `{ sleep_quality_rating: 1..5, client_timezone?: string }`
Same upsert pattern, column `sleep_quality_rating`.

### `validateEatingWindow`
Input: `{ meal_time_iso: string, client_timezone?: string }`

Behavior:
- Read `profiles.eating_pattern`. If null → return `{ enabled: false }`.
- Parse pattern. Initial support: `"16:8"` → window 12:00–20:00 local; `"18:6"` → 14:00–20:00; `"OMAD"` → 17:00–19:00; `"flexible"` → no window (return `{ enabled: false }`). Unknown strings → `{ enabled: false }`.
- Compute meal hour in user TZ from `meal_time_iso`. Return `{ enabled: true, in_window: boolean, window_start: "12:00", window_end: "20:00", pattern: "16:8" }`.

Adherence query (separate fn `getEatingWindowAdherence`):
- Last 15 logged meals from `shield_nutrition_logs` (ordered desc by created_at).
- For each, project meal hour into user TZ and check against the resolved window.
- Return `{ pattern, window_start, window_end, in_window_count, total_count, adherence_pct }`.

(Spec calls this "calculate adherence" inside `validateEatingWindow`; splitting it keeps the validator cheap to call before every meal log and the adherence fn callable from the adherence display only.)

## 3. `src/components/LogModals.tsx` — three new modal components

Style: reuse `Sheet`, plain text, 1–5 button rows mirroring the existing `ManualRecoveryForm` rating row (numbered tiles with labels under). No markdown.

### `PostSessionEnergyModal`
- Props: `{ open, onClose, onSaved? }`.
- Question: "How energized did that session leave you?"
- Buttons 1–5 with labels: Drained / Tired / Neutral / Good / Pumped.
- Footer: primary "Save" (disabled until selected) + secondary "Skip" (closes without writing).
- Calls `upsertPostSessionEnergy` then `onSaved?.()` + `onClose()`.

### `SleepQualityModal`
- Same shape, question: "How was your sleep quality?"
- Labels: Terrible / Poor / Okay / Good / Excellent.
- Calls `upsertSleepQuality`.

### `EatingWindowValidator`
- Props: `{ open, onClose, mealTimeISO, onConfirm, onSkip }`.
- On open: call `validateEatingWindow` once; if `enabled === false` or `in_window === true`, auto-call `onConfirm()` and close (no UI flash).
- If outside window: render plain text:
  - "Your window is {window_start}–{window_end} ({pattern})."
  - "This meal at {meal_local_time} is outside."
- Buttons: "Log anyway" (calls `onConfirm()`) | "Skip" (calls `onSkip()`).
- This component does not write to the DB itself — caller persists via existing `logMeal`. (Adherence is recomputed on demand by `getEatingWindowAdherence`, not stored per-meal.)

## Wiring (out-of-scope but noted for the next prompt)

The spec asks for the modals to "show after" workout / sleep / meal logging. Hookup points exist but aren't modified in this prompt:
- Workout save in `src/routes/workouts.tsx` (after `SetRow.save()` finishes the last set of a session).
- Sleep slider in `ManualRecoveryForm` (`LogModals.tsx`) — surface `SleepQualityModal` after `Save recovery`.
- Meal submit in the meal logging flow (`LogModals.tsx`) — wrap with `EatingWindowValidator` before `logMeal`.

Wiring is intentionally deferred so this prompt only ships migration + functions + modal components.

## Out of scope
- No changes to scoring engines (the new columns aren't read by `calculate-score` yet).
- No new RLS policies, no new tables, no `service_role` operations.
- No AI calls.
