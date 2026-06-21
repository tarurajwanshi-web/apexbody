
-- =====================================================================
-- PART 1: profiles additions
-- =====================================================================
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS timezone text NOT NULL DEFAULT 'Asia/Dubai',
  ADD COLUMN IF NOT EXISTS user_marked_abnormal_week_start date;

-- =====================================================================
-- PART 2: nutrition_weekly_reviews (created first so daily_macro_targets
-- can attach its FK inline)
-- =====================================================================
CREATE TABLE IF NOT EXISTS public.nutrition_weekly_reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  week_start_date date NOT NULL,
  week_end_date date NOT NULL,
  weigh_in_count smallint NOT NULL DEFAULT 0,
  days_logged smallint NOT NULL DEFAULT 0,
  adherence_pct numeric NOT NULL DEFAULT 0,
  eligible boolean NOT NULL DEFAULT false,
  confidence_tier text,
  abnormal_week boolean NOT NULL DEFAULT false,
  old_target_calories numeric,
  old_observed_tdee numeric,
  new_observed_tdee numeric,
  blended_tdee numeric,
  raw_target_calories numeric,
  new_target_calories numeric,
  adjustment_kcal numeric NOT NULL DEFAULT 0,
  decision text NOT NULL,
  flag_reason text,
  applied_target_id uuid,
  applied_at timestamptz,
  timezone_used text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT nutrition_weekly_reviews_user_week_uq UNIQUE (user_id, week_start_date),
  CONSTRAINT nutrition_weekly_reviews_confidence_chk CHECK (confidence_tier IS NULL OR confidence_tier IN ('high','medium','low')),
  CONSTRAINT nutrition_weekly_reviews_decision_chk CHECK (decision IN ('reduce','increase','hold','capped')),
  CONSTRAINT nutrition_weekly_reviews_flag_chk CHECK (
    flag_reason IS NULL OR flag_reason IN (
      'insufficient_data','abnormal_week','deficit_capped_for_safety','missing_required_profile_data'
    )
  )
);

GRANT SELECT ON public.nutrition_weekly_reviews TO authenticated;
GRANT ALL    ON public.nutrition_weekly_reviews TO service_role;

ALTER TABLE public.nutrition_weekly_reviews ENABLE ROW LEVEL SECURITY;

CREATE POLICY "users read own weekly reviews"
  ON public.nutrition_weekly_reviews
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS nutrition_weekly_reviews_user_week_idx
  ON public.nutrition_weekly_reviews(user_id, week_start_date DESC);

-- =====================================================================
-- PART 3: daily_macro_targets evolution
-- =====================================================================

-- Step 1: add effective_start_date nullable
ALTER TABLE public.daily_macro_targets
  ADD COLUMN IF NOT EXISTS effective_start_date date;

-- Step 2: backfill existing rows
UPDATE public.daily_macro_targets
SET effective_start_date = COALESCE(calculated_at::date, created_at::date, CURRENT_DATE)
WHERE effective_start_date IS NULL;

-- Step 3: add effective_end_date (NULL = active)
ALTER TABLE public.daily_macro_targets
  ADD COLUMN IF NOT EXISTS effective_end_date date;

-- Step 4: add source, backfill onboarding
ALTER TABLE public.daily_macro_targets
  ADD COLUMN IF NOT EXISTS source text;

UPDATE public.daily_macro_targets
SET source = 'onboarding'
WHERE source IS NULL;

ALTER TABLE public.daily_macro_targets
  ALTER COLUMN source SET NOT NULL,
  ALTER COLUMN source SET DEFAULT 'onboarding';

ALTER TABLE public.daily_macro_targets
  ADD CONSTRAINT daily_macro_targets_source_chk
  CHECK (source IN ('onboarding','weekly_review'));

-- Step 5: add review_id with FK
ALTER TABLE public.daily_macro_targets
  ADD COLUMN IF NOT EXISTS review_id uuid
  REFERENCES public.nutrition_weekly_reviews(id) ON DELETE SET NULL;

-- Step 6: NOT NULL on effective_start_date
ALTER TABLE public.daily_macro_targets
  ALTER COLUMN effective_start_date SET NOT NULL;

-- Step 7: drop legacy UNIQUE(user_id)
ALTER TABLE public.daily_macro_targets
  DROP CONSTRAINT IF EXISTS daily_macro_targets_user_unique;

-- Step 8: replace with UNIQUE(user_id, effective_start_date)
ALTER TABLE public.daily_macro_targets
  ADD CONSTRAINT daily_macro_targets_user_start_uq
  UNIQUE (user_id, effective_start_date);

-- Step 9: partial unique to enforce exactly-one-active per user
CREATE UNIQUE INDEX IF NOT EXISTS unique_active_macro_target_per_user
  ON public.daily_macro_targets(user_id)
  WHERE effective_end_date IS NULL;

-- Now wire the applied_target_id FK on nutrition_weekly_reviews
ALTER TABLE public.nutrition_weekly_reviews
  ADD CONSTRAINT nutrition_weekly_reviews_applied_target_fkey
  FOREIGN KEY (applied_target_id)
  REFERENCES public.daily_macro_targets(id) ON DELETE SET NULL;

-- =====================================================================
-- PART 4: apply_weekly_macro_review RPC (single-transaction)
-- =====================================================================
CREATE OR REPLACE FUNCTION public.apply_weekly_macro_review(
  p_review_id uuid,
  p_user_id uuid,
  p_week_start_date date,
  p_week_end_date date,
  p_effective_start_date date,
  -- review fields
  p_weigh_in_count smallint,
  p_days_logged smallint,
  p_adherence_pct numeric,
  p_eligible boolean,
  p_confidence_tier text,
  p_abnormal_week boolean,
  p_old_target_calories numeric,
  p_old_observed_tdee numeric,
  p_new_observed_tdee numeric,
  p_blended_tdee numeric,
  p_raw_target_calories numeric,
  p_new_target_calories numeric,
  p_adjustment_kcal numeric,
  p_decision text,
  p_flag_reason text,
  p_timezone_used text,
  -- new target fields
  p_bmr numeric,
  p_target_protein_g numeric,
  p_target_carbs_g numeric,
  p_target_fat_g numeric
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_closed_count integer;
  v_new_target_id uuid;
BEGIN
  -- 1. Insert review (applied_target_id null for now)
  INSERT INTO public.nutrition_weekly_reviews (
    id, user_id, week_start_date, week_end_date,
    weigh_in_count, days_logged, adherence_pct, eligible,
    confidence_tier, abnormal_week,
    old_target_calories, old_observed_tdee, new_observed_tdee,
    blended_tdee, raw_target_calories, new_target_calories,
    adjustment_kcal, decision, flag_reason, timezone_used
  ) VALUES (
    p_review_id, p_user_id, p_week_start_date, p_week_end_date,
    p_weigh_in_count, p_days_logged, p_adherence_pct, p_eligible,
    p_confidence_tier, p_abnormal_week,
    p_old_target_calories, p_old_observed_tdee, p_new_observed_tdee,
    p_blended_tdee, p_raw_target_calories, p_new_target_calories,
    p_adjustment_kcal, p_decision, p_flag_reason, p_timezone_used
  );

  -- 2. Close the currently-active target row
  UPDATE public.daily_macro_targets
  SET effective_end_date = p_effective_start_date,
      updated_at = now()
  WHERE user_id = p_user_id AND effective_end_date IS NULL;

  GET DIAGNOSTICS v_closed_count = ROW_COUNT;
  IF v_closed_count <> 1 THEN
    RAISE EXCEPTION 'apply_weekly_macro_review: expected exactly 1 active target row to close for user %, found %', p_user_id, v_closed_count;
  END IF;

  -- 3. Insert new active target row
  INSERT INTO public.daily_macro_targets (
    user_id, calculated_at, bmr, tdee,
    target_calories, target_protein_g, target_carbs_g, target_fat_g,
    formula_used, effective_start_date, effective_end_date,
    source, review_id
  ) VALUES (
    p_user_id, now(), p_bmr, p_blended_tdee,
    p_new_target_calories, p_target_protein_g, p_target_carbs_g, p_target_fat_g,
    'adaptive_weekly_tdee_reconciliation_v1',
    p_effective_start_date, NULL,
    'weekly_review', p_review_id
  )
  RETURNING id INTO v_new_target_id;

  -- 4. Backfill applied_target_id on the review row
  UPDATE public.nutrition_weekly_reviews
  SET applied_target_id = v_new_target_id,
      applied_at = now()
  WHERE id = p_review_id;

  RETURN v_new_target_id;
END;
$$;

REVOKE ALL ON FUNCTION public.apply_weekly_macro_review(
  uuid, uuid, date, date, date,
  smallint, smallint, numeric, boolean, text, boolean,
  numeric, numeric, numeric, numeric, numeric, numeric, numeric,
  text, text, text,
  numeric, numeric, numeric, numeric
) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.apply_weekly_macro_review(
  uuid, uuid, date, date, date,
  smallint, smallint, numeric, boolean, text, boolean,
  numeric, numeric, numeric, numeric, numeric, numeric, numeric,
  text, text, text,
  numeric, numeric, numeric, numeric
) TO service_role;

-- =====================================================================
-- PART 5: enable pg_cron
-- =====================================================================
CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS pg_net  WITH SCHEMA extensions;
