
# BATCH B — Training Engine Prompt v2

Scope: `supabase/functions/_shared/training-rules.ts` + `supabase/functions/generate-plan/index.ts`. No schema migration. No DB write-shape change (still `weekly_plans.plan_data` jsonb).

Verified pre-conditions:
- `workout_set_logs` has no CHECK constraint on `muscle_group` — the enum values in B2 will land in an existing text column with no rejection risk.
- `training-rules.ts` `pickWeekPatterns`/`buildFallbackPlan` currently reads `trainingDaysPerWeek` only; `goal` never enters pattern selection (B1 confirmed).
- Validator `ALLOWED_TOP = {days, volume_gate_alert, plan_start_date, plan_timezone}` — anything else (e.g. `cue_version` written post-hoc by backfill-cues, or the new `plan_data_version`) would be rejected by re-validation if we ever re-ran it on a stored plan. B3 closes that gap for the new field.
- `weekly_plans.plan_data` is jsonb — additive fields are free.

---

## B1 — Goal-aware fallback patterns (isolated, first)

`training-rules.ts` — replace the days-only `pickWeekPatterns` + inline pattern block in `buildFallbackPlan` with a goal-family lookup, then fall through to a days-count switch inside that family.

Pattern families:
- `strength` → compound-heavy full/lower/upper rotation, no isolation/conditioning
- `muscle_gain` / `recomposition` → PPL rotation with isolation on 5–6 day, full-body on ≤3 day
- `fat_loss` → PPL + conditioning finisher day, full-body on ≤3 day
- `athletic_performance` → lower/full/lower/upper with power+conditioning days (never generic PPL)

Signature stays the same; only the pattern array construction changes. `pickWeekPatterns` is removed (dead — the inline switch already replaced it). Rest-mask handling unchanged.

## B2 — Closed enums

Add and export from `training-rules.ts`:

```ts
export type MuscleGroup = "chest"|"back"|"shoulders"|"quads"|"hamstrings"|"glutes"
  |"calves"|"biceps"|"triceps"|"forearms"|"core"|"full_body"|"cardio"|"mobility";
export type MovementPattern = "squat"|"hinge"|"horizontal_push"|"vertical_push"
  |"horizontal_pull"|"vertical_pull"|"lunge"|"carry"|"rotation"|"anti_rotation"
  |"locomotion"|"conditioning"|"mobility";
export type ExerciseRole = "primary"|"secondary"|"accessory"|"isolation"
  |"core"|"conditioning"|"mobility"|"power";
```

Plus `MUSCLE_GROUPS`, `MOVEMENT_PATTERNS`, `EXERCISE_ROLES` as `readonly` string arrays (Set-backed helpers for O(1) validator membership checks).

## B3 — plan_data shape v2

- Day object: add `session_purpose: string` (short, prose; separate from display `session_name`). Rest days: `session_purpose = null`.
- Exercise object: add `exercise_role: ExerciseRole`, `movement_pattern: MovementPattern`; `muscle_group` remains a string but now constrained to `MuscleGroup`.
- Top level: add `plan_data_version: 2`. Set unconditionally after generation and after fallback, so every new row written by generate-plan is v2.

Existing rows in `weekly_plans` stay untouched (readers must tolerate `plan_data_version` missing → treat as v1, meaning `exercise_role`/`movement_pattern`/`session_purpose` may be absent). Consumer changes are OUT OF SCOPE for this batch.

## B4 — Post-validation computed summaries (never asked of Sonnet)

After `validateGeneratedPlan` passes, generate-plan computes and attaches:

- `training_volume_summary`: `{ total_sets, sets_per_muscle: Record<MuscleGroup, number>, sets_per_movement_pattern: Record<MovementPattern, number>, training_days: number }`. Pure sum from the now-enumerated fields.
- `exercise_media_summary`: `{ media_status: "matched" | "missing", missing_count: number }`. Source-agnostic — no YMove references. In this batch the initial write is `media_status: "missing", missing_count: total_ex_count` (real matching stays the existing async `sync-exercise-images` job's job).

Both are computed in code, in `generate-plan/index.ts` after validation succeeds AND after `buildFallbackPlan` returns. Also added to `ALLOWED_TOP` in the validator so a hypothetical re-validation pass doesn't reject them, but Sonnet is never asked for them (see B5) and validator does not require them (they are added after `validateGeneratedPlan`).

## B5 — Sonnet prompt updates

`callClaude` system + `basePrompt` in `generate-plan/index.ts`:

1. Schema JSON string extended with `session_purpose`, `exercise_role`, `movement_pattern`, and `plan_data_version` fields. Enum values listed inline in the system prompt for `muscle_group`, `movement_pattern`, `exercise_role` — Sonnet must pick from these lists verbatim.
2. Explicit no-markdown rule, alongside the existing "no session_note/notes/tempo" bans:
   > All text fields (`cue`, `progression_note`, `session_purpose`) must be plain prose — no markdown, no asterisks, no bold syntax, no bullet lists.
3. Explicit ban on aggregate fields: "Do NOT emit training_volume_summary, exercise_media_summary, or any summary/aggregate/count field. Those are computed downstream."
4. `session_purpose` guidance: "one sentence, max ~20 words, what this session is training and why — plain prose."

## B6 — Validator whitelist + enum membership

`training-rules.ts` `validateGeneratedPlan`:

- `ALLOWED_TOP += {plan_data_version, training_volume_summary, exercise_media_summary}` (last two tolerated for re-validation of stored plans).
- `ALLOWED_DAY += {session_purpose}`.
- `ALLOWED_EX  += {exercise_role, movement_pattern}`.
- New membership checks against the enum sets:
  - `muscle_group ∈ MUSCLE_GROUPS`
  - `movement_pattern ∈ MOVEMENT_PATTERNS`
  - `exercise_role ∈ EXERCISE_ROLES`
- `session_purpose`: required non-empty string on training days, must equal null on rest days. Reject strings containing `**`, `__`, ``` ` ```, or leading `- ` (markdown guard). Same guard applied to `cue` and `progression_note`.
- `plan_data_version`: if present, must equal `2`. Not required at validation time (generate-plan sets it after), but if Sonnet emits it, it must be right.

Fallback (`buildFallbackPlan`) — every fallback exercise gets `exercise_role`, `movement_pattern`, and an enum-valid `muscle_group`; every training day gets a `session_purpose` string; top-level `plan_data_version: 2` and `session_purpose: null` on rest days.

---

## Explicitly NOT in this batch

- 4-week block periodization / `training_blocks` table.
- Component redistribution (volume grid, weight trend, contradiction card).
- PR detection, Home streak, day-by-day paged navigation.
- `superset_group_id`, `swap_options_by_equipment`.
- Any migration on `workout_set_logs` (no constraint change needed).
- Consumer updates in `workouts.tsx` for the new `plan_data_version`/`session_purpose`/`exercise_role`/`movement_pattern` fields — readers tolerate missing, but no UI is added here.

## Test / verify after implementation

1. Type-only compile: enum types + arrays are exported.
2. Manual `generate-plan` invocation for a synthetic profile per goal — inspect returned plan for: `plan_data_version=2`, `training_volume_summary` present, all exercises carry valid enum values, fallback path also v2-shaped.
3. Re-validate a stored plan through `validateGeneratedPlan` (round-trip) — passes.
4. Confirm existing v1 rows in `weekly_plans` still render (workouts.tsx already tolerates missing fields on the current fields it reads; this batch adds none it consumes yet).
