# B4 — advance-mesocycle

Deterministic, service-role-only edge function. No LLM. No schema changes (confirmed: `mesocycle_state` has no `deload_reason` column — spec's "deload_reason set" is returned in JSON only, not persisted). Complements shipped `20260718135813` (mesocycle_state) and B1 landmarks. Onboarding already calls `calculate-macros` + `generate-plan` via `Promise.allSettled`; we append init here.

## 1. New file: `supabase/functions/advance-mesocycle/index.ts`

Auth: `authorizeCaller(req, supa, user_id)` — same pattern as detect-prs/calculate-score. Service-role client for reads/writes (mesocycle_state is service-role-write-only). Input: `{ user_id: string, mode?: 'init'|'weekly' }`, default `weekly`. Standard CORS block.

### Anchors (module-scoped helpers)

- `upcomingMondayISO(todayISO)`: **byte-for-byte the same math** as `generate-plan/upcomingMonday` (`day===1 ? 0 : (8-day)%7`, UTC). Must not drift — if it does, block_start_date and weekly_plans.week_start_date desynchronize.
- `getPreviousCompletedLocalWeek(tz)`: import from an inline copy of `src/lib/dates.ts` logic (Deno can't import the src helper directly; re-implement `getLocalDateISO` + Monday-anchored range with `addDaysISO`). One shared helper in `_shared/time-helpers.ts` already handles `userLocalMonday`; extend it with `previousCompletedWeek(tz)` returning `{ start, end }` so the function stays consistent with the rest of the engine.

### Step 0 — mode='init'

1. `SELECT * FROM mesocycle_state WHERE user_id=$1 AND is_active=true` → if row exists, no-op, return `{ initialized:false, alreadyActive:true, ...currentState }`.
2. Load `profiles.plan_unlock_date, goal, timezone`.
3. `planMonday = plan_unlock_date ?? upcomingMondayISO(today_UTC)`. Same UTC anchor as generate-plan — do NOT switch to user TZ here; the plan itself is UTC-Monday-anchored so the block must match.
4. INSERT `{ user_id, block_number:1, week_in_block:1, block_length_weeks:4, block_start_date:planMonday, phase:'accumulation', goal, is_active:true }`. On unique-index conflict (race with a parallel init), swallow and re-select.
5. Return `{ initialized:true, block_start_date:planMonday, block_number:1, week_in_block:1, phase:'accumulation' }`.

### Step 1 — mode='weekly' guards

1. Load active row → none: `{ skipped:'no_active_block' }`.
2. Resolve `tz = profiles.timezone ?? 'UTC'`. Compute `todayLocalISO`, `thisMonday` (local Mon of current week), `finishedWeek = previousCompletedWeek(tz)`.
3. If `todayLocalISO < block_start_date` → `{ skipped:'block_not_started' }`.
4. **Idempotency:** if `updated_at` falls within `[thisMonday 00:00, thisMonday+7)` in `tz` **and** we've already been through the weekly path this Monday (proxy: `updated_at >= thisMonday` local start), return `{ skipped:'already_advanced_this_week', ...currentState }`. Simpler and no schema change; a second cron fire the same Monday no-ops.

### Step 2 — did they train the finished week?

```
SELECT count(*) FROM workout_set_logs
WHERE user_id=$1 AND completed=true AND set_type<>'warmup'
  AND entry_date >= finishedWeek.start AND entry_date <= finishedWeek.end
```

- Count 0 → HOLD. Do NOT UPDATE the row (leaves updated_at untouched, so the idempotency guard still permits a future run if needed on catch-up). Return `{ held:true, reason:'no_training_last_week', block_number, week_in_block, phase }`.
- Count ≥1 → step 3.

### Step 3 — fatigue signals (only if advancing)

- **Chronic overreach:** read `weekly_volume_landmarks` for the two most recent completed weeks (`finishedWeek` + the one before). `chronic_overreach = ∃ muscle where completed_sets > fuel_adjusted_mrv in BOTH weeks`. Missing rows → false.
- **Systemic breakdown:** `readiness_scores` last 7 days by `entry_date` (user TZ). Only compute if `>= 3` rows: `avg(final_score) < 40 AND count(training_permission='red_recover') >= 2`. Else false.

### Step 4 — advance / deload (precedence A→D)

```
if phase=='accumulation' && (chronic_overreach || systemic_breakdown):
  A. phase='deload'; deload_reason='chronic_overreach'|'systemic_breakdown'|'both' (return only)
     week_in_block unchanged; block_number unchanged
elif phase=='accumulation' && week_in_block >= block_length_weeks:
  B. phase='deload' (planned); deload_reason='planned'
elif phase=='deload':
  C. block_number+=1; week_in_block=1; phase='accumulation'; block_start_date=thisMonday
else:
  D. week_in_block+=1     // guard: capped by CHECK; unreachable-overflow routed to B/C above
```

Goal unchanged here — B8 owns goal transitions.

### Step 5 — write + return

UPDATE the active row with new `{ block_number, week_in_block, phase, block_start_date?, updated_at=now() }`. Return `{ advanced:true, block_number, week_in_block, phase, is_deload_week: phase==='deload', deload_reason: <string|null> }`.

## 2. Wiring

- **Onboarding** (`src/routes/_authenticated/onboarding.tsx` L314): append a third promise to the `Promise.allSettled([calculate-macros, generate-plan])` — add `supabase.functions.invoke('advance-mesocycle', { body:{ user_id:userId, mode:'init' } })`. Log warn on rejection; never block onboarding.
- **Weekly cron:** existing Monday slots are `0 6` (generate-weekly-pattern) and `30 6` (adaptive-macros-weekly). Schedule advance-mesocycle at `**45 5 * * 1**` (05:45 UTC Monday) via `supabase--insert` calling `cron.schedule` + `net.http_post` with `x-internal-secret` header (pattern matches shield_dispatch_calculate_score). Iterates users via a small wrapper SQL or the function loops all users itself; cleanest: the cron posts once with no user_id, and the function selects all `is_active=true` mesocycle rows and processes each (bounded, service-role). Alternative if the "loop inside function" pattern doesn't fit existing style: keep the current per-user dispatch RPC pattern. I'll match existing style during build.

## 3. Config

`supabase/config.toml`: nothing to change (default `verify_jwt` handling is fine; auth is enforced by `authorizeCaller` + `x-internal-secret` for cron).

## 4. Verification (must pass before B5)

Synthetic users. All 12 cases from the spec:

1. Wed joiner init → `block_start_date` = upcoming Monday (not Wed). SQL confirms.
2. Weekly cron run on the Monday BEFORE block starts → `skipped:'block_not_started'`.
3. Trains first full Mon–Sun → next Monday advance: `week_in_block` 1→2.
4. Zero sets that week → `held`, week_in_block unchanged, `updated_at` unchanged.
5. 4 trained weeks → weeks 1,2,3 accumulation; week 4 → planned deload (B); next Monday → new block (C), block_number 2, week 1.
6. Chronic overreach two consecutive weeks at week 2 → early deload (A).
7. Systemic breakdown (avg<40, ≥2 red_recover) at week 2 → early deload (A).
8. Thin data (0–2 readiness rows / no landmarks) → never forces deload.
9. Double cron same Monday → second run no-ops (idempotency guard via updated_at within current local week).
10. Cron misses a Monday, fires next week → advances ONE week only (evaluates most recent finished week).
11. Non-UTC user (e.g. Asia/Dubai) → `finishedWeek` computed in `profiles.timezone`.
12. `week_in_block` never exceeds `block_length_weeks` (CHECK holds).

## Out of scope

- Persisting `deload_reason` / `missed_week` — returned in response only, not written (no schema change per spec).
- Goal transitions (B8).
- Daily readiness ceiling enforcement (B6).  
  
  
Approve with ONE required consistency fix: the plan week and the mesocycle training-week MUST use the same Monday definition. Right now Step 0 anchors block_start_date to UTC-Monday (matching generate-plan) but Step 2 evaluates the finished training week in user-local timezone. For any non-UTC user these two windows can differ by up to a day, causing the clock to hold a week they trained or advance one they didn't.
  Pick ONE Monday definition and use it everywhere in this function. Since generate-plan and weekly_plans.week_start_date are already UTC-Monday-anchored, and the plan is the source of truth the block must track, use UTC-Monday consistently:
  - Step 0 planMonday: UTC upcomingMonday (as written) — keep.
  - Step 2 finishedWeek: compute the previous completed UTC Mon-Sun window (NOT user-local). The training-week window that decides advancement must match the plan's week boundaries exactly, so a set logged "in plan week N" counts toward advancing past week N.
  - Step 1 thisMonday / idempotency guard: also UTC-Monday, consistent with the above.
  Drop the previousCompletedWeek(tz) / user-timezone approach for the advancement window. The block clock tracks the PLAN's weeks, and the plan is UTC-Monday. One definition, no seam.
  Document this explicitly in the function: "All week boundaries here are UTC-Monday to match generate-plan/weekly_plans.week_start_date. Do not introduce user-timezone week math — it desyncs the block clock from the plan."
  Note: this does mean a user's "week" for block purposes is UTC Mon-Sun, which for far-from-UTC users is slightly offset from their local calendar week. That is ACCEPTABLE and CORRECT here, because the block must align to the plan, and the plan is UTC-anchored. If we ever move plans to user-local weeks, we move both together. Consistency between plan and block is what matters, not which timezone — pick the one the plan already uses.
  Everything else approved as written:
  - init idempotency / unique-index conflict swallow: correct
  - HOLD leaves updated_at untouched: correct and clever (preserves catch-up)
  - single-advance per run, no catch-up multi-advance: correct
  - precedence A>B>C>D: correct
  - deload_reason returned not persisted (no schema change): correct
  - 05:45 UTC Monday slot before 06:00/06:30 jobs: correct
  - function loops all is_active rows from one cron post: fine, matches bounded service-role pattern