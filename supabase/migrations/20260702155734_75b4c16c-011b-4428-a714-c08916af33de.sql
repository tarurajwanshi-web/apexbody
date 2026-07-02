ALTER TABLE public.nutrition_weekly_reviews
  ADD COLUMN IF NOT EXISTS applied_modifier text,
  ADD COLUMN IF NOT EXISTS modifier_overrode_decision boolean NOT NULL DEFAULT false;