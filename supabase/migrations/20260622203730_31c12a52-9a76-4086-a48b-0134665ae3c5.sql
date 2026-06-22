ALTER TABLE public.profiles 
  ADD COLUMN IF NOT EXISTS soft_reset_at timestamptz,
  ADD COLUMN IF NOT EXISTS training_day_codes text[] DEFAULT '{}';