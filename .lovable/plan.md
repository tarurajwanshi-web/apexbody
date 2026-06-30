## Scope

Two files. No schema. No UI.

- `supabase/functions/_shared/signal-quality.ts` — add one reason code constant.
- `supabase/functions/calculate-score/index.ts` — post-processing fixes only. Pillar formulas, weights (30/22/20/15/13), `applyCap`, `fatiguePenalty`, `final_score`, and `engine_version` (`v6.3`) stay byte-identical.

## Bug recap (live row)

```text
load_carryover.systemic_load = 12.6  (yesterday strain 18 × decay 0.7)
final_score = 44 → training_permission = red_recover
nutrition_modifier = recovery_day_refeed
reason_codes: no load/fatigue code
top_drivers: no training-load driver
signal_quality.training.present = false
```

Carryover is contributing to the load picture and is decisive for `recovery_day_refeed`, but it's invisible everywhere a user / coach engine would look. That is the incoherence.

## Current thresholds (unchanged)

- `loadDays` decay map: `{0: 1.0, 1: 0.7, 2: 0.4, 3: 0.2}` over today + 3 prior days.
- `training_permission`:
  - `red_recover` if `final_score < 45 || systemic_load > 50`
  - `orange_reduce` if `final_score < 60 || systemic_load > 35 || lowReadiness`
  - `yellow_modify` if `final_score < 75 || systemic_load >= 25`
- `nutrition_modifier.deficit_caution`: `nutritionPillar < 50 && systemic_load >= 25`
- Existing `HIGH_LOAD_CARRYOVER` is pushed when `systemic_load >= 20`. That threshold does not match any decision boundary in the rule table above, which is part of why the live row at 12.6 produces nothing.

We keep all formulas. We re-align the load reason thresholds to the decision boundaries the rules actually use (25 / 35 / 50) and add a lower-tier reason for any non-zero carryover.

## Change 1 — `_shared/signal-quality.ts`

Add to the `REASON` map:

```ts
TRAINING_LOAD_CARRYOVER: "TRAINING_LOAD_CARRYOVER",
```

`HIGH_LOAD_CARRYOVER` already exists. `reason_codes` is `text[]`, so this is additive — no enum/check changes.

## Change 2 — load reason emission (calculate-score)

In the load_carryover block (current lines ~536-544), align thresholds with the decision rules:

```text
HIGH threshold: systemic_load >= 25   // matches yellow_modify / deficit_caution boundary
LOW  threshold: systemic_load > 0  && < 25
```

Emit:

- `HIGH_LOAD_CARRYOVER` when `systemic_load >= 25`.
- `TRAINING_LOAD_CARRYOVER` when `0 < systemic_load < 25`.

Both go into:

1. `load_carryover.reason_codes` (the embedded JSON object).
2. `reasonCodesAll` → ends up in `readiness_scores.reason_codes`.
3. `trainingSig.reason_codes` (see Change 4) → ends up in `signal_quality.signals.training.reason_codes` and the `shield_signal_quality_events` row for `training`.

This guarantees the load signal is visible in all three required surfaces whenever systemic_load is non-zero.

## Change 3 — escalate carryover when it is the deciding factor

After `training_permission` is computed (currently lines ~776-780), add a coherence guard:

```text
loadIsDecisive =
  systemic_load > 50 ||
  (training_permission === "orange_reduce" && systemic_load > 35) ||
  (training_permission === "yellow_modify" && systemic_load >= 25) ||
  (training_permission === "red_recover"   && systemic_load >= 25)
```

When `loadIsDecisive` is true, ensure `HIGH_LOAD_CARRYOVER` is in `reasonCodesAll`, `load_carryover.reason_codes`, and `trainingSig.reason_codes` even if `systemic_load < 25` would normally have demoted it to the lower tier. (In practice `loadIsDecisive` already implies `>= 25`, but the guard makes the invariant explicit and survives any future threshold tweak.)

## Change 4 — `signal_quality.signals.training` honest about carryover

Today (current lines ~646-653) training presence is gated on `today_.hadTraining` (a same-day workout log). Carryover is invisible. Replace with the following rule, which keeps current "same-day = HIGH/fresh" behaviour and surfaces yesterday/day-before strain:

```text
hadCarryStrain = systemic_load > 0
priorStrainPresent = loadDays.some(d => d.date != today && d.strain > 0)

trainingSig:
  present = today_.hadTraining || priorStrainPresent
  value   = today_.hadTraining ? today_.strainNorm : systemic_load
  source_method   = "workout_log"
  source_provider = "user"
  validity        = present ? "valid" : "missing"
  freshness       = today_.hadTraining ? "fresh"
                  : priorStrainPresent ? "stale"
                  : "missing"
  confidence      = today_.hadTraining ? "HIGH"
                  : priorStrainPresent ? "MEDIUM"
                  : "LOW"
  reason_codes    = derived from systemic_load tier (HIGH_LOAD_CARRYOVER / TRAINING_LOAD_CARRYOVER)
```

The pillar `training` score (`scores.training`) still requires `today_.hadTraining` — we do not back-fill the pillar score from carryover, which keeps `applyCap`, `final_score`, and the existing presence semantics deterministic. We are only making the *signal* visible.

## Change 5 — `top_drivers` surfaces the load

In the drivers builder (current lines ~763-771) we already push `"High training load carrying over"` at `systemic_load >= 20`. Replace with:

```text
if (systemic_load >= 25) push driver:
  label "Training load carrying over"
  impact -min(10, round(systemic_load / 5))     // currently -5..-10
else if (systemic_load > 0) push driver:
  label "Training load carrying over"
  impact -min(3, max(1, round(systemic_load / 5))) // -1..-3 for low tier
```

Rules around outranking small positives:

- The existing `drivers.sort((a, b) => b._abs - a._abs)` already pushes the largest-|impact| drivers to the front of the 4-slot slice. For the live row, `systemic_load = 12.6` → impact `-3`, which outranks the small positive `"Manual recovery check-in"` (capped at +3) and ties cleanly when equal. To make ordering deterministic when |impact| ties, extend the sort:

```text
drivers.sort((a, b) =>
  (b._abs - a._abs) ||
  (a.type === b.type ? 0 : a.type === "negative" ? -1 : 1)
)
```

Negatives win ties, so a decisive load carryover always shows when it caused `red_recover` / `orange_reduce` / `recovery_day_refeed`.

When `loadIsDecisive` is true (Change 3) but `systemic_load < 25`, force-bump the carryover driver's `_abs` to at least the largest positive driver's `_abs + 1` before the final slice so it cannot be evicted by accident. This is the only case where the formula nudges driver impact — pillar scores are untouched.

## Change 6 — `nutrition_modifier` coherence

Current rule (line ~787): `if (training_permission === "red_recover") nutrition_modifier = "recovery_day_refeed";`

The user's requirement is that `recovery_day_refeed` may not appear unless the load/recovery cause is also visible. Concretely, before emitting it, require either:

- a load reason is present in `reasonCodesAll` (`HIGH_LOAD_CARRYOVER` or `TRAINING_LOAD_CARRYOVER`), OR
- a recovery-pillar negative driver is in `top_drivers` ("Recovery running low"), OR
- `MANUAL_RECOVERY_DISCOUNTED` is in `reasonCodesAll`.

Rewrite:

```text
if (training_permission === "red_recover") {
  hasVisibleCause =
    reasonCodesAll.includes(HIGH_LOAD_CARRYOVER) ||
    reasonCodesAll.includes(TRAINING_LOAD_CARRYOVER) ||
    reasonCodesAll.includes(MANUAL_RECOVERY_DISCOUNTED) ||
    top_drivers.some(d => d.label === "Recovery running low" || d.label === "Training load carrying over");

  nutrition_modifier = hasVisibleCause ? "recovery_day_refeed" : "deficit_caution";
}
```

Because Changes 2 and 5 push `TRAINING_LOAD_CARRYOVER` / driver for *any* non-zero systemic_load, the live row (12.6) will now satisfy `hasVisibleCause` and keep `recovery_day_refeed` — but it will also be backed by a code and a driver. Synthetic cases with zero strain and no recovery pillar drop will downgrade to `deficit_caution`, which already exists in the union.

## Where HRV / RHR / sleep from `shield_health_signals` actually enter pillar formulas

This is verification, not a code change.

1. `signalsRes` loads rows from `public.shield_health_signals` for dates `[dayBefore, yesterday, today]` (line 392).
2. `groupSignals` picks the best row per `(date, metric_name)` using validity > confidence > source method ranks (lines 296-315).
3. For each day, the overlay block (lines 427-446) replaces `byDate[d].device.parsed_{hrv,rhr,sleep_hours}` with the normalized values for metric names `hrv_ms`, `resting_heart_rate_bpm`, and `sleep_hours`. Legacy `shield_device_uploads` is the fallback only when no normalized row exists.
4. `scoreDay` (lines 161-188) consumes that synthesized `device` object:
  - **Recovery pillar**: `deviceRecoveryScore(device.parsed_hrv, device.parsed_rhr, recoveryBaseline)` — so a native_health HRV row is the actual input to the HRV/RHR sub-scores and to `scores.recovery`.
  - **Sleep pillar**: `manualSleepScore(device.parsed_sleep_hours)` when device-first or as fallback — same code path for native and screenshot data.
5. `recoveryBaseline` still derives from `shield_device_uploads.parsed_{hrv,rhr}` over the trailing 14 days (line 389). For a fully native user this baseline could be empty, in which case `deviceRecoveryScore` already falls back to `HRV_POP_BASELINE` / `RHR_POP_BASELINE`. **Note for future work** (out of scope for this fix): the baseline query should eventually consume `shield_health_signals` too so native-only users get a personal baseline; flagged but not changed here.
6. `signal_quality.signals.{hrv,rhr,sleep}` and the per-metric `shield_signal_quality_events` rows are populated from `byDate[today].meta`, which is filled exclusively from `shield_health_signals` (lines 442-445). When no normalized row exists, legacy classification fills in (lines 553-616). So the signal_quality display and the audit table both already reflect native health when present.

Net: native HRV/RHR/sleep are used in pillar scoring today; the only file that wasn't reflecting reality was `signal_quality.signals.training` (Change 4) and the load reason surfacing (Changes 2/3/5/6).

## Invariants preserved

- Pillar formulas, weights, `applyCap`, `fatiguePenalty`, `final_score`, `engine_version` unchanged.
- `confidence_level` clamping logic (lines 797-804) untouched.
- All new strings (`TRAINING_LOAD_CARRYOVER`) live in `REASON` and `reason_codes` is `text[]`. No DB enum/check change.
- `shield_signal_quality_events` schema unchanged; rows now carry richer `reason_codes` for the training metric.

## Validation (after build, manual)

Run with three fixtures against the deployed function and inspect the written `readiness_scores` row + matching `shield_signal_quality_events`:

1. **Live-row repro (zero same-day strain, 18 strain yesterday):**
  - `load_carryover.systemic_load ≈ 12.6`, `load_carryover.reason_codes` contains `TRAINING_LOAD_CARRYOVER`.
  - `readiness_scores.reason_codes` contains `TRAINING_LOAD_CARRYOVER`.
  - `signal_quality.signals.training`: `present=true`, `freshness="stale"`, `confidence="MEDIUM"`, `value≈12.6`, `reason_codes` includes `TRAINING_LOAD_CARRYOVER`.
  - `top_drivers` contains `"Training load carrying over"` with impact `-3`.
  - `nutrition_modifier` stays `recovery_day_refeed` (load reason visible).
  - Final `final_score` byte-equal to current (44).
2. **High-load day (today strain 18 + yesterday 14):** `systemic_load ≈ 27.8`. Expect `HIGH_LOAD_CARRYOVER` everywhere, driver impact `-min(10, round(27.8/5)) = -6`, `signal_quality.signals.training.freshness="fresh"`, `confidence="HIGH"`.
3. **No strain anywhere, red_recover due to low final_score from manual recovery only:** load reasons absent, no load driver, `nutrition_modifier` falls back to `deficit_caution`.
4. **Idempotency:** re-run the function twice on the same `(user_id, entry_date)`. `final_score` stable, `shield_signal_quality_events` row count for the day stable (the existing delete-then-insert keeps it idempotent), `reason_codes` array stable.

## Out of scope (explicitly not in this fix)

- Migrating `recoveryBaseline` to read `shield_health_signals` (noted above).
- UI changes consuming the new `TRAINING_LOAD_CARRYOVER` code.
- Any schema change.

  
Approve with these corrections before implementation.

1. Do not emit TRAINING_LOAD_CARRYOVER for any tiny non-zero systemic_load.

Use:

- HIGH_LOAD_CARRYOVER when systemic_load >= 25

- TRAINING_LOAD_CARRYOVER when systemic_load >= 5 and < 25

- If systemic_load > 0 and < 5, keep it inside load_carryover.days/systemic_load but do not add top-level reason code or top_driver unless loadIsDecisive.

2. For the live row systemic_load = 12.6, TRAINING_LOAD_CARRYOVER should appear everywhere:

- load_carryover.reason_codes

- readiness_scores.reason_codes

- signal_[quality.signals.training](http://quality.signals.training).reason_codes

- shield_signal_quality_events training row

- top_drivers

3. For nutrition_modifier:

Do not allow recovery_day_refeed merely because training_permission = red_recover and systemic_load is tiny.

recovery_day_refeed requires a visible material cause:

- HIGH_LOAD_CARRYOVER, or

- TRAINING_LOAD_CARRYOVER with systemic_load >= 5, or

- Recovery running low driver, or

- MANUAL_RECOVERY_DISCOUNTED plus low readiness.

Otherwise if red_recover is due low score without training/recovery load, use deficit_caution or normal depending existing rules.

4. Keep the deterministic final_score unchanged.

5. Important future note, do not fix in this patch:

The plan says native HRV/RHR/sleep enter pillar scoring, but this is only fully true when path preference is device or manual is absent. If profile path preference is manual, manual recovery/sleep can still win over fresh native health. Do not change that here, but flag it as the next readiness hardening item.

6. Also do not touch parse-device-upload in this patch. We will handle parse write-order separately if needed.

Proceed with build after these edits.