CREATE OR REPLACE FUNCTION public.tmp_dispatch_generate_plan(p_user_id uuid)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  req_id bigint;
  secret text;
BEGIN
  SELECT public.get_dispatch_secret() INTO secret;
  SELECT net.http_post(
    url := 'https://toixlzfmxtmtypmupcuc.supabase.co/functions/v1/generate-plan',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-internal-secret', secret
    ),
    body := jsonb_build_object('user_id', p_user_id),
    timeout_milliseconds := 60000
  ) INTO req_id;
  RETURN req_id;
END;
$$;
SELECT public.tmp_dispatch_generate_plan('1f83792a-5b77-4c6a-aafe-858f21380f14'::uuid) AS request_id;