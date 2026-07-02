
# BATCH A1 — Re-lock RLS on system-computed tables

## Verified current state (just re-queried pg_policies)

Actual policies live right now (not all of what the request lists still exists — some INSERTs were already removed):

| Table | SELECT | INSERT | UPDATE | DELETE |
|---|---|---|---|---|
| `daily_macro_targets` | `own row select` ✅ keep | — (already gone) | `own row update` ❌ drop | `own row delete` ❌ drop |
| `nutrition_weekly_reviews` | `users read own weekly reviews` ✅ keep | — (already gone) | `users update own weekly reviews` ❌ drop | `users delete own weekly reviews` ❌ drop |
| `readiness_scores` | `own rows select` ✅ keep | `own rows insert` ❌ drop | `own rows update` ❌ drop | `own rows delete` ❌ drop |
| `weekly_plans` | `own row select` ✅ keep | `own row insert` ❌ drop | `own row update` ❌ drop | `own row delete` ❌ drop |

All four SELECT policies scoped `auth.uid() = user_id` remain intact after the drops → users keep read access. RLS stays enabled on all four tables (service_role bypasses RLS, so system writes continue to work).

## Client write dependency (verified)

`src/routes/workouts.tsx` line ~998 — `RestDaySwapCard` writes `plan_data` directly:

```ts
await supabase.from("weekly_plans").update({ plan_data: newPlanData }).eq("id", plan.id);
```

This is the only client write to any of the four tables. It breaks the moment the UPDATE policy is dropped. Fix in the same pass.

Recommendation: option (a) — move the write behind a server function. Matches every other system-table write in this codebase (generate-plan, calculate-macros, calculate-score, etc.). Option (b) — a narrow column/row-scoped UPDATE policy — is possible but expands the RLS surface for one feature and is inconsistent with the rest of the app.

## Plan (one migration + one server-side write path, deployed together)

### Step 1 — New server function: `swap-plan-day`

File: `supabase/functions/swap-plan-day/index.ts` (Deno edge function, service role, matches existing pattern in `calculate-macros`, `evaluate-fuelling`, etc.).

- Auth: `authorizeCaller(req, supa, body.user_id)` from `_shared/authorize.ts` — JWT bearer path (not internal-secret), verifies `auth.uid()` matches `body.user_id`.
- Input: `{ user_id, plan_id, source_day_index, target_day_index }`.
- Loads the plan row via service-role client, verifies `plan.user_id === body.user_id` (defense in depth beyond authz), computes the same `newDays`/`newPlanData` transform currently in the client, writes back via service role.
- Returns `{ ok: true, plan_data }` so the client can update local state without a round-trip re-read (or re-read via existing `reloadPlanOnly`).
- CORS: reuse `corsAllowHeaders` from `_shared/authorize.ts`.

### Step 2 — Client update in `src/routes/workouts.tsx`

Replace the direct `supabase.from("weekly_plans").update(...)` inside `RestDaySwapCard` (around line 998) with a `fetch` to the new function, using the pattern already used in `src/lib/nutrition.functions.ts::triggerWeeklyMacroReview`:

- Get session token from `supabase.auth.getSession()`.
- POST `${VITE_SUPABASE_URL}/functions/v1/swap-plan-day` with bearer + JSON body.
- On success, call `onSwapped()` (existing) to refetch.
- No other file needs touching — reads of `weekly_plans` at lines 60 and 156 stay untouched.

### Step 3 — Migration: drop write policies

Single migration, dropping ONLY the policies that currently exist (verified list above):

```sql
DROP POLICY IF EXISTS "own row update"  ON public.daily_macro_targets;
DROP POLICY IF EXISTS "own row delete"  ON public.daily_macro_targets;

DROP POLICY IF EXISTS "users update own weekly reviews" ON public.nutrition_weekly_reviews;
DROP POLICY IF EXISTS "users delete own weekly reviews" ON public.nutrition_weekly_reviews;

DROP POLICY IF EXISTS "own rows insert" ON public.readiness_scores;
DROP POLICY IF EXISTS "own rows update" ON public.readiness_scores;
DROP POLICY IF EXISTS "own rows delete" ON public.readiness_scores;

DROP POLICY IF EXISTS "own row insert"  ON public.weekly_plans;
DROP POLICY IF EXISTS "own row update"  ON public.weekly_plans;
DROP POLICY IF EXISTS "own row delete"  ON public.weekly_plans;
```

The `daily_macro_targets` INSERT and `nutrition_weekly_reviews` INSERT policies referenced in the request are already absent — `DROP ... IF EXISTS` covers them anyway if I'm being defensive, but I'll omit them since verification shows they're gone.

SELECT policies are not touched. RLS stays enabled. All existing server functions and RPCs (`apply_onboarding_macros`, `apply_existing_weekly_macro_review`, `shield_dispatch_*`, `calculate-*` functions) already run as service role or SECURITY DEFINER, so nothing server-side breaks.

## Order of operations in the same deploy

1. Ship `swap-plan-day` edge function.
2. Ship `workouts.tsx` client change pointing at it.
3. Apply the RLS drop migration.

Doing 3 before 1+2 breaks the swap feature; doing 1+2 before 3 is safe (the client just stops needing the policy). If the migration approval and function deploy can't be atomic, order = function → client → migration.

## Out of scope (explicitly)

- Not touching SELECT policies on any table.
- Not touching `nutrition_weekly_reviews` INSERT (already absent) or `daily_macro_targets` INSERT (already absent).
- Not adding a narrow column-scoped UPDATE policy (option b) — going with option a.
- No other batches. No schema changes beyond policy drops. No changes to `calculate-score`, `generate-plan`, macro engine, or Shield code.

## Files touched

- **New:** `supabase/functions/swap-plan-day/index.ts`
- **Edited:** `src/routes/workouts.tsx` (RestDaySwapCard write only, ~10 lines)
- **Migration:** one `DROP POLICY` migration (10 statements)

## Acceptance

- After migration, `pg_policies` shows only SELECT policies for authenticated on all four tables.
- `RestDaySwapCard` "Train anyway" still works end-to-end (verify manually: swap a rest day, confirm plan_data updated, no RLS error in console).
- No other UI regressions — no other client code writes these tables (verified via `rg`).
- `bun run build` clean.
