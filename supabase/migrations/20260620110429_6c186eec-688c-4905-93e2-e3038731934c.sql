
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS goal text,
  ADD COLUMN IF NOT EXISTS training_days_per_week smallint,
  ADD COLUMN IF NOT EXISTS equipment_access text,
  ADD COLUMN IF NOT EXISTS body_data_type text,
  ADD COLUMN IF NOT EXISTS dexa_body_fat_pct numeric,
  ADD COLUMN IF NOT EXISTS dexa_lean_mass_kg numeric,
  ADD COLUMN IF NOT EXISTS measurement_waist_cm numeric,
  ADD COLUMN IF NOT EXISTS measurement_hip_cm numeric,
  ADD COLUMN IF NOT EXISTS measurement_weight_kg numeric,
  ADD COLUMN IF NOT EXISTS measurement_height_cm numeric,
  ADD COLUMN IF NOT EXISTS profile_completed_at timestamptz,
  ADD COLUMN IF NOT EXISTS plan_unlock_date date;

ALTER TABLE public.profiles
  DROP CONSTRAINT IF EXISTS profiles_goal_check,
  ADD CONSTRAINT profiles_goal_check
    CHECK (goal IS NULL OR goal IN ('recomposition','muscle_gain','fat_loss','strength','athletic_performance'));

ALTER TABLE public.profiles
  DROP CONSTRAINT IF EXISTS profiles_training_days_check,
  ADD CONSTRAINT profiles_training_days_check
    CHECK (training_days_per_week IS NULL OR (training_days_per_week BETWEEN 1 AND 6));

ALTER TABLE public.profiles
  DROP CONSTRAINT IF EXISTS profiles_equipment_check,
  ADD CONSTRAINT profiles_equipment_check
    CHECK (equipment_access IS NULL OR equipment_access IN ('home_gym_db_only','commercial_gym','limited_equipment','bodyweight_only'));

ALTER TABLE public.profiles
  DROP CONSTRAINT IF EXISTS profiles_body_data_type_check,
  ADD CONSTRAINT profiles_body_data_type_check
    CHECK (body_data_type IS NULL OR body_data_type IN ('dexa','measurements'));
