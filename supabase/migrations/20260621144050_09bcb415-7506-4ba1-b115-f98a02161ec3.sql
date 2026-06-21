ALTER TABLE public.shield_device_uploads ADD COLUMN IF NOT EXISTS parsed_date date;
ALTER TABLE public.shield_manual_inputs ADD COLUMN IF NOT EXISTS recovery_source text;