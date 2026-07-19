# B6 — Plan obeys the engine; regenerated every Monday

Two parts. Part A makes `generate-plan` respect block state and per-muscle volume ceilings. Part B fans it out weekly so users actually see the new numbers.

Verified before planning:

- `generate-plan/index.ts:353` already reads `mesocycle_state` (only `phase`) — widen this, don't add a second query.
- `week_start_date` is already computed at line 508 (UTC-Monday of `planStartISO`) — reuse it.
- Upsert key is `(user_id, week_start_date)` at line 526 — safe for weekly regen.
- Auth is `authorizeCaller` + `x-internal-secret` — same pattern as `compute-volume-landmarks` and `advance-mesocycle`.
- Only current caller is `onboarding.tsx:322` (single `user_id`). No weekly regen exists.

---

## Part A — Plan obeys engine numbers

### A1. Load block state + landmarks (generate-plan/index.ts)

- Widen the meso select from `"phase"` to `"block_number, week_in_block, block_length_weeks, phase"`. Reuse the row for `cardioPhase`. Missing row → warn + defaults `{block:1, week:1, length:4, phase:'accumulation'}`.
- Add ONE read of `weekly_volume_landmarks` for the already-computed `week_start_date`, selecting `muscle_group, target_sets, fuel_adjusted_mrv` into `landmarksByMuscle`. Empty → warn, `{}`, skip A2/A3 volume steps for this run (never crash).

### A2. Inject volume targets into Sonnet prompt

When `landmarksByMuscle` non-empty, add a hard-constraint block sibling to `CARDIO_PLACEMENTS`:

```
BLOCK CONTEXT: week {week_in_block} of {block_length_weeks}, block {block_number}, phase {phase}
  accumulation → "Building week, ramp position early|mid|peak"
  deload       → "DELOAD week — volume low, movements crisp, higher target_rir, no failure"

WEEKLY VOLUME TARGETS (hard, distribute across training days):
  {muscle}: {target_sets} sets across the week (ceiling {fuel_adjusted_mrv})
  - Per-muscle weekly sum must be within ±1 of target_sets
  - NEVER exceed fuel_adjusted_mrv
  - Muscles not listed: minimal or none
```

### A3. Validate + deterministically repair

- Sum sets per `muscle_group` across non-rest days from `exercises[]`.
- **Soft retry (once):** if any muscle off target by >±2, retry generation naming the offenders.
- **Hard clamp — `clampPlanToCeilings` (pure fn):** for any muscle over `fuel_adjusted_mrv`, trim 1 set from the highest-volume exercise of the lowest-priority role (isolation → accessory → compound; never take a compound below 2 sets). Loop until within ceiling. Runs on the FINAL plan (post-Sonnet AND post-fallback), always when landmarks exist. Log every trim.
- **Deload sanity:** if `phase==='deload'`, assert total sets ≤ Σ`target_sets`+3 and `target_rir` skews high. No "% of MAV" rule.
- All existing validators (rest_mask, schema, enums, plain-prose, cardio echo) untouched.

### A4. Stamp block context on plan_data (top level)

```json
"block_context": {
  "block_number": int,
  "week_in_block": int,
  "block_length_weeks": int,
  "phase": "accumulation" | "deload",
  "phase_label": "Building — week 2 of 3" | "Deload — recover and consolidate"
}
```

Frontend rendering is out of scope.

### A5. Precedence comment (no daily gate)

Comment at injection site: `target_sets` is the aim; `fuel_adjusted_mrv` is the clamp-enforced ceiling; weekly readiness envelope may pull volume DOWN but never above ceiling; same-day red-day cut belongs to B7.

---

## Part B — Weekly fan-out (make it live)

### B1. Fan-out mode on `generate-plan`

Copy the `compute-volume-landmarks` pattern exactly. If body has no `user_id` (cron posts `{}`), select all active profiles and loop per-user with the existing pipeline. If `user_id` present, behave as today. Auth: cron path uses `x-internal-secret`; onboarding unchanged.

### B2. Regenerate UPCOMING week only

For the cron path, compute `planStartISO` = upcoming UTC Monday so the already-existing line 508 logic yields NEXT week's `week_start_date`. The `(user_id, week_start_date)` upsert therefore writes a NEW row and can NEVER overwrite the in-progress week's plan or completed sets. Document invariant in-file: "regen only writes the upcoming week; current week immutable once started; block clock advances on completed UTC-Monday weeks".

### B3. Schedule cron

`pg_cron` job `generate-plan-weekly` at `5 6 * * 1` (06:05 UTC Monday) — AFTER compute-volume-landmarks (05:40) and advance-mesocycle (05:45). Match the exact `net.http_post` + `x-internal-secret` shape used by `advance-mesocycle-weekly`.

---

## Files touched

- `supabase/functions/generate-plan/index.ts` — widen meso select, add landmarks read, prompt block, `clampPlanToCeilings`, one-retry loop, `block_context` stamp, fan-out mode, upcoming-week resolution for cron path.
- New pg_cron entry (via `supabase--insert`) — `generate-plan-weekly` at 06:05 UTC Mon.
- No schema migration. No client changes. No cardio/macro/TDEE changes.

## Verification (all must pass)

1. SQL sum per muscle_group vs `weekly_volume_landmarks`: week-1 accumulation within ±2 of `target_sets`.
2. Deload user: total ≈ halved targets; higher `target_rir`; no failure programming.
3. Under-fuelled user (`fuel_adjusted_mrv < mrv`): no muscle exceeds `fuel_adjusted_mrv` — the moat is visible in the plan.
4. Force over-prescription in fallback: `clampPlanToCeilings` trims; stored plan within ceiling; trims logged.
5. fat_loss regression: cardio placements from B5.5 still echoed correctly.
6. `plan_data.block_context` present + plain-prose label.
7. Missing-landmarks guard: delete landmark rows, regen → plan still generates, warn logged, no crash.
8. Anti-generic proof: gen plan → advance meso + rerun compute-volume-landmarks for next week → regen → plans differ, volume ramps.
9. Fan-out proof: POST `{}` with `x-internal-secret` → NEXT Monday's `weekly_plans` row created for a test user, CURRENT week untouched, `block_context.week_in_block` reflects advanced block.

#3 + #4 are the moat. #8 proves the engine changes across the block. #9 proves it reaches the user.

## Out of scope

Cardio/macro/TDEE changes; same-day red-cut gate; frontend rendering of `block_context`; `completed_sets` writes (stays 0). Day-1 dispatch fix (`upsertManualRecovery` → `calculate-score`) is B7.  


## **Part A approved. Part B needs one fix before build.**

Problem: `resolvePlanStartISO` (training-rules.ts:835) is not Monday-anchored — it returns today or tomorrow. So `week_start_date` can resolve to the current week when the cron fires Monday morning, overwriting the in-progress plan. The "can never overwrite" claim is not schema-guaranteed.

Fix (Part B2): the cron/fan-out path must NOT call `resolvePlanStartISO`, and must NOT reuse `upcomingMondayUTC` (it returns today when today is Monday). Add a strictly-next-Monday helper for the cron path only:

```
function nextMondayStrictUTC(d = new Date()): string {
  const day = d.getUTCDay();
  const delta = day === 1 ? 7 : ((8 - day) % 7) || 7;
  const m = new Date(d);
  m.setUTCDate(d.getUTCDate() + delta);
  return m.toISOString().slice(0,10);
}
```

Set `planStartISO = nextMondayStrictUTC(now)` on the cron path, feed it through the existing line-508 logic. Onboarding path keeps `resolvePlanStartISO` unchanged. Document why both existing helpers are deliberately not reused here.

Verification #9: for a test user who already has a current-week plan with completed sets, POST `{}` on a Monday and assert the current week's row is byte-identical afterward (plan_data + completed sets untouched) and a new next-Monday row was inserted. Two rows, current untouched.