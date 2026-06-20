
-- profiles additions
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS age smallint,
  ADD COLUMN IF NOT EXISTS biological_sex text;

ALTER TABLE public.profiles
  DROP CONSTRAINT IF EXISTS profiles_age_check;
ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_age_check CHECK (age IS NULL OR (age >= 10 AND age <= 100));

ALTER TABLE public.profiles
  DROP CONSTRAINT IF EXISTS profiles_biological_sex_check;
ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_biological_sex_check CHECK (biological_sex IS NULL OR biological_sex IN ('male','female'));

-- daily_macro_targets
CREATE TABLE IF NOT EXISTS public.daily_macro_targets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  calculated_at timestamptz NOT NULL DEFAULT now(),
  bmr numeric NOT NULL,
  tdee numeric NOT NULL,
  target_calories numeric NOT NULL,
  target_protein_g numeric NOT NULL,
  target_carbs_g numeric NOT NULL,
  target_fat_g numeric NOT NULL,
  formula_used text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT daily_macro_targets_user_unique UNIQUE (user_id)
);
GRANT SELECT ON public.daily_macro_targets TO authenticated;
GRANT ALL ON public.daily_macro_targets TO service_role;
ALTER TABLE public.daily_macro_targets ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own row select" ON public.daily_macro_targets FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE TRIGGER daily_macro_targets_updated_at BEFORE UPDATE ON public.daily_macro_targets FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- weekly_plans
CREATE TABLE IF NOT EXISTS public.weekly_plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  week_start_date date NOT NULL,
  plan_data jsonb NOT NULL,
  is_locked boolean NOT NULL DEFAULT true,
  unlock_date date NOT NULL,
  generated_by text NOT NULL DEFAULT 'claude-plan-v1',
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT weekly_plans_user_week_unique UNIQUE (user_id, week_start_date)
);
GRANT SELECT ON public.weekly_plans TO authenticated;
GRANT ALL ON public.weekly_plans TO service_role;
ALTER TABLE public.weekly_plans ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own row select" ON public.weekly_plans FOR SELECT TO authenticated USING (auth.uid() = user_id);

-- workout_set_logs
CREATE TABLE IF NOT EXISTS public.workout_set_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  entry_date date NOT NULL,
  exercise_name text NOT NULL,
  set_number smallint NOT NULL,
  reps_completed smallint,
  weight_kg numeric,
  completed boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT workout_set_logs_unique UNIQUE (user_id, entry_date, exercise_name, set_number)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.workout_set_logs TO authenticated;
GRANT ALL ON public.workout_set_logs TO service_role;
ALTER TABLE public.workout_set_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own rows select" ON public.workout_set_logs FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "own rows insert" ON public.workout_set_logs FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "own rows update" ON public.workout_set_logs FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "own rows delete" ON public.workout_set_logs FOR DELETE TO authenticated USING (auth.uid() = user_id);
CREATE TRIGGER workout_set_logs_updated_at BEFORE UPDATE ON public.workout_set_logs FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- shield_nutrition_logs additive columns (DO NOT touch existing)
ALTER TABLE public.shield_nutrition_logs
  ADD COLUMN IF NOT EXISTS estimated_calories numeric,
  ADD COLUMN IF NOT EXISTS estimated_protein_g numeric,
  ADD COLUMN IF NOT EXISTS estimated_carbs_g numeric,
  ADD COLUMN IF NOT EXISTS estimated_fat_g numeric,
  ADD COLUMN IF NOT EXISTS calorie_estimate_status text NOT NULL DEFAULT 'pending';

ALTER TABLE public.shield_nutrition_logs
  DROP CONSTRAINT IF EXISTS shield_nutrition_logs_calorie_estimate_status_check;
ALTER TABLE public.shield_nutrition_logs
  ADD CONSTRAINT shield_nutrition_logs_calorie_estimate_status_check
  CHECK (calorie_estimate_status IN ('pending','estimated','failed'));
