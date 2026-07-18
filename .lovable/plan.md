## B2 — Close the chronic-fatigue gap (per-muscle weekly volume)

Two fatigue clocks stay separate: **acute** (`calculate-score` systemic_load, 4-day decay — untouched) and **chronic** (weekly sets per muscle vs landmarks — this batch). Nothing in `calculate-score/index.ts` is edited.

### Pre-flight confirmations from reads

- `training-rules.ts` lines 36–40: `MUSCLE_GROUPS` = 14 keys — chest, back, shoulders, quads, hamstrings, glutes, calves, biceps, triceps, forearms, core, full_body, cardio, mobility. My `VOLUME_LANDMARKS` matches this exactly.
- `training-rules.ts` `Goal` type = 5 values: fat_loss, muscle_gain, strength, recomposition, athletic_performance. The spec's `GOAL_MAV_MULTIPLIER` also lists `hypertrophy` and `general_fitness` which don't exist in that enum. **I'll keep them in the map (harmless dead keys) and rely on the "unknown goal → 1.0 fallback" branch so any drift in `profiles.goal` never crashes.** Called out for the reviewer, not a blocker.
- `workouts.tsx` line 708: set-log insert already writes `muscle_group: exercise.muscle_group ?? null` when the exercise object carries it. Gap is only the null branch (custom / swapped / manually-typed exercises).
- `coach.functions.ts` line 315–333: `getMuscleGroupWeeklyVolume` reads `workout_set_logs.muscle_group` but currently buckets into 6 coarse groups (chest/back/shoulders/legs/arms/core), losing quads vs hamstrings vs glutes granularity that the heat map needs for per-muscle MEV/MAV/MRV coloring. Fixing this is required for Part 4 to be honest — extending the plan by one small piece.
- `MuscleGroupVolumeGrid.tsx` renders 6 tiles with a shared `color()` threshold — matches the spec's diagnosis.
- `weekly_volume_landmarks` table already exists (foundation batch); `fuel_adjusted_mrv` column is expected there for the post-B5 upgrade path. TODO comment only, no code today.

### Part 1 — `supabase/functions/_shared/volume-landmarks.ts` (new, pure module)

- Export `VOLUME_LANDMARKS` keyed to all 14 `MUSCLE_GROUPS`, exact numbers from the spec, 3 non-hypertrophy keys `null`.
- Export `EXPERIENCE_MULTIPLIER` and `GOAL_MAV_MULTIPLIER` as specified.
- Export `effectiveLandmarks(muscle, experience, goal)` → applies `EXPERIENCE_MULTIPLIER` to mev/mav/mrv and `GOAL_MAV_MULTIPLIER` to `mav` only (per RP convention — goal shifts the productive ceiling, not the floor or true max); unknown muscle / null landmarks → returns `null`; unknown experience or goal → falls back to 1.0 silently, never throws.
- **Mirror the module to `src/lib/volume-landmarks.ts` as a thin re-export** (or duplicate constants) so the browser bundle can import it without pulling the `_shared/` Deno path. Same numbers, single source of truth via the constants living in one of the two files and the other re-exporting.

### Part 2 — Muscle resolution at log time (`src/routes/workouts.tsx`)

Extend the existing `save()` in `SetRow` (line 693):

1. Resolve `resolvedMuscle` before insert:
  - if `exercise.muscle_group` present → use it (current behavior).
  - else look up `user_exercise_muscle_map` by `(user_id, exercise_name_key)` where `exercise_name_key = exercise.name.trim().toLowerCase()` → use it if found.
  - else `null` — proceed with insert unblocked.
2. Insert the set immediately with whatever `resolvedMuscle` we have. **Never block the save on classification.**
3. If `resolvedMuscle` was `null` after save, open a lightweight modal/sheet `<MusclePickerSheet>` (new small component, same file) that shows chips for the 14 `MUSCLE_GROUPS` values (with human labels). On pick:
  - `UPDATE workout_set_logs SET muscle_group = <pick> WHERE id = <inserted id>` (RLS lets the owner update their own set — existing policy).
  - `INSERT` into `user_exercise_muscle_map` `ON CONFLICT (user_id, exercise_name_key) DO UPDATE SET muscle_group = EXCLUDED.muscle_group`.
  - Toast the confirmation.
4. Dismissing the picker is fine — set stays saved with `muscle_group = null`; next time it prompts again.

Reuse the existing bg-3/text-primary tokens; no new styling primitives.

### Part 3 — Migration: `user_exercise_muscle_map`

Exact SQL from the spec. Ordered: `CREATE TABLE` → `GRANT` (authenticated select/insert/update, service_role all — no delete since it's user-owned classification with no destructive UX) → `ENABLE RLS` → 3 own-rows policies (select/insert/update). `exercise_name_key` is the lowercased trimmed name (same nameKey approach as `exercise_image_cache`, called out as a code comment above the constraint). No trigger needed.

### Part 4 — Heat map coloring (`MuscleGroupVolumeGrid.tsx` + data source)

**Data source change (`coach.functions.ts` `getMuscleGroupWeeklyVolume`):**

- Return the full 14-key bucket (chest, back, shoulders, quads, hamstrings, glutes, calves, biceps, triceps, forearms, core, full_body, cardio, mobility). Alias legacy strings once: `delts→shoulders`, `abs/obliques→core`, `lats→back`, `quadriceps→quads` — everything else must be a canonical `MUSCLE_GROUPS` value or dropped.
- Also return the user's `experience_level` and `goal` from `profiles` in the same call (single extra select, avoids threading through the dashboard loader).

**Component change (`MuscleGroupVolumeGrid.tsx`):**

- Replace the hardcoded `color()` with `bandFor(sets, landmarks)`:
  - `landmarks === null` → neutral (grey text on default surface, no top-border tint) — cardio/mobility/full_body just show count.
  - `sets < mev` → undertrained (blue-ish / muted, uses `--bg-3` border + text-secondary; **not red** — headroom, not alarm).
  - `mev ≤ sets < mav` → productive (`T.green`).
  - `mav ≤ sets ≤ mrv` → high-but-recoverable (`T.amber`).
  - `sets > mrv` → overreaching (`T.red`).
- Grid changes from 6 tiles to 14 tiles. Layout: `grid-cols-3 md:grid-cols-4 lg:grid-cols-7` (keeps mobile density reasonable). Hypertrophy muscles first, then non-scored (cardio/mobility/full_body) grouped last so the neutral tiles don't fragment the productive band visually.
- Compute per-tile via `effectiveLandmarks(key, profile.experience_level, profile.goal)`.
- **TODO comment** above the landmarks call: "After B5 ships `weekly_volume_landmarks.fuel_adjusted_mrv` per-week rows, prefer that value over `effectiveLandmarks().mrv` when a row exists for the current week."

Existing `T` tokens (`tokens.ts`) provide green/amber/red — no new colors.

### What is NOT in this batch

- No changes to `calculate-score/index.ts` (acute clock stays intact).
- No `fuel_adjusted_mrv` writes — B5's job.
- No exercise-video / large exercise dataset import.
- No deload-trigger logic — reads landmarks but decisioning is a later batch.

### Files touched


| File                                                    | Change                                                                                                    |
| ------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `supabase/functions/_shared/volume-landmarks.ts`        | NEW — landmarks, multipliers, `effectiveLandmarks()` helper.                                              |
| `src/lib/volume-landmarks.ts`                           | NEW — browser-safe mirror (re-exports constants).                                                         |
| `supabase/migrations/<ts>_user_exercise_muscle_map.sql` | NEW — table + grants + RLS + 3 policies.                                                                  |
| `src/routes/workouts.tsx`                               | Extend `SetRow.save()` with lookup + non-blocking `MusclePickerSheet`; add small sheet component in-file. |
| `src/lib/coach.functions.ts`                            | Widen `getMuscleGroupWeeklyVolume` to 14 canonical keys + return profile experience/goal.                 |
| `src/components/dashboard/MuscleGroupVolumeGrid.tsx`    | 14-tile layout; `bandFor()` per-muscle landmark coloring; TODO for post-B5.                               |


### Verification (post-build)

1. `grep -n "chest:\|full_body:\s*null" supabase/functions/_shared/volume-landmarks.ts` — all 14 keys present, 3 null.
2. Log a set from a generated plan exercise on a test user → `SELECT exercise_name, muscle_group FROM workout_set_logs WHERE user_id=... ORDER BY created_at DESC LIMIT 5;` shows non-null muscle_group.
3. Log a custom exercise → set inserts immediately, picker appears, pick chest → row patched, `user_exercise_muscle_map` row present; log the same name again → no picker.
4. Seed a user with 8 sets on back + 8 sets on core → heat map shows back tile in the undertrained band (below MEV 10) and core tile in the productive band (above MEV 6) — proves per-muscle landmarks.
5. Cardio/mobility tiles render neutral (no red/green).
6. `sed -n '700,720p' supabase/functions/calculate-score/index.ts` matches pre-batch content (decay map untouched).

# Reply **approve** to build, or push back on any part (esp. the 14-tile grid layout, the `hypertrophy`/`general_fitness` dead-key handling, or the browser/edge landmark mirror).  
  
  
Approve, with ONE required change to Part 4's data-source remap and two confirmations.

REQUIRED CHANGE — do not silently DROP unmapped muscle_group values. Instead:

- Map the known legacy aliases exactly as the CURRENT code already does (it's the source of truth for what legacy strings exist): lats→back, delts/deltoids→shoulders, quadriceps→quads, abs/obliques→core. Preserve ALL of these — the current getMuscleGroupWeeklyVolume already handles them, so your 14-key version must too or you REGRESS existing counts.

- For any value that is neither a canonical MUSCLE_GROUPS key nor a known alias: bucket it into a "unclassified" count that is RETURNED (not dropped), and log a console.warn with the offending string. Reason: a dropped set silently under-reports weekly volume, which later mis-fires the deload trigger. We must SEE unmapped values, not lose them. The heat map can render unclassified separately or ignore it for coloring, but the data must not vanish.

CONFIRM before building:

1. Run this to see what legacy values actually exist so we know the alias list is complete:

   SELECT DISTINCT lower(trim(muscle_group)) AS mg, count(*) 

   FROM workout_set_logs WHERE muscle_group IS NOT NULL GROUP BY 1 ORDER BY 2 DESC;

   Paste the result. If anything appears that isn't a canonical key or a known alias, add it to the alias map before shipping.

2. The browser mirror (src/lib/volume-landmarks.ts): confirm the constants live in ONE file and the other re-exports, so the numbers can never drift between edge and browser. A duplicate-constants approach where both files hardcode the same numbers is NOT acceptable — one source, one re-export.

Everything else in your plan is approved as written:

- hypertrophy/general_fitness dead keys with 1.0 fallback: fine.

- 14-tile grid grid-cols-3 md:grid-cols-4 lg:grid-cols-7, hypertrophy muscles first, neutral tiles last: fine.

- effectiveLandmarks applying goal multiplier to MAV only (not MEV/MRV): correct, that's proper RP convention.

- Non-blocking set save + MusclePickerSheet + user_exercise_muscle_map ON CONFLICT upsert: correct.

- calculate-score untouched: required, confirmed.

- The post-B5 fuel_adjusted_mrv TODO comment (no fake value now): correct.