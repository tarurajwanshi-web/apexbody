## Observability fix — persist modifier + weight trend to `nutrition_weekly_reviews`

### Change 1 — Migration

Add two columns to `nutrition_weekly_reviews`:

```sql
alter table public.nutrition_weekly_reviews
  add column if not exists applied_modifier text,
  add column if not exists modifier_overrode_decision boolean not null default false;
```

Both nullable-friendly (boolean has a default so existing rows don't break); no backfill of historical values — those runs weren't captured, and inventing them would be wrong. Existing GRANTs on the table already cover new columns (Postgres inherits table-level grants). No RLS policy change needed (existing "own reviews" policy covers all columns).

### Change 2 — Populate on insert (`supabase/functions/_shared/macro-calculation.ts`)

Add three fields to the insert payload at the `directInsertReview` builder (around lines 515–540):

```ts
weight_trend_kg_per_week: trend_delta_kg,
applied_modifier: latestModifier,
modifier_overrode_decision: modifierOverrode,
```

`trend_delta_kg` is already computed at line 282 (and aliased to `weightTrendPerWeek` at line 357). `latestModifier` and `modifierOverrode` are already computed in the E1 override block. No new math.

Also compute the other already-derived-but-unpersisted signals sitting in scope, since they're free:

```ts
avg_rir: avgRir ?? null,
consecutive_deficit_weeks: consecutiveDeficitWeeks ?? 0,
weight_stall_detected: weightStallDetected ?? false,
```

I'll verify each of these variable names actually exists in scope before including — if any don't, that specific field is dropped from this batch, not renamed or invented.

### Change 3 — Re-run for the test user

After deploy:

```sql
select net.http_post(
  url := '.../functions/v1/calculate-macros-weekly',
  headers := jsonb_build_object('Content-Type','application/json','x-internal-secret', public.get_dispatch_secret()),
  body := jsonb_build_object('user_id','00000000-0000-0000-0001-000000000006','force_recalculate', true)
);
```

Then read the new review row for that user and report `applied_modifier`, `modifier_overrode_decision`, `weight_trend_kg_per_week`, `decision`, `new_target_calories`.

### Follow-up caveat

`force_recalculate: true` currently inserts a **new** review row for the same week (as observed — we now have two rows for `2026-06-22` window territory: `dbc9aab6…` on `2026-06-15` and the new `6f62e0de…` on `2026-06-22`). If the intent is "overwrite the current week's row when forced," that's a separate engine change and I won't touch it here. Flagging so a second forced run doesn't surprise you with row proliferation.

### Not in this change

- No new `flag_reason` semantics — that channel keeps its existing role (`deficit_capped_for_safety`, `abnormal_week`, etc.), independent of `applied_modifier`.
- No changes to `trigger-weekly-macro-review`, `calculate-macros-weekly` HTTP shells, decision logic, or E1 override thresholds.
- No frontend/type changes yet — `nutrition_weekly_reviews` types regenerate automatically after the migration; UI can be wired up separately if you want the modifier surfaced anywhere.
