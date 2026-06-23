## Plan: `generate-daily-scorecard` edge function

### Create `supabase/functions/generate-daily-scorecard/index.ts`

Write the file as you pasted, verbatim. Schema verified — all referenced columns exist:
- `profiles.timezone`, `profiles.coaching_time`, `profiles.profile_completed_at` ✓
- `daily_coaching_cards (user_id, card_date, card_type, content)` with unique `(user_id, card_date, card_type)` matching the `onConflict` ✓
- `nutrition_daily_summaries` PK `(user_id, summary_date)` matches `onConflict` ✓
- `daily_macro_targets` and `nutrition_meal_full_analysis` columns all present ✓
- `requireInternalSecret` + `corsAllowHeaders` already exported from `_shared/authorize.ts` ✓

### Cron registration
Use `supabase--insert` to run your `cron.schedule(...)` SQL (data, not schema). Two notes before I run it:

1. **`current_setting('app.supabase_url')` / `app.internal_secret` are not set** in this project. The existing dispatch functions (e.g. `shield_dispatch_calculate_score`) hard-code the URL `https://toixlzfmxtmtypmupcuc.supabase.co/...` and pull the secret from `vault.decrypted_secrets` where `name='dispatch_secret'`. I'll mirror that pattern so the cron actually fires:
   ```sql
   SELECT cron.schedule(
     'generate-daily-scorecard',
     '*/5 * * * *',
     $$SELECT net.http_post(
       url := 'https://toixlzfmxtmtypmupcuc.supabase.co/functions/v1/generate-daily-scorecard',
       headers := jsonb_build_object(
         'Content-Type','application/json',
         'x-internal-secret', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name='dispatch_secret' LIMIT 1)
       ),
       body := '{}'::jsonb
     )$$
   );
   ```
2. `pg_cron` and `pg_net` extensions — I'll verify they're enabled (they're used by existing dispatchers, so likely yes) and skip enabling if so.

### Out of scope (per your instructions)
- No changes to score-nutrition, Shield, other functions, RLS, or frontend.
- No migration / no schema changes.

### Test after deploy
Invoke once with `{ "user_id": "<test uid>", "force": true }` + `x-internal-secret` header to confirm a card row appears in `daily_coaching_cards`.

Approve to proceed.