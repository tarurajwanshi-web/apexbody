
CREATE TABLE IF NOT EXISTS public.exercise_image_cache (
  exercise_name_key text PRIMARY KEY,
  exercise_name text NOT NULL,
  storage_path text NOT NULL,
  wger_exercise_id integer,
  license text,
  license_author text,
  original_url text,
  fetched_at timestamp with time zone NOT NULL DEFAULT now()
);
GRANT SELECT ON public.exercise_image_cache TO authenticated;
GRANT ALL ON public.exercise_image_cache TO service_role;
ALTER TABLE public.exercise_image_cache ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone authenticated can read exercise images cache"
  ON public.exercise_image_cache FOR SELECT TO authenticated USING (true);

-- Allow authenticated users to read objects in the exercise-images bucket via signed URL paths
CREATE POLICY "Authenticated can read exercise images"
  ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'exercise-images');
