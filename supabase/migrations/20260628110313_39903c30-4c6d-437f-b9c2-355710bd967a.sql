
CREATE TABLE public.user_fuelling_evaluations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  evaluation_date date NOT NULL,
  total_sets integer,
  avg_rir numeric,
  calories_consumed numeric,
  calories_target numeric,
  shortfall numeric,
  bmr numeric,
  training_cost numeric,
  severity text CHECK (severity IN ('underfuelled','marginal','adequate')),
  severity_score integer,
  message text,
  action text,
  mini_explanation text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, evaluation_date)
);

GRANT SELECT ON public.user_fuelling_evaluations TO authenticated;
GRANT ALL ON public.user_fuelling_evaluations TO service_role;

ALTER TABLE public.user_fuelling_evaluations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own fuelling evaluations"
  ON public.user_fuelling_evaluations
  FOR SELECT
  USING (auth.uid() = user_id);

CREATE INDEX idx_user_fuelling_evaluations_user_date
  ON public.user_fuelling_evaluations (user_id, evaluation_date DESC);
