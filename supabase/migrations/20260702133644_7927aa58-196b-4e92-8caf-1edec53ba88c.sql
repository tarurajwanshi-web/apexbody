DROP POLICY IF EXISTS "own row update"  ON public.daily_macro_targets;
DROP POLICY IF EXISTS "own row delete"  ON public.daily_macro_targets;

DROP POLICY IF EXISTS "users update own weekly reviews" ON public.nutrition_weekly_reviews;
DROP POLICY IF EXISTS "users delete own weekly reviews" ON public.nutrition_weekly_reviews;

DROP POLICY IF EXISTS "own rows insert" ON public.readiness_scores;
DROP POLICY IF EXISTS "own rows update" ON public.readiness_scores;
DROP POLICY IF EXISTS "own rows delete" ON public.readiness_scores;

DROP POLICY IF EXISTS "own row insert"  ON public.weekly_plans;
DROP POLICY IF EXISTS "own row update"  ON public.weekly_plans;
DROP POLICY IF EXISTS "own row delete"  ON public.weekly_plans;