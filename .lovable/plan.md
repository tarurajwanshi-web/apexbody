## APEX Engine Bridge v1A — generate-plan consumes Shield v6.3

Backend-only patch to `supabase/functions/generate-plan/index.ts`. No other files, no schema, no UI, no changes to `calculate-score`. Existing `weekly_plans` upsert shape and plan JSON schema preserved.

### File to change

- `supabase/functions/generate-plan/index.ts` — only this file.

### Exact logic changes

**1) Expand readiness query (lines 105–109)**

Replace the current select:

```ts
.select("final_score")
```

with:

```ts
.select("score_date, final_score, confidence_level, training_permission, nutrition_modifier, load_carryover, fuelling_status, top_drivers, reason_codes, signal_quality")
.order("score_date", { ascending: false })
```

`avgReadiness` calculation (lines 110–112) remains untouched — it still averages `final_score` across returned rows.

**2) Derive Shield context (insert after line 112)**

```ts
const rowsSorted = readinessRows ?? []; // already DESC by score_date
const latestReadiness: any = rowsSorted[0] ?? null;
const latestTrainingPermission: string | null = latestReadiness?.training_permission ?? null;
const latestConfidenceLevel: string | null = latestReadiness?.confidence_level ?? null;
const latestNutritionModifier: string | null = latestReadiness?.nutrition_modifier ?? null;
const latestFuellingStatus: string | null = latestReadiness?.fuelling_status ?? null;
const latestSystemicLoad: number = Number(latestReadiness?.load_carryover?.systemic_load ?? 0);
const latestTopDrivers: any[] = Array.isArray(latestReadiness?.top_drivers) ? latestReadiness.top_drivers : [];
const latestReasonCodes: string[] = Array.isArray(latestReadiness?.reason_codes) ? latestReadiness.reason_codes : [];

const redDays7 = rowsSorted.filter(r => r.training_permission === "red_recover").length;
const orangeDays7 = rowsSorted.filter(r => r.training_permission === "orange_reduce").length;
const yellowDays7 = rowsSorted.filter(r => r.training_permission === "yellow_modify").length;
const lowConfidenceDays7 = rowsSorted.filter(r => r.confidence_level === "LOW").length;

// Frequency-ranked reason codes across the 7-day window
const rcFreq: Record<string, number> = {};
for (const r of rowsSorted) {
  for (const c of (Array.isArray(r.reason_codes) ? r.reason_codes : [])) {
    rcFreq[c] = (rcFreq[c] ?? 0) + 1;
  }
}
const dominantReasonCodes = Object.entries(rcFreq)
  .sort((a, b) => b[1] - a[1])
  .slice(0, 5)
  .map(([code]) => code);
```

All accesses are null/array-guarded, so old rows with null/empty JSON never crash.

**3) Replace the blunt weekly gate (lines 178, 202–204)**

Remove `lowReadiness = avgReadiness < 45` as the sole driver. Compute a structured decision:

```ts
const trendLow = avgReadiness != null && avgReadiness < 45;

// Whole-week volume reduction only when the trend supports it
const weeklyReduce =
  redDays7 >= 2 ||
  orangeDays7 >= 2 ||
  (orangeDays7 >= 1 && redDays7 >= 1) ||
  trendLow;

// Acute (today / next session) guardrail from latest permission
const acuteRecover = latestTrainingPermission === "red_recover";
const acuteReduce  = latestTrainingPermission === "orange_reduce";
const acuteModify  = latestTrainingPermission === "yellow_modify";

const lowConfidenceGate = latestConfidenceLevel === "LOW";
```

**4) New `readinessNote` block replacing lines 202–204**

Build a layered prompt fragment:

- If `acuteRecover`: instruct Claude to make Day 1 (today / next scheduled session) a recovery / mobility / light technique / rest day; leave later days progressing unless `weeklyReduce`.
- Else if `acuteReduce`: reduce next-session volume/intensity (drop 1 set on compounds, cap RIR ≥ 2); rest of week unchanged unless `weeklyReduce`.
- Else if `acuteModify`: keep training as planned, avoid forced progression, add "warm-up readiness check" note on the first session.
- Else (`green_train`): normal programming unless `lowConfidenceGate`, in which case avoid aggressive unqualified progression but do not punish (no volume cut just for LOW confidence — manual-only users must not be penalised).
- If `weeklyReduce`: append the existing "-20%/drop 1 set" whole-week reduction rule and populate `volume_gate_alert`.
- If `latestSystemicLoad >= 25` (matches Shield `HIGH_LOAD_CARRYOVER` threshold from v6.3): add "acute high load carryover — start week conservative, first session should feel like RPE 6".
- If `latestSystemicLoad > 0` and < 25: soft note only, no volume change.

**5) Nutrition modifier context (append to prompt near line 208)**

Add a `nutritionContextNote`:

- If `latestNutritionModifier` ∈ {`hydration_priority`, `protein_priority`, `fuel_more`, `deficit_caution`, `recovery_day_refeed`} or `latestFuellingStatus` indicates under-fuelling / deficit: append a session_note discouraging failure sets and aggressive metabolic finishers. Never compute macros here.
- Existing `underFuelled` check based on `daily_macro_targets` vs intake is preserved and merged with the Shield modifier: the more conservative rule wins.

**6) Prompt additions (line 223 area)**

Concatenate a compact Shield summary passed to Claude so it can reason but not recompute:

```
Shield 7-day context:
- avg readiness: {avgReadiness}
- latest permission: {latestTrainingPermission} (confidence {latestConfidenceLevel})
- red/orange/yellow days: {redDays7}/{orangeDays7}/{yellowDays7}
- low-confidence days: {lowConfidenceDays7}
- latest systemic load carryover: {latestSystemicLoad}
- latest nutrition modifier: {latestNutritionModifier}
- dominant reason codes: {dominantReasonCodes.join(", ")}
```

**7) `volume_gate_alert` (lines 245–252)**

Replace `lowReadiness` gate with `weeklyReduce || acuteRecover`:

- When `acuteRecover` only: alert text explains today/next session is recovery-focused; rest of week normal.
- When `weeklyReduce`: existing conservative-volume alert copy retained.
- Else: `null`.

Existing upsert shape (lines 254–263), plan JSON schema, `generated_by: "claude-plan-v1"`, and the final response shape remain identical.

### Thresholds used

- `avgReadiness < 45` → trend low (retained).
- `redDays7 >= 2` OR `orangeDays7 >= 2` OR (`orangeDays7 >= 1` AND `redDays7 >= 1`) → weekly volume cut.
- `latestSystemicLoad >= 25` → acute high-load guardrail (matches Shield v6.3 `HIGH_LOAD_CARRYOVER`).
- `latestConfidenceLevel === "LOW"` → block aggressive/unqualified progression but never cut volume by itself.

### Robustness

- All Shield fields optional; missing/null/legacy rows fall back to today's blunt behaviour (avgReadiness gate only).
- No new dependencies. No shared helper needed.

### Validation steps

1. Row with `training_permission='red_recover'` on today, others green → plan generated: Day 1 recovery/rest, remaining days normal, `volume_gate_alert` mentions recovery, no whole-week cut.
2. 2× `red_recover` in past 7 days → plan reduces sets across the week; `volume_gate_alert` set.
3. Latest `orange_reduce` alone → next session reduced, week unchanged.
4. Latest `green_train` + `LOW` confidence → plan built normally, prompt tells Claude to avoid forced progression, `volume_gate_alert=null`.
5. `latestSystemicLoad = 30`, permission green → prompt includes high-load guardrail; no weekly cut.
6. No readiness rows at all (new user) → falls through to prior behaviour; no crash.
7. Row with `load_carryover=null`, `top_drivers=null`, `reason_codes=null` → no exception; systemic load = 0.
8. `nutrition_modifier='recovery_day_refeed'` → prompt appends fuelling-context note; macros untouched.

# Deploy: `generate-plan` only. `calculate-score` untouched.  
  
**Before build, apply these corrections to the plan:**

1. fuelling_status is jsonb, not text. Treat latestFuellingStatus as an object with null-safe guards, not string | null.

2. Do not assume Day 1 is today. generate-plan returns a Monday-starting 7-day plan. Acute red/orange/yellow guardrails should apply to the first non-rest training session in the generated plan, not blindly Day 1.

3. Do not add session_note or any field outside the existing plan JSON schema. Preserve schema exactly. Use volume_gate_alert, progression_note, cue, sets/reps/rest, and exercise selection to express recovery/fuelling/readiness changes.

Everything else in the plan is approved:

- generate-plan only

- no schema change

- calculate-score untouched

- avgReadiness retained

- Shield context added

- systemic_load used only as acute guardrail

- weekly volume reduction only from repeated red/orange or low weekly trend