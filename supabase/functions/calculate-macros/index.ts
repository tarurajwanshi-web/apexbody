// calculate-macros — evidence-based BMR/TDEE & macro targets.
// Pipeline (see APEX Prompt L for citations):
//   1. BMR via Mifflin-St Jeor (Frankenfield 2005 validated as most accurate
//      predictive equation). Katch-McArdle used only when verified DEXA lean
//      mass is on file, since it's more accurate given known LBM.
//   2. TDEE = BMR × activity multiplier mapped from training_days_per_week
//      using the standard PAL scale (sedentary 1.2 → extra active 1.9).
//   3. Goal adjustment as ABSOLUTE kcal delta (not a flat %): moderate
//      deficits/surpluses scale better across body sizes than multipliers.
//   4. Protein target by g/kg per ISSN Position Stand on Protein & Exercise
//      — higher end of the range during a hypocaloric phase to preserve LBM.
//   5. Fat floor at 0.4 g/kg OR 25% of calories (whichever is higher) for
//      hormonal/EFA health; carbs fill the remaining kcal.
// Input: { user_id }. Upserts into public.daily_macro_targets.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { authorizeCaller, corsAllowHeaders } from "../_shared/authorize.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": corsAllowHeaders,
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

/**
 * Map training_days_per_week → standard PAL multiplier.
 *  0 (or unknown) → sedentary 1.2
 *  1–3            → lightly active 1.375
 *  4–5            → moderately active 1.55
 *  6–7            → very active 1.725
 * (Extra active 1.9 is reserved for "very hard exercise + physical job",
 *  not derivable from training days alone, so we cap at 1.725.)
 */
function activityMult(days: number | null | undefined): number {
  const d = Number(days ?? 0);
  if (!isFinite(d) || d <= 0) return 1.2;
  if (d <= 3) return 1.375;
  if (d <= 5) return 1.55;
  return 1.725;
}

/**
 * Absolute kcal adjustment vs TDEE per stated goal.
 * fat_loss        −400  (middle of ISSN-aligned 300–500 moderate deficit)
 * muscle_gain     +250  (lean surplus; minimizes fat gain)
 * strength        +150  (small surplus to support adaptation)
 * recomposition      0  (eucaloric; protein-first split does the work)
 * athletic_perf      0  (maintenance unless explicitly cutting/bulking)
 */
function goalKcalDelta(goal: string | null | undefined): number {
  switch (goal) {
    case "fat_loss": return -400;
    case "muscle_gain": return 250;
    case "strength": return 150;
    case "recomposition":
    case "athletic_performance":
    default: return 0;
  }
}

/**
 * ISSN-aligned protein target (g/kg bodyweight).
 *  fat_loss (hypocaloric): 2.2  — upper-range to maximise LBM retention
 *  all other goals:        1.8  — within 1.6–2.0 g/kg general range
 */
function proteinPerKg(goal: string | null | undefined): number {
  return goal === "fat_loss" ? 2.2 : 1.8;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });

  const url = Deno.env.get("SUPABASE_URL")!;
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supa = createClient(url, key);

  try {
    const { user_id } = await req.json();
    if (!user_id) {
      return new Response(JSON.stringify({ error: "user_id required" }), {
        status: 400, headers: { ...cors, "Content-Type": "application/json" },
      });
    }
    // Audit #3: caller's JWT user.id must match body.user_id (or internal-secret).
    const authz = await authorizeCaller(req, supa, user_id);
    if (!authz.ok) {
      return new Response(JSON.stringify({ error: authz.error }), {
        status: authz.status, headers: { ...cors, "Content-Type": "application/json" },
      });
    }
    const { data: p, error } = await supa.from("profiles").select("*").eq("user_id", user_id).maybeSingle();
    if (error || !p) {
      return new Response(JSON.stringify({ error: "profile not found" }), {
        status: 404, headers: { ...cors, "Content-Type": "application/json" },
      });
    }

    const sex = p.biological_sex === "female" ? "female" : "male";
    const age = Number(p.age ?? 30);
    const weight_kg = Number(p.measurement_weight_kg ?? 70);
    const height_cm = Number(p.measurement_height_cm ?? 170);

    // --- BMR -----------------------------------------------------------------
    let bmr: number;
    let formula_used: string;
    if (p.body_data_type === "dexa" && p.dexa_lean_mass_kg) {
      // Katch-McArdle uses known LBM directly, more accurate than predictive.
      bmr = 370 + 21.6 * Number(p.dexa_lean_mass_kg);
      formula_used = "katch_mcardle";
    } else {
      bmr = sex === "male"
        ? 10 * weight_kg + 6.25 * height_cm - 5 * age + 5
        : 10 * weight_kg + 6.25 * height_cm - 5 * age - 161;
      formula_used = "mifflin_st_jeor";
    }

    // --- TDEE & goal-adjusted calorie target ---------------------------------
    const tdee = bmr * activityMult(p.training_days_per_week);
    const target_calories = Math.max(1200, tdee + goalKcalDelta(p.goal));
    // 1200 kcal floor: standard clinical safety floor to avoid prescribing a
    // dangerously low intake to small individuals on aggressive deficits.

    // --- Protein (ISSN g/kg per goal) ----------------------------------------
    const target_protein_g = weight_kg * proteinPerKg(p.goal);

    // --- Fat (g/kg floor, or 25% of kcal, whichever higher) ------------------
    const fatFloorFromKg = weight_kg * 0.4;             // hormonal/EFA minimum
    const fatFromPct = (target_calories * 0.25) / 9;    // app convention 25%
    const target_fat_g = Math.max(fatFloorFromKg, fatFromPct);

    // --- Carbs fill the remainder --------------------------------------------
    const remaining = target_calories - target_protein_g * 4 - target_fat_g * 9;
    const target_carbs_g = Math.max(0, remaining / 4);

    const today = new Date().toISOString().slice(0, 10);
    const row = {
      user_id,
      bmr: Math.round(bmr),
      tdee: Math.round(tdee),
      target_calories: Math.round(target_calories),
      target_protein_g: Math.round(target_protein_g),
      target_carbs_g: Math.round(target_carbs_g),
      target_fat_g: Math.round(target_fat_g),
      formula_used,
      effective_start_date: today,
    };

    // Audit #7: atomic close-prior + insert-new via single-transaction RPC.
    // Eliminates the race where two separate HTTP calls (UPDATE then UPSERT)
    // could collide with the partial unique index and leave the user with
    // zero active macro targets after onboarding.
    const { error: rpcErr } = await supa.rpc("apply_onboarding_macros", {
      p_user_id: user_id,
      p_effective_start_date: today,
      p_bmr: row.bmr,
      p_tdee: row.tdee,
      p_target_calories: row.target_calories,
      p_target_protein_g: row.target_protein_g,
      p_target_carbs_g: row.target_carbs_g,
      p_target_fat_g: row.target_fat_g,
      p_formula_used: row.formula_used,
    });
    if (rpcErr) throw rpcErr;

    return new Response(JSON.stringify({ ok: true, ...row }), {
      headers: { ...cors, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e instanceof Error ? e.message : e) }), {
      status: 500, headers: { ...cors, "Content-Type": "application/json" },
    });
  }
});
