
-- 1. pre_session_checks
CREATE TABLE public.pre_session_checks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  entry_date date NOT NULL,
  session_readiness smallint NOT NULL CHECK (session_readiness BETWEEN 1 AND 5),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX pre_session_checks_user_date_idx ON public.pre_session_checks(user_id, entry_date DESC);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.pre_session_checks TO authenticated;
GRANT ALL ON public.pre_session_checks TO service_role;
ALTER TABLE public.pre_session_checks ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own select psc" ON public.pre_session_checks FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "own insert psc" ON public.pre_session_checks FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "own update psc" ON public.pre_session_checks FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "own delete psc" ON public.pre_session_checks FOR DELETE TO authenticated USING (auth.uid() = user_id);

-- 2. body_scan_photos
CREATE TABLE public.body_scan_photos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  photo_url text NOT NULL,
  captured_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX body_scan_photos_user_idx ON public.body_scan_photos(user_id, captured_at DESC);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.body_scan_photos TO authenticated;
GRANT ALL ON public.body_scan_photos TO service_role;
ALTER TABLE public.body_scan_photos ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own select bsp" ON public.body_scan_photos FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "own insert bsp" ON public.body_scan_photos FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "own update bsp" ON public.body_scan_photos FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "own delete bsp" ON public.body_scan_photos FOR DELETE TO authenticated USING (auth.uid() = user_id);

-- 3. daily_ai_insights (one row per user per date)
CREATE TABLE public.daily_ai_insights (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  insight_date date NOT NULL,
  content text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, insight_date)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.daily_ai_insights TO authenticated;
GRANT ALL ON public.daily_ai_insights TO service_role;
ALTER TABLE public.daily_ai_insights ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own select dai" ON public.daily_ai_insights FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "own insert dai" ON public.daily_ai_insights FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "own update dai" ON public.daily_ai_insights FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "own delete dai" ON public.daily_ai_insights FOR DELETE TO authenticated USING (auth.uid() = user_id);

-- 4. readiness_scores.pre_session_adjustment
ALTER TABLE public.readiness_scores
  ADD COLUMN IF NOT EXISTS pre_session_adjustment numeric NOT NULL DEFAULT 0;

-- 5. Storage RLS for body-scans (per-user folder pattern: <uid>/<filename>)
CREATE POLICY "body-scans own select" ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'body-scans' AND auth.uid()::text = (storage.foldername(name))[1]);
CREATE POLICY "body-scans own insert" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'body-scans' AND auth.uid()::text = (storage.foldername(name))[1]);
CREATE POLICY "body-scans own update" ON storage.objects
  FOR UPDATE TO authenticated
  USING (bucket_id = 'body-scans' AND auth.uid()::text = (storage.foldername(name))[1]);
CREATE POLICY "body-scans own delete" ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'body-scans' AND auth.uid()::text = (storage.foldername(name))[1]);

-- 6. Resources bucket — allow authenticated users to read so users can browse/download
CREATE POLICY "resources read all auth" ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'resources');
