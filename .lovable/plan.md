# FIX-C — Readiness column fix in generate-training-sync

Single file: `supabase/functions/generate-training-sync/index.ts`. Two-token change inside the existing readiness block.

## Change

- Line 145: `.select("entry_date, overall_score")` → `.select("entry_date, final_score")`
- Line 152: `r.overall_score || 0` → `r.final_score || 0`

No other edits — query window, threshold logic, prompt, model, cron, and response shape stay as-is.

## Verify

After deploy, invoke the function for a user with recent `readiness_scores` rows where `final_score` ≥ 70, and confirm the generated `training_sync` card no longer defaults to the "low readiness → extra carbs" branch.
