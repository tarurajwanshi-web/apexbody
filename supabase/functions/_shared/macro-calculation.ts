// Shared adaptive macro calculation engine.
//
// Pure function library — no Deno.serve, no createClient. Callers inject an
// authenticated SupabaseClient (service-role) and optionally `now`.
//
// Two entry points use this:
//   - calculate-macros-weekly (Monday 13:00 UTC cron, all users)
//   - trigger-weekly-macro-review (HTTP, single user, Monday 00:00 user-local)

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { addDays, tsToLocalDate, userLocalMonday } from "./time-helpers.ts";

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
};

export type NutritionModifier =
  | "recovery_day_refeed"
  | "hydration_priority"
  | "protein_priority"
  | "deficit_caution"
  | "fuel_more"
  | "normal";

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

export type CalculateOptions = {
  /** Skip the idempotency check (re-run an already-reviewed week). */
  force?: boolean;
};

// ── nutrition math ─────────────────────────────────────────────────────────

function goalMultiplier(goal: string | null | undefined): number {
  switch (goal) {
    case "fat_loss": return 0.80;
    case "muscle_gain": return 1.10;
    case "strength": return 1.05;
    case "recomposition": return 1.0;
    case "athletic_performance": return 1.0;
    default: return 1.0;
  }
}

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

// ── per-user processing ────────────────────────────────────────────────────

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

  // Review window: prior Mon→Sun, new target activates today's local Monday.
  const current_week_start_date = userLocalMonday(tz, now);
  const week_start_date = addDays(current_week_start_date, -7);
  const week_end_date = addDays(current_week_start_date, -1);
  const window_end_exclusive = current_week_start_date;
  const new_effective_start_date = current_week_start_date;

  // Step 1: idempotency
  if (!force) {
    const { data: existing } = await supa
      .from("nutrition_weekly_reviews")
      .select("id")
      .eq("user_id", user_id)
      .eq("week_start_date", week_start_date)
      .maybeSingle();
    if (existing) {
      throw new Error(`review_exists:${week_start_date}`);
    }
  }

  const insertHold = async (
    flag_reason: string,
    eligible: boolean,
    abnormal: boolean,
  ): Promise<CalculationResult> => {
    await supa.from("nutrition_weekly_reviews").insert({
      user_id,
      week_start_date, week_end_date,
      weigh_in_count: 0, days_logged: 0, adherence_pct: 0,
      eligible, abnormal_week: abnormal,
      adjustment_kcal: 0,
      decision: "hold",
      flag_reason,
      timezone_used: tz,
    });
    return { user_id, status: "hold", decision: "hold", flag_reason };
  };

  // Step 2: active target + required profile data
  const { data: activeRows, error: activeErr } = await supa
    .from("daily_macro_targets")
    .select("id, bmr, tdee, target_calories, formula_used")
    .eq("user_id", user_id)
    .is("effective_end_date", null);
  if (activeErr) throw activeErr;
  if (!activeRows || activeRows.length === 0) {
    return insertHold("missing_required_profile_data", false, false);
  }
  if (activeRows.length > 1) {
    throw new Error(`data_integrity: ${activeRows.length} active macro targets`);
  }
  const active = activeRows[0];
  const old_tdee = Number(active.tdee);
  const old_target_calories = Number(active.target_calories);
  const old_bmr = Number(active.bmr);

  if (!p.biological_sex || !p.goal || !p.age) {
    return insertHold("missing_required_profile_data", false, false);
  }

  // prior week's observed tdee
  const { data: prior } = await supa
    .from("nutrition_weekly_reviews")
    .select("new_observed_tdee")
    .eq("user_id", user_id)
    .lt("week_start_date", week_start_date)
    .order("week_start_date", { ascending: false })
    .limit(1)
    .maybeSingle();
  const old_observed_tdee: number | null = prior?.new_observed_tdee ?? null;

  // Step 3: weigh-ins → one per local date
  const { data: weighs } = await supa
    .from("body_measurement_events")
    .select("entry_date, weight_kg, created_at")
    .eq("user_id", user_id)
    .not("weight_kg", "is", null)
    .gte("entry_date", week_start_date)
    .lt("entry_date", window_end_exclusive)
    .order("created_at", { ascending: false });

  const dailyWeights = new Map<string, number>();
  for (const w of weighs ?? []) {
    if (!dailyWeights.has(w.entry_date)) {
      dailyWeights.set(w.entry_date, Number(w.weight_kg));
    }
  }
  const weigh_in_count = dailyWeights.size;

  const { data: logs } = await supa
    .from("shield_nutrition_logs")
    .select("created_at, entry_date")
    .eq("user_id", user_id)
    .eq("deleted", false)
    .gte("entry_date", week_start_date)
    .lt("entry_date", window_end_exclusive);
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
      .from("body_measurement_events")
      .select("weight_kg")
      .eq("user_id", user_id)
      .not("weight_kg", "is", null)
      .order("entry_date", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (anyW?.weight_kg != null) current_weight_kg = Number(anyW.weight_kg);
  }
  if (current_weight_kg == null && p.measurement_weight_kg != null) {
    current_weight_kg = Number(p.measurement_weight_kg);
  }
  if (current_weight_kg == null) {
    return insertHold("missing_required_profile_data", false, false);
  }

  // ── Training load metrics ───────────────────────────────────────────────
  const { data: workoutSets, error: setError } = await supa
    .from("workout_set_logs")
    .select("id")
    .eq("user_id", user_id)
    .gte("entry_date", week_start_date)
    .lt("entry_date", window_end_exclusive);
  if (setError) console.error("[calculateMacrosForUser] workout sets fetch failed", setError);

  const totalSets = workoutSets?.length ?? 0;

  // Strain lives on shield_training_logs, not workout_set_logs.
  const { data: trainingLogs, error: trainErr } = await supa
    .from("shield_training_logs")
    .select("strain_value")
    .eq("user_id", user_id)
    .gte("entry_date", week_start_date)
    .lt("entry_date", window_end_exclusive);
  if (trainErr) console.error("[calculateMacrosForUser] training logs fetch failed", trainErr);

  const avgStrain = trainingLogs && trainingLogs.length > 0
    ? trainingLogs.reduce((sum, t) => sum + Number(t.strain_value ?? 0), 0) / trainingLogs.length
    : 0;

  let trainingLoadIndex = 1.0;
  if (totalSets < 10) trainingLoadIndex = 0.85;
  else if (totalSets < 20) trainingLoadIndex = 1.0;
  else if (totalSets < 30) trainingLoadIndex = 1.1;
  else trainingLoadIndex = 1.15;

  if (avgStrain >= 14) trainingLoadIndex += 0.1;
  else if (avgStrain > 0 && avgStrain < 6) trainingLoadIndex -= 0.1;

  const { data: readinessDays, error: readinessError } = await supa
    .from("readiness_scores")
    .select("final_score, nutrition_modifier, training_permission, score_date")
    .eq("user_id", user_id)
    .gte("score_date", week_start_date)
    .lt("score_date", window_end_exclusive)
    .order("score_date", { ascending: false });
  if (readinessError) console.error("[calculateMacrosForUser] readiness fetch failed", readinessError);

  const avgReadiness = readinessDays && readinessDays.length > 0
    ? readinessDays.reduce((sum, r) => sum + Number(r.final_score ?? 0), 0) / readinessDays.length
    : 50;

  // Most recent modifier at compute time — unbounded by the review window.
  // Matches generate-plan's semantics and the E1 "same-day directive" spec:
  // a modifier issued after the reviewed week (e.g. today) still applies.
  const { data: latestModifierRow } = await supa
    .from("readiness_scores")
    .select("nutrition_modifier, score_date")
    .eq("user_id", user_id)
    .order("score_date", { ascending: false })
    .limit(1)
    .maybeSingle();
  const latestModifier = (latestModifierRow?.nutrition_modifier ?? null) as NutritionModifier | null;

  if (avgReadiness < 45 && trainingLoadIndex > 1.0) {
    trainingLoadIndex = Math.max(0.85, trainingLoadIndex * 0.85);
  }
  trainingLoadIndex = Math.max(0.7, Math.min(1.3, trainingLoadIndex));
  const weeklySetAvg = totalSets / 7;

  // ── Observed TDEE (from trend + intake) ─────────────────────────────────
  const haveTrendData = weigh_in_count >= 2 && days_logged >= 1;
  let new_observed_tdee: number | null = null;
  let blended_tdee = old_tdee;
  let trend_delta_kg = 0;

  if (haveTrendData) {
    const sortedDates = [...dailyWeights.keys()].sort();
    const windowSize = weigh_in_count >= 6 ? 3 : Math.min(2, weigh_in_count);
    const startSlice = sortedDates.slice(0, windowSize).map((d) => dailyWeights.get(d)!);
    const endSlice = sortedDates.slice(-windowSize).map((d) => dailyWeights.get(d)!);
    const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
    trend_delta_kg = avg(endSlice) - avg(startSlice);

    const { data: kcalRows } = await supa
      .from("shield_nutrition_logs")
      .select("entry_date, estimated_calories, calorie_estimate_status")
      .eq("user_id", user_id)
      .eq("deleted", false)
      .in("calorie_estimate_status", ["estimated", "manual_edited"])
      .gte("entry_date", week_start_date)
      .lt("entry_date", window_end_exclusive);
    const dayKcal = new Map<string, number>();
    for (const r of kcalRows ?? []) {
      const k = Number((r as { estimated_calories?: number | string | null }).estimated_calories ?? 0);
      if (!isFinite(k) || k <= 0) continue;
      dayKcal.set(r.entry_date as string, (dayKcal.get(r.entry_date as string) ?? 0) + k);
    }
    const totalKcal = [...dayKcal.values()].reduce((a, b) => a + b, 0);
    const avg_daily_intake = days_logged > 0 ? totalKcal / days_logged : 0;

    const daily_delta_kcal = (trend_delta_kg * 7700) / 7;
    new_observed_tdee = trend_delta_kg < 0
      ? avg_daily_intake + Math.abs(daily_delta_kcal)
      : avg_daily_intake - daily_delta_kcal;

    if (weigh_in_count >= 6 && days_logged >= 6) {
      blended_tdee = old_tdee * 0.40 + new_observed_tdee * 0.60;
    } else {
      blended_tdee = old_tdee * 0.70 + new_observed_tdee * 0.30;
    }
  }

  // ── Decision + confidence ───────────────────────────────────────────────
  type Decision = "reduce" | "increase" | "hold" | "capped";
  let decision: Decision = "hold";
  let flagReason: string | null = null;
  let confidenceTier: "high" | "medium" | "low" = "low";

  if (days_logged >= 6 && weigh_in_count >= 3) confidenceTier = "high";
  else if (days_logged >= 4 && weigh_in_count >= 2) confidenceTier = "medium";
  else {
    confidenceTier = "low";
    if (days_logged < 3) flagReason = "insufficient_data";
  }

  // ── Abnormal week detection ───────────────────────────────────────────────
  // Case 1: user explicitly marked this week abnormal in the app.
  // Case 2 (floor-aware): user is at/near calorie floor AND eating <70% of
  //   that minimal target. Prevents engine cutting further on a user who is
  //   under-logging or already in a dangerous deficit. Without this guard,
  //   a 55% adherence user at the 1200 kcal floor receives a −270 kcal
  //   adjustment — derived from poor logging, not genuine TDEE signal.
  //   Normal threshold: 45% adherence triggers hold.
  //   Floor-aware threshold: 70% adherence when already at calorie floor.
  const sex_floor_kcal = p.biological_sex === "male" ? 1500
                       : p.biological_sex === "female" ? 1200
                       : 1350;
  const atCalorieFloor = old_target_calories <= sex_floor_kcal * 1.05;
  const abnormalThreshold = atCalorieFloor ? 0.70 : 0.45;
  const abnormal =
    p.user_marked_abnormal_week_start === week_start_date ||
    (adherence_pct / 100) < abnormalThreshold;
  if (abnormal && p.user_marked_abnormal_week_start !== week_start_date) {
    flagReason = atCalorieFloor
      ? "floor_aware_low_adherence"
      : "low_adherence";
  }
  const goal = p.goal || "recomposition";
  const weightTrendPerWeek = trend_delta_kg;
  const raw_target_calories = blended_tdee * goalMultiplier(goal) * trainingLoadIndex;
  let new_target_calories = old_target_calories;

  if (abnormal) {
    decision = "hold";
    flagReason = "abnormal_week";
    confidenceTier = "low";
    new_target_calories = old_target_calories;
  } else if (days_logged >= 3 && weigh_in_count >= 2) {
    if (goal === "fat_loss") {
      if (weightTrendPerWeek > -0.5) decision = trainingLoadIndex < 0.95 ? "reduce" : "hold";
      else if (weightTrendPerWeek < -1.5) decision = "increase";
      else decision = "hold";
    } else if (goal === "muscle_gain") {
      if (weightTrendPerWeek < 0.2) decision = trainingLoadIndex > 1.0 ? "increase" : "hold";
      else if (weightTrendPerWeek > 1.2) decision = "reduce";
      else decision = "hold";
    } else if (goal === "recomposition") {
      if (weightTrendPerWeek > 0.3) decision = "reduce";
      else if (weightTrendPerWeek < -0.5) decision = "increase";
      else decision = "hold";
    } else if (goal === "strength" || goal === "athletic_performance") {
      if (weightTrendPerWeek < 0.2) decision = trainingLoadIndex > 1.1 ? "increase" : "hold";
      else if (weightTrendPerWeek > 1.0) decision = "reduce";
      else decision = "hold";
    }

    const sex_floor = p.biological_sex === "male" ? 1500
                     : p.biological_sex === "female" ? 1200
                     : 1350;
    const weight_floor = (p.measurement_weight_kg ?? current_weight_kg ?? 70) * 10;
    const safeFloorMap: Record<string, number> = {
      fat_loss: Math.max(weight_floor, sex_floor),
      muscle_gain: blended_tdee * 0.95,
      recomposition: Math.max(blended_tdee * 0.95, sex_floor),
      strength: blended_tdee * 0.95,
      athletic_performance: blended_tdee * 0.95,
    };
    const safeCeilingMap: Record<string, number> = {
      fat_loss: blended_tdee * 0.95,
      muscle_gain: blended_tdee * 1.2,
      recomposition: blended_tdee * 1.05,
      strength: blended_tdee * 1.1,
      athletic_performance: blended_tdee * 1.1,
    };
    const floor = safeFloorMap[goal] ?? safeFloorMap.recomposition;
    const ceiling = safeCeilingMap[goal] ?? safeCeilingMap.recomposition;

    if (raw_target_calories < floor) {
      new_target_calories = Math.ceil(floor);
      decision = "capped";
      flagReason = "deficit_capped_for_safety";
    } else if (raw_target_calories > ceiling) {
      new_target_calories = Math.ceil(ceiling);
      decision = "capped";
    } else {
      new_target_calories = Math.ceil(raw_target_calories);
    }
  } else {
    new_target_calories = old_target_calories;
  }

  // ── Nutrition modifier override (Shield → macro engine) ─────────────────
  // Same-day directive from Shield's readiness_scores.nutrition_modifier.
  // Additive on top of weight-trend decision; never deepens a cut, never
  // overrides higher-priority flags (abnormal_week, insufficient_data, etc).
  let modifierOverrode = false;
  if (!abnormal && days_logged >= 3 && weigh_in_count >= 2) {
    if (latestModifier === "deficit_caution" && (decision === "reduce" || decision === "capped")) {
      // Never deepen a cut on a deficit-caution day.
      if (decision === "reduce" || (decision === "capped" && new_target_calories < old_target_calories)) {
        decision = "hold";
        new_target_calories = old_target_calories;
        modifierOverrode = true;
        if (!flagReason) flagReason = "deficit_caution_override";
      }
    } else if (latestModifier === "fuel_more") {
      if (decision === "reduce" || (decision === "capped" && new_target_calories < old_target_calories)) {
        decision = "hold";
        new_target_calories = old_target_calories;
        modifierOverrode = true;
        if (!flagReason) flagReason = "fuel_more_override";
      } else if (decision === "hold" && goal !== "fat_loss" && trend_delta_kg < 0.5) {
        // Bias hold → increase for non-fat-loss goals with flat/negative trend.
        decision = "increase";
        // Recompute from raw, bounded by existing ceiling for this goal.
        const _ceiling =
          goal === "muscle_gain" ? blended_tdee * 1.2
          : goal === "recomposition" ? blended_tdee * 1.05
          : goal === "strength" || goal === "athletic_performance" ? blended_tdee * 1.1
          : blended_tdee * 1.05;
        const bumped = Math.max(raw_target_calories, old_target_calories + 100);
        new_target_calories = Math.ceil(Math.min(_ceiling, bumped));
        modifierOverrode = true;
        if (!flagReason) flagReason = "fuel_more_override";
      }
    }
  }

  // ── Muscle gain under-eat guard ──────────────────────────────────────────
  // Compute raw adjustment first so the guard can inspect its direction.
  // If a muscle gain user is eating below 75% of their target, the engine
  // would read their low intake as a lower implied TDEE and reduce calories.
  // This is the wrong direction — they need to eat MORE, not less.
  // Override to hold and flag so UI can surface an adherence coaching note.
  const adjustment_kcal_raw = Math.ceil(raw_target_calories) - old_target_calories;
  if (
    goal === "muscle_gain" &&
    decision === "reduce" &&
    adherence_pct < 75 &&
    adjustment_kcal_raw < 0
  ) {
    decision = "hold";
    flagReason = "low_adherence_muscle_gain";
    new_target_calories = old_target_calories;
  }

  // ── Refeed candidate flag ─────────────────────────────────────────────────
  // Floor trigger: 4+ consecutive deficit weeks AND already at calorie floor.
  // Stall is implied — cannot cut further. Sets flag_reason for Engine 4
  // coaching card. Does NOT change new_target_calories. Refeed logic = Phase 2.
  const { data: priorDeficitRows } = await supa
    .from("nutrition_weekly_reviews")
    .select("id, adjustment_kcal")
    .eq("user_id", user_id)
    .lt("week_start_date", week_start_date)
    .order("week_start_date", { ascending: false })
    .limit(8);

  let consecutiveDeficitWeeks = 0;
  for (const row of priorDeficitRows ?? []) {
    if (Number(row.adjustment_kcal ?? 0) < 0) consecutiveDeficitWeeks++;
    else break;
  }

  const refeedCandidate =
    goal === "fat_loss" && (
      (consecutiveDeficitWeeks >= 8 && atCalorieFloor) ||
      (consecutiveDeficitWeeks >= 4 && atCalorieFloor &&
        old_target_calories <= sex_floor_kcal * 1.02)
    );

  if (refeedCandidate && !flagReason) {
    flagReason = "refeed_candidate";
  }

  const adjustment_kcal = new_target_calories - (old_target_calories || blended_tdee);
  const macros = recomputeMacros(new_target_calories, current_weight_kg, goal);
  const shouldApply = decision !== "hold" && confidenceTier !== "low" && !abnormal;

  const directInsertReview = async (overrideFlag?: string | null): Promise<string> => {
    const { data, error } = await supa
      .from("nutrition_weekly_reviews")
      .insert({
        user_id,
        week_start_date,
        week_end_date,
        weigh_in_count,
        days_logged,
        adherence_pct,
        eligible: days_logged >= 3,
        confidence_tier: confidenceTier,
        abnormal_week: abnormal,
        old_target_calories: old_target_calories || null,
        old_observed_tdee,
        new_observed_tdee,
        blended_tdee,
        raw_target_calories,
        new_target_calories,
        adjustment_kcal,
        training_load_index: trainingLoadIndex,
        weekly_sets_avg: weeklySetAvg,
        avg_strain_value: avgStrain,
        // bmr + target_protein_g/carbs_g/fat_g intentionally omitted:
        // those columns live on daily_macro_targets and are populated by
        // the apply_existing_weekly_macro_review RPC, not on the review row.
        decision,
        flag_reason: overrideFlag ?? flagReason,
        applied_target_id: null,
        applied_at: null,
        timezone_used: tz,
        weight_trend_kg_per_week: trend_delta_kg,
        consecutive_deficit_weeks: consecutiveDeficitWeeks,
        applied_modifier: latestModifier,
        modifier_overrode_decision: modifierOverrode,
      })
      .select("id")
      .single();
    if (error || !data) {
      throw new Error(`review_insert_failed: ${error?.message ?? "no row returned"}`);
    }
    return data.id as string;
  };

  if (shouldApply) {
    const reviewId = await directInsertReview();
    const { data: appliedTargetId, error: rpcErr } = await supa.rpc(
      "apply_existing_weekly_macro_review",
      {
        p_review_id: reviewId,
        p_effective_start_date: new_effective_start_date,
      },
    );
    if (rpcErr) {
      throw new Error(`apply_rpc_failed: ${rpcErr.message}`);
    }
    return {
      user_id,
      status: "adjusted",
      decision,
      flag_reason: flagReason,
      applied_target_id: (appliedTargetId as string | null) ?? null,
      applied_modifier: latestModifier,
      modifier_overrode_decision: modifierOverrode,
    };
  }

  await directInsertReview();

  return {
    user_id,
    status: decision === "hold" || decision === "capped" ? "hold" : "adjusted",
    decision,
    flag_reason: flagReason,
    applied_modifier: latestModifier,
    modifier_overrode_decision: modifierOverrode,
  };
}
