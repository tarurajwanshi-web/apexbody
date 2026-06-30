# Shield readiness engine — source-agnostic upgrade (plan)

Backend-only. No UI changes. No schema changes (the three migrations already shipped cover what's needed). No LLM in scoring.

## Files changed

1. `supabase/functions/parse-device-upload/index.ts` — extend to validate, normalize, and emit `shield_health_signals` rows.
2. `supabase/functions/calculate-score/index.ts` — read from `shield_health_signals` first (fallback to legacy tables), emit `shield_signal_quality_events`, populate the new `readiness_scores.signal_quality` / `top_drivers` / `load_carryover` / `fuelling_status` / `training_permission` / `nutrition_modifier` / `reason_codes` columns. Engine version bumps to `v6.3`.
3. New shared helper: `supabase/functions/_shared/signal-quality.ts` — pure validation/freshness/confidence helpers, no I/O. Imported by both edge functions so screenshot validation and scoring validation stay identical.

No schema migration required.

## 1. `_shared/signal-quality.ts` (new)

Pure functions, zero deps:

- `classifyHrv(v: number | null): { validity, suspicious, reason_codes[] }` — invalid <10 or >250; suspicious <20 or >150.
- `classifyRhr(v)` — invalid <30 or >120; suspicious <40 or >90.
- `classifySleep(v)` — invalid <0 or >14; suspicious <3 or >11.
- `classifyFreshness(parsed_date: string | null, entry_date: string): 'fresh' | 'stale' | 'missing' | 'future_date'` — future, >2 days older = stale, missing.
- `confidenceFromDeviceSet({ hrvOk, rhrOk, sleepOk, freshness, providerProxyOnly })` → `HIGH | MEDIUM | LOW` per the rule "no HRV → never HIGH" and "proxy-score-only → MEDIUM at best".
- Reason-code constants exported as a typed union (matches the allowed list in the spec).

Reused by both functions; keeps thresholds in one place.

## 2. `parse-device-upload/index.ts`

### Extraction (extend the Claude system prompt)

Current prompt extracts `hrv_ms, rhr_bpm, sleep_hours, data_date`. Extend the JSON schema with optional fields and instruct the model to return `null` whenever a field is not clearly visible (already its default behavior). Added optional fields:

- `sleep_deep_hours`, `sleep_rem_hours`, `sleep_awake_hours`
- `recovery_score` (Whoop/Oura "recovery %" or Oura readiness as a 0–100 proxy)
- `body_battery` (Garmin only)
- `readiness_proxy_score` is computed in code: when HRV/RHR are both null but `recovery_score` is visible, we treat it as a proxy and tag with `DEVICE_PROXY_SCORE_ONLY`.

### Validation + reason codes

After parsing, classify each numeric using the new shared helpers:

- HRV/RHR/sleep ranges per spec → `validity_status` per metric.
- Compute per-upload `freshness_status` from `parsed_date` vs `row.entry_date`.
- Decide overall `parse_status`:
  - All HRV/RHR/sleep/recovery_score/body_battery null → `failed` (existing behavior).
  - At least one usable metric → `parsed`; downgrade confidence when HRV is missing or invalid.
- Build a per-upload `reason_codes` list: `DEVICE_PARTIAL_PARSE`, `HRV_MISSING`, `RHR_MISSING`, `SLEEP_MISSING`, `DEVICE_PROXY_SCORE_ONLY`, `DEVICE_SIGNAL_STALE`, `HRV_SUSPICIOUS_RANGE`, `RHR_INVALID_RANGE`, etc.

The existing column writes to `shield_device_uploads` (`parsed_hrv`, `parsed_rhr`, `parsed_sleep_hours`, `parsed_date`, `parse_status`) are unchanged. Invalid values get NULL'd back to the DB instead of being persisted as junk (no guessing).

### Normalize into `shield_health_signals`

For each metric that survived validation (i.e. not `invalid`, not missing), upsert one row per metric:

- `user_id`, `signal_date = row.entry_date`
- `metric_name` ∈ {`hrv_ms`, `resting_heart_rate_bpm`, `sleep_hours`, `sleep_deep_hours`, `sleep_rem_hours`, `sleep_awake_hours`, `recovery_score`, `readiness_proxy_score`, `body_battery`}
- `metric_value`, `unit`
- `source_method = 'screenshot'`
- `source_provider = row.device_source` (whoop/oura/garmin)
- `source_table = 'shield_device_uploads'`, `source_id = row.id`
- `confidence_level`, `freshness_status`, `validity_status`, `reason_codes`
- `metadata = { parsed_date, has_proxy_only, ... }`

Write order: clear out any existing rows for `(user_id, signal_date, source_table='shield_device_uploads', source_id=row.id)` first, then insert fresh. The new partial unique index already enforces no duplicates for `(user_id, signal_date, metric_name, source_method, source_provider, source_id)` with `source_id NOT NULL`.

On `failed` parse: write nothing to `shield_health_signals` (no guessing). The DB trigger still fires `calculate-score`, which now falls back gracefully.

## 3. `calculate-score/index.ts`

### New: source-agnostic input layer

Introduce `readSignals(user_id, dateList)` that runs in parallel with the existing legacy queries and returns a `Map<entry_date, NormalizedSignals>`:

```
{ hrv_ms, rhr_bpm, sleep_hours, sleep_deep_hours, sleep_rem_hours,
  recovery_score, readiness_proxy_score, body_battery,
  per_metric: { metric -> { value, confidence, validity, freshness, source_method, source_provider, reason_codes } } }
```

Selection rule per metric: prefer the highest-confidence row available with `validity_status IN ('valid','suspicious')` (suspicious values are allowed but tagged). Native-health rows will be `source_method='native_health'`; manual-entered ones `'manual'`. Per metric, ranking is **HIGH > MEDIUM > LOW**, tie-break by `source_method` priority `native_health > screenshot > manual > derived > system`.

Fall back to legacy tables (`shield_device_uploads`, `shield_manual_inputs`, `shield_nutrition_logs`, `shield_training_logs`, `pre_session_checks`) only for metrics not present in the normalized rows. This makes the change additive — historical scoring continues to work for users who haven't generated normalized rows yet.

### Pillar weights stay fixed

`recovery 30 / sleep 22 / nutrition 20 / training 15 / mood 13` — no change. All existing formulas (`manualSleepScore`, `manualRecoveryScore`, `deviceRecoveryScore`, `fatiguePenalty`, `composeNutrition`, weighted 3-day avg, cap by confidence) stay verbatim.

### `signal_quality` block

After scoring, build:

```jsonc
{
  "overall": "HIGH|MEDIUM|LOW",
  "signals": {
    "hrv":       { "confidence": ..., "freshness": ..., "validity": ..., "source_method": ..., "source_provider": ..., "reason_codes": [...] },
    "rhr":       { ... },
    "sleep":     { ... },
    "nutrition": { ... },   // derived from meal coverage / quality variance
    "hydration": { ... },   // present/absent + within target
    "training":  { ... },   // strain present + within plausibility
    "mood":      { ... }
  }
}
```

`overall` is the worst non-LOW between (hrv, sleep, nutrition) with the same logic as `deriveConfidence` — i.e. if backbone HIGH → HIGH; else medium/low per coverage. Existing `confidence_level` column keeps its current derivation so we don't reshape downstream consumers.

### `shield_signal_quality_events`

For today's run, before INSERT:

```
delete from shield_signal_quality_events
where user_id = $1
  and signal_date = $2
  and source_type = 'system'
  and source_table = 'readiness_scores';
```

Then insert one row per signal (hrv, rhr, sleep, recovery/manual-recovery, nutrition, hydration, training, mood, pre_session). Each row gets:

- `source_type = 'system'` (this is the engine's audit log of what it saw)
- `source_provider` = the provider that supplied the underlying metric (whoop/oura/garmin/user/apex), or NULL if derived
- `metric_name`, `raw_value`, `normalized_value`, `unit`
- `freshness_status`, `validity_status`, `confidence_level`
- `reason_codes` from the allowed list

This is idempotent re-runs friendly: every recalculation rewrites today's quality audit cleanly.

### `load_carryover`

Pull `shield_training_logs.strain_value` for `[today, today-1, today-2, today-3]`:

```
decay = { 0: 1.0, 1: 0.7, 2: 0.4, 3: 0.2 }
contribution_d = strain_d * decay_d
systemic_load = sum(contributions)
```

Store as:

```jsonc
{
  "systemic_load": <number>,
  "days": [ { "date", "strain", "decay", "contribution" }, ... ],
  "reason_codes": ["HIGH_LOAD_CARRYOVER"?]  // when systemic_load > threshold (e.g. 20)
}
```

`HIGH_LOAD_CARRYOVER` is also appended to top-level `reason_codes` and made visible as a `top_drivers` negative, so strong HRV alone can't erase it — `top_drivers` is built independently from pillar deltas + carryover, not from the cap-adjusted final score.

### `top_drivers`

Compute from pillar deltas vs NEUTRAL plus load carryover:

```
for each pillar: impact ≈ ((score - NEUTRAL) * weight / 100)
push positive/negative entries with label + signed impact (rounded)
append { type:'negative', label:'High training load carrying over', impact:'-<n>' } when systemic_load > threshold
sort by |impact| desc; take top 4
```

Labels are static strings — no LLM.

### `training_permission` (rules, no LLM)

```
final_score >= 75 AND systemic_load < 25 AND no PRE_SESSION_LOW_READINESS → green_train
final_score 60–74 OR (>=75 AND systemic_load 25–35)                        → yellow_modify
final_score 45–59 OR systemic_load 35–50 OR PRE_SESSION_LOW_READINESS      → orange_reduce
final_score < 45 OR systemic_load > 50                                     → red_recover
```

Allowed values only.

### `nutrition_modifier` (rules, no LLM)

```
training_permission == 'red_recover'                                   → recovery_day_refeed
hydration sub-score < 70                                               → hydration_priority
protein <= 80% of target (when target available via daily_macro_targets)→ protein_priority
nutrition pillar < 50 AND systemic_load > 25                           → deficit_caution
final_score >= 70 AND systemic_load >= 25 AND nutrition pillar < 60    → fuel_more
otherwise                                                              → normal
```

Allowed values only.

### `fuelling_status`

Lightweight digest used by daily coach note + UI later:

```jsonc
{
  "hydration_pct": ...,
  "hydration_target_ml": ...,
  "protein_pct": ...,           // null if no daily_macro_targets row
  "calories_pct": ...,          // null if no targets
  "reason_codes": []
}
```

Pure read; no writes outside `readiness_scores`.

### `reason_codes` (top-level column)

Aggregated, de-duped, from: each signal's reason codes + load carryover + per-pillar gates. Only strings from the allowed list. Examples emitted:

- `DEVICE_SIGNAL_STALE`, `DEVICE_PARTIAL_PARSE`, `DEVICE_PROXY_SCORE_ONLY`
- `MANUAL_FALLBACK_REQUIRED` (no device signal today and HRV is null)
- `HRV_HIGH_CONFIDENCE`, `HRV_SUSPICIOUS_RANGE`, `RHR_INVALID_RANGE`
- `MANUAL_RECOVERY_DISCOUNTED` (manual recovery used when device path expected)
- `LOW_SLEEP_CONFIDENCE`, `HIGH_LOAD_CARRYOVER`, `PRE_SESSION_LOW_READINESS`
- `HYDRATION_BELOW_TARGET`, `PROTEIN_LOW_FOR_GOAL`, `DEFICIT_CAUTION_LOW_RECOVERY`

### `engine_version`

Bump from `v6.2` → `v6.3` in the constant; everything still writes through `readiness_scores.engine_version`. The DB column default stays at `v6.1` per the earlier patch.

## Schema work

None. The three migrations already shipped (`readiness_scores` new columns, `shield_signal_quality_events`, `shield_health_signals`) cover all writes. The partial unique index on `shield_health_signals` is leveraged for screenshot upserts.

## Risks & assumptions

- **Behavioral parity:** Reading normalized signals must produce the same final score as today when only screenshot data exists. We guarantee this by writing `shield_health_signals` from the same parsed values and using the same per-metric thresholds; reader prefers normalized rows but falls through to legacy if the normalized write didn't happen (older uploads).
- **Suspicious values are accepted, not dropped.** They contribute but tag `*_SUSPICIOUS_RANGE` and can never raise confidence to HIGH. Invalid values are treated as missing.
- **Proxy-only screenshots** (no HRV/RHR, just a recovery number) are written as `readiness_proxy_score` and capped at MEDIUM confidence; the recovery pillar in `calculate-score` will optionally consume it as a low-weight fallback (decision: keep current `deviceRecoveryScore` formula unchanged for v1; proxy is used only when both HRV and RHR are null, mapped to a damped pillar score via the same `NEUTRAL + 0.75*(raw-NEUTRAL)` smoothing). This preserves determinism.
- **Native health later:** because the reader is source-agnostic, adding a Capacitor adapter that writes `source_method='native_health'` rows requires zero engine changes.
- **No data deletion.** Per-day quality events are rewritten under `source_type='system' AND source_table='readiness_scores'` only.
- **Throughput:** Two extra DB writes per parse (one batched insert into `shield_health_signals` of up to ~9 rows) and ~9 inserts per score recalculation into `shield_signal_quality_events`. Same path already does multi-table queries; negligible.

## Validation after build

1. **Unit-style smoke**: invoke `parse-device-upload` against a real test upload via `supabase--curl_edge_functions`; verify `shield_device_uploads` columns unchanged, `shield_health_signals` rows present with correct `source_method='screenshot'` and `source_provider=device_source`.
2. **Edge cases**: HRV=300 → invalid → no `shield_health_signals` row for hrv_ms, reason `HRV_SUSPICIOUS_RANGE` absent / `HRV_MISSING` present; HRV=180 → suspicious, row written, `HRV_SUSPICIOUS_RANGE`; only-recovery-score screenshot → `readiness_proxy_score` row + `DEVICE_PROXY_SCORE_ONLY`; data_date 5 days old → freshness `stale` + `DEVICE_SIGNAL_STALE`.
3. **Engine end-to-end**: run `calculate-score` for a user with normalized rows; verify `readiness_scores` has populated `signal_quality`, `top_drivers`, `load_carryover`, `fuelling_status`, `training_permission`, `nutrition_modifier`, `reason_codes`; `final_score` matches the v6.2 deterministic value (regression test against current row pre-rerun).
4. **Idempotency**: re-run `calculate-score` for the same day twice and confirm `shield_signal_quality_events` row count for `(user, date, source_type='system', source_table='readiness_scores')` stays constant.
5. **Fallback**: temporarily clear `shield_health_signals` for a user/day, re-run `calculate-score`; legacy-table fallback should still produce a valid score with `reason_codes` containing `MANUAL_FALLBACK_REQUIRED` when device data is absent.
6. **Logs**: `supabase--edge_function_logs` for both functions, search for "invalid enum" / constraint failures — must be empty.

No build performed yet. Approve to implement.
