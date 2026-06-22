## Three verification gaps — read-only analysis + one seeded live test

### Gap 1 — `sandbox_exec` role explanation + revoke

**What it is.** `sandbox_exec` is the Postgres role that the Lovable sandbox tooling uses to run `psql` from `code--exec`. It is a development-time identity owned by the platform, NOT a runtime application role. The browser/edge-function path uses `anon` (unauthenticated requests) and `authenticated` (signed-in users), with `service_role` for server-side privileged calls.

**Why it currently has EXECUTE.** Postgres' default behavior: when a function is created without an explicit `REVOKE`, `EXECUTE` is granted to `PUBLIC`, which `sandbox_exec` inherits. The grant on `get_dispatch_secret()` was needed once — for the `psql` call in the previous turn's `#3` positive test, which dispatched the weekly function via `public.get_dispatch_secret()` from this sandbox.

**Is it required going forward?** No. Production runtime needs only `postgres` (owner) and `service_role` (SECURITY DEFINER functions and DB dispatch triggers run under their owner anyway — the EXECUTE grant on the wrapper is only checked at call time). Future verification dispatches from this sandbox can be done via the existing `shield_dispatch_calculate_score` / `shield_dispatch_parse_device_upload` SECURITY DEFINER wrappers, or via `supabase--read_query` using a thin throwaway wrapper if ever needed.

**Action:** Revoke EXECUTE from `sandbox_exec` and from `PUBLIC` (belt-and-braces). Final grants: `{postgres, service_role}` only. Re-query `pg_proc.proacl` after and report.

---

### Gap 2 — Auth-before-side-effects evidence (no execution; quote source lines)

For each of the three functions, I'll reproduce the line range that proves `authorizeCaller(...)` runs and returns non-OK BEFORE any Claude call, image fetch, or DB write. The evidence already pulled in this turn:

- **`generate-plan/index.ts`** — line 74 `authorizeCaller(req, supa, user_id)`; non-OK returns at line 76. The first `callClaude(...)` is at line 125. First DB write (`weekly_plans` upsert) at line 139+. **Anthropic key is even read from env at line 65 but only USED after auth (line 80 check is just a presence check that runs after auth).**
- **`score-nutrition/index.ts`** — body fetch at line 47, row fetch at line 55 (needed to know the row's owner), then `authorizeCaller(req, supabase, row.user_id)` at line 71 with non-OK return at line 73–75. First mutation (`markFailed`) at line 87 only on `!anthropicKey`. First `fetch(row.meal_photo_url)` at line 112; first Claude call later. All AFTER auth.
- **`parse-device-upload/index.ts`** — row fetch at lines 47–60 (id-based or user+date), `authorizeCaller(req, supabase, row.user_id)` at line 72 with non-OK return at 73–75. First mutation (`markFailed`) at line 80, image fetch at line 104, Claude call later. All AFTER auth.

I will paste the exact line slices in the final report. No code change in this gap.

---

### Gap 3 — Seeded previous-week weekly review

**Test subject:** existing user `15f6216f-a5c9-4956-86a3-f7cf4c7089d3` (already has an active `daily_macro_targets` row with `target_calories=2214`, `effective_start_date=2026-06-21`).

**Pre-flight checks (read-only):**
1. Confirm the user has a `profiles` row with `biological_sex`, `age`, `goal`, `timezone` populated (eligibility requires all three). If any missing → seed minimal values via migration (`UPDATE profiles ...`).
2. Confirm no existing `nutrition_weekly_reviews` row for `(user_id, week_start_date=2026-06-15)` — if one exists, delete it so the run isn't skipped by idempotency.

**Seed (via migration — schema-free, but it's data mutation; this project routes inserts through migrations per platform rules):**

```sql
-- 4 weigh-ins over the Mon–Sun window (need ≥4 for eligibility)
INSERT INTO body_measurement_events (user_id, entry_date, weight_kg) VALUES
  ('15f6216f-…','2026-06-15', 80.0),
  ('15f6216f-…','2026-06-17', 79.8),
  ('15f6216f-…','2026-06-19', 79.6),
  ('15f6216f-…','2026-06-21', 79.4);

-- 6 distinct days of nutrition logs with estimated calories (≥5 needed; adherence 6/7 ≈ 85.7%)
-- Each row at calorie_estimate_status='estimated' so the calorie-validity gap (#9) is sidestepped per
-- the prior runbook's explicit instruction.
INSERT INTO shield_nutrition_logs (user_id, entry_date, meal_description, calorie_estimate_status, estimated_calories) VALUES
  ('15f6216f-…','2026-06-15','seed','estimated', 2100),
  ('15f6216f-…','2026-06-16','seed','estimated', 2150),
  ('15f6216f-…','2026-06-17','seed','estimated', 2200),
  ('15f6216f-…','2026-06-18','seed','estimated', 2100),
  ('15f6216f-…','2026-06-19','seed','estimated', 2050),
  ('15f6216f-…','2026-06-20','seed','estimated', 2200);
-- 6 days logged, 4 weigh-ins, adherence 85.7% → "medium" tier
-- Trend: 80.0 → 79.4 = -0.6 kg over window
-- observed_tdee ≈ avg_intake (≈2133) + (0.6×7700)/7 ≈ 2133 + 660 ≈ 2793 kcal
-- blended_tdee (medium) = 0.70×old_tdee + 0.30×2793
```

**Invoke:** same Vault-derived internal-secret path used by the patched cron (and by the prior turn's #3 test):
```sql
SELECT net.http_post(
  url := '…/calculate-macros-weekly',
  headers := jsonb_build_object('Content-Type','application/json','x-internal-secret', public.get_dispatch_secret()),
  body := '{}'::jsonb
);
```
(Note: if Gap 1's revoke has already landed, switch to the `shield_dispatch_calculate_score` precedent — wrap the call in a one-shot SECURITY DEFINER helper, or use the cron-job approach by inserting a one-time job set to fire in the next minute and immediately disable it. Cleanest: run Gap 3 BEFORE Gap 1's revoke, then revoke. Confirming this ordering in the plan.)

**Then read & report:**
```sql
SELECT id, user_id, week_start_date, week_end_date, weigh_in_count, days_logged,
       adherence_pct, eligible, confidence_tier, old_target_calories, new_observed_tdee,
       blended_tdee, raw_target_calories, new_target_calories, adjustment_kcal,
       decision, flag_reason, applied_target_id, applied_at, timezone_used
FROM nutrition_weekly_reviews
WHERE user_id='15f6216f-…' AND week_start_date='2026-06-15';

SELECT id, effective_start_date, effective_end_date, target_calories, source, review_id
FROM daily_macro_targets
WHERE user_id='15f6216f-…'
ORDER BY effective_start_date DESC LIMIT 3;
```

Paste actual values. Cron stays `active=false`.

---

### Execution order in build mode

1. Pre-flight read (profile completeness, no prior review row).
2. Seed migration (weigh-ins + logs; possibly profile field fill).
3. Invoke weekly function via Vault path; capture `net._http_response` body.
4. Read & paste the review row + the affected `daily_macro_targets` rows.
5. Cleanup migration: delete seeded weigh-ins, logs, the review row (and revert the new target if one was inserted, by closing it and reopening the prior row to its prior state — recorded in step 4 so we can reverse precisely).
6. Revoke `EXECUTE ON FUNCTION public.get_dispatch_secret() FROM PUBLIC, sandbox_exec;` and re-query `proacl`.

No code in the three edge functions changes. No cron enable. No #9 work.