## Plan: Add `test-seed-10-users` Edge Function

Create a new edge function at `supabase/functions/test-seed-10-users/index.ts` using the code provided in the message verbatim.

### What it does
Seeds 10 synthetic test users × 90 days of data, each user representing a distinct edge case to stress-test the engines:
- perfect-adherence, crash-recovery, inconsistent-logger, low-readiness-chronic, newbie-improvement, yo-yoer, injury-recovery, perfect-nutrition-bad-recovery, high-volume-low-readiness, ghost-user

For each user/day, inserts into: `readiness_scores`, `body_measurement_events`, `workout_set_logs`, `shield_training_logs`, `pre_session_checks`, `shield_nutrition_logs` (with `claude_score_status: 'skipped'` to suppress AI scoring).

### Files
- **Create** `supabase/functions/test-seed-10-users/index.ts` — paste user-provided code as-is.

### Notes
- Coexists with the existing `seed-synthetic-test-users` function (does not modify it).
- Uses service role key; callable via POST. No frontend trigger added in this plan (user said they'll click a dashboard button — assumed to already exist or will request separately).
- Auto-deploys on save.

Confirm and I'll create the file.
