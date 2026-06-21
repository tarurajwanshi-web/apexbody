CREATE OR REPLACE FUNCTION public.shield_dispatch_parse_device_upload(_upload_id uuid, _user_id uuid, _entry_date date)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
  BEGIN
    PERFORM net.http_post(
      url := 'https://toixlzfmxtmtypmupcuc.supabase.co/functions/v1/parse-device-upload',
      headers := jsonb_build_object('Content-Type', 'application/json'),
      body := jsonb_build_object('upload_id', _upload_id, 'user_id', _user_id, 'entry_date', _entry_date)
    );
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;
END;
$$;

CREATE OR REPLACE FUNCTION public.shield_device_uploads_parse_webhook()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Dispatch parse whenever a row lands in pending state (new insert, or re-uploaded screenshot)
  IF NEW.parse_status = 'pending'
     AND (TG_OP = 'INSERT' OR OLD.screenshot_url IS DISTINCT FROM NEW.screenshot_url) THEN
    PERFORM public.shield_dispatch_parse_device_upload(NEW.id, NEW.user_id, NEW.entry_date);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS shield_device_uploads_parse_dispatch ON public.shield_device_uploads;
CREATE TRIGGER shield_device_uploads_parse_dispatch
AFTER INSERT OR UPDATE ON public.shield_device_uploads
FOR EACH ROW EXECUTE FUNCTION public.shield_device_uploads_parse_webhook();