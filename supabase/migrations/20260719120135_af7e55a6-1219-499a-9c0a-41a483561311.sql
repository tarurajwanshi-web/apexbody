select net.http_post(
  url := 'https://toixlzfmxtmtypmupcuc.supabase.co/functions/v1/generate-plan',
  headers := jsonb_build_object('Content-Type','application/json','x-internal-secret', public.get_dispatch_secret()),
  body := jsonb_build_object('user_id','1f83792a-5b77-4c6a-aafe-858f21380f14')
) as request_id;