CREATE TABLE IF NOT EXISTS public.user_exercise_muscle_map (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  -- exercise_name_key = lowercased/trimmed exercise_name (same nameKey approach as exercise_image_cache)
  exercise_name_key text NOT NULL,
  exercise_name text NOT NULL,
  muscle_group text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uemm_unique UNIQUE (user_id, exercise_name_key),
  CONSTRAINT uemm_muscle_check CHECK (muscle_group IN (
    'chest','back','shoulders','quads','hamstrings','glutes',
    'calves','biceps','triceps','forearms','core',
    'full_body','cardio','mobility'
  ))
);

GRANT SELECT, INSERT, UPDATE ON public.user_exercise_muscle_map TO authenticated;
GRANT ALL ON public.user_exercise_muscle_map TO service_role;

ALTER TABLE public.user_exercise_muscle_map ENABLE ROW LEVEL SECURITY;

CREATE POLICY "own rows select" ON public.user_exercise_muscle_map
  FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "own rows insert" ON public.user_exercise_muscle_map
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "own rows update" ON public.user_exercise_muscle_map
  FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);