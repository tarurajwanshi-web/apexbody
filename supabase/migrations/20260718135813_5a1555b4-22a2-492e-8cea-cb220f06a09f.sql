-- PART 1 — Additive columns on workout_set_logs (5 genuinely-missing; reuse existing rir/rest_seconds_actual/muscle_group)
ALTER TABLE public.workout_set_logs
  ADD COLUMN IF NOT EXISTS target_rir smallint,
  ADD COLUMN IF NOT EXISTS set_type text NOT NULL DEFAULT 'working',
  ADD COLUMN IF NOT EXISTS is_pr boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS pr_type text,
  ADD COLUMN IF NOT EXISTS is_accessory_block boolean NOT NULL DEFAULT false;

ALTER TABLE public.workout_set_logs DROP CONSTRAINT IF EXISTS workout_set_logs_set_type_check;
ALTER TABLE public.workout_set_logs
  ADD CONSTRAINT workout_set_logs_set_type_check
  CHECK (set_type IN ('warmup','working','drop','failure','backoff'));

ALTER TABLE public.workout_set_logs DROP CONSTRAINT IF EXISTS workout_set_logs_pr_type_check;
ALTER TABLE public.workout_set_logs
  ADD CONSTRAINT workout_set_logs_pr_type_check
  CHECK (pr_type IS NULL OR pr_type IN ('max_weight','max_est_1rm','max_reps_at_weight','max_volume'));

-- PART 2 — mesocycle_state
CREATE TABLE IF NOT EXISTS public.mesocycle_state (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  block_number smallint NOT NULL DEFAULT 1,
  week_in_block smallint NOT NULL DEFAULT 1,
  block_length_weeks smallint NOT NULL DEFAULT 4,
  block_start_date date NOT NULL,
  phase text NOT NULL DEFAULT 'accumulation',
  goal text NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT mesocycle_phase_check CHECK (phase IN ('accumulation','deload')),
  CONSTRAINT mesocycle_week_check CHECK (week_in_block >= 1 AND week_in_block <= block_length_weeks)
);

GRANT SELECT ON public.mesocycle_state TO authenticated;
GRANT ALL ON public.mesocycle_state TO service_role;

ALTER TABLE public.mesocycle_state ENABLE ROW LEVEL SECURITY;

CREATE POLICY "own rows select" ON public.mesocycle_state
  FOR SELECT TO authenticated USING (auth.uid() = user_id);

CREATE UNIQUE INDEX IF NOT EXISTS mesocycle_one_active_per_user
  ON public.mesocycle_state (user_id) WHERE is_active = true;

CREATE TRIGGER mesocycle_state_updated_at BEFORE UPDATE ON public.mesocycle_state
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- PART 3 — weekly_volume_landmarks
CREATE TABLE IF NOT EXISTS public.weekly_volume_landmarks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  week_start_date date NOT NULL,
  muscle_group text NOT NULL,
  mev smallint NOT NULL,
  mav smallint NOT NULL,
  mrv smallint NOT NULL,
  fuel_adjusted_mrv smallint NOT NULL,
  target_sets smallint NOT NULL,
  completed_sets smallint NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT wvl_unique UNIQUE (user_id, week_start_date, muscle_group)
);

GRANT SELECT ON public.weekly_volume_landmarks TO authenticated;
GRANT ALL ON public.weekly_volume_landmarks TO service_role;

ALTER TABLE public.weekly_volume_landmarks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "own rows select" ON public.weekly_volume_landmarks
  FOR SELECT TO authenticated USING (auth.uid() = user_id);

CREATE TRIGGER weekly_volume_landmarks_updated_at BEFORE UPDATE ON public.weekly_volume_landmarks
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- PART 4 — personal_records
CREATE TABLE IF NOT EXISTS public.personal_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  exercise_name text NOT NULL,
  pr_type text NOT NULL,
  value numeric NOT NULL,
  reps smallint,
  weight_kg numeric,
  achieved_date date NOT NULL,
  set_log_id uuid REFERENCES public.workout_set_logs(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT pr_type_check CHECK (pr_type IN ('max_weight','max_est_1rm','max_reps_at_weight','max_volume'))
);

CREATE INDEX IF NOT EXISTS personal_records_user_exercise
  ON public.personal_records (user_id, exercise_name, achieved_date DESC);

GRANT SELECT ON public.personal_records TO authenticated;
GRANT ALL ON public.personal_records TO service_role;

ALTER TABLE public.personal_records ENABLE ROW LEVEL SECURITY;

CREATE POLICY "own rows select" ON public.personal_records
  FOR SELECT TO authenticated USING (auth.uid() = user_id);