## Plan: `generate-daily-coach-note` edge function

### Create `supabase/functions/generate-daily-coach-note/index.ts`
Write the file as you pasted, verbatim. Schema already verified in the prior scorecard plan — all referenced columns exist (`profiles.goal/measurement_weight_kg/biological_sex/age/timezone/coaching_time`, `daily_macro_targets`, `nutrition_meal_full_analysis`, `daily_coaching_cards` with unique `(user_id, card_date, card_type)`).

### Register cron via `supabase--insert`
Same correction as last time: your SQL uses `current_setting('app.supabase_url')` and `current_setting('app.internal_secret')`, neither of which is configured on this project. I'll mirror the existing dispatcher pattern (hardcoded URL + Vault lookup), matching the scorecard cron:

```sql
SELECT cron.schedule(
  'generate-daily-coach-note',
  '*/5 * * * *',
  $$SELECT net.http_post(
    url := 'https://toixlzfmxtmtypmupcuc.supabase.co/functions/v1/generate-daily-coach-note',
    headers := jsonb_build_object(
      'Content-Type','application/json',
      'x-internal-secret', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name='dispatch_secret' LIMIT 1)
    ),
    body := '{}'::jsonb
  )$$
);
```

### Notes (no action, just flagging)
- `ANTHROPIC_API_KEY` is already set ✓.
- Time gate uses minute window `[5, 10)` of the coaching hour, paired with 5-min cron — fine.
- Out of scope per your instructions: no other functions, RLS, frontend, or schema changes.

Approve to proceed.