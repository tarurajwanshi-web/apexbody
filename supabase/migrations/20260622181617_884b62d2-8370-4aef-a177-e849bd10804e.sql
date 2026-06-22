
-- Lock down SECURITY DEFINER functions: revoke EXECUTE from anon/authenticated/PUBLIC.
-- Keep increment_hydration callable by authenticated users (it is the user-facing RPC).
REVOKE EXECUTE ON FUNCTION public.apply_onboarding_macros(uuid, date, numeric, numeric, numeric, numeric, numeric, numeric, text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.apply_weekly_macro_review(uuid, uuid, date, date, date, smallint, smallint, numeric, boolean, text, boolean, numeric, numeric, numeric, numeric, numeric, numeric, numeric, text, text, text, numeric, numeric, numeric, numeric) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.get_dispatch_secret() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.shield_dispatch_calculate_score(uuid, date) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.shield_dispatch_parse_device_upload(uuid, uuid, date) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.shield_dispatch_score_nutrition(uuid) FROM PUBLIC, anon, authenticated;
-- Trigger-only webhook functions (no zero-arg call surface needed for clients)
REVOKE EXECUTE ON FUNCTION public.shield_device_uploads_parse_webhook() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.shield_device_uploads_webhook() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.shield_manual_inputs_webhook() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.shield_nutrition_logs_score_dispatch_webhook() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.shield_nutrition_logs_webhook() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.shield_pre_session_checks_webhook() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.shield_training_logs_webhook() FROM PUBLIC, anon, authenticated;

-- daily_macro_targets: owner-scoped write policies (writes happen via SECURITY DEFINER fns;
-- these policies are defense-in-depth so direct PostgREST writes cannot target other users).
CREATE POLICY "own row insert" ON public.daily_macro_targets FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "own row update" ON public.daily_macro_targets FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "own row delete" ON public.daily_macro_targets FOR DELETE TO authenticated USING (auth.uid() = user_id);

-- nutrition_weekly_reviews
CREATE POLICY "users insert own weekly reviews" ON public.nutrition_weekly_reviews FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "users update own weekly reviews" ON public.nutrition_weekly_reviews FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "users delete own weekly reviews" ON public.nutrition_weekly_reviews FOR DELETE TO authenticated USING (auth.uid() = user_id);

-- readiness_scores
CREATE POLICY "own rows insert" ON public.readiness_scores FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "own rows update" ON public.readiness_scores FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "own rows delete" ON public.readiness_scores FOR DELETE TO authenticated USING (auth.uid() = user_id);

-- weekly_plans
CREATE POLICY "own row insert" ON public.weekly_plans FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "own row update" ON public.weekly_plans FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "own row delete" ON public.weekly_plans FOR DELETE TO authenticated USING (auth.uid() = user_id);

-- hydration_events: missing UPDATE policy
CREATE POLICY "Users update own hydration events" ON public.hydration_events FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
