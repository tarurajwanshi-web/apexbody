-- =====================================================================
-- 1. CREATE shield_health_signals
-- =====================================================================

CREATE TABLE IF NOT EXISTS public.shield_health_signals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  signal_date date NOT NULL,
  observed_start_at timestamptz,
  observed_end_at timestamptz,
  metric_name text NOT NULL,
  metric_value numeric,
  unit text,
  source_method text NOT NULL,
  source_provider text NOT NULL,
  source_table text,
  source_id uuid,
  confidence_level text,
  freshness_status text,
  validity_status text,
  is_user_corrected boolean NOT NULL DEFAULT false,
  original_value numeric,
  corrected_at timestamptz,
  correction_reason text,
  reason_codes text[] NOT NULL DEFAULT '{}',
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Idempotent column re-assertion (in case table exists partially)
ALTER TABLE public.shield_health_signals ADD COLUMN IF NOT EXISTS observed_start_at timestamptz;
ALTER TABLE public.shield_health_signals ADD COLUMN IF NOT EXISTS observed_end_at timestamptz;
ALTER TABLE public.shield_health_signals ADD COLUMN IF NOT EXISTS metric_value numeric;
ALTER TABLE public.shield_health_signals ADD COLUMN IF NOT EXISTS unit text;
ALTER TABLE public.shield_health_signals ADD COLUMN IF NOT EXISTS source_table text;
ALTER TABLE public.shield_health_signals ADD COLUMN IF NOT EXISTS source_id uuid;
ALTER TABLE public.shield_health_signals ADD COLUMN IF NOT EXISTS confidence_level text;
ALTER TABLE public.shield_health_signals ADD COLUMN IF NOT EXISTS freshness_status text;
ALTER TABLE public.shield_health_signals ADD COLUMN IF NOT EXISTS validity_status text;
ALTER TABLE public.shield_health_signals ADD COLUMN IF NOT EXISTS is_user_corrected boolean NOT NULL DEFAULT false;
ALTER TABLE public.shield_health_signals ADD COLUMN IF NOT EXISTS original_value numeric;
ALTER TABLE public.shield_health_signals ADD COLUMN IF NOT EXISTS corrected_at timestamptz;
ALTER TABLE public.shield_health_signals ADD COLUMN IF NOT EXISTS correction_reason text;
ALTER TABLE public.shield_health_signals ADD COLUMN IF NOT EXISTS reason_codes text[] NOT NULL DEFAULT '{}';
ALTER TABLE public.shield_health_signals ADD COLUMN IF NOT EXISTS metadata jsonb NOT NULL DEFAULT '{}'::jsonb;

-- Grants
GRANT SELECT ON public.shield_health_signals TO authenticated;
GRANT ALL ON public.shield_health_signals TO service_role;

-- CHECK constraints (guarded)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'shield_health_signals_source_method_check') THEN
    ALTER TABLE public.shield_health_signals
      ADD CONSTRAINT shield_health_signals_source_method_check
      CHECK (source_method IN ('screenshot','native_health','manual','derived','system'));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'shield_health_signals_source_provider_check') THEN
    ALTER TABLE public.shield_health_signals
      ADD CONSTRAINT shield_health_signals_source_provider_check
      CHECK (source_provider IN ('whoop','oura','garmin','apple_health','health_connect','samsung_health','user','apex','unknown'));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'shield_health_signals_confidence_level_check') THEN
    ALTER TABLE public.shield_health_signals
      ADD CONSTRAINT shield_health_signals_confidence_level_check
      CHECK (confidence_level IS NULL OR confidence_level IN ('HIGH','MEDIUM','LOW'));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'shield_health_signals_freshness_status_check') THEN
    ALTER TABLE public.shield_health_signals
      ADD CONSTRAINT shield_health_signals_freshness_status_check
      CHECK (freshness_status IS NULL OR freshness_status IN ('fresh','stale','missing','future_date','unknown'));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'shield_health_signals_validity_status_check') THEN
    ALTER TABLE public.shield_health_signals
      ADD CONSTRAINT shield_health_signals_validity_status_check
      CHECK (validity_status IS NULL OR validity_status IN ('valid','suspicious','invalid','missing'));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'shield_health_signals_metric_name_check') THEN
    ALTER TABLE public.shield_health_signals
      ADD CONSTRAINT shield_health_signals_metric_name_check
      CHECK (metric_name IN (
        'hrv_ms','resting_heart_rate_bpm','sleep_hours','sleep_quality_score',
        'sleep_deep_hours','sleep_rem_hours','sleep_awake_hours','recovery_score',
        'readiness_proxy_score','body_battery','respiratory_rate','spo2_pct',
        'temperature_deviation','steps','active_energy_kcal','hydration_ml',
        'mood_score','training_strain','pre_session_readiness'
      ));
  END IF;
END $$;

-- Indexes
CREATE INDEX IF NOT EXISTS idx_shield_health_signals_user_date
  ON public.shield_health_signals (user_id, signal_date);
CREATE INDEX IF NOT EXISTS idx_shield_health_signals_user_metric_date
  ON public.shield_health_signals (user_id, metric_name, signal_date);
CREATE INDEX IF NOT EXISTS idx_shield_health_signals_user_provider_date
  ON public.shield_health_signals (user_id, source_provider, signal_date);
CREATE UNIQUE INDEX IF NOT EXISTS idx_shield_health_signals_unique_source
  ON public.shield_health_signals (user_id, signal_date, metric_name, source_method, source_provider, source_id)
  WHERE source_id IS NOT NULL;

-- updated_at trigger (reuse existing function)
DROP TRIGGER IF EXISTS update_shield_health_signals_updated_at ON public.shield_health_signals;
CREATE TRIGGER update_shield_health_signals_updated_at
BEFORE UPDATE ON public.shield_health_signals
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- RLS
ALTER TABLE public.shield_health_signals ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS shield_health_signals_select_own ON public.shield_health_signals;
CREATE POLICY shield_health_signals_select_own
  ON public.shield_health_signals
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

-- =====================================================================
-- 2. EXTEND shield_signal_quality_events (native-ready)
-- =====================================================================

ALTER TABLE public.shield_signal_quality_events
  ADD COLUMN IF NOT EXISTS source_provider text;

-- Replace source_type CHECK constraint with explicit drops (no dynamic lookup)
ALTER TABLE public.shield_signal_quality_events
  DROP CONSTRAINT IF EXISTS shield_sqe_source_type_check;
ALTER TABLE public.shield_signal_quality_events
  DROP CONSTRAINT IF EXISTS shield_signal_quality_events_source_type_check;

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

-- Guarded source_provider CHECK
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'shield_signal_quality_events_source_provider_check') THEN
    ALTER TABLE public.shield_signal_quality_events
      ADD CONSTRAINT shield_signal_quality_events_source_provider_check
      CHECK (
        source_provider IS NULL OR source_provider IN (
          'whoop','oura','garmin','apple_health','health_connect','samsung_health','user','apex','unknown'
        )
      );
  END IF;
END $$;
