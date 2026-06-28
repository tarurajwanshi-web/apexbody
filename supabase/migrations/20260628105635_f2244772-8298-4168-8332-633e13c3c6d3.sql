CREATE TABLE public.user_recovery_patterns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  pattern_type text NOT NULL,
  pattern_key text NOT NULL,
  description text NOT NULL,
  explanation text,
  protocol text,
  data_points int NOT NULL DEFAULT 0,
  correlation_coeff numeric,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  detected_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, pattern_type, pattern_key)
);

GRANT SELECT ON public.user_recovery_patterns TO authenticated;
GRANT ALL ON public.user_recovery_patterns TO service_role;

ALTER TABLE public.user_recovery_patterns ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users read own recovery patterns"
ON public.user_recovery_patterns
FOR SELECT
TO authenticated
USING (auth.uid() = user_id);

CREATE INDEX user_recovery_patterns_user_idx
ON public.user_recovery_patterns (user_id, data_points DESC);

CREATE TRIGGER update_user_recovery_patterns_updated_at
BEFORE UPDATE ON public.user_recovery_patterns
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();