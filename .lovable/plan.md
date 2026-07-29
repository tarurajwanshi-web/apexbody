## Verified current state

- `supabase/functions/compute-volume-landmarks/index.ts` L182–183: filters `readiness_scores` on `entry_date` (wrong column).
- `supabase/functions/advance-mesocycle/index.ts` L231–232: same bug.
- `readiness_scores` has no `entry_date` column — the date column is `score_date` (per `src/integrations/supabase/types.ts` and every other consumer: generate-plan, swap-plan-day, evaluate-fuelling, generate-daily-coach-note, macro-calculation).
- Both queries currently drop the query error silently, so `readinessFactor` stays 1.0 in compute-volume-landmarks and `systemic_breakdown` stays false in advance-mesocycle — neither can ever trigger.

## Changes

### File 1 — `supabase/functions/compute-volume-landmarks/index.ts` (~L178–184)

- Replace `.gte("entry_date", readinessWindowStart)` → `.gte("score_date", readinessWindowStart)`
- Replace `.lte("entry_date", today)` → `.lte("score_date", today)`
- Change destructure to `const { data: readinessRows, error: readinessErr } = await supa…`
- Immediately after the query, add:
  ```ts
  if (readinessErr) console.error("[compute-volume-landmarks] readiness query failed", readinessErr.message);
  ```

### File 2 — `supabase/functions/advance-mesocycle/index.ts` (~L227–232)

- Replace `.gte("entry_date", sevenDaysAgo)` → `.gte("score_date", sevenDaysAgo)`
- Replace `.lte("entry_date", todayIso)` → `.lte("score_date", todayIso)`
- Change destructure to `const { data: readiness, error: readinessErr } = await supa…`
- Immediately after the query, add:
  ```ts
  if (readinessErr) console.error("[advance-mesocycle] readiness query failed", readinessErr.message);
  ```

## Not touched

- Thresholds unchanged: `readinessFactor = 0.9`, `avg < 45`, `avg < 40`, `reds >= 2`.
- `fuelFactor`, `target_sets`, deload precedence, and all other logic in both files untouched.
- No other files modified.

## Post-build

Redeploy both edge functions (`compute-volume-landmarks`, `advance-mesocycle`) so the fix reaches the workers running the Monday cron.
