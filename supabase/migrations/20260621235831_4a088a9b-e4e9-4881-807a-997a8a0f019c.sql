SELECT cron.alter_job(
  job_id := (SELECT jobid FROM cron.job WHERE jobname='adaptive-macros-weekly'),
  command := $cmd$
    SELECT net.http_post(
      url := 'https://toixlzfmxtmtypmupcuc.supabase.co/functions/v1/calculate-macros-weekly',
      headers := jsonb_build_object(
        'Content-Type','application/json',
        'x-internal-secret', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name='dispatch_secret')
      ),
      body := '{}'::jsonb
    );
  $cmd$
);