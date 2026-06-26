## Goal

Split `calculate-macros-weekly/index.ts` into:
1. `supabase/functions/_shared/time-helpers.ts` — pure date utils
2. `supabase/functions/_shared/macro-calculation.ts` — `calculateMacrosForUser(...)`

`calculate-macros-weekly/index.ts` keeps its `Deno.serve` HTTP shell and just loops profiles → calls the shared function. A future `trigger-weekly-macro-review` function can call the same shared function for one user.

## Important — your spec conflicts with the live code in 4 places. I need to confirm which wins before writing.

The existing function has been audited and tuned; some of your pseudocode would silently regress it. Please confirm Option A (keep current behavior) or Option B (overwrite with your spec) for each:

**Q1. Weight table.** Spec says `weight_logs(weight_kg, created_at)`. The DB table is `body_measurement_events(entry_date, weight_kg, created_at)` and that's what the live code reads. There is no `weight_logs` table.
- A: keep `body_measurement_events` (recommended — `weight_logs` doesn't exist).
- B: create `weight_logs` (out of scope for this extraction).

**Q2. Review window.** Live code reviews the **prior** week (Mon→Sun that just ended) and activates the new target on the **current** local Monday. Your spec reviews the week that *starts* on `userLocalMonday(tz, now)` — i.e. the upcoming week, which has no data yet.
- A: keep prior-week semantics (recommended; matches Monday 13:00 UTC cron intent).
- B: switch to current-Monday-as-window-start (will break, days_logged will always be 0–1).

**Q3. `apply_weekly_macro_review` RPC signature.** The deployed RPC takes the long parameter list currently used (`p_review_id`, `p_week_end_date`, `p_effective_start_date`, `p_weigh_in_count`, `p_days_logged`, `p_adherence_pct`, `p_eligible`, `p_confidence_tier`, `p_abnormal_week`, `p_old_*`, `p_raw_target_calories`, `p_adjustment_kcal`, `p_flag_reason`, `p_timezone_used`, `p_bmr`, …). Your spec calls it with a much shorter signature (`p_review_week_start`, `p_review_week_end`, `p_new_target_*`, `p_training_load_index`, etc.) — that call will fail with "function does not exist."
- A: keep the existing RPC signature (recommended).
- B: write a migration to add a new RPC overload (separate task).

**Q4. Decision tiers.** Live code uses `"high" | "medium" | "low"` and goal-specific trend logic (fat_loss / muscle_gain / recomposition / strength). Your spec uses `"COLLECTING" | "LOW" | "MEDIUM" | "HIGH"` and a simpler `goalMultiplier * trainingLoadIndex` formula with no trend-based decision.
- A: keep current tiered decision logic (recommended).
- B: replace with simpler spec logic (loses fat-loss/muscle-gain trend correction).

Default assumption if you don't answer: **A on all four** — i.e. mechanically extract the existing logic into the shared module without changing behavior, and apply only the structural changes your spec actually requires (separate files, exported function, accept injected `supa` + `now`, throw instead of returning `{status:"error"}` on RPC failure).

## Plan (assuming all A)

### File 1 — `supabase/functions/_shared/time-helpers.ts`
Move verbatim from current `index.ts`:
- `userLocalMonday(tz, now=new Date())`
- `tsToLocalDate(tsIso, tz)`
- `addDays(isoDate, days)`
- Add `getISOWeek(date)` (new, per spec).

### File 2 — `supabase/functions/_shared/macro-calculation.ts`
- Import `SupabaseClient` type + helpers.
- Export `Profile`, `CalculationResult` types matching your spec (status union: `"hold" | "adjusted" | "skipped" | "error"` — kept wider so cron loop can still report skipped/error without try/catch noise; happy to narrow to `"hold" | "adjusted"` per your spec if you confirm caller will handle skipped via the idempotency throw).
- Export `async function calculateMacrosForUser(user_id, profile, supa, now=new Date()): Promise<CalculationResult>`.
- Body = current `processUser` lines 113–502, with these edits:
  - Take `supa`, `profile`, `now` as args (no `createClient`).
  - Replace the silent idempotency skip with `throw new Error("review_exists:" + week_start_date)` so single-user HTTP callers see it; cron wrapper catches and maps to `"skipped"`.
  - On RPC failure: throw instead of swallowing (per your spec "Throw errors on RPC failure"). Cron wrapper catches → `"error"` result + logs.
  - Return `{ user_id, status, decision, flag_reason?, applied_target_id? }`.

### File 3 — `supabase/functions/calculate-macros-weekly/index.ts` (slim)
- Keep `Deno.serve`, auth, profile fetch, results aggregation.
- Replace inline `processUser` with:
  ```ts
  try { results.push(await calculateMacrosForUser(p.user_id, p, supa)); }
  catch (e) {
    const msg = String(e?.message ?? e);
    if (msg.startsWith("review_exists:")) results.push({ user_id: p.user_id, status: "skipped" });
    else results.push({ user_id: p.user_id, status: "error", error: msg });
  }
  ```
- `force_recalculate` handling: pass through as a 4th arg `(…, opts?: { force?: boolean })` to the shared function, which skips the idempotency check when true.

### Out of scope (separate task)
- Creating `trigger-weekly-macro-review` HTTP entry point.
- Any DB migration (no RPC changes, no new tables).
- Pruning `workout_set_logs` set-count usage (kept — it drives `trainingLoadIndex` tiers, not just `avgStrain`).

## Verification
- Build passes; no new imports outside `_shared/`.
- `calculate-macros-weekly` curl with `{user_id, force_recalculate:true}` produces same review row shape as before for a known test user (spot-check `training_load_index`, `avg_strain_value`, `decision` match prior run).
- Lint: `bun run lint:ui` unaffected (server-only change).

Confirm Q1–Q4 (or just "go with A") and I'll switch to build mode.
