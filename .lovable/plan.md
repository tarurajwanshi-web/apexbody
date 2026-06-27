## Scope

Single file: `src/routes/workouts.tsx`. Only `SetRow` and the `Exercise` type definition change. All other components untouched.

## Change 1 — Exercise type (line 19)

Extend to include optional `muscle_group`:

```ts
type Exercise = { name: string; sets: number; reps: string; rest_seconds: number; cue?: string; muscle_group?: string };
```

## Change 2 — SetRow state (after line 566)

Add RIR state alongside existing reps/weight:

```ts
const [rir, setRir] = useState<number | null>(existing?.rir ?? null);
```

Note: `SetLog` type (line 23) doesn't include `rir` today. To keep `existing?.rir` type-safe with strict TS, also extend `SetLog` with `rir?: number | null` (in-scope: workouts.tsx only; the DB column already exists as `smallint`). This is a one-line additive change inside the same file — no other component reads it.

## Change 3 — save() row object (lines 576–584)

Add two fields to the upsert payload:

```ts
rir: rir,
muscle_group: exercise.muscle_group ?? null,
```

`rest_seconds_actual` and `target_*` columns stay null — out of scope.

## Change 4 — RIR stepper JSX in SetRow (between kg span and Check button)

Insert the stepper block exactly as specified (with `ml-auto` to push it right), then strip `ml-auto` from the Check button so it sits flush after the stepper. Stepper:
- `+` button: null → 3, else `Math.min(4, v+1)`
- value display: `—` when null, otherwise the number
- `−` button: null → null, else `Math.max(0, v-1)`

Stepper layout uses existing tokens (`bg-bg-3`, `text-text-secondary`, `text-[10px]`/`[13px]`/`[14px]`, `tabular-nums`, `active:scale-95`) — no new design tokens.

## Verification after build

- Type-check passes (Exercise + SetLog additions).
- Upsert payload still matches `onConflict: "user_id,entry_date,exercise_name,set_number"` (unchanged keys).
- `lint:ui` passes — only allowed text sizes used (10/13/14 px); no `rounded-3xl`; no forbidden font weights.

## Explicitly untouched

ExerciseLogger, DayCard, PreWorkoutCheckSheet, maybeWriteTrainingSummary, BodyScanSection, RestDaySwapCard, VolumeNudge, CueSheet, LockBanner, READINESS_OPTIONS, and every other component in the file.

## Risk notes

- `muscle_group` arrives only on plans generated after the `generate-plan` change shipped; older cached `weekly_plans.plan_data` rows store `null` → save() writes null, no breakage.
- DB columns `rir` (smallint) and `muscle_group` (text) already exist — no migration needed.
