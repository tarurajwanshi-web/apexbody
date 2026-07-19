# B5.5 — Cardio: Prescribed, Logged, Fatigue-Feeding (NEVER Calorie-Feeding)

## Governing principle (verified against code)

Cardio does exactly three things: **prescribed** (goal-dosed dose in the plan), **logged** (companion table), **fed into fatigue** (calculate-score strain input). It explicitly does **NOT** feed the calorie target. Verified at `macro-calculation.ts:228-236`: `new_observed_tdee = avg_daily_intake + |daily_delta_kcal|` — TDEE is computed **backward from weight trend**, so cardio burn is already inside the trend. Adding cardio kcal to macros would double-count and stall fat loss.

Envelope integration is verified at `training-rules.ts:181-185`: `conditioning` is already in `MOVEMENT_PATTERNS` and pushed onto `allowedPatterns` for fat_loss/athletic and stripped on reduce/recovery. B5.5 layers dose/placement on top; the envelope stays authoritative for allowed patterns.

---

## Part 1 — New file: `supabase/functions/_shared/cardio-rules.ts`

Pure module. Exports:

```ts
export type CardioModality = "zone2" | "liss" | "intervals" | "mixed";

export interface CardioPrescription {
  weekly_sessions: number;
  minutes_per_session: number;
  modality: CardioModality;
  intensity_note: string;
  placement_note: string;
  rationale: string;
  allow_interval_swap: boolean; // advanced fat_loss / athletic only
}

export function resolveCardioPrescription(input: {
  goal: Goal;
  experience: Experience;
  phase: "accumulation" | "deload";        // from mesocycle_state
  weeklyReduce: boolean;                    // from envelope
}): CardioPrescription
```

Per-goal intermediate baseline (evidence-cited in a top-of-file comment referencing BBM 150 min/wk, concurrent-training reviews for LISS min-interference, HIIT small-dose):


| goal                 | sessions | min | modality | notes                                    |
| -------------------- | -------- | --- | -------- | ---------------------------------------- |
| fat_loss             | 3        | 30  | zone2    | intervals swap allowed for advanced only |
| muscle_gain          | 2        | 25  | zone2    | LISS min-interference range              |
| recomposition        | 3        | 25  | zone2    | —                                        |
| strength             | 2        | 20  | zone2    | steady-state only, never with intervals  |
| athletic_performance | 3        | 25  | mixed    | 2 zone2 + 1 intervals                    |


Experience scaling: `beginner` → sessions−1 (floor 1), minutes−5 (floor 15), all zone2 (no intervals). `advanced` → upper end + allow interval swap where listed.

Deload / weeklyReduce: sessions−1 (floor 1), minutes−5 (floor 15), steady-state only, `allow_interval_swap=false`.

Also export `cardioReadinessSoftening(permission)` returning `{ optional: boolean; minutes_delta: number; force_zone2: boolean }` — on `red_recover` / `orange_reduce`, cardio becomes optional and drops to a light zone2 floor.

Top-of-file comment (required, literal): "Cardio intentionally does NOT feed the calorie target — adaptive TDEE (weight-trend-based, see macro-calculation.ts line 232) already captures cardio burn; adding it here would double-count and stall fat loss."

---

## Part 2 — plan_data schema extension (`generate-plan/index.ts`)

Add an OPTIONAL `cardio` field on each day. NOT inside `exercises[]`.

```
day.cardio = {
  modality: "zone2" | "liss" | "intervals" | "mixed",
  minutes: number,
  intensity_note: string,
  optional: boolean
} | null
```

**Deterministic placement engine** (pre-Sonnet, in `generate-plan/index.ts`):

1. Call `resolveCardioPrescription` using `goal`, `experience_level`, mesocycle `phase`, `envelope.weeklyReduce`.
2. Distribute `weekly_sessions` across the 7-day calendar with priority order:
  - Prefer `rest_flag=true` days.
  - Otherwise a non-heavy-leg training day (heuristic: session_name doesn't contain "leg"/"lower"/"squat"/"deadlift" — the plan hasn't been generated yet, so use the training-day slot index; simplest deterministic rule: avoid the day immediately preceding a training day whose slot the engine will typically assign to lower).
  - Never the calendar day immediately before another training day for `strength` goal.
3. Apply `cardioReadinessSoftening(latestTrainingPermission)` to each assigned day; set `optional=true` and shrink minutes on softened days.
4. Emit a `cardio_placements: { [dayIndex]: cardioObj }` structure and pass it to Sonnet as a **fixed input** (same category as `restMask`).

**Prompt changes**:

- Extend the schema in the system prompt: `day.cardio` is optional, one of the shape above or `null`.
- Add hard constraint: "cardio field is authoritative from the engine; echo the provided cardio_placements exactly. Do NOT invent, add, remove, or move cardio."
- Include `CARDIO_PLACEMENTS (hard)` block in the user prompt, analogous to `REST_MASK`.

**Validator** (`validateGeneratedPlan` in `training-rules.ts`): reject plans where `day.cardio` diverges from the engine's `cardio_placements` on any day (missing, extra, or moved).

**Fallback plan** (`buildFallbackPlan`): apply the same `cardio_placements` deterministically. Fallback is the ground truth if Sonnet fails validation.

---

## Part 3 — DB migration: `cardio_logs`

```sql
CREATE TABLE public.cardio_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  entry_date date NOT NULL,
  modality text NOT NULL,
  minutes smallint NOT NULL,
  intensity text,
  perceived_effort smallint,
  source text NOT NULL DEFAULT 'manual',
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT cardio_minutes_check CHECK (minutes >= 0 AND minutes <= 600),
  CONSTRAINT cardio_rpe_check CHECK (perceived_effort IS NULL OR (perceived_effort BETWEEN 1 AND 10)),
  CONSTRAINT cardio_intensity_check CHECK (intensity IS NULL OR intensity IN ('zone2','liss','intervals','mixed')),
  CONSTRAINT cardio_source_check CHECK (source IN ('manual','wearable'))
);
CREATE INDEX cardio_logs_user_date ON public.cardio_logs (user_id, entry_date DESC);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.cardio_logs TO authenticated;
GRANT ALL ON public.cardio_logs TO service_role;
ALTER TABLE public.cardio_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own rows all" ON public.cardio_logs FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
```

Plus a Shield dispatch trigger mirroring `workout_set_logs_score_dispatch`: on insert/update, call `shield_dispatch_calculate_score(user_id, entry_date)` so a cardio log immediately re-triggers readiness for that day.

---

## Part 4 — Cardio feeds fatigue in `calculate-score`

In `calculate-score/index.ts`, in the training-strain pillar input for the entry date:

1. Query `cardio_logs` for `(user_id, entry_date)`.
2. Compute a modest cardio-strain contribution using published coefficients (document them in-code):
  - `zone2`/`liss`: `minutes * 0.35`
  - `mixed`: `minutes * 0.55`
  - `intervals`: `minutes * 0.9`
3. Cap the per-day cardio contribution at ~30 strain-equivalent points so a big cardio day cannot dominate the training pillar (lifting still leads).
4. Add to the existing strain sum used for `load_carryover.systemic_load` so next-day readiness reflects the load via the existing decay map.

No changes to weights, formulas, or thresholds — only the strain-input aggregation gains a cardio term.

---

## Part 5 — Guardrails against double-counting

Explicit **negatives** enforced by this batch (verification #8 is the moat check):

- No import of `cardio-rules.ts` or `cardio_logs` in `macro-calculation.ts`, `calculate-macros`, or `evaluate-fuelling`.
- No new column on `daily_macro_targets`.
- `advance-mesocycle` and `compute-volume-landmarks` unchanged.

CI-style grep asserted in verification: `rg "cardio" supabase/functions/_shared/macro-calculation.ts supabase/functions/calculate-macros supabase/functions/evaluate-fuelling` must return nothing.

---

## Part 6 — Client surface (minimal for this batch)

- **Log path**: add a "Cardio" option to the existing `QuickActionSheet` / `LogModals` (mirrors `MealLogModal`) writing to `cardio_logs`. Modality dropdown, minutes numeric, optional RPE. Fires Shield recompute implicitly via trigger.
- **Plan render**: `workouts.tsx` reads `day.cardio` from the resolved plan day and renders a small cardio card under the exercises list (title, minutes, intensity note, "optional" pill when true). Non-invasive — existing exercises rendering unchanged.

Dashboard/nutrition/settings UI: unchanged this batch.

---

## Verification (all must pass before B6)

Seed fixtures against a scratch user; each check is a psql read + a screenshot where UI-visible:

1. `fat_loss` intermediate → plan has 3 `cardio` days (30 min zone2), none directly before a heavy-leg day.
2. `strength` intermediate → 2 cardio days (20 min zone2), never same day or day-before as heavy squat/DL.
3. `muscle_gain` → 2 cardio days (25 min zone2).
4. `beginner fat_loss` → 2 cardio days (25 min zone2), no intervals.
5. Deload week (phase='deload') → cardio dose drops by 1 session and 5 min, steady-state only.
6. Latest readiness = `red_recover` → today's cardio has `optional=true`, minutes softened.
7. Insert a 45-min zone2 `cardio_logs` row → next `readiness_scores` row for that user shows a higher `load_carryover.systemic_load` than a control day with no cardio.
8. **MOAT CHECK — after #7's cardio log, re-run `calculate-macros`; `daily_macro_targets.target_calories` is unchanged from before the cardio log. Grep confirms no cardio imports in macro modules.**
9. Corrupt Sonnet output to move a cardio day → `validateGeneratedPlan` rejects it → fallback plan is used and preserves the engine's `cardio_placements` exactly.

Do NOT proceed to B6 until 1–9 pass.

---

## Files touched

- NEW `supabase/functions/_shared/cardio-rules.ts`
- EDIT `supabase/functions/_shared/training-rules.ts` — `validateGeneratedPlan` recognizes `day.cardio`; `buildFallbackPlan` accepts and echoes `cardio_placements`
- EDIT `supabase/functions/generate-plan/index.ts` — resolve prescription, compute placements, extend Sonnet schema + prompt, pass placements to fallback, validate echo
- EDIT `supabase/functions/calculate-score/index.ts` — fold `cardio_logs` into training-strain
- NEW migration — `cardio_logs` table + Shield dispatch trigger
- EDIT `src/components/QuickActionSheet.tsx` + `src/components/LogModals.tsx` — add `CardioLogModal`
- EDIT `src/routes/workouts.tsx` — render `day.cardio` card
- No edits to `macro-calculation.ts`, `calculate-macros`, `evaluate-fuelling`, nutrition/dashboard code

## Out of scope

- Wearable auto-import of cardio (source='wearable' reserved; no importer this batch).
- VO2max, HR zones per user, endurance periodization — deliberately excluded.
- Retroactive cardio backfill.
- Any change to macro/TDEE math.

&nbsp;

# Approve, with one REQUIRED precision fix and one confirmation. Both verified against real code.

REQUIRED — cardio strain MUST use the same 0-21 scale as lifting, and must ADD to (not overwrite) any existing strain for the day.

Verified facts:

- Lifting already writes shield_training_logs.strain_value via maybeWriteTrainingSummary (workouts.tsx:941) on a 0-21 WHOOP-style scale: strain = min(21, (completedSets*0.6 + volume/1200)). A full session ≈ 12-18.

- calculate-score normalizes strain as s*5 capped at 100 (line 216) and feeds the load_carryover decay.

- So cardio's strain contribution must be on the SAME 0-21 scale, or it will wildly over/under-penalize readiness.

Cardio strain mapping (keep modest, same scale):

  zone2/liss: ~0.10 strain per minute  -> 30 min = 3.0 strain (light, correct — an easy walk shouldn't tank readiness)

  intervals/mixed: ~0.20 strain per minute -> 20 min = 4.0 strain (harder, higher)

  Cap any single cardio session's contribution at ~8 (cardio alone shouldn't exceed a hard lifting session).

CRITICAL — a day can have BOTH lifting and cardio. The strain writes must COMBINE, not overwrite:

- If a shield_training_logs row already exists for (user, entry_date) from lifting, ADD the cardio strain to it: new_strain = min(21, existing_strain + cardio_strain). Do NOT overwrite the lifting strain with cardio strain (that would erase the lifting fatigue).

- If no row exists (cardio-only day), create one with just the cardio strain.

- Use an upsert that reads-then-adds, or a DB-side increment, to avoid a race between the lifting summary write (workouts.tsx:941) and the cardio write. Confirm the ordering: cardio log write should read current strain_value and add.

CONFIRM before building:

1. shield_training_logs unique constraint on (user_id, entry_date)? If yes, the combine-logic upserts cleanly. If not, cardio could create a DUPLICATE row and calculate-score would read only one. Verify the constraint; if missing, the combine must UPDATE the existing row, not insert.

2. Cardio strain coefficients (0.10/0.20 per min) produce sane readiness impact: a 30-min zone2 day adds ~3 strain (s*5=15 normalized, minor), a heavy-lift + 30-min-cardio day combines to ~15-21 (meaningful but capped). Sanity-check these against a seeded readiness run before finalizing.

Everything else approved:

- cardio does NOT touch macros/TDEE (verified: TDEE is weight-trend-based, macro-calculation.ts:234 — cardio already captured, no double-count): correct, keep the comment.

- cardio_logs table, goal-dosed prescription, plan cardio field echoed by Sonnet, deload/readiness softening: all correct.

- The B5.5 verification #8 (calorie target unchanged after cardio log): keep as the moat-integrity check.