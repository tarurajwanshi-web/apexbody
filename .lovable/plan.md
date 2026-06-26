## Context

The file already imports `calculateMacrosForUser` and loops sequentially — the structural refactor you described is largely in place. Before overwriting, three deltas in your spec are worth confirming, because each one is a behavior change, not a structural one:

1. **Profile filter.** Spec uses `.eq("deleted_at", null)`. PostgREST requires `.is("deleted_at", null)` for NULL comparisons (`.eq` with `null` matches zero rows). The current file uses `.not("profile_completed_at", "is", null)` to skip onboarding-incomplete users. Proposal: keep the `profile_completed_at` filter (works today, matches intent of "active profiles").
2. **`experience_level`.** Spec adds it to the SELECT but not to the `Profile` type, and the shared `Profile` type in `_shared/macro-calculation.ts` doesn't include it either. Proposal: drop it from the SELECT unless you want me to also extend the shared `Profile` type.
3. **Drop `force_recalculate` + single-user `user_id` body params?** Current shell accepts both (handy for manual re-runs and the "skipped" status for already-reviewed weeks). Spec removes them. Proposal: keep them — they don't affect the cron path and the trigger-weekly-macro-review function covers the single-user case but this is useful for ops.

## Plan

Rewrite `supabase/functions/calculate-macros-weekly/index.ts` to match your spec's shape (typed `ProcessResult`, explicit `adjusted/held/errors` summary, `timestamp`, `total_users`, console.error per-user, console.log summary), while:

- Using `.not("profile_completed_at", "is", null)` for the profile filter (fixes the `.eq(..., null)` bug).
- Omitting `experience_level` from the SELECT (shared `Profile` type unchanged).
- Preserving optional `{ user_id, force_recalculate }` body params and the `"skipped"` status for `review_exists:` errors.
- Reusing existing `requireInternalSecret`, `corsAllowHeaders`, and the shared `calculateMacrosForUser` (no changes to `_shared/*`).

No other files touched. Cron schedule unchanged.

## Confirm

Reply "go" to proceed, or tell me to override any of the three deltas above (e.g. "use spec exactly, drop force/user_id, drop experience_level, fix `.is(null)`").