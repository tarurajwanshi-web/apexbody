// calculate-macros-weekly — Adaptive Macro Engine (Module 5)
//
// Runs once per week (Mon 13:00 UTC via pg_cron). For each profile:
//   1. Compute the user-local Monday→Sunday window (profiles.timezone).
//   2. Skip if a nutrition_weekly_reviews row already exists for that (user, week_start).
//   3. Reconcile prescribed targets against observed weight trend + intake.
//   4. Either insert a HOLD review row directly, OR call apply_weekly_macro_review
//      RPC to atomically: insert review + close old target + insert new target + link.
//
// Independent of calculate-macros (onboarding) and Shield. Failure here cannot affect
// any other function.

import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { requireInternalSecret, corsAllowHeaders } from "../_shared/authorize.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": corsAllowHeaders,
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};


type Profile = {
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

type WeeklyResult = {
  user_id: string;
  status: "skipped" | "hold" | "adjusted" | "error";
  decision?: string;
  flag_reason?: string | null;
  error?: string;
};

// ── time helpers ────────────────────────────────────────────────────────────

/** Compute the user-local Monday (date) for "now" in IANA tz. */
function userLocalMonday(tz: string, now: Date = new Date()): string {
  // Format the current instant as YYYY-MM-DD in the user's local tz.
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric", month: "2-digit", day: "2-digit",
  });
  const parts = fmt.formatToParts(now);
  const get = (t: string) => parts.find(p => p.type === t)!.value;
  const localDateStr = `${get("year")}-${get("month")}-${get("day")}`;
  // Derive ISO weekday from the local date (Sun=0..Sat=6 in JS; Mon-anchored
  // index = (jsDay+6)%7 so Mon→0, Tue→1, ..., Sun→6).
  const d = new Date(`${localDateStr}T00:00:00Z`);
  const dayIdx = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - dayIdx);
  return d.toISOString().slice(0, 10);
}

function addDays(isoDate: string, days: number): string {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Convert a UTC timestamp ISO string to the user-local YYYY-MM-DD. */
function tsToLocalDate(tsIso: string, tz: string): string {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit",
  });
  const parts = fmt.formatToParts(new Date(tsIso));
  const get = (t: string) => parts.find(p => p.type === t)!.value;
  return `${get("year")}-${get("month")}-${get("day")}`;
}

// ── nutrition math ──────────────────────────────────────────────────────────

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

// ── per-user processing ─────────────────────────────────────────────────────

async function processUser(supa: SupabaseClient, p: Profile, force: boolean): Promise<WeeklyResult> {
  const tz = p.timezone || "Asia/Dubai";
  // Audit #1 fix: the cron runs Monday 13:00 UTC, which is AFTER local-Monday
  // 00:00 in every supported timezone. userLocalMonday() therefore returns
  // the Monday that just BEGAN. We want to review the week that just ENDED.
  //   review window:  [prior Monday, prior Sunday]   (7 days, the week we evaluate)
  //   new target activates today (current local Monday)
  const current_week_start_date = userLocalMonday(tz);
  const week_start_date = addDays(current_week_start_date, -7);   // prior Monday (review window start, inclusive)
  const week_end_date = addDays(current_week_start_date, -1);     // prior Sunday (review window end, inclusive)
  const window_end_exclusive = current_week_start_date;            // exclusive upper bound for all data queries
  const new_effective_start_date = current_week_start_date;        // new target activates today

  // Step 1: idempotency
  if (!force) {
    const { data: existing } = await supa
      .from("nutrition_weekly_reviews")
      .select("id")
      .eq("user_id", p.user_id)
      .eq("week_start_date", week_start_date)
      .maybeSingle();
    if (existing) return { user_id: p.user_id, status: "skipped" };
  }

  // Helper for HOLD-path direct insert
  const insertHold = async (flag_reason: string, eligible: boolean, abnormal: boolean) => {
    await supa.from("nutrition_weekly_reviews").insert({
      user_id: p.user_id,
      week_start_date, week_end_date,
      weigh_in_count: 0, days_logged: 0, adherence_pct: 0,
      eligible, abnormal_week: abnormal,
      adjustment_kcal: 0,
      decision: "hold",
      flag_reason,
      timezone_used: tz,
    });
    return { user_id: p.user_id, status: "hold" as const, decision: "hold", flag_reason };
  };

  // Step 2: active target + required profile data
  const { data: activeRows, error: activeErr } = await supa
    .from("daily_macro_targets")
    .select("id, bmr, tdee, target_calories, formula_used")
    .eq("user_id", p.user_id)
    .is("effective_end_date", null);
  if (activeErr) return { user_id: p.user_id, status: "error", error: activeErr.message };
  if (!activeRows || activeRows.length === 0) {
    return insertHold("missing_required_profile_data", false, false);
  }
  if (activeRows.length > 1) {
    // Data-integrity lock — don't apply changes
    return { user_id: p.user_id, status: "error",
      error: `data_integrity: ${activeRows.length} active macro targets` };
  }
  const active = activeRows[0];
  const old_tdee = Number(active.tdee);
  const old_target_calories = Number(active.target_calories);
  const old_bmr = Number(active.bmr);

  // required profile fields
  if (!p.biological_sex || !p.goal || !p.age) {
    return insertHold("missing_required_profile_data", false, false);
  }

  // prior week's observed tdee
  const { data: prior } = await supa
    .from("nutrition_weekly_reviews")
    .select("new_observed_tdee")
    .eq("user_id", p.user_id)
    .lt("week_start_date", week_start_date)
    .order("week_start_date", { ascending: false })
    .limit(1)
    .maybeSingle();
  const old_observed_tdee: number | null = prior?.new_observed_tdee ?? null;

  // Step 3: weigh-ins → one per local date
  const { data: weighs } = await supa
    .from("body_measurement_events")
    .select("entry_date, weight_kg, created_at")
    .eq("user_id", p.user_id)
    .not("weight_kg", "is", null)
    .gte("entry_date", week_start_date)
    .lt("entry_date", window_end_exclusive)
    .order("created_at", { ascending: false });

  const dailyWeights = new Map<string, number>(); // date → latest weight
  for (const w of weighs ?? []) {
    if (!dailyWeights.has(w.entry_date)) {
      dailyWeights.set(w.entry_date, Number(w.weight_kg));
    }
  }
  const weigh_in_count = dailyWeights.size;

  // nutrition days logged (distinct local dates)
  const { data: logs } = await supa
    .from("shield_nutrition_logs")
    .select("created_at, entry_date")
    .eq("user_id", p.user_id)
    .eq("deleted", false)
    .gte("entry_date", week_start_date)
    .lt("entry_date", window_end_exclusive);
  const localDays = new Set<string>();
  for (const l of logs ?? []) {
    // Prefer entry_date (already a local-ish date column); fall back to created_at→tz
    const d = l.entry_date ?? tsToLocalDate(l.created_at as string, tz);
    if (d >= week_start_date && d < window_end_exclusive) localDays.add(d);
  }
  const days_logged = localDays.size;
  const adherence_pct = (days_logged / 7) * 100;

  // current_weight_kg fallback chain
  let current_weight_kg: number | null = null;
  if (dailyWeights.size > 0) {
    // Take the latest entry_date in window
    const latestDate = [...dailyWeights.keys()].sort().pop()!;
    current_weight_kg = dailyWeights.get(latestDate)!;
  }
  if (current_weight_kg == null) {
    const { data: anyW } = await supa
      .from("body_measurement_events")
      .select("weight_kg")
      .eq("user_id", p.user_id)
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

  // ── Training load metrics ────────────────────────────────────────────────
  const { data: workoutSets, error: setError } = await supa
    .from("workout_set_logs")
    .select("strain_value")
    .eq("user_id", p.user_id)
    .gte("entry_date", week_start_date)
    .lt("entry_date", window_end_exclusive);
  if (setError) console.error("[calculate-macros-weekly] workout sets fetch failed", setError);

  const totalSets = workoutSets?.length ?? 0;
  const avgStrain = workoutSets && workoutSets.length > 0
    ? workoutSets.reduce((sum, s) => sum + Number(s.strain_value ?? 0), 0) / workoutSets.length
    : 0;

  let trainingLoadIndex = 1.0;
  if (totalSets < 10) trainingLoadIndex = 0.85;
  else if (totalSets < 20) trainingLoadIndex = 1.0;
  else if (totalSets < 30) trainingLoadIndex = 1.1;
  else trainingLoadIndex = 1.15;

  const { data: readinessDays, error: readinessError } = await supa
    .from("readiness_scores")
    .select("final_score")
    .eq("user_id", p.user_id)
    .gte("score_date", week_start_date)
    .lt("score_date", window_end_exclusive);
  if (readinessError) console.error("[calculate-macros-weekly] readiness fetch failed", readinessError);

  const avgReadiness = readinessDays && readinessDays.length > 0
    ? readinessDays.reduce((sum, r) => sum + Number(r.final_score ?? 0), 0) / readinessDays.length
    : 50;

  if (avgReadiness < 45 && trainingLoadIndex > 1.0) {
    trainingLoadIndex = Math.max(0.85, trainingLoadIndex * 0.85);
  }
  trainingLoadIndex = Math.max(0.7, Math.min(1.3, trainingLoadIndex));
  const weeklySetAvg = totalSets / 7;

  // ── Observed TDEE (from trend + intake) ──────────────────────────────────
  const haveTrendData = weigh_in_count >= 2 && days_logged >= 1;
  let new_observed_tdee: number | null = null;
  let blended_tdee = old_tdee;
  let trend_delta_kg = 0;

  if (haveTrendData) {
    const sortedDates = [...dailyWeights.keys()].sort();
    const windowSize = weigh_in_count >= 6 ? 3 : Math.min(2, weigh_in_count);
    const startSlice = sortedDates.slice(0, windowSize).map(d => dailyWeights.get(d)!);
    const endSlice = sortedDates.slice(-windowSize).map(d => dailyWeights.get(d)!);
    const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
    trend_delta_kg = avg(endSlice) - avg(startSlice);

    const { data: kcalRows } = await supa
      .from("shield_nutrition_logs")
      .select("entry_date, estimated_calories, calorie_estimate_status")
      .eq("user_id", p.user_id)
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

  // ── Decision + confidence ────────────────────────────────────────────────
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

  const abnormal = p.user_marked_abnormal_week_start === week_start_date;
  const goal = p.goal || "recomposition";
  const weightTrendPerWeek = trend_delta_kg;
  let raw_target_calories = blended_tdee * goalMultiplier(goal) * trainingLoadIndex;
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

  const adjustment_kcal = new_target_calories - (old_target_calories || blended_tdee);

  await supa.from("nutrition_weekly_reviews").insert({
    user_id: p.user_id,
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
    decision,
    flag_reason: flagReason,
    applied_target_id: null,
    applied_at: null,
    timezone_used: tz,
  });

  return {
    user_id: p.user_id,
    status: decision === "hold" || decision === "capped" ? "hold" : "adjusted",
    decision,
    flag_reason: flagReason,
  };
}

// ── HTTP entry ──────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });

  const url = Deno.env.get("SUPABASE_URL")!;
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supa = createClient(url, key);

  let body: { user_id?: string; force_recalculate?: boolean } = {};
  try { body = await req.json(); } catch { /* empty body OK for cron */ }
  const force = body.force_recalculate === true;

  // Audit #2 spec: this function is internal-only (DB cron / dispatch).
  // Reject any request lacking a valid x-internal-secret header — NO JWT
  // fallback, even for force_recalculate by a signed-in user. If a manual
  // re-run is needed, dispatch through the DB layer (which forwards the
  // secret) rather than calling the edge function directly.
  const authz = await requireInternalSecret(req, supa);
  if (!authz.ok) {
    return new Response(JSON.stringify({ error: authz.error }), {
      status: authz.status, headers: { ...cors, "Content-Type": "application/json" },
    });
  }


  let profiles: Profile[];
  try {
    if (body.user_id) {
      const { data, error } = await supa
        .from("profiles")
        .select("user_id, timezone, goal, biological_sex, age, measurement_height_cm, measurement_weight_kg, body_data_type, dexa_lean_mass_kg, user_marked_abnormal_week_start")
        .eq("user_id", body.user_id);
      if (error) throw error;
      profiles = (data ?? []) as Profile[];
    } else {
      const { data, error } = await supa
        .from("profiles")
        .select("user_id, timezone, goal, biological_sex, age, measurement_height_cm, measurement_weight_kg, body_data_type, dexa_lean_mass_kg, user_marked_abnormal_week_start")
        .not("profile_completed_at", "is", null);
      if (error) throw error;
      profiles = (data ?? []) as Profile[];
    }
  } catch (e) {
    return new Response(
      JSON.stringify({ ok: false, error: String(e instanceof Error ? e.message : e) }),
      { status: 500, headers: { ...cors, "Content-Type": "application/json" } },
    );
  }

  const results: WeeklyResult[] = [];
  for (const p of profiles) {
    try {
      results.push(await processUser(supa, p, force));
    } catch (e) {
      results.push({
        user_id: p.user_id, status: "error",
        error: String(e instanceof Error ? e.message : e),
      });
    }
  }

  return new Response(
    JSON.stringify({
      ok: true,
      processed: results.length,
      summary: results.reduce<Record<string, number>>((acc, r) => {
        acc[r.status] = (acc[r.status] ?? 0) + 1;
        return acc;
      }, {}),
      results,
    }),
    { headers: { ...cors, "Content-Type": "application/json" } },
  );
});
