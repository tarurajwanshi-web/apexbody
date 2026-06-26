# FIX-A — Nutrition engine: real strain + actually apply the result

Single-file change: `supabase/functions/calculate-macros-weekly/index.ts`. No other files touched. JSON response shape, timezone math, idempotency, floors/ceilings, and internal-secret auth all preserved.

## Change 1 — Strain source (lines ~249–267)

Replace the training-load block so strain reads from `shield_training_logs`, while `totalSets` still comes from `workout_set_logs`.

- Keep the `workout_set_logs` query for the same `[week_start_date, window_end_exclusive)` window but change `.select("strain_value")` → `.select("id")`. `totalSets = workoutSets?.length ?? 0`.
- Add a second query against `shield_training_logs` for the same user/window:
  ```ts
  const { data: trainingLogs, error: trainErr } = await supa
    .from("shield_training_logs")
    .select("strain_value")
    .eq("user_id", p.user_id)
    .gte("entry_date", week_start_date)
    .lt("entry_date", window_end_exclusive);
  if (trainErr) console.error("[calculate-macros-weekly] training logs fetch failed", trainErr);
  ```
- Compute `avgStrain` as the mean of `Number(t.strain_value ?? 0)` across rows; if `trainingLogs` is empty/null, `avgStrain = 0`.
- Keep the existing `totalSets`-based tiering for `trainingLoadIndex` (0.85 / 1.0 / 1.1 / 1.15), then **after** tiering apply the strain nudge:
  - `if (avgStrain >= 14) trainingLoadIndex += 0.1;` (one tier up)
  - `else if (avgStrain > 0 && avgStrain < 6) trainingLoadIndex -= 0.1;` (one tier down)
- Keep the existing low-readiness damp (`avgReadiness < 45 && > 1.0`) and the final clamp `Math.max(0.7, Math.min(1.3, trainingLoadIndex))` unchanged.

`avg_strain_value` already gets stored in the review row (line 429) — value is now real instead of always 0.

## Change 2 — Apply the decision (replace lines 410–442)

Today the function always inserts the review with `applied_target_id: null`. Switch to:

1. Compute `review_id = crypto.randomUUID()` and the recomputed macros once:
   ```ts
   const review_id = crypto.randomUUID();
   const macros = recomputeMacros(new_target_calories, current_weight_kg, goal);
   const shouldApply = decision !== "hold" && confidenceTier !== "low" && !abnormal;
   ```
2. If `shouldApply`, call the RPC with the **exact** arg list from `src/integrations/supabase/types.ts` (lines 964–991):
   ```ts
   const { error: rpcErr } = await supa.rpc("apply_weekly_macro_review", {
     p_review_id: review_id,
     p_user_id: p.user_id,
     p_week_start_date: week_start_date,
     p_week_end_date: week_end_date,
     p_effective_start_date: new_effective_start_date,
     p_weigh_in_count: weigh_in_count,
     p_days_logged: days_logged,
     p_adherence_pct: adherence_pct,
     p_eligible: days_logged >= 3,
     p_confidence_tier: confidenceTier,
     p_abnormal_week: abnormal,
     p_old_target_calories: old_target_calories,
     p_old_observed_tdee: old_observed_tdee ?? 0,
     p_new_observed_tdee: new_observed_tdee ?? 0,
     p_blended_tdee: blended_tdee,
     p_raw_target_calories: raw_target_calories,
     p_new_target_calories: new_target_calories,
     p_adjustment_kcal: adjustment_kcal,
     p_decision: decision,
     p_flag_reason: flagReason ?? "",
     p_timezone_used: tz,
     p_bmr: old_bmr,
     p_target_protein_g: macros.target_protein_g,
     p_target_carbs_g: macros.target_carbs_g,
     p_target_fat_g: macros.target_fat_g,
   });
   if (rpcErr) {
     // Fallback: plain review insert, surface error in flag_reason. Never throw.
     await supa.from("nutrition_weekly_reviews").insert({ /* current shape */,
       flag_reason: `apply_rpc_failed: ${rpcErr.message}` });
     return { user_id: p.user_id, status: "hold", decision,
              flag_reason: `apply_rpc_failed: ${rpcErr.message}` };
   }
   return { user_id: p.user_id, status: "adjusted", decision, flag_reason: flagReason };
   ```
   Note: RPC arg types are non-nullable per generated types, so coalesce nullable observed-TDEE values to `0`. `training_load_index`, `weekly_sets_avg`, and `avg_strain_value` are not RPC params; they will not be written on the apply path (RPC owns the insert). The fallback insert keeps writing them.
3. Else (hold / low-confidence / abnormal): keep the current direct insert exactly as today (lines 410–435 unchanged, including `applied_target_id: null`).

The `processUser` function never throws — RPC errors are caught and reported via the fallback's `flag_reason`.

## Out of scope

No edits to migrations, other edge functions, RPC body, or frontend. Response shape and HTTP entrypoint untouched.
