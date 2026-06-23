Create `supabase/functions/generate-weekly-pattern/index.ts` with the full file body as pasted (model `claude-sonnet-4-6`, Friday 8 PM local-time gate, 7-day meal/training/weight aggregation, idempotent `weekly_pattern` card in `daily_coaching_cards`, low-data fallback, `force` param).

Then register the cron via `supabase--insert`:

```sql
SELECT cron.schedule(
  'generate-weekly-pattern',
  '*/5 * * * *',
  $$SELECT net.http_post(
    url := 'https://toixlzfmxtmtypmupcuc.supabase.co/functions/v1/generate-weekly-pattern',
    headers := jsonb_build_object(
      'Content-Type','application/json',
      'x-internal-secret', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name='dispatch_secret' LIMIT 1)
    ),
    body := '{}'::jsonb
  )$$
);
```

No other functions, RLS, schema, or frontend changes.

Note: `claude-sonnet-4-6` isn't a standard Anthropic model id format. Using it verbatim per your instruction; if the API returns 404 on first run, swap to the correct dated Sonnet id.