## Plan — one-off manual recompute

`trigger-weekly-macro-review` can't do this: it's JWT-only, derives the user from the token, has no `force_recalculate`, and short-circuits off-Monday and when a review row already exists. The sibling `calculate-macros-weekly` is the correct entry — it accepts `{ user_id, force_recalculate }`, is gated by `x-internal-secret`, and calls the same shared `calculateMacrosForUser` engine.

### Step 1 — invoke it

Run via `supabase--insert` (uses `net.http_post`, so `public.get_dispatch_secret()` is fetched server-side; the secret never enters tool arguments):

```sql
select net.http_post(
  url := 'https://toixlzfmxtmtypmupcuc.supabase.co/functions/v1/calculate-macros-weekly',
  headers := jsonb_build_object(
    'Content-Type', 'application/json',
    'x-internal-secret', public.get_dispatch_secret()
  ),
  body := jsonb_build_object(
    'user_id', '00000000-0000-0000-0001-000000000006',
    'force_recalculate', true
  )
);
```

This dispatches asynchronously.

### Step 2 — verify

Wait a few seconds, then in parallel:

1. `supabase--edge_function_logs` for `calculate-macros-weekly`, filter on the user_id — confirm the summary line (`status: adjusted | hold | skipped | error` and `decision`).
2. `supabase--read_query` on `nutrition_weekly_reviews` for that user, ordered by `week_start_date desc limit 2` — inspect `decision`, `applied_target_id`, `blended_tdee`, `new_target_calories`, and the newly-surfaced `applied_modifier` / `modifier_overrode_decision` fields from the E1 change (whichever column names the shared engine wrote — I'll verify shape from the row).
3. If `applied_target_id` is set, `supabase--read_query` `daily_macro_targets` for that user to confirm the new active target row.

### Notes / caveats

- `force_recalculate: true` in `calculate-macros-weekly` re-runs the engine even if a review row exists for this week; the shared engine's exact overwrite/insert behavior under `force` is what I'll observe in step 2. If the run fails with `review_exists:` despite `force`, that's an engine-level gap to flag — not something to work around by deleting the row without asking.
- No code changes. No migration. Read-only verification after the one dispatch.
- Nothing about the trigger endpoints, cron schedule, or shared engine is modified.

### If you'd rather not touch SQL

Alternative: `supabase--curl_edge_functions` to `/calculate-macros-weekly` with a manually-supplied `x-internal-secret` header. Requires reading `public.get_dispatch_secret()` first and passing the raw value in headers, which is slightly leakier than option 1. Same result.
