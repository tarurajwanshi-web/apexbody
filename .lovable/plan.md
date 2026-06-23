Create `supabase/functions/generate-training-sync/index.ts` with the full file body as pasted (Thursday 6 PM local-time gate, reads next week's `weekly_plans`, current `daily_macro_targets`, last 7 days `readiness_scores`; Sonnet `claude-sonnet-4-6`; idempotent `training_sync` card in `daily_coaching_cards`; no-plan fallback; `force` param).

Register cron via `supabase--insert`:

```sql
SELECT cron.schedule(
  'generate-training-sync',
  '*/5 * * * *',
  $$SELECT net.http_post(
    url := 'https://toixlzfmxtmtypmupcuc.supabase.co/functions/v1/generate-training-sync',
    headers := jsonb_build_object(
      'Content-Type','application/json',
      'x-internal-secret', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name='dispatch_secret' LIMIT 1)
    ),
    body := '{}'::jsonb
  )$$
);
```

No other functions, RLS, schema, or frontend changes.

Note: `claude-sonnet-4-6` isn't a standard dated Anthropic model id. Using verbatim per your instruction; if the API returns 404, we swap to the correct dated Sonnet id.