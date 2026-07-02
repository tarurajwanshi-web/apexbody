# Batch F — readiness awareness for evaluate-fuelling and generate-training-sync

Schema verified: `user_fuelling_evaluations` has no readiness column today (columns confirmed: id, user_id, evaluation_date, total_sets, avg_rir, calories_consumed, calories_target, shortfall, bmr, training_cost, severity, severity_score, message, action, mini_explanation, created_at). One migration required for F1; F2 is code-only.

## F1 — `supabase/functions/evaluate-fuelling/index.ts`

1. **Migration** (new): add `readiness_modifier_at_eval text` to `public.user_fuelling_evaluations`. Nullable, no default, no CHECK. Approved separately before code lands (types.ts regenerates after).
2. Inside the per-profile loop, after the `sets`/`meals`/`targets` fetches, add the unbounded most-recent-row fetch — same shape proven in E1 today:
   ```ts
   const { data: latestReadinessRow } = await supa
     .from("readiness_scores")
     .select("nutrition_modifier, training_permission, final_score, score_date")
     .eq("user_id", p.user_id)
     .order("score_date", { ascending: false })
     .limit(1)
     .maybeSingle();
   ```
   No date window. Not gated to `yesterdayLocal` — most-recent is a same-day directive, matching E1's reasoning.
3. **Severity nudge** — after `evaluate(...)` returns, if `ev.severity === "marginal"` AND (`latestReadinessRow?.nutrition_modifier === "deficit_caution"` OR `latestReadinessRow?.training_permission === "red_recover"`), promote to `severity: "underfuelled"`, `severity_score: 3`. Preserve original numeric fields (`shortfall`, `training_cost`, `calories_target`) — only severity classification changes.
4. **Message/action reinforcement** — when the promotion above fires, or when `ev.severity_score >= 2` AND the readiness signal independently agrees (either flag set), append a single sentence to `ev.message`: `"This lines up with your readiness — Shield already flagged today for caution."` No template rewrite; just an append when both engines converge. Applied before the row is upserted and before `miniExplain` is called (so the AI-gateway explanation sees the reinforced message text).
5. **Persist** the raw modifier used for the decision — extend the upsert payload with `readiness_modifier_at_eval: latestReadinessRow?.nutrition_modifier ?? latestReadinessRow?.training_permission ?? null`. Purely observability; the decision has already been made.

Untouched: `training_cost`/`bmr`/threshold math, the `evaluate()` function signature, the local-6am gate, the p80 volume-tier filter, the `miniExplain` call and its gpt-5-mini model choice.

## F2 — `supabase/functions/generate-training-sync/index.ts`

Code-only, no schema.

1. Extend the existing 7-day readiness `select` to `score_date, final_score, confidence_level, training_permission, nutrition_modifier, load_carryover`.
2. Keep `avgReadiness` computed exactly as today from `final_score` across the 7-day window — legitimate trend metric.
3. Add a **separate** most-recent-row fetch (unbounded, `.order("score_date", desc).limit(1).maybeSingle()`) for `training_permission, confidence_level, nutrition_modifier`. Do not reuse the 7-day windowed query — that's the exact stale-window bug fixed earlier this session.
4. In the Sonnet prompt, keep the existing `THIS WEEK'S READINESS TREND: avg X/100` line, and add immediately after it:
   ```
   TODAY'S READINESS STATE: permission={training_permission}, confidence={confidence_level}, nutrition_modifier={nutrition_modifier}
   ```
   Nulls render as `unknown` (matching the existing avgReadiness null-handling style).

Untouched: cron schedule, Thursday-6pm-local time gate, idempotency check, card storage, `no_plan` fallback, Sonnet model/prompt structure/word target.

## Order

F1 migration → approve → F1 code → F2 code. F1 must land first because it establishes the schema.

## Verification after both land

```sql
-- F1
select user_id, evaluation_date, severity, severity_score, readiness_modifier_at_eval
from user_fuelling_evaluations
where evaluation_date = (select max(evaluation_date) from user_fuelling_evaluations)
order by severity_score desc limit 10;

-- F2 (cron job 9)
select jobid, status, start_time, end_time
from cron.job_run_details where jobid = 9
order by start_time desc limit 5;
```
Also spot-check `daily_coaching_cards` for a recent `card_type='training_sync'` row and confirm the card body references a concrete `training_permission`/`nutrition_modifier` rather than only an average.

## Not in this batch

- No change to calculate-macros-weekly / E2 cron-timezone (queued next).
- No change to evaluate-fuelling's gpt-5-mini model choice (separate cost/consistency question, not a bug).
- No new UI surfacing.
