# B5 — Weekly Volume Landmarks (the moat, made concrete)

Fuel + readiness shrink the per-muscle weekly ceiling; heat map recolors accordingly. Deterministic, service-role, no LLM.

## Files

1. **NEW** `supabase/functions/compute-volume-landmarks/index.ts`
2. **EDIT** `supabase/functions/advance-mesocycle/index.ts` — swap stale `completed_sets` read for a live `workout_set_logs` count (bug fix, called out below)
3. **EDIT** `src/components/dashboard/MuscleGroupVolumeGrid.tsx` — resolve TODO(B5): prefer this-week landmark row, fall back to `effectiveLandmarks`
4. **EDIT** `src/routes/_authenticated/onboarding.tsx` — append `compute-volume-landmarks` after `advance-mesocycle` (init) in the Promise.allSettled chain
5. **CRON** insert `compute-volume-landmarks-weekly` at Mon `05:50 UTC` (after mesocycle 05:45, before generate-plan slots)

## Function contract

**Input:** `{ user_id }` — auth via `requireInternalSecret` OR bearer matching `user_id`.

**Skip guards** (return `{ skipped: reason }`):

- no active `mesocycle_state` row → `no_active_block`
- profile missing goal/experience → `incomplete_profile`

**thisMonday** = UTC Monday for `new Date()` (same helper as B4/generate-plan).

### Fuel factor (goal-target keyed, NOT absolute deficit)

- `avgIntake` = mean of `shield_nutrition_logs.estimated_calories` last 7 days where `calorie_estimate_status IN ('estimated','manual_edited')` AND `deleted=false`. Skip no-log days.
- `target` = active `daily_macro_targets.target_calories` (goal-appropriate by construction).
- `intakePct = avgIntake / target`.
- Bands: `>=0.95 → 1.0`; `0.80–0.95 → 0.85`; `<0.80 → 0.7`.
- **Thin data guard:** fewer than 4 logged days in the window → `fuelFactor = 1.0`.

### Readiness factor

- `avg7` = mean of `readiness_scores.final_score` last 7 days (rows present).
- `avg7 < 45` AND `≥3` rows → `0.9`, else `1.0`.

### Per-muscle math

For every muscle in `VOLUME_LANDMARKS` where entry is non-null (skip `full_body`, `cardio`, `mobility`):

```
base = effectiveLandmarks(muscle, experience_level, goal)   // exp mult on all, goal mult on MAV
mev, mav, mrv = round(base.*)
fuel_adjusted_mrv = max(mev, round(mrv * fuelFactor * readinessFactor))   // floor: never below MEV

if phase === 'deload':
  target_sets = max(round(mev * 0.5), 2)
else:  // accumulation
  accumWeeks = block_length_weeks - 1
  progress   = (week_in_block - 1) / max(1, accumWeeks - 1)   // 0..1
  rampTarget = mev + (mav - mev) * progress
  baselineClimb = min(block_number - 1, 3)
  target_sets = round(rampTarget) + baselineClimb

target_sets = min(target_sets, fuel_adjusted_mrv)   // hard ceiling
```

### Write

UPSERT one row per trainable muscle on `(user_id, week_start_date, muscle_group)`:
`mev, mav, mrv, fuel_adjusted_mrv, target_sets, updated_at=now()`. `completed_sets` stays at its default `0` — we never write it. Idempotent (`ON CONFLICT DO UPDATE`).

**Return:** `{ week_start_date, fuelFactor, readinessFactor, muscles: [{ muscle_group, mev, mav, mrv, fuel_adjusted_mrv, target_sets }] }`.

## B4 fix — `advance-mesocycle` chronic-overreach counts LIVE

Current code (lines 207–222) reads `completed_sets` from `weekly_volume_landmarks` — which we've now confirmed is always `0` by design. The deload trigger cannot fire.

Replace that block: for each of the last 2 completed UTC Mon–Sun weeks, query `workout_set_logs` for the user filtered by `completed = true`, `set_type <> 'warmup'` (or IS NULL), grouped by `muscle_group`. Compare per-muscle counts against that week's `weekly_volume_landmarks.fuel_adjusted_mrv` (fetch the two rows per muscle). A muscle is "over ceiling" for a week when live count > that week's `fuel_adjusted_mrv`. `chronic_overreach` = same muscle over-ceiling in both weeks. Everything downstream (systemic_breakdown, phase branching) unchanged.

## Heat map wiring (`MuscleGroupVolumeGrid.tsx`)

Extend the `coach.functions.ts` payload (or add a small server fn) to also return this-week's `weekly_volume_landmarks` rows keyed by `muscle_group`. In `bandFor`, prefer `{ mev, mav, mrv: fuel_adjusted_mrv }` from the landmark row when present; else fall back to `effectiveLandmarks(...)` (brand-new user). Completed volume stays counted live from `workout_set_logs` — no change there. Remove the TODO comment.

## Onboarding & cron

- `onboarding.tsx` promise chain: append `compute-volume-landmarks` alongside `advance-mesocycle` init (fire-and-forget, `Promise.allSettled`).
- `pg_cron`: schedule `compute-volume-landmarks-weekly` at `50 5 * * 1`, batch-processing active users the same way B4's Monday job does (via `x-internal-secret`).

## Verification (must all pass before B6)

Seed scenarios in a scratch user and query `weekly_volume_landmarks`:

1. Well-fuelled + rested → `fuel_adjusted_mrv == mrv`, `target_sets` ramps MEV→MAV.
2. Under-eating (<80% of *own* target) → `fuelFactor=0.7`, ceiling and `target_sets` drop.
3. Fat_loss user hitting deficit target (~100%) → `fuelFactor=1.0`, **no penalty** (proves goal-target keying).
4. Low readiness (avg<45, ≥3 rows) → `readinessFactor=0.9`, ceiling shrinks.
5. <4 nutrition-logged days → `fuelFactor=1.0` (no fabricated penalty).
6. Deload week → `target_sets ≈ round(mev*0.5)`, floored ≥2.
7. Invariant: `fuel_adjusted_mrv >= mev` for every row.
8. Heat map: 15 sets on same muscle → amber for well-fuelled, RED for under-eating. **Screenshot both.**
9. B4 chronic-overreach: synthesize 2 weeks of over-ceiling `workout_set_logs` → confirm deload trigger fires (was impossible pre-fix).

## Out of scope

- B6 (generate-plan consumption of `target_sets`) — next batch.
- Retroactive backfill of prior weeks — B5 writes forward only.
- Changing `completed_sets` column semantics or dropping it (leave for a later cleanup migration once B4 fix has soaked).

Approve with one required change, now verified against the shipped advance-mesocycle code (lines 206-223):

The shipped B4 chronic-overreach check ALREADY reads completed_sets and fuel_adjusted_mrv from each weekly_volume_landmarks row and compares them per-week correctly (finishedWeek and prevWeek each against their own ceiling). The ONLY reason it can't fire is that completed_sets is never populated (always 0).

Therefore B5 MUST populate completed_sets — this is not optional cleanup, it's what makes the chronic_overreach deload trigger work. Change B5 Step 5/6:

- When writing each weekly_volume_landmarks row for thisMonday's week, also compute and write completed_sets = the actual count of completed non-warmup sets for THAT muscle in the week the row represents.

- Important: the row is written for thisMonday (forward-looking target_sets), but completed_sets should reflect actual logged volume. Resolve this cleanly: write completed_sets for the week the row is keyed to (week_start_date = thisMonday) by counting sets logged in that week. Since that week is just beginning, it starts near 0 and should be updated as the week progresses — OR, simpler and matching how B4 reads it: B4 compares finishedWeek and prevWeek rows, so those rows' completed_sets must hold THOSE weeks' final counts.

  Cleanest approach: compute-volume-landmarks, when it runs on Monday for the NEW week, should ALSO backfill the just-finished week's completed_sets into that finished week's existing landmark row (update last week's row with its now-final actual count), so that next Monday when B4 looks back at finishedWeek/prevWeek, the counts are settled and accurate.

Confirm the write path so that when B4 reads finishedWeek.start and prevWeek.start rows, their completed_sets equal the real logged non-warmup set counts for those weeks. That is the exact data B4 line 214 needs.

DROP my earlier note about verifying per-week comparison — I've now confirmed the shipped code (line 221-222: weeks.has(finishedWeek.start) && weeks.has(prevWeek.start)) already compares each week against its own ceiling correctly. No change needed there.

Everything else in the B5 plan approved as written (fuel factor goal-keyed, thin-data guard, MEV floor, deload target, heat map fallback, cron 05:50).

&nbsp;