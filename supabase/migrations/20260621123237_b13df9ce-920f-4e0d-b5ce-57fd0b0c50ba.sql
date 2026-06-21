
CREATE TABLE IF NOT EXISTS public.hydration_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  entry_date date NOT NULL DEFAULT ((now() AT TIME ZONE 'UTC')::date),
  amount_ml integer NOT NULL CHECK (amount_ml > 0),
  created_at timestamp with time zone NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS hydration_events_user_date_idx ON public.hydration_events (user_id, entry_date);
GRANT SELECT, INSERT, DELETE ON public.hydration_events TO authenticated;
GRANT ALL ON public.hydration_events TO service_role;
ALTER TABLE public.hydration_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users select own hydration events" ON public.hydration_events FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Users insert own hydration events" ON public.hydration_events FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users delete own hydration events" ON public.hydration_events FOR DELETE TO authenticated USING (auth.uid() = user_id);

CREATE OR REPLACE FUNCTION public.increment_hydration(p_amount_ml integer)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_user uuid := auth.uid();
  v_date date := (now() AT TIME ZONE 'UTC')::date;
  v_total integer;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  IF p_amount_ml IS NULL OR p_amount_ml <= 0 THEN RAISE EXCEPTION 'amount must be > 0'; END IF;

  INSERT INTO public.shield_manual_inputs (user_id, entry_date, hydration_ml)
  VALUES (v_user, v_date, p_amount_ml)
  ON CONFLICT (user_id, entry_date)
  DO UPDATE SET hydration_ml = COALESCE(public.shield_manual_inputs.hydration_ml, 0) + EXCLUDED.hydration_ml
  RETURNING hydration_ml INTO v_total;

  INSERT INTO public.hydration_events (user_id, entry_date, amount_ml)
  VALUES (v_user, v_date, p_amount_ml);

  RETURN v_total;
END;
$function$;
