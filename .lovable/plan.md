Thread `todayLocalISO` as a `todayISO: string` prop from `WorkoutsPage` through the five top-level components that currently reference it out of scope.

### Edits (all in `src/routes/workouts.tsx`)

1. **`DayCard`** (fn at line 496):
   - Add `todayISO: string` to its props type; destructure it.
   - Render call ~line 332: add `todayISO={todayLocalISO}`.
   - Line 575: pass through — `<ExerciseLogger todayISO={todayISO} ... />`.

2. **`ExerciseLogger`** (line 583):
   - Add `todayISO: string` prop; destructure.
   - Line 612 `<SetRow ...>`: add `todayISO={todayISO}`.

3. **`SetRow`** (line 628):
   - Add `todayISO: string` prop; destructure.
   - Line 648: `entry_date: todayLocalISO,` → `entry_date: todayISO,`
   - Line 662: `await maybeWriteTrainingSummary(dayPlan, allLogs, row);` → `await maybeWriteTrainingSummary(dayPlan, allLogs, row, todayISO);`

4. **`maybeWriteTrainingSummary`** (line 712):
   - Add 4th param `todayISO: string`.
   - Line 720: `const date = todayLocalISO;` → `const date = todayISO;`

5. **`PreWorkoutCheckSheet`** (line 771):
   - Add `todayISO: string` prop; destructure.
   - Line 782: `entry_date: todayLocalISO,` → `entry_date: todayISO,`
   - Render call ~line 352: add `todayISO={todayLocalISO}`.

6. **Delete dead code**: remove line 29 `function todayISO() { ... }` — every call site is converted, and the prop name shadows it inside components regardless.

### Verification

- `rg -n "todayISO\(\)" src/routes/workouts.tsx` → zero matches.
- `rg -n "todayLocalISO" src/routes/workouts.tsx` → only inside `WorkoutsPage` (lines 53, 54, 99, 110, 117, and the two new prop pass-downs at 332/352).

### Out of scope

`plan.functions.ts`, `dashboard.tsx`, `dashboard-data.ts`, `package.json`. No new network calls.
