# Backend Safety Patch — Native Health Signals

Single idempotent SQL migration. No UI, no edge function, no data deletion changes.

## 1. Create `public.shield_health_signals`

`CREATE TABLE IF NOT EXISTS` with the full column set as specified:

- `id uuid PK default gen_random_uuid()`
- `user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE`
- `signal_date date NOT NULL`
- `observed_start_at timestamptz`, `observed_end_at timestamptz`
- `metric_name text NOT NULL`, `metric_value numeric`, `unit text`
- `source_method text NOT NULL`, `source_provider text NOT NULL`
- `source_table text`, `source_id uuid`
- `confidence_level text`, `freshness_status text`, `validity_status text`
- `is_user_corrected boolean NOT NULL DEFAULT false`, `original_value numeric`, `corrected_at timestamptz`, `correction_reason text`
- `reason_codes text[] NOT NULL DEFAULT '{}'`
- `metadata jsonb NOT NULL DEFAULT '{}'::jsonb`
- `created_at timestamptz NOT NULL DEFAULT now()`, `updated_at timestamptz NOT NULL DEFAULT now()`

Idempotency: each column also re-asserted with `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` so a partially-created table converges to the spec.

### Grants (immediately after CREATE)

- `GRANT SELECT ON public.shield_health_signals TO authenticated`
- `GRANT ALL ON public.shield_health_signals TO service_role`

### CHECK constraints (each wrapped in guarded `DO $$ ... $$` checking `pg_constraint`)

- `shield_health_signals_source_method_check`: `source_method IN ('screenshot','native_health','manual','derived','system')`
- `shield_health_signals_source_provider_check`: `source_provider IN ('whoop','oura','garmin','apple_health','health_connect','samsung_health','user','apex','unknown')`
- `shield_health_signals_confidence_level_check`: `confidence_level IS NULL OR confidence_level IN ('HIGH','MEDIUM','LOW')`
- `shield_health_signals_freshness_status_check`: `freshness_status IS NULL OR freshness_status IN ('fresh','stale','missing','future_date','unknown')`
- `shield_health_signals_validity_status_check`: `validity_status IS NULL OR validity_status IN ('valid','suspicious','invalid','missing')`
- `shield_health_signals_metric_name_check`: `metric_name IN ('hrv_ms','resting_heart_rate_bpm','sleep_hours','sleep_quality_score','sleep_deep_hours','sleep_rem_hours','sleep_awake_hours','recovery_score','readiness_proxy_score','body_battery','respiratory_rate','spo2_pct','temperature_deviation','steps','active_energy_kcal','hydration_ml','mood_score','training_strain','pre_session_readiness')`

### Indexes (`CREATE INDEX IF NOT EXISTS`)

- `idx_shield_health_signals_user_date (user_id, signal_date)`
- `idx_shield_health_signals_user_metric_date (user_id, metric_name, signal_date)`
- `idx_shield_health_signals_user_provider_date (user_id, source_provider, signal_date)`
- `CREATE UNIQUE INDEX IF NOT EXISTS idx_shield_health_signals_unique_source ON ... (user_id, signal_date, metric_name, source_method, source_provider, source_id) WHERE source_id IS NOT NULL`

### `updated_at` trigger

Existing `public.update_updated_at_column()` is present (confirmed in db-functions list). Reuse it:

```sql
DROP TRIGGER IF EXISTS update_shield_health_signals_updated_at ON public.shield_health_signals;
CREATE TRIGGER update_shield_health_signals_updated_at
BEFORE UPDATE ON public.shield_health_signals
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
```

### RLS

- `ALTER TABLE public.shield_health_signals ENABLE ROW LEVEL SECURITY`
- `DROP POLICY IF EXISTS shield_health_signals_select_own ...; CREATE POLICY shield_health_signals_select_own FOR SELECT TO authenticated USING (auth.uid() = user_id)`
- No INSERT/UPDATE/DELETE policies for authenticated → blocked. Service role bypasses RLS via grant.

## 2. Native-ready upgrades on `public.shield_signal_quality_events`

- `ALTER TABLE ... ADD COLUMN IF NOT EXISTS source_provider text`
- Replace `source_type` CHECK safely:
  1. `DO $$` block: look up existing `shield_signal_quality_events_source_type_check` (or any check on `source_type`), `ALTER TABLE ... DROP CONSTRAINT IF EXISTS` it.
  2. `ALTER TABLE ... ADD CONSTRAINT shield_signal_quality_events_source_type_check CHECK (source_type IN ('screenshot','device_screenshot','native_health','manual','workout_log','nutrition_log','mood_log','system'))` — keeps `device_screenshot` for backward compatibility; no data migration needed.
- Add guarded `shield_signal_quality_events_source_provider_check`: `source_provider IS NULL OR source_provider IN ('whoop','oura','garmin','apple_health','health_connect','samsung_health','user','apex','unknown')`.

## Idempotency summary

- `CREATE TABLE IF NOT EXISTS` + `ADD COLUMN IF NOT EXISTS` for table shape
- `CREATE INDEX IF NOT EXISTS` (incl. unique partial)
- `DROP TRIGGER IF EXISTS` + `CREATE TRIGGER`
- `DROP POLICY IF EXISTS` + `CREATE POLICY`
- Constraints: guarded `DO $$ ... $$` blocks that test `pg_constraint` before adding; for the source_type swap, drop-if-exists then add

## Out of scope (per request)

- No edge function changes
- No UI changes
- No backfill / data deletion
- No new RPCs

## Deliverable

Single `supabase--migration` call containing the SQL above.  
  
Proceed, but make this correction before running:

For replacing the source_type constraint on public.shield_signal_quality_events, do not dynamically drop "any check on source_type".

Explicitly drop only these known possible constraint names:

ALTER TABLE public.shield_signal_quality_events

DROP CONSTRAINT IF EXISTS shield_sqe_source_type_check;

ALTER TABLE public.shield_signal_quality_events

DROP CONSTRAINT IF EXISTS shield_signal_quality_events_source_type_check;

Then add the new constraint:

ALTER TABLE public.shield_signal_quality_events

ADD CONSTRAINT shield_signal_quality_events_source_type_check

CHECK (

  source_type IN (

    'screenshot',

    'device_screenshot',

    'native_health',

    'manual',

    'workout_log',

    'nutrition_log',

    'mood_log',

    'system'

  )

);

Everything else is approved.