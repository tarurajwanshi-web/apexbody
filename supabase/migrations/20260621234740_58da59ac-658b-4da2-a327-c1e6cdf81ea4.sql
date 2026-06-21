-- 1. Ensure pgsodium + vault are present (Supabase Cloud has them by default).
CREATE EXTENSION IF NOT EXISTS supabase_vault;

-- 2. Copy the current dispatch_secret value into Vault (idempotent).
DO $$
DECLARE
  _existing_id uuid;
  _value text;
BEGIN
  SELECT id INTO _existing_id FROM vault.secrets WHERE name = 'dispatch_secret';
  IF _existing_id IS NULL THEN
    SELECT value INTO _value FROM public.internal_secrets WHERE name = 'dispatch_secret';
    IF _value IS NULL THEN
      _value := encode(gen_random_bytes(32), 'hex');
    END IF;
    PERFORM vault.create_secret(_value, 'dispatch_secret',
      'APEX internal dispatch shared secret — used by SQL dispatchers and the weekly cron to authenticate to edge functions.');
  END IF;
END $$;

-- 3. SECURITY DEFINER accessor for edge functions (service_role only).
CREATE OR REPLACE FUNCTION public.get_dispatch_secret()
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = vault, public
AS $$
  SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'dispatch_secret' LIMIT 1;
$$;
REVOKE EXECUTE ON FUNCTION public.get_dispatch_secret() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_dispatch_secret() TO service_role;

-- 4. Repoint the SQL dispatchers at Vault.
CREATE OR REPLACE FUNCTION public.shield_dispatch_calculate_score(_user_id uuid, _entry_date date)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'extensions', 'vault'
AS $function$
DECLARE _secret text;
BEGIN
  BEGIN
    SELECT decrypted_secret INTO _secret FROM vault.decrypted_secrets WHERE name = 'dispatch_secret' LIMIT 1;
    PERFORM net.http_post(
      url := 'https://toixlzfmxtmtypmupcuc.supabase.co/functions/v1/calculate-score',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-internal-secret', COALESCE(_secret, '')
      ),
      body := jsonb_build_object('user_id', _user_id, 'entry_date', _entry_date)
    );
  EXCEPTION WHEN OTHERS THEN NULL;
  END;
END;
$function$;

CREATE OR REPLACE FUNCTION public.shield_dispatch_parse_device_upload(_upload_id uuid, _user_id uuid, _entry_date date)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'extensions', 'vault'
AS $function$
DECLARE _secret text;
BEGIN
  BEGIN
    SELECT decrypted_secret INTO _secret FROM vault.decrypted_secrets WHERE name = 'dispatch_secret' LIMIT 1;
    PERFORM net.http_post(
      url := 'https://toixlzfmxtmtypmupcuc.supabase.co/functions/v1/parse-device-upload',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-internal-secret', COALESCE(_secret, '')
      ),
      body := jsonb_build_object('upload_id', _upload_id, 'user_id', _user_id, 'entry_date', _entry_date)
    );
  EXCEPTION WHEN OTHERS THEN NULL;
  END;
END;
$function$;

-- 5. Drop the table; nothing reads from it after the edge functions redeploy.
DROP TABLE IF EXISTS public.internal_secrets;
