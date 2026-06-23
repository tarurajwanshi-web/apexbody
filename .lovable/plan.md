## Plan: Re-run end-to-end test of `score-nutrition`

Repeat the previous live test against the deployed edge function.

**Steps**
1. Reuse `/tmp/meal.jpg` (already downloaded) and build a fresh payload with a new `meal_id` UUID, existing test `user_id`, today's `entry_date`, and base64 image.
2. POST to `https://toixlzfmxtmtypmupcuc.supabase.co/functions/v1/score-nutrition`.
3. Verify HTTP 200 + macros/status in response.
4. Query `nutrition_meal_full_analysis` for the new `meal_id` to confirm the row was inserted with full analysis.
5. If OpenAI still returns 429 `insufficient_quota`, stop and report — that requires you to top up the OpenAI account.

No code changes. Approve to run.