## Goal

Harden the source-agnostic Shield engine so fresh native/screenshot signals beat manual when valid, manual still wins when device data is stale/invalid/explicitly overridden, and screenshot parses can never trigger `calculate-score` before the normalized rows exist.

Backend only. No schema changes. No UI changes. No formula changes — only the *input value* that feeds the existing recovery/sleep pillar formulas may change as a result of better source selection.

---

## Part A — Native / manual precedence in `calculate-score`

File: `supabase/functions/calculate-score/index.ts`

### A1. Centralize active source selection

Today `scoreDay()` decides per-metric source with two independent branches that only consult `pathPref` and `parsed_hrv != null`. It ignores `validity_status`, `freshness_status`, `is_user_corrected`, and silently lets manual win when `pathPref === 'manual'` even if a HIGH-confidence `native_health` row exists for the day.

Introduce a single `pickActiveSource(metric, meta, manual, pathPref)` helper used for HRV, RHR, and sleep. Decision order:

```text
1. If meta exists AND validity ∈ {valid, suspicious} AND freshness ∈ {fresh, unknown}
   AND meta.source_method === 'native_health':
      → use native value (device branch)
2. Else if meta exists AND validity ∈ {valid, suspicious} AND freshness ∈ {fresh, unknown}
   AND meta.source_method === 'screenshot' AND pathPref === 'device':
      → use screenshot value (device branch)
3. Else if manual value present AND
     (manual.is_user_corrected === true            // explicit override
      OR meta is missing
      OR meta.validity ∈ {invalid, missing}
      OR meta.freshness ∈ {stale, future_date}
      OR pathPref === 'manual' AND meta.source_method !== 'native_health'):
      → use manual value (manual branch)
4. Else if meta exists with any usable value (last-resort screenshot even when pathPref='manual'):
      → use device value
5. Else: pillar unscored.
```

Rules this enforces (matching the user's spec):

- Fresh valid `native_health` always beats manual — even when `pathPref='manual'`. Manual is documented as fallback / correction, not a way to mute Apple Health.
- Fresh valid `screenshot` only beats manual when `pathPref='device'`.
- Stale device signals never beat manual.
- Invalid HRV/RHR/sleep is dropped (already nulled by `groupSignals`) and manual takes over.
- `manual.is_user_corrected = true` (or non-null `correction_reason`) forces the manual path regardless of device freshness — explicit user override.
- Manual-only mode keeps working when no native/screenshot row exists.

Note: `shield_manual_inputs` already has `is_user_corrected`, `corrected_at`, `correction_reason`. Extend the existing `manualRes` select to include these.

### A2. Pillar input values follow source selection

In `scoreDay()`, replace the two existing recovery/sleep branches with `pickActiveSource` results, then:

- Recovery: if `native_health` or `screenshot` chosen → `deviceRecoveryScore(hrv, rhr, recoveryBaseline)`. Native HRV/RHR therefore enter the recovery pillar formula directly via the same `byDate[d].device = { parsed_hrv, parsed_rhr, parsed_sleep_hours }` overlay block (lines 426–446). That overlay is the only place HRV/RHR enter the pillar calc, so it must take native values too — extend the existing overlay to prefer `meta.hrv.value` whenever it is the active source (which it already does, but also ensure freshness/validity gates from A1 are applied before overlay).
- Sleep: if native/screenshot chosen → `manualSleepScore(deviceSleep)`. If manual chosen → `manualSleepScore(manual.sleep_hours)`.
- Return `usedNative` flag alongside the existing `usedDevice` / `usedManual` so downstream signal-quality and audit code can distinguish native from screenshot.

Final-score formulas (`applyCap`, `fatiguePenalty`, `final_pre_cap`, weighted pillar avg, hydration & nutrition composition) are untouched.

### A3. Reason codes

Add one new constant in `supabase/functions/_shared/signal-quality.ts` (text-only, no DB enum):

```
USER_MANUAL_OVERRIDE_USED = "USER_MANUAL_OVERRIDE_USED"
```

Emission rules inside `calculate-score`:

- `USER_MANUAL_OVERRIDE_USED` → emitted when the manual path was chosen for at least one of HRV/RHR/sleep while a usable (`valid|suspicious`, `fresh`) device/native row was also available. This means the user explicitly overrode device data (typically via `is_user_corrected`).
- `MANUAL_FALLBACK_REQUIRED` → existing rule loosened: emit when manual was chosen AND no usable device/native row existed for HRV or RHR (i.e. true fallback, not override). Currently this fires whenever both HRV and RHR are missing from signal quality — keep that as a sufficient condition.
- `DEVICE_SIGNAL_STALE` → already emitted by `parse-device-upload`; also emit here when a metric's `meta.freshness === 'stale'` and manual was chosen as a result.
- `HRV_INVALID_RANGE` / `RHR_INVALID_RANGE` / `SLEEP_INVALID_RANGE` → already classified at parse time; surface in `reason_codes` here when an invalid device signal was the reason manual was used.

### A4. signal_quality reflects active source

Update the per-signal summary builder (lines 579–617) so each `SignalSummary` is constructed from the *chosen* source, not just the best-ranked normalized row. Specifically:

- If native won → `source_method='native_health'`, `source_provider` ∈ {`apple_health`,`health_connect`,`samsung_health`}, freshness from the native row.
- If screenshot won → `source_method='screenshot'`, `source_provider` from the upload, freshness from the row.
- If manual won → `source_method='manual'`, `source_provider='user'`, and `reason_codes` includes `MANUAL_RECOVERY_DISCOUNTED` for the recovery summary plus `USER_MANUAL_OVERRIDE_USED` / `MANUAL_FALLBACK_REQUIRED` as applicable.

The existing `effectiveConfidence` clamp (lines 853–861) stays. It already caps to MEDIUM when neither HRV nor RHR is present and never exceeds `signal_quality.overall`.

### A5. Where active source selection happens

Single source of truth: a new `pickActiveSource()` helper at module scope plus a small block inside the `for (const d of dateList)` overlay loop (lines 427–446) that:

1. Reads `signalsByDate.get(d)` (already done).
2. Reads the matching `manualRes` row including `is_user_corrected`.
3. Calls `pickActiveSource` per metric.
4. Writes the chosen numeric back onto `byDate[d].device.parsed_*` so existing `scoreDay()` math is unchanged.
5. Records the active method/provider/reason codes on `byDate[d].meta.*` for downstream summary/audit.

This keeps formula code (`scoreDay`, `applyCap`, etc.) untouched.

---

## Part B — Screenshot parse write-order in `parse-device-upload`

File: `supabase/functions/parse-device-upload/index.ts`

### B1. Reorder writes

Current order (after Anthropic returns):

1. UPDATE `shield_device_uploads` SET `parse_status='parsed'` + parsed_* columns (lines 274–285).
2. DELETE old `shield_health_signals` for `(user, date, upload)` (lines 368–374).
3. INSERT new `shield_health_signals` rows (lines 376–379).

The DB trigger `shield_device_uploads_webhook` fires on step 1 and dispatches `calculate-score`, which can read `shield_health_signals` before step 3 commits.

Replace with the two-phase write:

```text
Phase 1 (no parse_status flip):
  UPDATE shield_device_uploads
    SET parsed_hrv, parsed_rhr, parsed_sleep_hours, parsed_date
    WHERE id = row.id;
  -- parse_status intentionally NOT touched here

Phase 2:
  DELETE shield_health_signals WHERE user_id, signal_date, source_table, source_id;
  INSERT shield_health_signals (...rows);

Phase 3 (flip parse_status last, after normalized rows are committed):
  UPDATE shield_device_uploads SET parse_status='parsed' WHERE id = row.id;
```

On total failure (`totalFailure === true`) or any thrown error before Phase 3:

```text
UPDATE shield_device_uploads SET parse_status='failed' WHERE id = row.id;
-- no normalized rows written, calculate-score falls back to manual/neutral
```

The DB trigger `shield_device_uploads_webhook` already gates on `NEW.parse_status = 'parsed' AND (OP='INSERT' OR OLD.parse_status IS DISTINCT FROM 'parsed')`, so flipping only in Phase 3 means the dispatch fires exactly once, after normalized rows are committed.

The parse-dispatch trigger `shield_device_uploads_parse_webhook` only fires when `parse_status = 'pending'` — Phase-1 column writes leave parse_status at its prior value (`pending` on first parse, `parsed` on re-parse), and Phase-1 never changes `screenshot_url`, so the recursion guard `OLD.screenshot_url IS DISTINCT FROM NEW.screenshot_url` keeps holding. No new loop is introduced.

### B2. Explicit dispatch is unnecessary

Because the existing webhook fires exactly once on the Phase-3 `parse_status='parsed'` flip, we do not need to call `calculate-score` explicitly from the edge function. Leave dispatch to the DB layer.

### B3. Failure handling

- Anthropic non-200 / JSON parse failure → existing `markFailed()` path (unchanged) still runs *before* any signal rows are written. Good.
- Phase 2 INSERT error → revert: leave `parse_status` unflipped and call `markFailed()`. Add an explicit catch around Phase 2 to do this.

---

## Part C — Validation steps (manual, no build yet)

Use SQL + invoke-server-function once code lands. All checks per (`user_id`, `entry_date`).

1. **Fresh native + manual same day**
  - Insert: `shield_health_signals` HRV 65ms `source_method='native_health' source_provider='apple_health' validity='valid' freshness='fresh'`; `shield_manual_inputs.recovery_self_rating=2`.
  - Trigger `calculate-score`.
  - Expect: `readiness_scores.signal_quality.signals.hrv.source_method = 'native_health'`, recovery pillar uses `deviceRecoveryScore(65, …)`, `reason_codes` does NOT include `MANUAL_FALLBACK_REQUIRED`, does NOT include `USER_MANUAL_OVERRIDE_USED`.
2. **Fresh native + explicit manual override**
  - Same as (1) but set `shield_manual_inputs.is_user_corrected = true, correction_reason = 'sensor wrong'`.
  - Expect: recovery pillar uses `manualRecoveryScore(2)`, `reason_codes` includes `USER_MANUAL_OVERRIDE_USED` and `MANUAL_RECOVERY_DISCOUNTED`.
3. **Stale screenshot + manual**
  - Insert: `shield_health_signals` HRV row with `freshness_status='stale'`; manual sleep 7h, recovery 4.
  - Expect: recovery & sleep use manual values; `reason_codes` includes `MANUAL_FALLBACK_REQUIRED` and `DEVICE_SIGNAL_STALE`.
4. **Invalid HRV screenshot + manual**
  - Insert: `shield_health_signals` HRV 300ms (already filtered to `validity='invalid'` by `parse-device-upload`, so the row won't exist) — emulate via direct insert with `validity_status='invalid'`. Manual recovery 3.
  - Expect: invalid row excluded by `groupSignals`; manual recovery used; `reason_codes` includes `MANUAL_FALLBACK_REQUIRED` and `HRV_INVALID_RANGE` (carried from parse) if present in the raw rows for the day.
5. **Manual-only day**
  - No `shield_health_signals`, no `shield_device_uploads`. Manual recovery 4, sleep 7.5, mood 🙂.
  - Expect: scoring works; `confidence_level` capped at `MEDIUM`; `reason_codes` includes `MANUAL_FALLBACK_REQUIRED`; no `USER_MANUAL_OVERRIDE_USED`.
6. **Screenshot parse write-order**
  - Upload a Whoop screenshot, invoke `parse-device-upload`.
  - Watch `shield_signal_quality_events` / `readiness_scores` row created by the trigger: it must run AFTER `shield_health_signals` rows exist. Verify with:
    ```sql
    SELECT (SELECT count(*) FROM shield_health_signals s
             WHERE s.user_id = u.user_id AND s.signal_date = u.entry_date
               AND s.source_id = u.id) AS sig_rows,
           u.parse_status, u.updated_at
    FROM shield_device_uploads u WHERE u.id = '<id>';
    ```
    `sig_rows > 0` whenever `parse_status='parsed'`.
7. **Idempotency**
  - Re-invoke `calculate-score` for the same `(user, date)`. Expect exactly one `readiness_scores` row (upsert) and zero duplicate `shield_signal_quality_events` rows (the function already `DELETE`s then `INSERT`s for `source_type='system'`).

---

## Files to change

- `supabase/functions/_shared/signal-quality.ts` — add `USER_MANUAL_OVERRIDE_USED` constant.
- `supabase/functions/calculate-score/index.ts` — add `pickActiveSource` helper, plumb `is_user_corrected` / `correction_reason` from `shield_manual_inputs` into the overlay, rewrite the recovery/sleep source selection in `scoreDay`, update signal-quality builder to reflect chosen source, emit new reason codes.
- `supabase/functions/parse-device-upload/index.ts` — split the `shield_device_uploads` update into Phase 1 (columns only) and Phase 3 (`parse_status='parsed'`) around the `shield_health_signals` delete/insert.

No new shared helper file needed.

---

## Risks & assumptions

- Assumes `shield_manual_inputs.is_user_corrected` is the canonical override flag. If it is set true by other code paths unrelated to recovery/sleep overrides, manual could win over fresh native unintentionally. Mitigation: combine with `correction_reason IS NOT NULL` only when needed; in practice both fields move together.
- Assumes future native ingestion writes `shield_health_signals` with the same shape (`source_method='native_health'`, ISO `signal_date`, validity/freshness populated). Capacitor bridge work lives outside this patch.
- Two-phase parse write means a crash between Phase 2 and Phase 3 leaves `parse_status='pending'` with `shield_health_signals` rows already written; the parse-dispatch trigger will not re-fire (screenshot_url unchanged), so the next manual re-parse or `calculate-score` invoke must clean up. We accept that vs. the bigger risk of scoring against missing rows.
- Three sequential RPCs instead of two in the happy parse path adds ~30–60ms latency. Acceptable.

# No DB migration: `USER_MANUAL_OVERRIDE_USED` is a text-only reason code; `readiness_scores.reason_codes` and `shield_signal_quality_events.reason_codes` are `text[]`.  
  
  
**Approve with required corrections before Build**.  


- 1. Do not select is_user_corrected, corrected_at, or correction_reason from shield_manual_inputs.
  Those columns do not exist in the live shield_manual_inputs table.
  If explicit manual override is needed in this patch, only use:
  - shield_health_[signals.is](http://signals.is)_user_corrected
  - shield_health_signals.correction_reason
  when source_method = 'manual'
  Otherwise, defer explicit manual override handling and implement only:
  - fresh valid native_health beats manual
  - stale/invalid/missing device/native falls back to manual
  - fresh screenshot beats manual only when pathPref = 'device'
  2. Do not add USER_MANUAL_OVERRIDE_USED unless the code can detect it from shield_health_signals manual rows.
  If no reliable override field is available, skip this reason code for now.
  3. For recovery source selection, treat HRV/RHR as a recovery bundle.
  Do not let HRV come from native and RHR come from stale screenshot if a cleaner source exists.
  Prefer:
  - fresh valid native_health HRV/RHR bundle
  - fresh valid screenshot bundle when pathPref = device
  - manual recovery fallback when device/native recovery bundle is stale/invalid/missing
  Partial native HRV-only can be used, but must be confidence-capped and reason-coded.
  4. For sleep source selection:
  - fresh valid native_health sleep beats manual
  - fresh valid screenshot sleep beats manual only when pathPref = device
  - stale/invalid/missing device sleep falls back to manual sleep
  5. Fix parse-device-upload write order more simply:
  Do not do Phase 1 update while parse_status remains pending.
  Instead:
  - validate AI extraction in memory
  - delete old shield_health_signals rows for this upload
  - insert new shield_health_signals rows
  - only after successful signal insert, update shield_device_uploads once with:
    parsed_hrv,
    parsed_rhr,
    parsed_sleep_hours,
    parsed_date,
    parse_status = 'parsed'
  On total failure:
  - set parse_status = 'failed'
  - write no normalized rows
  This avoids calculate-score running before normalized rows exist and avoids extra pending-row update recursion risk.
  6. Preserve no schema changes, no UI changes, deterministic formulas, and existing allowed DB values.
  After these edits, build.