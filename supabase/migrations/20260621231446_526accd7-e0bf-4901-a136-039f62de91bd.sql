
-- ── #4: RLS lockdown on derived/system-generated tables ─────────────────────
-- daily_macro_targets, readiness_scores, weekly_plans are written only by
-- service-role edge functions / the apply_weekly_macro_review RPC. Strip
-- direct user write access; keep SELECT-own + implicit service_role ALL.

DROP POLICY IF EXISTS "Users insert own macro targets" ON public.daily_macro_targets;
DROP POLICY IF EXISTS "Users update own macro targets" ON public.daily_macro_targets;
DROP POLICY IF EXISTS "Users delete own macro targets" ON public.daily_macro_targets;

DROP POLICY IF EXISTS "own rows insert" ON public.readiness_scores;
DROP POLICY IF EXISTS "own rows update" ON public.readiness_scores;
DROP POLICY IF EXISTS "own rows delete" ON public.readiness_scores;

DROP POLICY IF EXISTS "Users insert own weekly plans" ON public.weekly_plans;
DROP POLICY IF EXISTS "Users update own weekly plans" ON public.weekly_plans;
DROP POLICY IF EXISTS "Users delete own weekly plans" ON public.weekly_plans;

-- ── #3: Internal-secret table for DB→edge-function dispatch authentication ─
-- Service-role only. No public grants, no policies, RLS on (denies anon/auth
-- entirely). Security-definer SQL dispatch funcs and the service-role edge
-- functions read directly; PostgREST exposure is blocked.
CREATE TABLE IF NOT EXISTS public.internal_secrets (
  name text PRIMARY KEY,
  value text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.internal_secrets TO service_role;
ALTER TABLE public.internal_secrets ENABLE ROW LEVEL SECURITY;

INSERT INTO public.internal_secrets (name, value)
VALUES ('dispatch_secret', encode(gen_random_bytes(32), 'hex'))
ON CONFLICT (name) DO NOTHING;

-- Update dispatch funcs to forward the internal secret as an HTTP header.
CREATE OR REPLACE FUNCTION public.shield_dispatch_calculate_score(_user_id uuid, _entry_date date)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE _secret text;
BEGIN
  BEGIN
    SELECT value INTO _secret FROM public.internal_secrets WHERE name = 'dispatch_secret';
    PERFORM net.http_post(
      url := 'https://toixlzfmxtmtypmupcuc.supabase.co/functions/v1/calculate-score',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-internal-secret', COALESCE(_secret, '')
      ),
      body := jsonb_build_object('user_id', _user_id, 'entry_date', _entry_date)
    );
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;
END;
$function$;

CREATE OR REPLACE FUNCTION public.shield_dispatch_parse_device_upload(_upload_id uuid, _user_id uuid, _entry_date date)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE _secret text;
BEGIN
  BEGIN
    SELECT value INTO _secret FROM public.internal_secrets WHERE name = 'dispatch_secret';
    PERFORM net.http_post(
      url := 'https://toixlzfmxtmtypmupcuc.supabase.co/functions/v1/parse-device-upload',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-internal-secret', COALESCE(_secret, '')
      ),
      body := jsonb_build_object('upload_id', _upload_id, 'user_id', _user_id, 'entry_date', _entry_date)
    );
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;
END;
$function$;

-- ── #7: Atomic onboarding macros write (close prior active + insert new) ────
-- Matches the apply_weekly_macro_review transactional pattern, scoped to the
-- onboarding path. Restricted to service_role.
CREATE OR REPLACE FUNCTION public.apply_onboarding_macros(
  p_user_id uuid,
  p_effective_start_date date,
  p_bmr numeric,
  p_tdee numeric,
  p_target_calories numeric,
  p_target_protein_g numeric,
  p_target_carbs_g numeric,
  p_target_fat_g numeric,
  p_formula_used text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_existing_id uuid;
  v_new_id uuid;
BEGIN
  -- If a target already exists for this user at this effective_start_date,
  -- update it in place (idempotent re-run during onboarding tweaks).
  SELECT id INTO v_existing_id
  FROM public.daily_macro_targets
  WHERE user_id = p_user_id
    AND effective_start_date = p_effective_start_date
  LIMIT 1;

  IF v_existing_id IS NOT NULL THEN
    UPDATE public.daily_macro_targets
    SET calculated_at = now(),
        bmr = p_bmr,
        tdee = p_tdee,
        target_calories = p_target_calories,
        target_protein_g = p_target_protein_g,
        target_carbs_g = p_target_carbs_g,
        target_fat_g = p_target_fat_g,
        formula_used = p_formula_used,
        effective_end_date = NULL,
        source = 'onboarding',
        review_id = NULL,
        updated_at = now()
    WHERE id = v_existing_id;
    RETURN v_existing_id;
  END IF;

  -- Otherwise close any prior active target row (started before today) and
  -- insert the new one — single transaction, so the partial unique index
  -- can never see two active rows for this user.
  UPDATE public.daily_macro_targets
  SET effective_end_date = p_effective_start_date,
      updated_at = now()
  WHERE user_id = p_user_id
    AND effective_end_date IS NULL
    AND effective_start_date < p_effective_start_date;

  INSERT INTO public.daily_macro_targets (
    user_id, calculated_at, bmr, tdee,
    target_calories, target_protein_g, target_carbs_g, target_fat_g,
    formula_used, effective_start_date, effective_end_date, source, review_id
  ) VALUES (
    p_user_id, now(), p_bmr, p_tdee,
    p_target_calories, p_target_protein_g, p_target_carbs_g, p_target_fat_g,
    p_formula_used, p_effective_start_date, NULL, 'onboarding', NULL
  )
  RETURNING id INTO v_new_id;

  RETURN v_new_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.apply_onboarding_macros(uuid, date, numeric, numeric, numeric, numeric, numeric, numeric, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_onboarding_macros(uuid, date, numeric, numeric, numeric, numeric, numeric, numeric, text) TO service_role;
