
ALTER TABLE public.shield_manual_inputs
  ADD COLUMN IF NOT EXISTS hydration_ml integer NOT NULL DEFAULT 0;

CREATE OR REPLACE FUNCTION public.increment_hydration(p_amount_ml integer)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_date date := (now() AT TIME ZONE 'UTC')::date;
  v_total integer;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;
  IF p_amount_ml IS NULL OR p_amount_ml < 0 THEN
    RAISE EXCEPTION 'amount must be >= 0';
  END IF;

  INSERT INTO public.shield_manual_inputs (user_id, entry_date, hydration_ml)
  VALUES (v_user, v_date, p_amount_ml)
  ON CONFLICT (user_id, entry_date)
  DO UPDATE SET hydration_ml = COALESCE(public.shield_manual_inputs.hydration_ml, 0) + EXCLUDED.hydration_ml
  RETURNING hydration_ml INTO v_total;

  RETURN v_total;
END;
$$;

GRANT EXECUTE ON FUNCTION public.increment_hydration(integer) TO authenticated;
