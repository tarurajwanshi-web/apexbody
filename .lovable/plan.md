## APEX Workout Generation Bridge v1B — Evidence-Informed Rules + Shield v6.3

Backend-only. Two files:

1. `supabase/functions/_shared/training-rules.ts` — NEW, pure helper (no I/O, no Deno APIs beyond types). Contains envelope resolution + plan validator + fallback template.
2. `supabase/functions/generate-plan/index.ts` — replace the "prompt → Claude → normalize" tail (lines ~234–353). Everything before line 234 (auth, queries, Shield derivation, exercise history, fuelling) stays as-is.

`calculate-score`, DB schema, `plan_data` JSON contract, and `weekly_plans` upsert shape all unchanged.

### 0. Confirmed profile values (from live DB)

- `goal`: `fat_loss` | `muscle_gain` | `strength` | `recomposition` | `athletic_performance`
- `experience_level`: `beginner` | `intermediate` | `advanced` | null → default `intermediate`
- `equipment_access`: `commercial_gym` | `home_gym_db_only` | `bodyweight_only` | null → default `commercial_gym`. (`limited_equipment` is referenced by existing prompt but not present in DB — treat as valid alias mapping to home_gym_db_only rules.)
- `training_days_per_week`: 3–6

### 1. `_shared/training-rules.ts` — exports

```
type Goal = 'fat_loss' | 'muscle_gain' | 'strength' | 'recomposition' | 'athletic_performance';
type Experience = 'beginner' | 'intermediate' | 'advanced';
type Equipment = 'commercial_gym' | 'home_gym_db_only' | 'bodyweight_only' | 'limited_equipment';
type Permission = 'green_train' | 'yellow_modify' | 'orange_reduce' | 'red_recover' | null;
type Confidence = 'LOW' | 'MEDIUM' | 'HIGH' | null;

interface EnvelopeInput {
  goal, experience, equipment, trainingDaysPerWeek,
  permission, confidence, nutritionModifier, fuellingCaution,
  systemicLoad, weeklyReduce, redDays7, orangeDays7,
}

interface Envelope {
  sessionType: 'train' | 'modify' | 'reduce' | 'recovery';
  targetRir: [number, number];           // e.g. [1,3]
  setsPerExercise: [number, number];      // e.g. [2,4]
  exercisesPerSession: [number, number];  // e.g. [4,6]
  restSeconds: [number, number];
  repRange: [number, number];             // canonical rep window
  progressionModel: 'linear' | 'double_progression' | 'autoregulated' | 'hold';
  allowedPatterns: string[];              // e.g. ['squat','hinge','push','pull','carry','lunge','core','mobility','conditioning']
  allowedTechniques: string[];            // ['straight_sets', 'antagonistic_superset', 'drop_set', 'rest_pause']
  equipmentPool: 'barbell+db+machine+cable' | 'db+bench+bands' | 'bodyweight_only' | 'db+bodyweight';
  weeklyVolumeCutPct: number;             // 0 or 20
  guardrails: string[];                   // free-text lines for prompt
}

resolveTrainingEnvelope(input): Envelope
validateGeneratedPlan(plan, envelope, weekStartISO): { ok: true } | { ok: false, violations: string[] }
buildFallbackPlan(envelope, weekStartISO, trainingDaysPerWeek, equipment): Plan  // deterministic safe template
```

### 2. `resolveTrainingEnvelope` decision tree

**Session type (Shield first):**

- `red_recover` → `recovery`
- `orange_reduce` → `reduce`
- `yellow_modify` → `modify`
- else → `train`

**Target RIR:**

- recovery: [4,5]; reduce: [2,4]; modify: [2,3]; train: goal default (strength [1,3], hypertrophy/muscle_gain/recomp [1,3], fat_loss [1,3], athletic mixed [2,4])
- Beginner: floor RIR at 2 regardless of goal.
- LOW confidence: floor at 2, ceiling +1.

**Sets/exercises per session:**

- recovery: sets [1,2], exercises [3,5], mostly mobility/technique/light conditioning.
- reduce: sets [2,3], drop 1 vs train baseline.
- modify/train: baseline by goal × experience.
- Beginner cap: sets ≤ 3, exercises ≤ 5, no advanced techniques.

**Weekly volume cut:** 20% if `weeklyReduce` (redDays7≥2 OR orangeDays7≥2 OR (red≥1 AND orange≥1) OR trendLow); else 0.

**Progression model:**

- Beginner → `linear`.
- Intermediate → `double_progression`.
- Advanced → `autoregulated`, unless recovery/reduce → `hold`.
- Any session_type ∈ {recovery, reduce} or LOW confidence → override to `hold`.

**Allowed patterns:**

- strength: squat, hinge, horizontal_push, horizontal_pull, vertical_push, vertical_pull + light accessories.
- muscle_gain / recomposition: full pattern set incl. isolation.
- fat_loss: full patterns + optional conditioning finisher (removed on reduce/recovery).
- athletic_performance: adds power/explosive patterns; removed on orange/red.
- recovery session_type: mobility, technique, light conditioning only.

**Allowed techniques:**

- Always: `straight_sets`.
- Intermediate+: `antagonistic_superset`.
- Advanced only: `drop_set`, `rest_pause`. Never on high-risk barbell compounds (deadlift/squat/clean). Never on recovery/reduce or LOW confidence.

**Equipment pool:**

- `commercial_gym` → barbell+db+machine+cable.
- `home_gym_db_only` / `limited_equipment` → db+bench+bands.
- `bodyweight_only` → bodyweight_only.

**Rest seconds:** strength [150,240]; hypertrophy [60,120]; fat_loss [45,90]; recovery [30,60]; athletic power [120,180].

**Fuelling caution** (`nutrition_modifier ∈ {hydration_priority, protein_priority, fuel_more, deficit_caution, recovery_day_refeed}` OR fuelling under/deficit): forbid training-to-failure (RIR ≥ 2), forbid metabolic finishers, remove drop_set / rest_pause.

**High systemic load (≥25):** force `hold` progression on first non-rest day, RIR ≥ 3.

**Guardrails array:** stringified summary of everything above so it can be injected into the prompt.

### 3. `validateGeneratedPlan` checks

Returns violations list; empty = ok.

Schema/shape:

- `plan.days` is array length 7.
- `day` ∈ 1..7 unique and ordered.
- `date === addDays(weekStart, day-1)` and `day_name` matches JS Date weekday for that ISO date.
- `rest` boolean; if `rest === true`: `session_name === null` and `exercises === []`.
- If `rest === false`: `session_name` non-empty string, `exercises` length ∈ envelope.exercisesPerSession.
- Only whitelisted top-level plan fields present (`days`, `volume_gate_alert`). Only whitelisted exercise fields (`name, sets, reps, rest_seconds, cue, muscle_group, progression_note`). Reject `session_note` and any extras.

Exercise-level:

- `sets` int ∈ envelope.setsPerExercise.
- `reps` string. Parse leading integer; if `session_type === recovery` allow "10-15" or time-based ("30s"). Otherwise numeric range must fall inside envelope.repRange (allow ±1).
- `rest_seconds` int ∈ envelope.restSeconds (±10s tolerance).
- `cue` non-empty ≤ 200 chars.
- `muscle_group` non-empty.
- `progression_note` non-empty.
- If `target_rir` field present (optional): must be inside envelope.targetRir.
- Equipment match: name must not contain forbidden tokens for pool (e.g. bodyweight_only rejects "barbell", "dumbbell", "cable", "machine"; db-only rejects "barbell", "cable", "machine"; etc.). Simple substring blocklist.

Beginner safety:

- No exercise name matches deny-list `["snatch","clean & jerk","clean and jerk","deficit deadlift","jefferson","zercher","muscle-up"]`.
- No `drop set`, `rest-pause`, `giant set` tokens in `cue`/`progression_note`.

Shield permission enforcement:

- If `sessionType === 'recovery'`: at least the first non-rest day must be mobility/technique/light (heuristic: all exercises `sets ≤ 2`, `reps` string contains "s" or number ≥ 8, `progression_note` matches /recovery|light|technique|mobility/i, and no compound heavy lift names).
- If `sessionType === 'reduce'`: first non-rest day sets ≤ baseline − 1, progression_note contains "hold" or "RIR" hint.
- If `sessionType === 'modify'`: first non-rest day progression_note contains readiness/warm-up hint.

Techniques:

- Reject any `cue`/`progression_note` mentioning drop set / rest-pause / cluster / myo-rep unless technique is in `envelope.allowedTechniques`.

### 4. Generation loop (replaces existing try/catch in generate-plan)

```
envelope = resolveTrainingEnvelope(...)
prompt = buildPrompt(envelope, historyNote, shieldContext, fuelNote, weekStartISO)
plan = await callClaude(prompt)
res  = validateGeneratedPlan(plan, envelope, weekStartISO)
if (!res.ok) {
   prompt2 = prompt + "\nPREVIOUS OUTPUT WAS INVALID. Violations:\n- " + res.violations.join("\n- ") + "\nReturn a corrected JSON object."
   plan = await callClaude(prompt2)
   res  = validateGeneratedPlan(plan, envelope, weekStartISO)
}
if (!res.ok) {
   plan = buildFallbackPlan(envelope, weekStartISO, days, equip)
   // set volume_gate_alert with a note that a safe fallback was used
}
```

Sonnet never self-validates — validator is deterministic and runs after every generation.

### 5. `buildFallbackPlan` (deterministic template)

- Pure function, no LLM.
- Picks pattern from envelope + equipment:
  - `bodyweight_only` → bodyweight progression (squat, push-up, row (band/inverted), hinge (single-leg RDL), core, mobility).
  - `home_gym_db_only` / `limited_equipment` → DB upper/lower or DB full-body based on `trainingDaysPerWeek`.
  - `commercial_gym` → PPL (6d), U/L (4d), full body (3d), U/L + PPL hybrid (5d).
- Straight sets only, RIR clamped to envelope, no advanced techniques.
- Every exercise: `progression_note = "safe fallback — hold weight, RIR " + rir`.
- Rest days filled with `rest:true, session_name:null, exercises:[]`.
- `volume_gate_alert` set to explain fallback was used.

Uses APEX-owned pattern names (`APEX Push A`, `APEX Lower A`, `APEX Full Body A`) — no external program branding.

### 6. Prompt changes in `generate-plan/index.ts`

- Compute envelope early using existing derived Shield vars.
- Replace the ad-hoc `goalRule` / `experienceRule` / `equipRule` strings with a serialised envelope block (`envelope.guardrails.join("\n")`).
- Keep existing `shieldContext`, `readinessNote`, `fuelNote`, `historyNote` for context.
- Extend the system prompt to reject any field outside the schema and to state RIR/technique constraints. No change to output schema.
- On fallback, still write to `weekly_plans` with `generated_by: "claude-plan-v1"` (unchanged) — the contract on disk is identical.

### 7. Plan JSON contract

No changes proposed. Existing keys retained: `days[]` with `day, day_name, rest, session_name, exercises[]`, and `volume_gate_alert`. Exercise keys: `name, sets, reps, rest_seconds, cue, muscle_group, progression_note`. No new fields.

### 8. Thresholds (single source of truth in training-rules.ts)

- Weekly volume cut trigger: `redDays7 ≥ 2 || orangeDays7 ≥ 2 || (redDays7 ≥ 1 && orangeDays7 ≥ 1) || avgReadiness < 45`.
- High systemic load: `systemic_load ≥ 25` (matches Shield v6.3 `HIGH_LOAD_CARRYOVER`).
- Weekly cut magnitude: −20% sets (drop 1 set/exercise).

### 9. Assumptions / risks

- `limited_equipment` legacy alias survives even though DB never stores it.
- Sonnet may still produce fields the validator strips; we choose to reject and reprompt rather than silently drop, so bad LLM output surfaces via fallback.
- Fallback template is intentionally conservative — some advanced users may see reduced variety when the LLM output is invalid twice. Acceptable safety trade-off.
- Reps parsing is heuristic (leading integer / hyphen range / "30s"); we tolerate ±1 on range bounds.
- Equipment substring blocklist is coarse (e.g. rejects "barbell row" for db-only). Documented in helper comments.

### 10. Validation steps (manual, after build)

1. Envelope unit smoke: call `resolveTrainingEnvelope` with each `(goal, experience, permission)` combination and log the returned envelope. Confirm:
  - beginner never gets `drop_set` / `rest_pause`.
  - `red_recover` → sessionType=recovery, progression=hold, no compounds allowed.
  - `bodyweight_only` → equipmentPool=bodyweight_only.
  - `systemic_load=30, green_train` → progression=hold, RIR floor ≥ 3.
2. End-to-end for a user with green readiness → plan generates once, validator passes, no fallback.
3. Force validator failure by mocking Claude output missing `progression_note` → verify reprompt fires and passes.
4. Force double failure (mock invalid twice) → verify `buildFallbackPlan` writes a schema-valid `plan_data` and `volume_gate_alert` mentions fallback.
5. Row with `training_permission='red_recover'` → generated first non-rest day contains only mobility/technique/light work; validator passes.
6. Row with 2× `orange_reduce` in 7 days → `volume_gate_alert` populated, sets reduced by 1 vs baseline.
7. `equipment_access='bodyweight_only'` + LLM returns a barbell → validator rejects, reprompt succeeds or fallback returns a bodyweight plan.
8. `nutrition_modifier='recovery_day_refeed'` → progression_note across all exercises reads "stop 2-3 reps short" / equivalent; no drop_set.
9. Legacy user with all readiness fields null → envelope defaults to normal `train`, validator passes.
10. `plan_data` in `weekly_plans` matches existing UI expectations (spot-check `Workouts` route rendering).

### Do NOT change

- Any DB schema, migrations, RLS.
- `calculate-score`, `parse-device-upload`, `_shared/signal-quality.ts`.
- `plan_data` shape / `weekly_plans` upsert / `generated_by` string.
- UI files.  


# Do not change the Sonnet model id.
Keep max_tokens at 3000 unless the generated JSON is being truncated.
If increasing max_tokens is required, state the reason clearly before build.  
  


- 1. Fix timezone/actionable start:
  - Include profiles.timezone in the profile SELECT.
  - Do not use upcomingMonday() as the user-facing plan start.
  - Compute plan_start_date from the user's local timezone.
  - If local hour is before 12:00 and no completed workout exists today, plan_start_date = local today.
  - Else plan_start_date = local tomorrow.
  - Keep weekly_plans.week_start_date only for DB compatibility if needed, but the actual plan_data must be rolling from plan_start_date.
  2. Fix plan_data contract deliberately:
  - Add top-level plan_data.plan_start_date.
  - Add top-level plan_data.plan_timezone.
  - Add date to every day object.
  - day remains 1..7.
  - day_name is derived from local date.
  This is a JSON contract expansion, not a DB schema migration. State that clearly.
  3. Update validator whitelist:
  Top-level allowed keys:
  days, volume_gate_alert, plan_start_date, plan_timezone.
  Day allowed keys:
  day, date, day_name, rest, session_name, exercises.
  4. Decide RIR contract:
  Preferred: add target_rir to each exercise object and validate it.
  If UI does not display it, that is okay. It can be stored for engine logic.
  Exercise allowed keys become:
  name, sets, reps, rest_seconds, cue, muscle_group, progression_note, target_rir.
  5. Acute Shield rules:
  Apply red/orange/yellow to the first upcoming non-rest training day in the rolling local-date plan.
  Do not apply to Monday by default.
  Everything else is approved:
  - new _shared/training-rules.ts
  - deterministic rules first
  - Sonnet second
  - validator after Sonnet
  - retry once
  - fallback template
  - no DB schema migration
  - calculate-score untouched
  - no training_blocks yet  
  6. Equipment and goal constraints must be applied before generation, not only after validation.
  Before calling Sonnet:
  - Resolve equipment_access into an allowed exercise pool.
  - Resolve goal into allowed training patterns.
  - Resolve experience_level into allowed complexity.
  - Pass these as hard constraints in the prompt.
  Examples:
  - bodyweight_only must never generate sled push, barbell squat, cable row, leg press, machine chest press, dumbbell press, or treadmill-only prescriptions.
  - home_gym_db_only must never generate sled push, barbell movements, cable/machine exercises, or equipment the user does not have.
  - commercial_gym may use barbell, dumbbell, cable, machine, sled, cardio equipment if appropriate.
  - fat_loss can include conditioning only if equipment supports it; for home/db-only, use alternatives like loaded carries if available, step-ups, intervals, brisk walking, circuits, or bodyweight conditioning.
  - athletic_performance can include power/conditioning patterns, but only with equipment available and only if Shield permission allows it.
  Validator must also reject equipment-incompatible exercises after generation.
  If Sonnet violates this once, reprompt with the exact equipment violation.
  If it violates twice, fallback template must use only equipment-safe exercises.