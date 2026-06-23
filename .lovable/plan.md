Create `supabase/functions/check-permission-slip/index.ts` with the file body as pasted.

- Event-based: requires `user_id` in body (returns 400 if missing).
- Deterministic rule: `readiness > 75` AND `training_load_index > 1.05` AND `carbs < 85% of target` — all three must be true to fire.
- Idempotent: one `permission_slip` card per user per local day in `daily_coaching_cards`.
- Calls Haiku `claude-haiku-4-5-20251001`; safe fallback string on error.
- `force=true` bypasses both the rule and idempotency for testing.
- Returns debug payload (readiness, training load, carbs %) when conditions not met.

Schema verified: `nutrition_weekly_reviews.training_load_index` and `.weekly_sets_avg` exist; `readiness_scores.overall_score` exists; other tables already in use.

**No cron** — event-based. Frontend POSTs `{user_id}` with `x-internal-secret` header on readiness updates.

No changes to other functions, RLS, schema, or frontend.