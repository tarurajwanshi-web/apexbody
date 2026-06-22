DROP POLICY IF EXISTS "own rows update" ON public.shield_nutrition_logs;
CREATE POLICY "own rows update" ON public.shield_nutrition_logs
  FOR UPDATE TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);