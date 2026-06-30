-- APEX Coach backend safety patch
-- Idempotent: safe to re-run.

-- ── A. Rewrite apply_existing_weekly_macro_review ─────────────────────────
CREATE OR REPLACE FUNCTION public.apply_existing_weekly_macro_review(
  p_review_id uuid,
  p_effective_start_date date DEFAULT CURRENT_DATE
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_review public.nutrition_weekly_reviews%ROWTYPE;
  v_active public.daily_macro_targets%ROWTYPE;
  v_new_id uuid;
  v_bmr numeric;
  v_tdee numeric;
  v_calories numeric;
  v_protein numeric;
  v_fat numeric;
  v_carbs numeric;
  v_closed_count integer;
BEGIN
  SELECT * INTO v_review
  FROM public.nutrition_weekly_reviews
  WHERE id = p_review_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'review_not_found: %', p_review_id;
  END IF;

  IF v_review.applied_target_id IS NOT NULL THEN
    RAISE EXCEPTION 'review_already_applied: %', p_review_id;
  END IF;

  SELECT * INTO v_active
  FROM public.daily_macro_targets
  WHERE user_id = v_review.user_id
    AND effective_end_date IS NULL
  ORDER BY effective_start_date DESC
  LIMIT 1
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'no_active_macro_target_for_user: %', v_review.user_id;
  END IF;

  IF p_effective_start_date < v_active.effective_start_date THEN
    RAISE EXCEPTION 'effective_start_before_active_target_start';
  END IF;

  -- Compose new target values from review (with active fallbacks)
  v_bmr := v_active.bmr;
  v_tdee := COALESCE(v_review.blended_tdee, v_active.tdee);
  v_calories := COALESCE(v_review.new_target_calories, v_active.target_calories);
  v_protein := v_active.target_protein_g;
  v_fat := v_active.target_fat_g;

  IF v_calories IS NOT NULL AND v_protein IS NOT NULL AND v_fat IS NOT NULL THEN
    v_carbs := GREATEST(0, ROUND((v_calories - v_protein * 4 - v_fat * 9) / 4.0));
  ELSE
    v_carbs := v_active.target_carbs_g;
  END IF;

  IF p_effective_start_date = v_active.effective_start_date THEN
    -- Same-day update in place
    UPDATE public.daily_macro_targets
    SET bmr = v_bmr,
        tdee = v_tdee,
        target_calories = v_calories,
        target_protein_g = v_protein,
        target_carbs_g = v_carbs,
        target_fat_g = v_fat,
        formula_used = 'adaptive_weekly_tdee_reconciliation_v1',
        source = 'weekly_review',
        review_id = v_review.id,
        calculated_at = now(),
        updated_at = now()
    WHERE id = v_active.id;

    v_new_id := v_active.id;
  ELSE
    -- Close the active row, insert a new one
    UPDATE public.daily_macro_targets
    SET effective_end_date = p_effective_start_date - 1,
        updated_at = now()
    WHERE id = v_active.id;

    GET DIAGNOSTICS v_closed_count = ROW_COUNT;
    IF v_closed_count <> 1 THEN
      RAISE EXCEPTION 'expected_one_active_target_to_close_for_user: %', v_review.user_id;
    END IF;

    INSERT INTO public.daily_macro_targets (
      user_id, calculated_at, bmr, tdee,
      target_calories, target_protein_g, target_carbs_g, target_fat_g,
      formula_used, effective_start_date, effective_end_date,
      source, review_id
    )
    VALUES (
      v_review.user_id, now(), v_bmr, v_tdee,
      v_calories, v_protein, v_carbs, v_fat,
      'adaptive_weekly_tdee_reconciliation_v1',
      p_effective_start_date, NULL,
      'weekly_review', v_review.id
    )
    RETURNING id INTO v_new_id;
  END IF;

  UPDATE public.nutrition_weekly_reviews
  SET applied_target_id = v_new_id,
      applied_at = now()
  WHERE id = v_review.id;

  RETURN v_new_id;
END;
$fn$;

-- ── B. Add Shield v1.1 decision columns to readiness_scores ──────────────
ALTER TABLE public.readiness_scores ADD COLUMN IF NOT EXISTS signal_quality jsonb DEFAULT '{}'::jsonb;
ALTER TABLE public.readiness_scores ADD COLUMN IF NOT EXISTS top_drivers jsonb DEFAULT '[]'::jsonb;
ALTER TABLE public.readiness_scores ADD COLUMN IF NOT EXISTS load_carryover jsonb DEFAULT '{}'::jsonb;
ALTER TABLE public.readiness_scores ADD COLUMN IF NOT EXISTS fuelling_status jsonb DEFAULT '{}'::jsonb;
ALTER TABLE public.readiness_scores ADD COLUMN IF NOT EXISTS training_permission text;
ALTER TABLE public.readiness_scores ADD COLUMN IF NOT EXISTS nutrition_modifier text;
ALTER TABLE public.readiness_scores ADD COLUMN IF NOT EXISTS reason_codes text[] DEFAULT '{}';

-- ── D. CHECK constraints on readiness_scores (guarded) ───────────────────
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'readiness_scores_training_permission_check'
      AND conrelid = 'public.readiness_scores'::regclass
  ) THEN
    ALTER TABLE public.readiness_scores
      ADD CONSTRAINT readiness_scores_training_permission_check
      CHECK (training_permission IS NULL OR training_permission IN
        ('green_train','yellow_modify','orange_reduce','red_recover'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'readiness_scores_nutrition_modifier_check'
      AND conrelid = 'public.readiness_scores'::regclass
  ) THEN
    ALTER TABLE public.readiness_scores
      ADD CONSTRAINT readiness_scores_nutrition_modifier_check
      CHECK (nutrition_modifier IS NULL OR nutrition_modifier IN
        ('normal','fuel_more','protein_priority','hydration_priority','deficit_caution','recovery_day_refeed'));
  END IF;
END
$$;

-- ── E. Create shield_signal_quality_events ───────────────────────────────
CREATE TABLE IF NOT EXISTS public.shield_signal_quality_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  signal_date date NOT NULL,
  source_table text,
  source_id uuid,
  metric_name text NOT NULL,
  raw_value numeric,
  normalized_value numeric,
  unit text,
  source_type text NOT NULL,
  device_source text,
  freshness_status text,
  validity_status text,
  confidence_level text,
  reason_codes text[] DEFAULT '{}',
  created_at timestamptz DEFAULT now()
);

GRANT SELECT ON public.shield_signal_quality_events TO authenticated;
GRANT ALL ON public.shield_signal_quality_events TO service_role;

ALTER TABLE public.shield_signal_quality_events ENABLE ROW LEVEL SECURITY;

-- ── F. CHECK constraints on shield_signal_quality_events (guarded) ───────
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'shield_sqe_source_type_check'
      AND conrelid = 'public.shield_signal_quality_events'::regclass
  ) THEN
    ALTER TABLE public.shield_signal_quality_events
      ADD CONSTRAINT shield_sqe_source_type_check
      CHECK (source_type IN
        ('device_screenshot','manual','workout_log','nutrition_log','mood_log','system'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'shield_sqe_freshness_status_check'
      AND conrelid = 'public.shield_signal_quality_events'::regclass
  ) THEN
    ALTER TABLE public.shield_signal_quality_events
      ADD CONSTRAINT shield_sqe_freshness_status_check
      CHECK (freshness_status IS NULL OR freshness_status IN
        ('fresh','stale','missing','future_date','unknown'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'shield_sqe_validity_status_check'
      AND conrelid = 'public.shield_signal_quality_events'::regclass
  ) THEN
    ALTER TABLE public.shield_signal_quality_events
      ADD CONSTRAINT shield_sqe_validity_status_check
      CHECK (validity_status IS NULL OR validity_status IN
        ('valid','suspicious','invalid','missing'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'shield_sqe_confidence_level_check'
      AND conrelid = 'public.shield_signal_quality_events'::regclass
  ) THEN
    ALTER TABLE public.shield_signal_quality_events
      ADD CONSTRAINT shield_sqe_confidence_level_check
      CHECK (confidence_level IS NULL OR confidence_level IN ('HIGH','MEDIUM','LOW'));
  END IF;
END
$$;

-- ── G. Indexes ───────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_shield_signal_quality_events_user_date
  ON public.shield_signal_quality_events (user_id, signal_date);
CREATE INDEX IF NOT EXISTS idx_shield_signal_quality_events_user_metric_date
  ON public.shield_signal_quality_events (user_id, metric_name, signal_date);
CREATE INDEX IF NOT EXISTS idx_readiness_scores_user_date
  ON public.readiness_scores (user_id, score_date);

-- ── H. RLS policy: SELECT own rows only (no write policies = blocked) ────
DROP POLICY IF EXISTS signal_quality_select_own ON public.shield_signal_quality_events;
CREATE POLICY signal_quality_select_own
  ON public.shield_signal_quality_events
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);