# B3 — PR Detection

Deterministic edge function `detect-prs` + minimal client hook. No LLM, no schema changes (schema landed in `20260718135813`).

## 1. New file: `supabase/functions/detect-prs/index.ts`

Auth: reuse `authorizeCaller(req, supabase, user_id)` (same pattern as `calculate-score`) so the user's session JWT is accepted. CORS block identical to `calculate-score`. Service-role client for all reads/writes (personal_records has service-role-only writes).

Input (POST JSON):

```
{ user_id: string, entry_date: string (YYYY-MM-DD), exercise_name: string }
```

### Algorithm

1. **Load history.** `SELECT id, entry_date, weight_kg, reps_completed FROM workout_set_logs` WHERE `user_id`, `exercise_name` match, `completed = true`, `weight_kg IS NOT NULL`, `reps_completed IS NOT NULL AND reps_completed > 0`, `set_type <> 'warmup'`.
2. **Split** into `today` (entry_date === input.entry_date) and `history` (entry_date < input.entry_date). If `history.length === 0` → return `{ prs: [] }` (first-ever entry never celebrates; step 5 also clears `is_pr` for today).
3. **Epley 1RM** per set: `est1rm = weight * (1 + reps / 30)`. Comment cites Epley (1985). Skip est1rm PR candidacy when `reps > 12` (still eligible for max_weight / max_reps / max_volume).
4. **Compute prior bests from history:**
  - `priorMaxWeight = max(weight_kg)`
  - `priorMaxEst1rm = max(est1rm) over sets with reps <= 12`
  - `priorMaxRepsAtWeight: Map<weight_kg, maxReps>`
  - `priorMaxVolume = max(weight_kg * reps_completed)` (single-set)
5. **Recompute `is_pr` for today's sets from scratch:** first `UPDATE workout_set_logs SET is_pr=false, pr_type=NULL` for user+exercise+entry_date. Then iterate today's sets in `set_number` order and, for each set, check the four PR types against the running bests (bests update as we iterate today's sets, so the second identical-weight set of the day doesn't double-flag max_weight). A set that triggers any PR type gets `is_pr = true` and `pr_type = <highest priority>` with priority `max_est_1rm > max_weight > max_volume > max_reps_at_weight`.
6. **De-dupe personal_records writes:** for each detected PR, `SELECT value FROM personal_records WHERE user_id, exercise_name, pr_type ORDER BY achieved_date DESC, created_at DESC LIMIT 1`. Insert only when new value is strictly greater. Row: `{ user_id, exercise_name, pr_type, value, reps: reps_completed, weight_kg, achieved_date: entry_date, set_log_id }`. `value` rounded to 1 decimal for `max_est_1rm`, kept exact for others.
7. **Return** `{ prs: [{ pr_type, value, exercise_name }, ...] }` — one entry per PR row inserted.

Idempotency: step 5 wipes+recomputes `is_pr` each call; step 6 blocks duplicate personal_records rows. Editing a set down never deletes historical PRs; `is_pr` on that set drops to false on next call.

## 2. Client wire-up: `src/routes/workouts.tsx` SetRow.save (~L740)

Right after `if (completed) await maybeWriteTrainingSummary(...)`:

```ts
if (completed) {
  try {
    const { data: prRes } = await supabase.functions.invoke("detect-prs", {
      body: { user_id: uid, entry_date: todayISO, exercise_name: exercise.name },
    });
    const prs = (prRes as any)?.prs as Array<{ pr_type: string; value: number; exercise_name: string }> | undefined;
    if (prs && prs.length > 0) {
      const label = prs.map(p => prLabel(p)).join(" · ");
      toast.success(`New PR — ${label}`);
    }
  } catch { /* PR detection must never break saving */ }
}
```

Small local `prLabel({pr_type, value, exercise_name})` helper (plain text, no emoji):

- `max_weight` → `${exercise_name} ${value}kg`
- `max_est_1rm` → `${exercise_name} est 1RM ${value}kg`
- `max_reps_at_weight` → `${exercise_name} ${value} reps`
- `max_volume` → `${exercise_name} volume ${value}kg`

Gate: only invoked when `completed === true`. Warmup skipping is enforced server-side (via `set_type <> 'warmup'`); today's UI has no warmup toggle yet, so nothing extra to guard client-side.

## 3. No config changes

`supabase/config.toml`: not touched. detect-prs runs with the platform default (JWT verified by our own `authorizeCaller`, same as calculate-score).

## 4. Verification (must pass before B4)

Using a clean synthetic user:

1. Log Bench Press 60kg x 8 → invoke detect-prs → `{ prs: [] }`. `personal_records` empty; `is_pr` false.
2. Next day, Bench 62.5kg x 8 → prs contain `max_weight (62.5)`, `max_volume (500)`, `max_est_1rm (~79)`. Row's `is_pr=true`, `pr_type='max_est_1rm'`.
3. Next day, Bench 62.5kg x 10 → `max_reps_at_weight (10)` and `max_volume (625)` (and likely `max_est_1rm`).
4. Re-invoke detect-prs for the same day+exercise → 0 new rows inserted.
5. Insert a warmup set (`set_type='warmup'`) at 100kg x 3 directly via SQL → invoke → no PR.
6. `SELECT exercise_name, pr_type, value, achieved_date FROM personal_records WHERE user_id=<test> ORDER BY created_at DESC` matches expectations.
7. Log Bench 60kg x 15 (fresh user) after a prior 60kg x 12 baseline → `max_reps_at_weight` and `max_volume` fire; `max_est_1rm` does NOT (reps > 12).

## Out of scope

- Full PR feed UI (later frontend batch)
- Landmark-based warmup autodetection
- Deleting personal_records on downward edits (per spec: PRs are historical facts)

&nbsp;

#   
  
Approve, with ONE correctness fix to step 6 de-dupe.

- The de-dupe currently compares the new PR value against the MOST RECENT personal_records row (ORDER BY achieved_date DESC LIMIT 1). This is wrong — a PR is only real if it beats the ALL-TIME best, not the latest-dated one. With backdated edits or out-of-order logging, "most recent" can be lower than a genuine prior best, letting a non-PR through.
  Change step 6 to:
    SELECT MAX(value) AS best FROM personal_records
    WHERE user_id = $1 AND exercise_name = $2 AND pr_type = $3;
  Insert only when the new value is strictly greater than best (or best IS NULL = first PR of this type). This makes "is it a PR?" mean "beats all-time best for this type," which is the only correct definition.
  Note this must stay CONSISTENT with step 4, which already computes prior bests from the workout_set_logs history (not from personal_records). Two sources of "prior best" now exist: step 4 reads set-log history, step 6 reads personal_records. They should agree, but personal_records is the authoritative PR ledger. Keep step 4 as the detection trigger (fast, from live sets) and step 6 MAX(value) as the write-guard (authoritative, prevents a duplicate/regressive row). If they ever disagree (e.g. a set was deleted but its PR row remains), the personal_records MAX wins for the write guard — that's correct, because a PR that was genuinely hit remains a historical fact even if the set row was later removed.
  Everything else approved as written:
  - history/today split with entry_date < input.entry_date: correct
  - first-ever entry returns {prs:[]} and clears is_pr: correct
  - Epley with reps>12 skip for est_1rm only: correct
  - step 5 wipe-and-recompute is_pr per call (idempotent): correct
  - running bests update as today's sets iterate (no double-flag): correct, good catch by you
  - priority max_est_1rm > max_weight > max_volume > max_reps_at_weight: correct
  - client try/catch never blocks save, plain-text toast: correct
  - authorizeCaller + service-role writes: correct