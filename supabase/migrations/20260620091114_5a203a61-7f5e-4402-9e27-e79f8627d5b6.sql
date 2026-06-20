
-- shield_manual_inputs
CREATE TABLE public.shield_manual_inputs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  entry_date date NOT NULL,
  recovery_self_rating smallint CHECK (recovery_self_rating BETWEEN 1 AND 5),
  sleep_hours numeric(4,2),
  mood_emoji text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, entry_date)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.shield_manual_inputs TO authenticated;
GRANT ALL ON public.shield_manual_inputs TO service_role;
ALTER TABLE public.shield_manual_inputs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own rows select" ON public.shield_manual_inputs FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "own rows insert" ON public.shield_manual_inputs FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "own rows update" ON public.shield_manual_inputs FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "own rows delete" ON public.shield_manual_inputs FOR DELETE TO authenticated USING (auth.uid() = user_id);

-- shield_device_uploads
CREATE TABLE public.shield_device_uploads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  entry_date date NOT NULL,
  device_source text CHECK (device_source IN ('whoop','oura','garmin')),
  screenshot_url text NOT NULL,
  parsed_hrv numeric,
  parsed_rhr numeric,
  parsed_sleep_hours numeric(4,2),
  parsed_sleep_stages jsonb,
  parse_status text NOT NULL DEFAULT 'pending' CHECK (parse_status IN ('pending','parsed','failed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, entry_date)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.shield_device_uploads TO authenticated;
GRANT ALL ON public.shield_device_uploads TO service_role;
ALTER TABLE public.shield_device_uploads ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own rows select" ON public.shield_device_uploads FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "own rows insert" ON public.shield_device_uploads FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "own rows update" ON public.shield_device_uploads FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "own rows delete" ON public.shield_device_uploads FOR DELETE TO authenticated USING (auth.uid() = user_id);

-- shield_nutrition_logs
CREATE TABLE public.shield_nutrition_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  entry_date date NOT NULL,
  meal_description text,
  meal_photo_url text,
  claude_quality_score numeric,
  claude_score_status text NOT NULL DEFAULT 'pending' CHECK (claude_score_status IN ('pending','scored','failed')),
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.shield_nutrition_logs TO authenticated;
GRANT ALL ON public.shield_nutrition_logs TO service_role;
ALTER TABLE public.shield_nutrition_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own rows select" ON public.shield_nutrition_logs FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "own rows insert" ON public.shield_nutrition_logs FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "own rows update" ON public.shield_nutrition_logs FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "own rows delete" ON public.shield_nutrition_logs FOR DELETE TO authenticated USING (auth.uid() = user_id);

-- shield_training_logs
CREATE TABLE public.shield_training_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  entry_date date NOT NULL,
  strain_value numeric,
  session_notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.shield_training_logs TO authenticated;
GRANT ALL ON public.shield_training_logs TO service_role;
ALTER TABLE public.shield_training_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own rows select" ON public.shield_training_logs FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "own rows insert" ON public.shield_training_logs FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "own rows update" ON public.shield_training_logs FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "own rows delete" ON public.shield_training_logs FOR DELETE TO authenticated USING (auth.uid() = user_id);

-- readiness_scores
CREATE TABLE public.readiness_scores (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  score_date date NOT NULL,
  final_score numeric NOT NULL,
  confidence_level text CHECK (confidence_level IN ('HIGH','MEDIUM','LOW')),
  confidence_reason text,
  input_path text CHECK (input_path IN ('device','manual','mixed')),
  pillar_breakdown jsonb NOT NULL,
  fatigue_adjustment numeric NOT NULL DEFAULT 0,
  nudge_message text,
  engine_version text NOT NULL DEFAULT 'v6.1',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, score_date)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.readiness_scores TO authenticated;
GRANT ALL ON public.readiness_scores TO service_role;
ALTER TABLE public.readiness_scores ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own rows select" ON public.readiness_scores FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "own rows insert" ON public.readiness_scores FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "own rows update" ON public.readiness_scores FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "own rows delete" ON public.readiness_scores FOR DELETE TO authenticated USING (auth.uid() = user_id);
