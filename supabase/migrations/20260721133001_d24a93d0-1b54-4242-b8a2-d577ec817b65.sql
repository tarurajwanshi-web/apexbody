ALTER TABLE public.nutrition_weekly_reviews DROP CONSTRAINT IF EXISTS nutrition_weekly_reviews_flag_chk;
ALTER TABLE public.nutrition_weekly_reviews ADD CONSTRAINT nutrition_weekly_reviews_flag_chk CHECK (
  flag_reason IS NULL OR flag_reason IN (
    'insufficient_data',
    'abnormal_week',
    'deficit_capped_for_safety',
    'missing_required_profile_data',
    'low_adherence_muscle_gain',
    'refeed_candidate',
    'floor_aware_low_adherence',
    'low_adherence',
    'invalid_goal_value',
    'missing_target_rate',
    'deficit_caution_override',
    'fuel_more_override',
    'target_reached',
    'at_safe_minimum_not_deficit',
    'abnormal_weight_swing',
    'stale_weight_used'
  )
);