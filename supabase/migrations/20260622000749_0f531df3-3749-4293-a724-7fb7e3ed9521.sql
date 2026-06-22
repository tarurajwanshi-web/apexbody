DELETE FROM public.body_measurement_events
 WHERE user_id='15f6216f-a5c9-4956-86a3-f7cf4c7089d3'
   AND entry_date IN ('2026-06-15','2026-06-17','2026-06-19');

DELETE FROM public.shield_nutrition_logs
 WHERE user_id='15f6216f-a5c9-4956-86a3-f7cf4c7089d3'
   AND meal_description LIKE 'seed-%';

-- Order matters: drop new active target FIRST, then re-open the prior.
DELETE FROM public.daily_macro_targets WHERE id = 'e32f07e0-bf50-489b-b7e2-7d53fc414c90';

UPDATE public.daily_macro_targets
   SET effective_end_date = NULL, updated_at = now()
 WHERE id = 'd3eb5a84-c5f9-413e-8260-09a2cf102652';

DELETE FROM public.nutrition_weekly_reviews WHERE id = '68e6b71e-1443-478f-9064-98272b77894c';

REVOKE EXECUTE ON FUNCTION public.get_dispatch_secret() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_dispatch_secret() FROM sandbox_exec;