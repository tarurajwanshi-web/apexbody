import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { addDays, tsToLocalDate, userLocalMonday } from "./time-helpers.ts";
import { goalDirection } from "./goal-direction.ts";

export type Profile = {
  user_id: string;
  timezone: string;
  goal: string | null;
  biological_sex: string | null;
  age: number | null;
  measurement_height_cm: number | null;
  measurement_weight_kg: number | null;
  body_data_type: string | null;
  dexa_lean_mass_kg: number | null;
  user_marked_abnormal_week_start: string | null;
  target_weight_kg: number | null;
  target_rate_pct: number | null;
  reached_target_at: string | null;
};

export type NutritionModifier =
  | "recovery_day_refeed" | "hydration_priority" | "protein_priority"
  | "deficit_caution" | "fuel_more" | "normal";

export type CalculationResult = {
  user_id: string;
  status: "hold" | "adjusted" | "skipped" | "error";
  decision?: string;
  flag_reason?: string | null;
  applied_target_id?: string | null;
  applied_modifier?: NutritionModifier | null;
  modifier_overrode_decision?: boolean;
  error?: string;
};

export type CalculateOptions = { force?: boolean };

function proteinPerKg(goal: string | null | undefined): number {
  return goal === "fat_loss" ? 2.2 : 1.8;
}

function recomputeMacros(targetCalories: number, weightKg: number, goal: string | null) {
  const target_protein_g = weightKg * proteinPerKg(goal);
  const fatFloorFromKg = weightKg * 0.4;
  const fatFromPct = (targetCalories * 0.25) / 9;
  const target_fat_g = Math.max(fatFloorFromKg, fatFromPct);
  const remaining = targetCalories - target_protein_g * 4 - target_fat_g * 9;
  const target_carbs_g = Math.max(0, remaining / 4);
  return {
    target_protein_g: Math.round(target_protein_g),
    target_carbs_g: Math.round(target_carbs_g),
    target_fat_g: Math.round(target_fat_g),
  };
}

export async function calculateMacrosForUser(
  user_id: string,
  profile: Profile,
  supa: SupabaseClient,
  now: Date = new Date(),
  opts: CalculateOptions = {},
): Promise<CalculationResult> {
  const p = profile;
  const force = opts.force === true;
  const tz = p.timezone || "Asia/Dubai";

  const current_week_start_date = userLocalMonday(tz, now);
  const week_start_date = addDays(current_week_start_date, -7);
  const week_end_date = addDays(current_week_start_date, -1);
  const window_end_exclusive = current_week_start_date;
  const new_effective_start_date = current_week_start_date;

  if (!force) {
    const { data: existing } = await supa
      .from("nutrition_weekly_reviews").select("id")
      .eq("user_id", user_id).eq("week_start_date", week_start_date).maybeSingle();
    if (existing) throw new Error(`review_exists:${week_start_date}`);
  }

  const insertHold = async (flag_reason: string, eligible: boolean, abnormal: boolean): Promise<CalculationResult> => {
    await supa.from("nutrition_weekly_reviews").insert({
      user_id, week_start_date, week_end_date,
      weigh_in_count: 0, days_logged: 0, adherence_pct: 0,
      eligible, abnormal_week: abnormal, adjustment_kcal: 0,
      decision: "hold", flag_reason, timezone_used: tz,
    });
    return { user_id, status: "hold", decision: "hold", flag_reason };
  };

  let direction: "lose" | "gain" | "maintain";
  try {
    direction = goalDirection(p.goal ?? "");
  } catch {
    return insertHold("invalid_goal_value", false, false);
  }

  if (direction !== "maintain" && p.target_rate_pct == null) {
    return insertHold("missing_target_rate", false, false);
  }

  const { data: activeRows, error: activeErr } = await supa
    .from("daily_macro_targets").select("id, bmr, tdee, target_calories, formula_used")
    .eq("user_id", user_id).is("effective_end_date", null);
  if (activeErr) throw activeErr;
  if (!activeRows || activeRows.length === 0) return insertHold("missing_required_profile_data", false, false);
  if (activeRows.length > 1) throw new Error(`data_integrity: ${activeRows.length} active macro targets`);
  const active = activeRows[0];
  const old_tdee = Number(active.tdee);
  const old_target_calories = Number(active.target_calories);

  if (!p.biological_sex || !p.goal || !p.age) return insertHold("missing_required_profile_data", false, false);

  const { data: prior } = await supa
    .from("nutrition_weekly_reviews").select("new_observed_tdee")
    .eq("user_id", user_id).lt("week_start_date", week_start_date)
    .order("week_start_date", { ascending: false }).limit(1).maybeSingle();
  const old_observed_tdee: number | null = prior?.new_observed_tdee ?? null;

  const { data: weighs } = await supa
    .from("body_measurement_events").select("entry_date, weight_kg, created_at")
    .eq("user_id", user_id).not("weight_kg", "is", null)
    .gte("entry_date", week_start_date).lt("entry_date", window_end_exclusive)
    .order("created_at", { ascending: false });

  const dailyWeights = new Map<string, number>();
  for (const w of weighs ?? []) {
    if (!dailyWeights.has(w.entry_date)) dailyWeights.set(w.entry_date, Number(w.weight_kg));
  }
  const weigh_in_count = dailyWeights.size;

  const { data: logs } = await supa
    .from("shield_nutrition_logs").select("created_at, entry_date")
    .eq("user_id", user_id).eq("deleted", false)
    .gte("entry_date", week_start_date).lt("entry_date", window_end_exclusive);
  const localDays = new Set<string>();
  for (const l of logs ?? []) {
    const d = l.entry_date ?? tsToLocalDate(l.created_at as string, tz);
    if (d >= week_start_date && d < window_end_exclusive) localDays.add(d);
  }
  const days_logged = localDays.size;
  const adherence_pct = (days_logged / 7) * 100;

  let current_weight_kg: number | null = null;
  if (dailyWeights.size > 0) {
    const latestDate = [...dailyWeights.keys()].sort().pop()!;
    current_weight_kg = dailyWeights.get(latestDate)!;
  }
  if (current_weight_kg == null) {
    const { data: anyW } = await supa
      .from("body_measurement_events").select("weight_kg")
      .eq("user_id", user_id).not("weight_kg", "is", null)
      .order("entry_date", { ascending: false }).order("created_at", { ascending: false })
      .limit(1).maybeSingle();
    if (anyW?.weight_kg != null) current_weight_kg = Number(anyW.weight_kg);
  }
  if (current_weight_kg == null && p.measurement_weight_kg != null) current_weight_kg = Number(p.measurement_weight_kg);
  if (current_weight_kg == null || current_weight_kg <= 0) return insertHold("missing_required_profile_data", false, false);

  // ── Training load metrics (unchanged) ───────────────────────────────
  const { data: workoutSets } = await supa
    .from("workout_set_logs").select("id").eq("user_id", user_id)
    .gte("entry_date", week_start_date).lt("entry_date", window_end_exclusive);
  const totalSets = workoutSets?.length ?? 0;

  const { data: trainingLogs } = await supa
    .from("shield_training_logs").select("strain_value").eq("user_id", user_id)
    .gte("entry_date", week_start_date).lt("entry_date", window_end_exclusive);
  const avgStrain = trainingLogs && trainingLogs.length > 0
    ? trainingLogs.reduce((sum, t) => sum + Number(t.strain_value ?? 0), 0) / trainingLogs.length : 0;

  let trainingLoadIndex = 1.0;
  if (totalSets < 10) trainingLoadIndex = 0.85;
  else if (totalSets < 20) trainingLoadIndex = 1.0;
  else if (totalSets < 30) trainingLoadIndex = 1.1;
  else trainingLoadIndex = 1.15;
  if (avgStrain >= 14) trainingLoadIndex += 0.1;
  else if (avgStrain > 0 && avgStrain < 6) trainingLoadIndex -= 0.1;

  const { data: readinessDays } = await supa
    .from("readiness_scores").select("final_score, nutrition_modifier, training_permission, score_date")
    .eq("user_id", user_id).gte("score_date", week_start_date).lt("score_date", window_end_exclusive)
    .order("score_date", { ascending: false });
  const avgReadiness = readinessDays && readinessDays.length > 0
    ? readinessDays.reduce((sum, r) => sum + Number(r.final_score ?? 0), 0) / readinessDays.length : 50;

  const { data: latestModifierRow } = await supa
    .from("readiness_scores").select("nutrition_modifier, score_date")
    .eq("user_id", user_id).order("score_date", { ascending: false }).limit(1).maybeSingle();
  const latestModifier = (latestModifierRow?.nutrition_modifier ?? null) as NutritionModifier | null;

  if (avgReadiness < 45 && trainingLoadIndex > 1.0) trainingLoadIndex = Math.max(0.85, trainingLoadIndex * 0.85);
  trainingLoadIndex = Math.max(0.7, Math.min(1.3, trainingLoadIndex));
  const weeklySetAvg = totalSets / 7;

  // ── EMA weight trend, replacing the old few-point average ──────────
  const haveTrendData = weigh_in_count >= 2 && days_logged >= 1;
  let trend_delta_kg = 0;
  if (haveTrendData) {
    const { data: trendRow } = await supa
      .from("weight_trend_state").select("trend_kg, last_computed_date")
      .eq("user_id", user_id).maybeSingle();
    const alpha = 0.1;
    let trend = trendRow?.trend_kg ?? current_weight_kg;
    const startTrend = trend;
    const sortedDates = [...dailyWeights.keys()].sort();
    for (const d of sortedDates) trend = trend + alpha * (dailyWeights.get(d)! - trend);
    trend_delta_kg = trend - startTrend;
    await supa.from("weight_trend_state").upsert(
      { user_id, trend_kg: trend, last_computed_date: sortedDates[sortedDates.length - 1] },
      { onConflict: "user_id" },
    );
  }

  const { data: kcalRows } = await supa
    .from("shield_nutrition_logs").select("entry_date, estimated_calories, calorie_estimate_status")
    .eq("user_id", user_id).eq("deleted", false)
    .in("calorie_estimate_status", ["estimated", "manual_edited"])
    .gte("entry_date", week_start_date).lt("entry_date", window_end_exclusive);
  const dayKcal = new Map<string, number>();
  for (const r of kcalRows ?? []) {
    const k = Number((r as { estimated_calories?: number | string | null }).estimated_calories ?? 0);
    if (!isFinite(k) || k <= 0) continue;
    dayKcal.set(r.entry_date as string, (dayKcal.get(r.entry_date as string) ?? 0) + k);
  }
  const totalKcal = [...dayKcal.values()].reduce((a, b) => a + b, 0);
  const avg_daily_intake = days_logged > 0 ? totalKcal / days_logged : 0;

  let new_observed_tdee: number | null = null;
  let blended_tdee = old_tdee;
  if (haveTrendData) {
    const daily_delta_kcal = (trend_delta_kg * 7700) / 7;
    new_observed_tdee = trend_delta_kg < 0 ? avg_daily_intake + Math.abs(daily_delta_kcal) : avg_daily_intake - daily_delta_kcal;
    blended_tdee = (weigh_in_count >= 6 && days_logged >= 6)
      ? old_tdee * 0.40 + new_observed_tdee * 0.60
      : old_tdee * 0.70 + new_observed_tdee * 0.30;
  }

  type Decision = "reduce" | "increase" | "hold" | "capped";
  let decision: Decision = "hold";
  let flagReason: string | null = null;
  let confidenceTier: "high" | "medium" | "low" = "low";
  if (days_logged >= 6 && weigh_in_count >= 3) confidenceTier = "high";
  else if (days_logged >= 4 && weigh_in_count >= 2) confidenceTier = "medium";
  else { confidenceTier = "low"; if (days_logged < 3) flagReason = "insufficient_data"; }

  const sex_floor_kcal = p.biological_sex === "male" ? 1500 : p.biological_sex === "female" ? 1200 : 1350;
  const atCalorieFloor = old_target_calories <= sex_floor_kcal * 1.05;
  const abnormalThreshold = atCalorieFloor ? 0.70 : 0.45;
  const abnormal = p.user_marked_abnormal_week_start === week_start_date || (adherence_pct / 100) < abnormalThreshold;
  if (abnormal && p.user_marked_abnormal_week_start !== week_start_date) {
    flagReason = atCalorieFloor ? "floor_aware_low_adherence" : "low_adherence";
  }

  const goal = p.goal || "recomposition";
  const raw_target_calories = blended_tdee * trainingLoadIndex; // direction math replaces the old goalMultiplier
  let new_target_calories = old_target_calories;

  if (abnormal) {
    decision = "hold"; flagReason = "abnormal_week"; confidenceTier = "low"; new_target_calories = old_target_calories;
  } else if (days_logged >= 3 && weigh_in_count >= 2) {
    const targetRatePct = Number(p.target_rate_pct ?? 0.25);
    const targetWeeklyKg = (targetRatePct / 100) * current_weight_kg;
    const lower = targetWeeklyKg * 0.7;
    const upper = targetWeeklyKg * 1.3;

    if (direction === "lose") {
      const observedLossKg = -trend_delta_kg;
      decision = observedLossKg < lower ? (trainingLoadIndex < 0.95 ? "reduce" : "hold")
        : observedLossKg > upper ? "increase" : "hold";
    } else if (direction === "gain") {
      const observedGainKg = trend_delta_kg;
      decision = observedGainKg < lower ? (trainingLoadIndex > 1.0 ? "increase" : "hold")
        : observedGainKg > upper ? "reduce" : "hold";
    } else {
      const deadzone = 1.0;
      const drift = current_weight_kg - Number(p.target_weight_kg ?? current_weight_kg);
      decision = Math.abs(drift) <= deadzone ? "hold" : drift > 0 ? "reduce" : "increase";
    }

    const sex_floor = p.biological_sex === "male" ? 1500 : p.biological_sex === "female" ? 1200 : 1350;
    const weight_floor = current_weight_kg * 10;
    const floor = direction === "lose" ? Math.max(weight_floor, sex_floor) : blended_tdee * 0.95;
    const ceiling = direction === "gain" ? blended_tdee * 1.2 : direction === "maintain" ? blended_tdee * 1.05 : blended_tdee * 0.95;

    if (raw_target_calories < floor) { new_target_calories = Math.ceil(floor); decision = "capped"; flagReason = "deficit_capped_for_safety"; }
    else if (raw_target_calories > ceiling) { new_target_calories = Math.ceil(ceiling); decision = "capped"; }
    else { new_target_calories = Math.ceil(raw_target_calories); }
  }

  // ── Shield modifier override (unchanged logic) ──────────────────────
  let modifierOverrode = false;
  if (!abnormal && days_logged >= 3 && weigh_in_count >= 2) {
    if (latestModifier === "deficit_caution" && (decision === "reduce" || decision === "capped")) {
      if (decision === "reduce" || (decision === "capped" && new_target_calories < old_target_calories)) {
        decision = "hold"; new_target_calories = old_target_calories; modifierOverrode = true;
        if (!flagReason) flagReason = "deficit_caution_override";
      }
    } else if (latestModifier === "fuel_more") {
      if (decision === "reduce" || (decision === "capped" && new_target_calories < old_target_calories)) {
        decision = "hold"; new_target_calories = old_target_calories; modifierOverrode = true;
        if (!flagReason) flagReason = "fuel_more_override";
      } else if (decision === "hold" && direction !== "lose" && trend_delta_kg < 0.5) {
        decision = "increase";
        const _ceiling = direction === "gain" ? blended_tdee * 1.2 : blended_tdee * 1.05;
        const bumped = Math.max(raw_target_calories, old_target_calories + 100);
        new_target_calories = Math.ceil(Math.min(_ceiling, bumped));
        modifierOverrode = true;
        if (!flagReason) flagReason = "fuel_more_override";
      }
    }
  }

  const adjustment_kcal_raw = Math.ceil(raw_target_calories) - old_target_calories;
  if (direction === "gain" && decision === "reduce" && adherence_pct < 75 && adjustment_kcal_raw < 0) {
    decision = "hold"; flagReason = "low_adherence_muscle_gain"; new_target_calories = old_target_calories;
  }

  const { data: priorDeficitRows } = await supa
    .from("nutrition_weekly_reviews").select("id, adjustment_kcal")
    .eq("user_id", user_id).lt("week_start_date", week_start_date)
    .order("week_start_date", { ascending: false }).limit(8);
  let consecutiveDeficitWeeks = 0;
  for (const row of priorDeficitRows ?? []) {
    if (Number(row.adjustment_kcal ?? 0) < 0) consecutiveDeficitWeeks++;
    else break;
  }
  const refeedCandidate = direction === "lose" && (
    (consecutiveDeficitWeeks >= 8 && atCalorieFloor) ||
    (consecutiveDeficitWeeks >= 4 && atCalorieFloor && old_target_calories <= sex_floor_kcal * 1.02)
  );
  if (refeedCandidate && !flagReason) flagReason = "refeed_candidate";

  // ── Goal-reached detection (new) ─────────────────────────────────────
  if (direction !== "maintain" && p.reached_target_at == null && p.target_weight_kg != null) {
    const distanceToTarget = Math.abs(current_weight_kg - Number(p.target_weight_kg));
    if (distanceToTarget <= 1.0) {
      await supa.from("profiles").update({ reached_target_at: new Date().toISOString() }).eq("user_id", user_id);
      if (!flagReason) flagReason = "target_reached";
    }
  }

  const adjustment_kcal = new_target_calories - (old_target_calories || blended_tdee);
  const shouldApply = decision !== "hold" && confidenceTier !== "low" && !abnormal;

  const directInsertReview = async (overrideFlag?: string | null): Promise<string> => {
    const { data, error } = await supa.from("nutrition_weekly_reviews").insert({
      user_id, week_start_date, week_end_date, weigh_in_count, days_logged, adherence_pct,
      eligible: days_logged >= 3, confidence_tier: confidenceTier, abnormal_week: abnormal,
      old_target_calories: old_target_calories || null, old_observed_tdee, new_observed_tdee, blended_tdee,
      raw_target_calories, new_target_calories, adjustment_kcal, training_load_index: trainingLoadIndex,
      weekly_sets_avg: weeklySetAvg, avg_strain_value: avgStrain, decision,
      flag_reason: overrideFlag ?? flagReason, applied_target_id: null, applied_at: null, timezone_used: tz,
      weight_trend_kg_per_week: trend_delta_kg, consecutive_deficit_weeks: consecutiveDeficitWeeks,
      applied_modifier: latestModifier, modifier_overrode_decision: modifierOverrode,
    }).select("id").single();
    if (error || !data) throw new Error(`review_insert_failed: ${error?.message ?? "no row returned"}`);
    return data.id as string;
  };

  if (shouldApply) {
    const reviewId = await directInsertReview();
    const { data: appliedTargetId, error: rpcErr } = await supa.rpc("apply_existing_weekly_macro_review", {
      p_review_id: reviewId, p_effective_start_date: new_effective_start_date,
    });
    if (rpcErr) throw new Error(`apply_rpc_failed: ${rpcErr.message}`);
    return { user_id, status: "adjusted", decision, flag_reason: flagReason, applied_target_id: (appliedTargetId as string | null) ?? null, applied_modifier: latestModifier, modifier_overrode_decision: modifierOverrode };
  }
  await directInsertReview();
  return { user_id, status: decision === "hold" || decision === "capped" ? "hold" : "adjusted", decision, flag_reason: flagReason, applied_modifier: latestModifier, modifier_overrode_decision: modifierOverrode };
}
