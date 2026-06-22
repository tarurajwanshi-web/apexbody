ALTER TABLE public.shield_nutrition_logs
  ADD COLUMN IF NOT EXISTS vision_detected_items jsonb,
  ADD COLUMN IF NOT EXISTS confirmed_items jsonb,
  ADD COLUMN IF NOT EXISTS vision_provider text,
  ADD COLUMN IF NOT EXISTS vision_confidence numeric,
  ADD COLUMN IF NOT EXISTS user_confirmed_vision boolean NOT NULL DEFAULT false;