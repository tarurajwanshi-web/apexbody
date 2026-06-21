CREATE OR REPLACE FUNCTION public.shield_pre_session_checks_webhook()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  PERFORM public.shield_dispatch_calculate_score(NEW.user_id, NEW.entry_date);
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS shield_pre_session_checks_after_insert ON public.pre_session_checks;
CREATE TRIGGER shield_pre_session_checks_after_insert
AFTER INSERT OR UPDATE ON public.pre_session_checks
FOR EACH ROW EXECUTE FUNCTION public.shield_pre_session_checks_webhook();