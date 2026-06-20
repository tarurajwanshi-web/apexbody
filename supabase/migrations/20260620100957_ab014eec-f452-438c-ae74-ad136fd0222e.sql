
-- Enable pg_net for webhook HTTP calls
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;

-- ============ shield_nutrition_logs upgrades ============
ALTER TABLE public.shield_nutrition_logs
  ADD COLUMN IF NOT EXISTS protein_tier smallint CHECK (protein_tier BETWEEN 0 AND 100),
  ADD COLUMN IF NOT EXISTS carb_quality_score smallint CHECK (carb_quality_score BETWEEN 0 AND 100),
  ADD COLUMN IF NOT EXISTS timing_score smallint CHECK (timing_score BETWEEN 0 AND 100),
  ADD COLUMN IF NOT EXISTS deleted boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

-- Convert claude_quality_score to a generated column rolling up the three dimensions.
ALTER TABLE public.shield_nutrition_logs DROP COLUMN IF EXISTS claude_quality_score;
ALTER TABLE public.shield_nutrition_logs
  ADD COLUMN claude_quality_score smallint GENERATED ALWAYS AS (
    CASE
      WHEN protein_tier IS NULL OR carb_quality_score IS NULL OR timing_score IS NULL THEN NULL
      ELSE round(0.4 * protein_tier + 0.35 * carb_quality_score + 0.25 * timing_score)::smallint
    END
  ) STORED;

-- updated_at trigger
DROP TRIGGER IF EXISTS shield_nutrition_logs_updated_at ON public.shield_nutrition_logs;
CREATE TRIGGER shield_nutrition_logs_updated_at
  BEFORE UPDATE ON public.shield_nutrition_logs
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Refresh SELECT policy to hide soft-deleted rows from the app.
-- (service_role bypasses RLS, so audit reads still work.)
DROP POLICY IF EXISTS "own rows select" ON public.shield_nutrition_logs;
CREATE POLICY "own rows select" ON public.shield_nutrition_logs
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id AND deleted = false);

-- Separate policy so admins/owners can still query deleted rows explicitly via service role
-- (no extra policy needed; service_role bypasses RLS).

-- ============ Webhook dispatcher ============
CREATE OR REPLACE FUNCTION public.shield_dispatch_calculate_score(_user_id uuid, _entry_date date)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
  BEGIN
    PERFORM net.http_post(
      url := 'https://toixlzfmxtmtypmupcuc.supabase.co/functions/v1/calculate-score',
      headers := jsonb_build_object('Content-Type', 'application/json'),
      body := jsonb_build_object('user_id', _user_id, 'entry_date', _entry_date)
    );
  EXCEPTION WHEN OTHERS THEN
    -- swallow errors so writes never fail because the edge fn is missing
    NULL;
  END;
END;
$$;

-- Nutrition trigger: any insert/update fires; on delete-flag flips, also fires.
CREATE OR REPLACE FUNCTION public.shield_nutrition_logs_webhook()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM public.shield_dispatch_calculate_score(NEW.user_id, NEW.entry_date);
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS shield_nutrition_logs_webhook ON public.shield_nutrition_logs;
CREATE TRIGGER shield_nutrition_logs_webhook
  AFTER INSERT OR UPDATE ON public.shield_nutrition_logs
  FOR EACH ROW EXECUTE FUNCTION public.shield_nutrition_logs_webhook();

-- Manual inputs trigger
CREATE OR REPLACE FUNCTION public.shield_manual_inputs_webhook()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM public.shield_dispatch_calculate_score(NEW.user_id, NEW.entry_date);
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS shield_manual_inputs_webhook ON public.shield_manual_inputs;
CREATE TRIGGER shield_manual_inputs_webhook
  AFTER INSERT OR UPDATE ON public.shield_manual_inputs
  FOR EACH ROW EXECUTE FUNCTION public.shield_manual_inputs_webhook();

-- Training logs trigger
CREATE OR REPLACE FUNCTION public.shield_training_logs_webhook()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM public.shield_dispatch_calculate_score(NEW.user_id, NEW.entry_date);
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS shield_training_logs_webhook ON public.shield_training_logs;
CREATE TRIGGER shield_training_logs_webhook
  AFTER INSERT OR UPDATE ON public.shield_training_logs
  FOR EACH ROW EXECUTE FUNCTION public.shield_training_logs_webhook();

-- Device uploads: only fire when parse_status transitions to 'parsed'
CREATE OR REPLACE FUNCTION public.shield_device_uploads_webhook()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.parse_status = 'parsed'
     AND (TG_OP = 'INSERT' OR OLD.parse_status IS DISTINCT FROM 'parsed') THEN
    PERFORM public.shield_dispatch_calculate_score(NEW.user_id, NEW.entry_date);
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS shield_device_uploads_webhook ON public.shield_device_uploads;
CREATE TRIGGER shield_device_uploads_webhook
  AFTER INSERT OR UPDATE ON public.shield_device_uploads
  FOR EACH ROW EXECUTE FUNCTION public.shield_device_uploads_webhook();
