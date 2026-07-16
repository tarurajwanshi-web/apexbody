-- Adaptive macro-review test seed pack.
--
-- Purpose: prove that the observed-vs-target-rate branch in
-- supabase/functions/_shared/macro-calculation.ts (the block starting at
-- "if (direction === 'lose')") produces a decision of 'reduce' or 'increase'
-- for at least one user. Every review in nutrition_weekly_reviews prior to
-- this seed was 'hold' or 'capped', so we need one user with:
--
--   • realistic adherence (>= 5 days_logged out of the prior 7)
--   • a real weight trend (>= 2 weigh_ins, distinct entry_dates)
--   • target_rate_pct set (so the rate comparison actually runs)
--   • an active daily_macro_targets row (already true for our test cohort)
--
-- Two synthetic users are seeded for the prior full week:
--   USER_LOSE_UNDERSHOOT  loses less weight than their target rate → expect 'reduce'
--   USER_GAIN_UNDERSHOOT  gains less weight than their target rate → expect 'increase'
--
-- Adjust the two uuid literals below to two real test-user ids in your
-- profiles table before running. They must already have an active
-- daily_macro_targets row with source='onboarding' (§5 of the diagnostic).
--
-- After running this file, POST to trigger-weekly-macro-review (or wait for
-- the weekly cron) and then run the verification query at the bottom.

\set USER_LOSE   '\'00000000-0000-0000-0001-000000000009\''  -- fat_loss user
\set USER_GAIN   '\'00000000-0000-0000-0001-000000000008\''  -- muscle_gain user

BEGIN;

-- 1. Ensure the two users have target_rate_pct populated and the right goal
--    direction. Adjust weights if the profile weights differ.
UPDATE public.profiles
SET goal = 'fat_loss', target_rate_pct = 0.5, target_weight_kg = COALESCE(target_weight_kg, measurement_weight_kg - 5)
WHERE user_id = :USER_LOSE;

UPDATE public.profiles
SET goal = 'muscle_gain', target_rate_pct = 0.25, target_weight_kg = COALESCE(target_weight_kg, measurement_weight_kg + 5)
WHERE user_id = :USER_GAIN;

-- 2. Seed 6 daily nutrition logs and 3 weigh-ins for the prior week
--    (Monday..Sunday of the week that just ended in the user's timezone;
--    the calculator uses today's local Monday minus 7 days). Adjust the
--    date arithmetic if the current date is far from these values.
WITH prior AS (
  SELECT (date_trunc('week', now() AT TIME ZONE 'Asia/Dubai')::date - INTERVAL '7 days')::date AS wk_start
)
INSERT INTO public.shield_nutrition_logs
  (user_id, entry_date, deleted, estimated_calories, calorie_estimate_status, created_at)
SELECT :USER_LOSE, (SELECT wk_start FROM prior) + offset, false, 2050, 'estimated',
       ((SELECT wk_start FROM prior) + offset + INTERVAL '12 hours')::timestamptz
FROM generate_series(0, 5) AS offset
UNION ALL
SELECT :USER_GAIN, (SELECT wk_start FROM prior) + offset, false, 2600, 'estimated',
       ((SELECT wk_start FROM prior) + offset + INTERVAL '12 hours')::timestamptz
FROM generate_series(0, 5) AS offset;

-- 3. Seed weigh-ins showing an "undershoot" trend:
--    Loser drops 0.1 kg over 6 days (target was 0.5% × weight — expect reduce).
--    Gainer adds 0.05 kg over 6 days (target was 0.25% × weight — expect increase).
WITH prior AS (
  SELECT (date_trunc('week', now() AT TIME ZONE 'Asia/Dubai')::date - INTERVAL '7 days')::date AS wk_start
),
lose_base AS (SELECT COALESCE(measurement_weight_kg, 80) AS w FROM public.profiles WHERE user_id = :USER_LOSE),
gain_base AS (SELECT COALESCE(measurement_weight_kg, 80) AS w FROM public.profiles WHERE user_id = :USER_GAIN)
INSERT INTO public.body_measurement_events
  (user_id, entry_date, weight_kg, created_at)
SELECT :USER_LOSE, (SELECT wk_start FROM prior) + d, (SELECT w FROM lose_base) - d * 0.017,
       ((SELECT wk_start FROM prior) + d + INTERVAL '7 hours')::timestamptz
FROM (VALUES (0), (3), (6)) v(d)
UNION ALL
SELECT :USER_GAIN, (SELECT wk_start FROM prior) + d, (SELECT w FROM gain_base) + d * 0.008,
       ((SELECT wk_start FROM prior) + d + INTERVAL '7 hours')::timestamptz
FROM (VALUES (0), (3), (6)) v(d);

-- 4. Clear any stale abnormal-week marker so adherence is judged fresh.
UPDATE public.profiles
SET user_marked_abnormal_week_start = NULL
WHERE user_id IN (:USER_LOSE, :USER_GAIN);

-- 5. Drop any pre-existing weekly review for the seeded week so calculate-macros-weekly
--    can re-run for these two users without hitting the review_exists guard.
DELETE FROM public.nutrition_weekly_reviews
WHERE user_id IN (:USER_LOSE, :USER_GAIN)
  AND week_start_date = (date_trunc('week', now() AT TIME ZONE 'Asia/Dubai')::date - INTERVAL '7 days')::date;

COMMIT;

-- ─────────────────────────────────────────────────────────────────────────
-- Verification query. Run AFTER invoking trigger-weekly-macro-review
-- (POST https://<project>.supabase.co/functions/v1/trigger-weekly-macro-review
-- with the internal secret) or waiting for the next cron tick.
-- ─────────────────────────────────────────────────────────────────────────

SELECT user_id, week_start_date, decision, flag_reason,
       weigh_in_count, days_logged, adherence_pct,
       weight_trend_kg_per_week, adjustment_kcal, applied_at
FROM public.nutrition_weekly_reviews
WHERE user_id IN (:USER_LOSE, :USER_GAIN)
ORDER BY week_start_date DESC
LIMIT 4;

-- PASS criteria for the diagnostic:
--   • the USER_LOSE row has decision='reduce' (or 'capped' with adjustment_kcal < 0)
--   • the USER_GAIN row has decision='increase'
--   • applied_at is non-NULL for at least one
--
-- If both come back 'hold' with flag_reason='abnormal_week', re-check that
-- the seeded entry_dates land inside the review's week window for the
-- current timezone. If both come back 'hold' with no flag_reason, the
-- rate-comparison branch is broken and the adaptive engine needs code
-- changes, not more data.
