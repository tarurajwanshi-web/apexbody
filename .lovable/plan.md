# Manually invoke `adaptive-macros-weekly` (jobid 3)

## Goal
Run the literal `command` string stored in `cron.job` for jobid 3 right now, and report whether the dispatch succeeds or fails. No approximation — copy from `cron.job.command` verbatim.

## Steps

1. **Re-fetch the exact command** to guarantee we run what pg_cron runs, not a paraphrase:
   ```sql
   SELECT command FROM cron.job WHERE jobid = 3;
   ```

2. **Execute it verbatim** via `supabase--read_query`. The stored command is:
   ```sql
   SELECT net.http_post(
     url := 'https://toixlzfmxtmtypmupcuc.supabase.co/functions/v1/calculate-macros-weekly',
     headers := jsonb_build_object(
       'Content-Type','application/json',
       'x-internal-secret', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name='dispatch_secret')
     ),
     body := '{}'::jsonb
   );
   ```
   `net.http_post` returns a `request_id` synchronously; the HTTP call is async in `pg_net`.

3. **Poll `net._http_response`** for that request_id to capture the real outcome:
   ```sql
   SELECT id, status_code, content_type, timed_out, error_msg,
          left(content, 500) AS body_preview, created
   FROM net._http_response
   WHERE id = <request_id>
   ORDER BY created DESC
   LIMIT 1;
   ```
   Retry briefly if the row hasn't landed yet (pg_net worker latency is usually <1s).

4. **Cross-check edge function logs** for `calculate-macros-weekly` around the invocation timestamp to catch anything that doesn't surface in the HTTP response (boot errors, per-user failures, etc.).

5. **Report back:**
   - `request_id` and the `net._http_response` row (status_code, error_msg, body preview)
   - Any relevant edge function log lines
   - Verdict: success / partial / failure, with the specific error if it failed

## Not in this change
- No schema changes, no cron edits, no edge function code changes.
- No re-run for a specific user; this fires the scheduled entrypoint exactly as pg_cron would on Monday 13:00 UTC.
- No investigation of why you thought `active: false` — separate thread if you want it.
