
CREATE POLICY "Users insert own macro targets" ON public.daily_macro_targets FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users update own macro targets" ON public.daily_macro_targets FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users delete own macro targets" ON public.daily_macro_targets FOR DELETE TO authenticated USING (auth.uid() = user_id);

CREATE POLICY "Users insert own weekly plans" ON public.weekly_plans FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users update own weekly plans" ON public.weekly_plans FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users delete own weekly plans" ON public.weekly_plans FOR DELETE TO authenticated USING (auth.uid() = user_id);
