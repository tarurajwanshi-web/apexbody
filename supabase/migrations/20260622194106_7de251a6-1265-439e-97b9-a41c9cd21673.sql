CREATE OR REPLACE FUNCTION public.soft_delete_meal(p_meal_id uuid, p_user_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.shield_nutrition_logs
  SET deleted = true
  WHERE id = p_meal_id AND user_id = p_user_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Meal not found or not owned by user';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.restore_meal(p_meal_id uuid, p_user_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.shield_nutrition_logs
  SET deleted = false
  WHERE id = p_meal_id AND user_id = p_user_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Meal not found or not owned by user';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.soft_delete_meal(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.soft_delete_meal(uuid, uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.restore_meal(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.restore_meal(uuid, uuid) TO authenticated;