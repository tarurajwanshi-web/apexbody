## Scope

Single file edit: `supabase/functions/generate-plan/index.ts`. No other files touched.

## Change 1 — extend profiles select (line 86)

Add `experience_level` to the select list so the column is available downstream.

## Change 2 — add live signal queries (insert after line 97, before `equipRule`)

Three sequential queries scoped to the last 7 days:

1. **Readiness** — `readiness_scores.final_score` averaged across `score_date >= sevenDaysAgoISO`. Yields `avgReadiness` and `lowReadiness = avgReadiness < 45`.
2. **Target calories** — current active `daily_macro_targets` row (`effective_end_date IS NULL`) via `maybeSingle()`.
3. **Average intake** — `shield_nutrition_logs.estimated_calories` filtered to `deleted=false` and `calorie_estimate_status IN ('estimated','manual_edited')` for the same window. Yields `avgIntake` and `underFuelled = avgIntake < targetCalories * 0.80`.

All three signals degrade to `null` when there's no data; flags only fire when both sides exist.

## Change 3 — enrich prompt + Claude schema

- Add `const experience = p.experience_level ?? "intermediate";` next to the other `const` declarations.
- Extend the system-prompt schema comment so each exercise object includes `"muscle_group": string`.
- Add `experienceRule` (beginner / intermediate / advanced branches).
- Add conditional `readinessNote` (low readiness → drop 1 set per exercise, add session_note).
- Add conditional `fuelNote` (under-fuelled → stop 2–3 reps short of failure, add session_note).
- Rewrite the `prompt` template to include experience, the new rule, the muscle_group instruction, the two alert notes, and request `muscle_group` in each exercise tuple.

## Explicitly untouched

`authorizeCaller`, `upcomingMonday`, `addDays`, `stripFences`, `callClaude` (including retry), CORS, error handling, weekly_plans upsert, the `generated_by` tag.

## Risk notes

- `readiness_scores.score_date` and `shield_nutrition_logs.entry_date` are the canonical date columns confirmed in earlier work — using them directly.
- `daily_macro_targets` uses the active-row pattern (`effective_end_date IS NULL`) consistent with `apply_weekly_macro_review`.
- Service-role client bypasses RLS, so no auth shape changes are required for the new reads.
- Schema-comment change is additive; existing consumers of `plan_data` that ignore unknown keys remain compatible. If any client strictly validates exercise shape, it will need `muscle_group` tolerated — flagging for awareness, no code change here.
