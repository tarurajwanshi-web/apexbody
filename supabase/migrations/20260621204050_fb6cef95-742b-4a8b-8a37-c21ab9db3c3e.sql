-- 1. Itemized macros on nutrition logs
ALTER TABLE public.shield_nutrition_logs
  ADD COLUMN IF NOT EXISTS estimated_items jsonb;

-- 2. Body measurement event history
CREATE TABLE IF NOT EXISTS public.body_measurement_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  entry_date date NOT NULL DEFAULT (now() AT TIME ZONE 'UTC')::date,
  source text NOT NULL DEFAULT 'manual', -- 'manual' | 'dexa' | 'inbody'
  weight_kg numeric,
  body_fat_pct numeric,
  lean_mass_kg numeric,
  waist_cm numeric,
  hip_cm numeric,
  arm_cm numeric,
  thigh_cm numeric,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.body_measurement_events TO authenticated;
GRANT ALL ON public.body_measurement_events TO service_role;

ALTER TABLE public.body_measurement_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "users read own body measurements"
  ON public.body_measurement_events FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "users insert own body measurements"
  ON public.body_measurement_events FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "users update own body measurements"
  ON public.body_measurement_events FOR UPDATE TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE POLICY "users delete own body measurements"
  ON public.body_measurement_events FOR DELETE TO authenticated
  USING (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS body_measurement_events_user_date_idx
  ON public.body_measurement_events (user_id, entry_date DESC);
