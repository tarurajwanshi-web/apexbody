
ALTER TABLE public.shield_nutrition_logs
  DROP CONSTRAINT IF EXISTS shield_nutrition_logs_calorie_estimate_status_check;
ALTER TABLE public.shield_nutrition_logs
  ADD CONSTRAINT shield_nutrition_logs_calorie_estimate_status_check
  CHECK (calorie_estimate_status = ANY (ARRAY['pending'::text,'estimated'::text,'failed'::text,'manual_edited'::text]));

ALTER TABLE public.shield_nutrition_logs
  ADD COLUMN IF NOT EXISTS original_estimated_items jsonb,
  ADD COLUMN IF NOT EXISTS original_estimated_calories numeric,
  ADD COLUMN IF NOT EXISTS original_estimated_protein_g numeric,
  ADD COLUMN IF NOT EXISTS original_estimated_carbs_g numeric,
  ADD COLUMN IF NOT EXISTS original_estimated_fat_g numeric,
  ADD COLUMN IF NOT EXISTS user_corrected boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS correction_count integer NOT NULL DEFAULT 0;

-- Server-side score-nutrition dispatcher (safety net; client fast-path remains)
CREATE OR REPLACE FUNCTION public.shield_dispatch_score_nutrition(_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, vault
AS $$
DECLARE _secret text;
BEGIN
  BEGIN
    SELECT decrypted_secret INTO _secret FROM vault.decrypted_secrets WHERE name = 'dispatch_secret' LIMIT 1;
    PERFORM net.http_post(
      url := 'https://toixlzfmxtmtypmupcuc.supabase.co/functions/v1/score-nutrition',
      headers := jsonb_build_object(
        'Content-Type','application/json',
        'x-internal-secret', COALESCE(_secret,'')
      ),
      body := jsonb_build_object('nutrition_log_id', _id)
    );
  EXCEPTION WHEN OTHERS THEN NULL;
  END;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.shield_dispatch_score_nutrition(uuid) FROM PUBLIC;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sandbox_exec') THEN
    EXECUTE 'REVOKE EXECUTE ON FUNCTION public.shield_dispatch_score_nutrition(uuid) FROM sandbox_exec';
  END IF;
END $$;
GRANT EXECUTE ON FUNCTION public.shield_dispatch_score_nutrition(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.shield_nutrition_logs_score_dispatch_webhook()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.claude_score_status = 'pending' THEN
    PERFORM public.shield_dispatch_score_nutrition(NEW.id);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS shield_nutrition_logs_score_dispatch ON public.shield_nutrition_logs;
CREATE TRIGGER shield_nutrition_logs_score_dispatch
AFTER INSERT ON public.shield_nutrition_logs
FOR EACH ROW EXECUTE FUNCTION public.shield_nutrition_logs_score_dispatch_webhook();
