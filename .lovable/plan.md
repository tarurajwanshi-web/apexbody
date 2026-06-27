## Engine 3 — Runtime Adaptive Training

Findings from current code:
- **Nutrition averaging (FIX 3 prior batch)**: already in place — `generate-plan/index.ts` lines 122–137 group `shield_nutrition_logs` by `entry_date`, then average over `dailyTotals`. No change needed.
- **RIR in SetRow**: already wired — `SetRow` reads/writes `rir` via stepper (lines 567, 585, 616–631); type extended at line 23. No change needed.
- **Workout history**: not queried in `generate-plan`. To add.
- **Readiness volume gate**: missing — `PreWorkoutCheckSheet` (line 702) only saves mood; no `final_score` lookup or volume reduction.
- **`progression_note`**: not in plan schema or UI.

---

### FIX 1 — `supabase/functions/generate-plan/index.ts`

**Insert after line 111 (after `avgReadiness` block):** query 30-day history.

```ts
const thirtyDaysAgo = new Date();
thirtyDaysAgo.setUTCDate(thirtyDaysAgo.getUTCDate() - 30);
const thirtyDaysAgoISO = thirtyDaysAgo.toISOString().slice(0, 10);
const { data: workoutHistory } = await supa
  .from("workout_set_logs")
  .select("exercise_name, weight_kg, reps_completed, rir, entry_date")
  .eq("user_id", user_id)
  .eq("completed", true)
  .gte("entry_date", thirtyDaysAgoISO)
  .order("entry_date", { ascending: false });

const exerciseHistory: Record<string, {
  lastWeight: number; lastReps: number; lastRIR: number;
  maxVolumeSet: string; avgRIR: number;
}> = {};
const rirAcc: Record<string, { sum: number; n: number }> = {};
for (const log of workoutHistory ?? []) {
  const name = (log as any).exercise_name as string;
  const w = Number((log as any).weight_kg ?? 0);
  const r = Number((log as any).reps_completed ?? 0);
  const rir = (log as any).rir ?? 2;
  if (!exerciseHistory[name]) {
    exerciseHistory[name] = {
      lastWeight: w, lastReps: r, lastRIR: rir,
      maxVolumeSet: `${w}×${r}`, avgRIR: rir,
    };
    rirAcc[name] = { sum: rir, n: 1 };
  } else {
    const cur = exerciseHistory[name];
    const curVol = parseFloat(cur.maxVolumeSet.split("×")[0]) * parseFloat(cur.maxVolumeSet.split("×")[1]);
    if (w * r > curVol) cur.maxVolumeSet = `${w}×${r}`;
    rirAcc[name].sum += rir; rirAcc[name].n += 1;
    cur.avgRIR = Math.round((rirAcc[name].sum / rirAcc[name].n) * 10) / 10;
  }
}
```

**Prompt enrichment (line 172 prompt block):** append a history section + progression rule + extended schema instructions:

```ts
const historyNote = Object.keys(exerciseHistory).length > 0
  ? `\nRecent exercise history (last 30 days):\n${JSON.stringify(exerciseHistory, null, 2)}\n` +
    `Progression rule: if lastRIR 0-1 → +2.5–5% weight; RIR 2-3 → hold weight or +1 rep; RIR 4+ → deload or reduce volume.`
  : "";
```
Include `${historyNote}` after `${fuelNote}`.

**Schema instruction (system message, line 46):** extend exercise schema so each exercise includes `progression_note: string` (e.g. `"+2.5% from last week"`, `"hold weight, +1 rep"`, `"deload 10%"`, or `"new exercise — start moderate"`).

### FIX 2 — `src/routes/workouts.tsx`

**Type extensions (line 19):** add `progression_note?: string` to `Exercise`.

**State (around line 41):** add
```ts
const [todayReadiness, setTodayReadiness] = useState<number | null>(null);
const [volumeChoice, setVolumeChoice] = useState<"full" | "reduced" | "recovery" | null>(null);
```

**Load readiness in `loadAll` (line 50 area):** add a parallel fetch of `readiness_scores.final_score` for `score_date = today`, store in `todayReadiness`.

**Gate UI (insert between lines 250 and 251, before the rest-day branch, inside the IIFE):**
```tsx
if (todayReadiness !== null && todayReadiness < 45 && volumeChoice === null) {
  return (
    <div className="mx-5 mt-4 rounded-2xl border-l-4 border-amber-500 bg-amber-500/10 p-4">
      <p className="text-[12px] uppercase tracking-wider text-amber-300">Low readiness</p>
      <p className="mt-1 text-[14px] text-text-primary">Readiness is {todayReadiness}. Consider a recovery session.</p>
      <div className="mt-3 flex flex-col gap-2">
        <button onClick={() => setVolumeChoice('reduced')} className="rounded-xl bg-bg-3 py-2 text-[13px]">Reduce Volume (−30%)</button>
        <button onClick={() => setVolumeChoice('recovery')} className="rounded-xl bg-bg-3 py-2 text-[13px]">Recovery Session</button>
        <button onClick={() => setVolumeChoice('full')} className="rounded-xl bg-bg-3 py-2 text-[13px]">Proceed As Planned</button>
      </div>
    </div>
  );
}
```

**Apply volume reduction:** derive an `effectivePlan` from `plan.plan_data` once `volumeChoice` is set:
- `reduced`: for each working exercise, `Math.max(2, Math.ceil(sets * 0.7))`.
- `recovery`: `Math.max(2, Math.ceil(sets * 0.5))`.
- `full`: unchanged.
Keep first set (warm-up) untouched. Pass the adjusted day to `DayCard`/`ExerciseLogger`.

**Persist choice:** in `PreWorkoutCheckSheet.save` (line 705), pass and write `notes: volumeChoice ?? null` into the `pre_session_checks` insert (using existing `notes` column — no schema change).

**SetRow upsert RIR (line 585):** already includes `rir`. No change. Verified.

### FIX 3 — Surface `progression_note` in UI

In `DayCard` (line 480, exercise list) and in `ExerciseLogger` header (line 528):
```tsx
{exercise.progression_note && (
  <p className="text-[10px] text-text-tertiary mt-0.5">{exercise.progression_note}</p>
)}
```

---

### Guardrails respected
- Shield readiness calc untouched (read-only of `final_score`).
- Nutrition target logic untouched.
- Plan JSON only extended with `progression_note` (additive).
- Set logging flow unchanged; RIR remains optional.
- Volume reduction is opt-in via the gate buttons.
