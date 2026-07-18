## Batch: Training Engine Schema Foundation

One new migration file `supabase/migrations/<ts>_training_engine_foundation.sql` containing the exact SQL you specified, in the exact order (Part 1 → Part 4), followed by the 4 verification queries.

### Pre-flight confirmations

- `public.update_updated_at_column()` exists (confirmed in db-functions context — plpgsql, sets `NEW.updated_at`). Safe to attach as `BEFORE UPDATE` trigger on the three new tables.
- `public.workout_set_logs` exists with 16 columns. `ADD COLUMN IF NOT EXISTS` is safe for all 8 additions.
- Existing RLS pattern verified: own-rows via `auth.uid() = user_id`, `SELECT` to authenticated, engine tables (like `readiness_scores`) have no authenticated write policies — matches the spec.

### ⚠️ Two overlap conflicts to resolve before I write the migration

`workout_set_logs` already has columns that partially overlap the additive block:


| Existing column               | Spec adds               | Behavior with `IF NOT EXISTS`                                     |
| ----------------------------- | ----------------------- | ----------------------------------------------------------------- |
| `rir smallint`                | `actual_rir smallint`   | Both will exist. `rir` untouched, new `actual_rir` created empty. |
| `rest_seconds_actual integer` | `rest_seconds smallint` | Both will exist. Redundant storage, two-source-of-truth risk.     |
| `muscle_group text`           | `muscle_group text`     | No-op (IF NOT EXISTS skips). ✅ Fine.                              |


Also existing (no conflict, just FYI): `rpe smallint`, `target_reps int`, `target_weight_kg numeric` — spec adds `target_rir` which is the RIR sibling of `target_reps`, so that pairing is clean.

**Question:** how do you want to handle `rir` and `rest_seconds_actual`?

- **Option A (recommended, still pure SQL):** Skip adding `actual_rir` and `rest_seconds` — treat existing `rir` as `actual_rir` and `rest_seconds_actual` as `rest_seconds`. Migration adds 6 columns instead of 8. Verification query updated to reflect 6.
- **Option B:** Apply spec verbatim (adds duplicates). B3/B4/B5 will need to pick one column and ignore the other; downstream code has to remember which.
- **Option C:** Rename existing columns to the spec names in this migration (`rir` → `actual_rir`, `rest_seconds_actual` → `rest_seconds`). Not additive — touches existing data, but zero rows today likely makes this cheap. Requires I check row count first.

No other conflicts. Parts 2–4 (`mesocycle_state`, `weekly_volume_landmarks`, `personal_records`) reference no existing objects beyond `auth.users`, `workout_set_logs.id`, and `update_updated_at_column()` — all present.

### What the migration will contain once you pick A/B/C

1. Part 1: `ALTER TABLE workout_set_logs` — 6 or 8 `ADD COLUMN IF NOT EXISTS` (depending on choice), plus the two `CHECK` constraints (`set_type_check`, `pr_type_check`) with `DROP … IF EXISTS` first for idempotency.
2. Part 2: `mesocycle_state` — CREATE TABLE → GRANT (authenticated SELECT, service_role ALL) → ENABLE RLS → own-rows SELECT policy → partial unique index on `(user_id) WHERE is_active` → `updated_at` trigger.
3. Part 3: `weekly_volume_landmarks` — same 4-step order, unique `(user_id, week_start_date, muscle_group)`, `updated_at` trigger.
4. Part 4: `personal_records` — same 4-step order, index `(user_id, exercise_name, achieved_date DESC)`. No `updated_at` (spec has no updated_at column).
5. Verification block as SQL comments at the bottom, plus I'll run the 4 queries after apply and paste results.

Grants match the spec (authenticated SELECT only, service_role ALL — writes are engine-owned, no anon).

### Approve with your choice

# Reply "A", "B", or "C" (or override the plan) and I'll build the migration file.  
  
  
Option A, modified — reuse existing columns, add only what's genuinely missing. Do NOT rename anything (rir and rest_seconds_actual are referenced in 9+ live code locations: workouts.tsx set logger, coach.functions.ts, generate-plan, generate-daily-coach-note, ExerciseHistoryPanel — renaming breaks all of them).

Reconcile the additive block as follows:

KEEP EXISTING, DO NOT ADD:

- Existing `rir` IS actual_rir. Do not add actual_rir. Downstream functions (B3/B4/B5) will read `rir`.

- Existing `rest_seconds_actual` IS rest_seconds. Do not add rest_seconds. Downstream reads `rest_seconds_actual`.

- Existing `muscle_group` — no-op, already present.

ADD ONLY these 5 genuinely-missing columns:

  target_rir smallint          (the RIR sibling of existing target_reps — clean pairing, confirmed absent)

  set_type text NOT NULL DEFAULT 'working'

  is_pr boolean NOT NULL DEFAULT false

  pr_type text

  is_accessory_block boolean NOT NULL DEFAULT false

KEEP both CHECK constraints (set_type_check, pr_type_check) with DROP IF EXISTS first.

Parts 2-4 (mesocycle_state, weekly_volume_landmarks, personal_records) — apply verbatim, no changes.

Update the verification query to check for these 5 new columns (not 8): target_rir, set_type, is_pr, pr_type, is_accessory_block. Plus confirm existing rir, rest_seconds_actual, muscle_group are still present and untouched.

Confirm before applying: grep the codebase for any existing target_rir, set_type, is_pr, pr_type, is_accessory_block on workout_set_logs to be 100% sure none already exist. If any do, skip that ADD.