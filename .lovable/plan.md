# calculate-score v6.3 — coherence patch

Backend-only. No schema, no UI changes. Two files touched:

- `supabase/functions/_shared/signal-quality.ts` — add one reason code constant.
- `supabase/functions/calculate-score/index.ts` — post-processing fixes only. Pillar formulas, weights, caps, and the `final_score` calculation stay byte-identical.

## 1. New reason code

`signal-quality.ts` — add:

```
NUTRITION_NOT_LOGGED: "NUTRITION_NOT_LOGGED",
```

It joins the existing `REASON` map. `reason_codes` on `readiness_scores` is a `text[]`, so this is purely additive — no enum / check constraint touched.

## 2. Confidence alignment (fix #1)

In `calculate-score/index.ts`, after both `confidence` (legacy `deriveConfidence`) and `overall_sq` (signal_quality.overall) are computed, derive the column value from the worst of the two and from device-backbone presence:

```text
manualOnlyBackbone = !hrvSig.present && !rhrSig.present
backboneHigh       = hrvSig.confidence === "HIGH" && sleepSig.confidence === "HIGH"

effectiveConfidence:
  start = confidence            // existing deriveConfidence result
  if manualOnlyBackbone:        // HRV + RHR both missing
    start = min(start, "medium")
  if !backboneHigh and start == "high":
    start = "medium"
  start = min(start, overall_sq) // take the worst of the two
```

`min` uses `LOW < MEDIUM < HIGH`. The `final_score` cap still uses the original `confidence` value so deterministic outputs do not move; only `readiness_scores.confidence_level` is written from `effectiveConfidence`. This satisfies "if signal_quality.overall is lower than calculated confidence_level, use the lower confidence" without altering the score formula.

## 3. Manual fallback reason codes (fix #2)

Current code only emits `MANUAL_FALLBACK_REQUIRED` when HRV, RHR, **and** sleep are all absent. Loosen to spec — fire whenever HRV and RHR are both missing:

```text
if (!hrvSig.present && !rhrSig.present) push MANUAL_FALLBACK_REQUIRED
```

For `MANUAL_RECOVERY_DISCOUNTED`, drop the `pathPref === "device"` gate. The trigger becomes "manual recovery contributed to the recovery pillar while HRV is absent":

```text
if (today_.usedManual && presentToday.recovery && !hrvSig.present)
  push MANUAL_RECOVERY_DISCOUNTED
```

Both are already in the allowed `REASON` map.

## 4. Honest `top_drivers` (fix #3)

Three changes to the existing driver-building loop:

a. **Recovery positive label** when device backbone is absent: replace `"Strong recovery signal"` with `"Manual recovery check-in"` and clamp the impact to ≤ +3 (manual recovery cannot manufacture a top positive driver). Negative side keeps `"Recovery running low"` so genuine drops still surface.

b. **Nutrition driver** — only emit a *positive* nutrition driver when meals are actually logged today (`today_.mealQuality != null`). When the pillar score came from hydration-only (manual path, no meals), skip emission rather than mislabel "Nutrition on target". Negative side stays unchanged so missed-meal days can still show negative impact via the modifier rules below.

c. **Hydration driver** — independent of the nutrition pillar:

- `hydrationPct != null && hydrationPct < 80` → negative driver `"Hydration below target"` with impact `-min(5, round((80 - hydrationPct)/8))`.
- No positive hydration driver is emitted (hydration alone never becomes a top positive).

Sort + slice-to-4 stays the same.

## 5. `fuelling_status` honest on no-meals (fix #4)

`todayMeals` is the array filtered to `entry_date === today && !deleted`. Today's pillar already uses `today_.mealQuality` which is null when no meals are logged. Mirror that in fuelling:

```text
loggedMealsToday = todayMeals.length > 0
proteinPct  = loggedMealsToday && target.target_protein_g  ? round(...) : null
caloriesPct = loggedMealsToday && target.target_calories   ? round(...) : null

if (!loggedMealsToday) push NUTRITION_NOT_LOGGED into fuelReasons
else:
  if (proteinPct != null && proteinPct < 80)            push PROTEIN_LOW_FOR_GOAL
  if (caloriesPct != null && caloriesPct < 75 && systemic_load >= 25)
                                                         push DEFICIT_CAUTION_LOW_RECOVERY
```

So zero-meals days no longer falsely emit `PROTEIN_LOW_FOR_GOAL` and `fuelling_status.{protein_pct, calories_pct}` are `null` (which the existing column accepts — both are JSON, nullable). The same guard is applied to the `nutrition_modifier` rule chain so `protein_priority` cannot fire on a no-meals day; it falls through to `normal` (or `hydration_priority` if hydration is the issue).

`NUTRITION_NOT_LOGGED` is also pushed into top-level `reason_codes` via the existing `fuelReasons` aggregation.

## 6. Invariants preserved

- Pillar scores, weights (30/22/20/15/13), `applyCap`, `fatiguePenalty`, `final_score`, and `engine_version` (`v6.3`) are unchanged.
- All emitted reason codes are members of `REASON`. `reason_codes` is a Postgres `text[]`, so the new `NUTRITION_NOT_LOGGED` value needs no migration.
- `signal_quality.overall` derivation stays as-is; we only consume it to clamp `confidence_level`.
- `shield_signal_quality_events` write path is untouched.

## Verification after build

1. **Manual-only fixture (the reported case):** meals=0, HRV/RHR absent, manual recovery+sleep+mood present.
  - `confidence_level` = MEDIUM (not HIGH).
  - `reason_codes` includes `MANUAL_FALLBACK_REQUIRED`, `MANUAL_RECOVERY_DISCOUNTED`, `NUTRITION_NOT_LOGGED`.
  - `top_drivers` contains no `"Nutrition on target"` and no `"Strong recovery signal"`; may contain `"Manual recovery check-in"` capped at +3, and `"Hydration below target"` if applicable.
  - `fuelling_status.protein_pct` and `.calories_pct` are `null`.
  - `nutrition_modifier` is not `protein_priority` purely from missing meals.
2. **Device fixture with valid HRV + sleep, no meals:** `confidence_level` stays HIGH, top_drivers can include `"Strong recovery signal"`, `NUTRITION_NOT_LOGGED` still emitted.
3. **Idempotency:** re-run twice; `final_score` stable, `shield_signal_quality_events` row count unchanged.

No build executed yet. Approve to implement.  
  
Approved. Build this patch.

Small guard: when comparing confidence values, normalize casing carefully because DB values are uppercase HIGH/MEDIUM/LOW, while some internal variables may be lowercase high/medium/low. Do not write lowercase values into readiness_scores.confidence_level or shield_signal_quality_events.confidence_level.