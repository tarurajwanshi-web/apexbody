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

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
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
  const week_start_date = userLocalMonday(tz);
  const week_end_date = addDays(week_start_date, 6);
  const window_end_exclusive = addDays(week_start_date, 7);

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

  // Step 4: abnormal week
  if (p.user_marked_abnormal_week_start === week_start_date) {
    await supa.from("nutrition_weekly_reviews").insert({
      user_id: p.user_id,
      week_start_date, week_end_date,
      weigh_in_count, days_logged, adherence_pct,
      eligible: false, abnormal_week: true,
      old_target_calories,
      old_observed_tdee,
      adjustment_kcal: 0,
      decision: "hold",
      flag_reason: "abnormal_week",
      timezone_used: tz,
    });
    return { user_id: p.user_id, status: "hold", decision: "hold", flag_reason: "abnormal_week" };
  }

  // eligibility
  const eligible = weigh_in_count >= 4 && days_logged >= 5 && adherence_pct >= 70;
  if (!eligible) {
    await supa.from("nutrition_weekly_reviews").insert({
      user_id: p.user_id,
      week_start_date, week_end_date,
      weigh_in_count, days_logged, adherence_pct,
      eligible: false, abnormal_week: false,
      old_target_calories,
      old_observed_tdee,
      adjustment_kcal: 0,
      decision: "hold",
      flag_reason: "insufficient_data",
      timezone_used: tz,
    });
    return { user_id: p.user_id, status: "hold", decision: "hold", flag_reason: "insufficient_data" };
  }

  // Step 5: observed TDEE via trend weight
  const sortedDates = [...dailyWeights.keys()].sort();
  const windowSize = weigh_in_count >= 6 ? 3 : 2;
  const startSlice = sortedDates.slice(0, windowSize).map(d => dailyWeights.get(d)!);
  const endSlice = sortedDates.slice(-windowSize).map(d => dailyWeights.get(d)!);
  const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
  const smoothed_start = avg(startSlice);
  const smoothed_end = avg(endSlice);
  const trend_delta_kg = smoothed_end - smoothed_start;

  // avg daily intake from shield_nutrition_logs — need calories per log
  // shield_nutrition_logs doesn't store calories directly, so we pull from
  // a calories column if present, otherwise estimate via the score table.
  // For Module 5 MVP we assume calories live on the logs row as `total_kcal`
  // if available; fallback to 0 (which will be filtered out and treated as
  // insufficient_data on a downstream pass).
  const { data: kcalRows } = await supa
    .from("shield_nutrition_logs")
    .select("entry_date, estimated_calories, calorie_estimate_status")
    .eq("user_id", p.user_id)
    .eq("deleted", false)
    .eq("calorie_estimate_status", "estimated")
    .gte("entry_date", week_start_date)
    .lt("entry_date", window_end_exclusive);
  // Sum kcal per local day, then average over days_logged
  const dayKcal = new Map<string, number>();
  for (const r of kcalRows ?? []) {
    const k = Number((r as { estimated_calories?: number | string | null }).estimated_calories ?? 0);
    if (!isFinite(k) || k <= 0) continue;
    dayKcal.set(r.entry_date as string, (dayKcal.get(r.entry_date as string) ?? 0) + k);
  }
  const totalKcal = [...dayKcal.values()].reduce((a, b) => a + b, 0);
  const avg_daily_intake = days_logged > 0 ? totalKcal / days_logged : 0;

  let observed_tdee: number;
  if (trend_delta_kg < 0) {
    const daily_deficit = (Math.abs(trend_delta_kg) * 7700) / 7;
    observed_tdee = avg_daily_intake + daily_deficit;
  } else {
    const daily_surplus = (trend_delta_kg * 7700) / 7;
    observed_tdee = avg_daily_intake - daily_surplus;
  }
  const new_observed_tdee = observed_tdee;

  // Step 6: confidence + blended TDEE
  let confidence_tier: "high" | "medium";
  let blended_tdee: number;
  if (weigh_in_count >= 6 && days_logged >= 6 && adherence_pct >= 85) {
    confidence_tier = "high";
    blended_tdee = old_tdee * 0.40 + observed_tdee * 0.60;
  } else {
    confidence_tier = "medium";
    blended_tdee = old_tdee * 0.70 + observed_tdee * 0.30;
  }

  // Step 7: raw target
  let raw_target_calories = blended_tdee * goalMultiplier(p.goal);

  // Step 8a: deficit cap
  const max_deficit = Math.min(blended_tdee * 0.25, 750);
  if (blended_tdee - raw_target_calories > max_deficit) {
    raw_target_calories = blended_tdee - max_deficit;
  }

  // Step 8b: safety floor
  const protein_floor_kcal = current_weight_kg * 1.6 * 4;
  const fat_floor_kcal = current_weight_kg * 0.6 * 9;
  const carb_floor_kcal = 50 * 4;
  const macro_floor = protein_floor_kcal + fat_floor_kcal + carb_floor_kcal;
  const sex_floor = p.biological_sex === "male" ? 1500 : 1200;
  const minimum_calories = Math.max(old_bmr, sex_floor, macro_floor);

  let floor_capped = false;
  if (raw_target_calories < minimum_calories) {
    floor_capped = true;
    raw_target_calories = minimum_calories;
  }

  // Step 8c: weekly adjustment cap
  let new_target_calories: number;
  let clamped_adjustment = 0;
  if (old_target_calories < minimum_calories) {
    new_target_calories = minimum_calories;
    floor_capped = true;
  } else {
    const proposed = raw_target_calories - old_target_calories;
    const weekly_cap = confidence_tier === "high" ? 250 : 150;
    clamped_adjustment = Math.max(-weekly_cap, Math.min(weekly_cap, proposed));
    new_target_calories = old_target_calories + clamped_adjustment;
  }
  const adjustment_kcal = new_target_calories - old_target_calories;

  // Step 9: decision label
  let decision: "reduce" | "increase" | "hold" | "capped";
  let flag_reason: string | null = null;
  if (floor_capped) {
    decision = "capped";
    flag_reason = "deficit_capped_for_safety";
  } else if (clamped_adjustment < 0) {
    decision = "reduce";
  } else if (clamped_adjustment > 0) {
    decision = "increase";
  } else {
    decision = "hold";
  }

  // Step 10: write via RPC (transactional)
  if (decision === "hold") {
    // Hold from a zero-net adjustment after math — still record the review,
    // no target change.
    await supa.from("nutrition_weekly_reviews").insert({
      user_id: p.user_id,
      week_start_date, week_end_date,
      weigh_in_count, days_logged, adherence_pct,
      eligible: true, abnormal_week: false, confidence_tier,
      old_target_calories, old_observed_tdee, new_observed_tdee,
      blended_tdee, raw_target_calories, new_target_calories,
      adjustment_kcal: 0,
      decision: "hold",
      flag_reason: null,
      timezone_used: tz,
    });
    return { user_id: p.user_id, status: "hold", decision: "hold" };
  }

  // Generate the review_id app-side so the RPC can use it to link the new target.
  const review_id = crypto.randomUUID();
  const macros = recomputeMacros(new_target_calories, current_weight_kg, p.goal);

  const { error: rpcErr } = await supa.rpc("apply_weekly_macro_review", {
    p_review_id: review_id,
    p_user_id: p.user_id,
    p_week_start_date: week_start_date,
    p_week_end_date: week_end_date,
    p_effective_start_date: week_start_date,
    p_weigh_in_count: weigh_in_count,
    p_days_logged: days_logged,
    p_adherence_pct: adherence_pct,
    p_eligible: true,
    p_confidence_tier: confidence_tier,
    p_abnormal_week: false,
    p_old_target_calories: old_target_calories,
    p_old_observed_tdee: old_observed_tdee,
    p_new_observed_tdee: new_observed_tdee,
    p_blended_tdee: blended_tdee,
    p_raw_target_calories: raw_target_calories,
    p_new_target_calories: new_target_calories,
    p_adjustment_kcal: adjustment_kcal,
    p_decision: decision,
    p_flag_reason: flag_reason,
    p_timezone_used: tz,
    p_bmr: old_bmr,
    p_target_protein_g: macros.target_protein_g,
    p_target_carbs_g: macros.target_carbs_g,
    p_target_fat_g: macros.target_fat_g,
  });
  if (rpcErr) {
    return { user_id: p.user_id, status: "error", error: rpcErr.message };
  }
  return { user_id: p.user_id, status: "adjusted", decision, flag_reason };
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
