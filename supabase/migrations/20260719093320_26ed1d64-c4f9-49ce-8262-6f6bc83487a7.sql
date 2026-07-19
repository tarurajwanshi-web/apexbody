-- B5.5: Cardio logs table + strain-combine trigger + Shield dispatch trigger.
-- Cardio is prescribed, logged, and feeds fatigue via shield_training_logs.strain_value.
-- It intentionally does NOT feed macros/TDEE — that's captured by weight-trend TDEE.

CREATE TABLE IF NOT EXISTS public.cardio_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  entry_date date NOT NULL,
  modality text NOT NULL,
  minutes smallint NOT NULL,
  intensity text,
  perceived_effort smallint,
  source text NOT NULL DEFAULT 'manual',
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT cardio_minutes_check CHECK (minutes >= 0 AND minutes <= 600),
  CONSTRAINT cardio_rpe_check CHECK (perceived_effort IS NULL OR (perceived_effort BETWEEN 1 AND 10)),
  CONSTRAINT cardio_intensity_check CHECK (intensity IS NULL OR intensity IN ('zone2','liss','intervals','mixed')),
  CONSTRAINT cardio_source_check CHECK (source IN ('manual','wearable'))
);
CREATE INDEX IF NOT EXISTS cardio_logs_user_date ON public.cardio_logs (user_id, entry_date DESC);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.cardio_logs TO authenticated;
GRANT ALL ON public.cardio_logs TO service_role;

ALTER TABLE public.cardio_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "cardio_logs own rows all"
  ON public.cardio_logs
  FOR ALL
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Combine cardio strain into shield_training_logs.strain_value (0-21 scale).
-- Recomputes on every insert/update/delete by summing all cardio_logs rows for
-- the (user, date), then adds it to the existing lifting-derived strain.
-- The lifting portion is separately recomputed by sync_workout_strain_to_training_log;
-- to avoid a fight between the two, we store the cardio contribution as a
-- separate additive term: read existing strain_value, subtract any prior cardio
-- contribution recorded on the row's session_notes tag, add new cardio strain, cap 21.
-- Simpler pragmatic implementation: on ANY cardio_logs change, recompute cardio
-- strain and overwrite (session_notes || ' + cardio') pattern is fragile — instead
-- we UPDATE strain_value = LEAST(21, lifting_only + cardio_only), where lifting_only
-- comes from live re-count of workout_set_logs (same formula as
-- sync_workout_strain_to_training_log), and cardio_only from sum over cardio_logs.

CREATE OR REPLACE FUNCTION public.recompute_daily_training_strain(_user_id uuid, _entry_date date)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _set_count integer := 0;
  _total_volume numeric := 0;
  _lifting_strain numeric := 0;
  _cardio_strain numeric := 0;
  _combined numeric;
BEGIN
  -- Lifting portion (same formula as sync_workout_strain_to_training_log).
  SELECT COUNT(*), COALESCE(SUM(COALESCE(reps_completed,0) * COALESCE(weight_kg,0)), 0)
    INTO _set_count, _total_volume
  FROM public.workout_set_logs
  WHERE user_id = _user_id AND entry_date = _entry_date AND completed = true;

  IF _set_count > 0 THEN
    _lifting_strain := ROUND(((_set_count * 0.6) + (_total_volume / 1200.0)) * 10) / 10;
  END IF;

  -- Cardio portion: modest per-minute coefficients on the same 0-21 scale.
  -- zone2/liss: 0.10/min; mixed/intervals: 0.20/min. Per-row cap 8.
  SELECT COALESCE(SUM(
    LEAST(
      8.0,
      CASE
        WHEN COALESCE(intensity, modality) IN ('intervals','mixed') THEN minutes * 0.20
        ELSE minutes * 0.10
      END
    )
  ), 0)
    INTO _cardio_strain
  FROM public.cardio_logs
  WHERE user_id = _user_id AND entry_date = _entry_date;

  _combined := LEAST(21, _lifting_strain + _cardio_strain);

  IF _combined > 0 THEN
    INSERT INTO public.shield_training_logs (user_id, entry_date, strain_value, session_notes)
    VALUES (_user_id, _entry_date, _combined,
      _set_count::text || ' sets + ' || ROUND(_cardio_strain, 1)::text || ' cardio strain')
    ON CONFLICT (user_id, entry_date)
    DO UPDATE SET
      strain_value = _combined,
      session_notes = _set_count::text || ' sets + ' || ROUND(_cardio_strain, 1)::text || ' cardio strain';
  END IF;
END;
$$;

-- Rewire the existing workout-set trigger to use the unified recompute
-- so lifting and cardio stay coherent regardless of write order.
CREATE OR REPLACE FUNCTION public.sync_workout_strain_to_training_log()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.recompute_daily_training_strain(NEW.user_id, NEW.entry_date);
  RETURN NEW;
END;
$$;

-- Cardio trigger: recompute + dispatch Shield rescore.
CREATE OR REPLACE FUNCTION public.cardio_logs_after_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid uuid;
  _dt date;
BEGIN
  IF TG_OP = 'DELETE' THEN
    _uid := OLD.user_id; _dt := OLD.entry_date;
  ELSE
    _uid := NEW.user_id; _dt := NEW.entry_date;
  END IF;
  PERFORM public.recompute_daily_training_strain(_uid, _dt);
  PERFORM public.shield_dispatch_calculate_score(_uid, _dt);
  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS cardio_logs_after_ins_upd ON public.cardio_logs;
DROP TRIGGER IF EXISTS cardio_logs_after_del ON public.cardio_logs;

CREATE TRIGGER cardio_logs_after_ins_upd
  AFTER INSERT OR UPDATE ON public.cardio_logs
  FOR EACH ROW EXECUTE FUNCTION public.cardio_logs_after_change();

CREATE TRIGGER cardio_logs_after_del
  AFTER DELETE ON public.cardio_logs
  FOR EACH ROW EXECUTE FUNCTION public.cardio_logs_after_change();