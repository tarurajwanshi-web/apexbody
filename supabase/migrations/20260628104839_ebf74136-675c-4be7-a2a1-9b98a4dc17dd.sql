ALTER TABLE public.shield_manual_inputs
  ADD COLUMN IF NOT EXISTS post_session_energy_rating int
    CHECK (post_session_energy_rating BETWEEN 1 AND 5);

ALTER TABLE public.shield_manual_inputs
  ADD COLUMN IF NOT EXISTS sleep_quality_rating int
    CHECK (sleep_quality_rating BETWEEN 1 AND 5);

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS eating_pattern varchar(20) DEFAULT NULL;