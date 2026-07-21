import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { authorizeCaller, corsAllowHeaders } from "../_shared/authorize.ts";
import { goalDirection, rateCeilingFor } from "../_shared/goal-direction.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": corsAllowHeaders,
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function activityMult(days: number | null | undefined): number {
  const d = Number(days ?? 0);
  if (!isFinite(d) || d <= 0) return 1.2;
  if (d <= 3) return 1.375;
  if (d <= 5) return 1.55;
  return 1.725;
}

function proteinPerKg(goal: string | null | undefined): number {
  return goal === "fat_loss" ? 2.2 : 1.8;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });

  const url = Deno.env.get("SUPABASE_URL")!;
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supa = createClient(url, key);

  const err = (status: number, body: Record<string, unknown>) =>
    new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

  try {
    const { user_id } = await req.json();
    if (!user_id) return err(400, { error: "user_id required" });

    const authz = await authorizeCaller(req, supa, user_id);
    if (!authz.ok) return err(authz.status, { error: authz.error });

    const { data: p, error } = await supa.from("profiles").select("*").eq("user_id", user_id).maybeSingle();
    if (error || !p) return err(404, { error: "profile not found" });

    // ── Required-field gate (no silent defaults) ────────────────────────
    const missing: string[] = [];
    if (p.biological_sex !== "male" && p.biological_sex !== "female") missing.push("biological_sex");
    if (p.age == null) missing.push("age");
    if (p.measurement_weight_kg == null) missing.push("measurement_weight_kg");
    if (p.measurement_height_cm == null) missing.push("measurement_height_cm");
    if (!p.goal) missing.push("goal");
    if (missing.length > 0) return err(422, { error: "Cannot calculate macros — required fields missing", missing_fields: missing });

    const sex = p.biological_sex as "male" | "female";
    const age = Number(p.age);
    const weight_kg = Number(p.measurement_weight_kg);
    const height_cm = Number(p.measurement_height_cm);
    if (weight_kg <= 0 || height_cm <= 0) return err(422, { error: "weight/height must be positive" });

    try {
      goalDirection(p.goal); // validate recognized goal
    } catch (e) {
      return err(422, { error: String(e instanceof Error ? e.message : e) });
    }

    const goal = p.goal as string;

    // ── Goal-based validation ───────────────────────────────────────────
    const checkBmi = (targetKg: number, dir: "lose" | "gain") => {
      if (dir === "lose" && targetKg >= weight_kg) return "target_weight_kg must be below current weight for this goal";
      if (dir === "gain" && targetKg <= weight_kg) return "target_weight_kg must be above current weight for this goal";
      const bmiAtTarget = targetKg / ((height_cm / 100) ** 2);
      if (dir === "lose" && bmiAtTarget < 18.5) return "target_weight_kg implies an unsafe BMI (under 18.5)";
      if (dir === "gain" && bmiAtTarget >= 35) return "target_weight_kg implies an unsafe BMI (35 or above)";
      return null;
    };

    if (goal === "fat_loss") {
      if (p.target_rate_pct == null || Number(p.target_rate_pct) <= 0) {
        return err(422, { error: "Cannot calculate macros — positive target_rate_pct required for fat_loss", missing_fields: ["target_rate_pct"] });
      }
      if (p.target_weight_kg == null) {
        return err(422, { error: "Cannot calculate macros — target_weight_kg required for fat_loss", missing_fields: ["target_weight_kg"] });
      }
      const msg = checkBmi(Number(p.target_weight_kg), "lose");
      if (msg) return err(422, { error: msg });
    } else if (goal === "muscle_gain" || goal === "strength") {
      if (p.target_kcal_delta == null || Number(p.target_kcal_delta) <= 0) {
        return err(422, { error: "Cannot calculate macros — positive target_kcal_delta required for this goal", missing_fields: ["target_kcal_delta"] });
      }
      if (p.target_weight_kg != null) {
        const msg = checkBmi(Number(p.target_weight_kg), "gain");
        if (msg) return err(422, { error: msg });
      }
    } else if (goal === "recomposition") {
      if (p.target_kcal_delta == null || Number(p.target_kcal_delta) >= 0) {
        return err(422, { error: "Cannot calculate macros — negative target_kcal_delta required for recomposition", missing_fields: ["target_kcal_delta"] });
      }
    }
    // athletic_performance: maintenance, no gate

    // ── BMR ──────────────────────────────────────────────────────────────
    let bmr: number;
    let formula_used: string;
    if (p.body_data_type === "dexa" && p.dexa_lean_mass_kg) {
      bmr = 370 + 21.6 * Number(p.dexa_lean_mass_kg);
      formula_used = "katch_mcardle";
    } else {
      bmr = sex === "male"
        ? 10 * weight_kg + 6.25 * height_cm - 5 * age + 5
        : 10 * weight_kg + 6.25 * height_cm - 5 * age - 161;
      formula_used = "mifflin_st_jeor";
    }

    // ── TDEE + goal-based deficit/surplus ────────────────────────────────
    const tdee = bmr * activityMult(p.training_days_per_week);
    let deltaKcal = 0;
    if (goal === "fat_loss") {
      const ceiling = rateCeilingFor(goal)!;
      const clampedRate = Math.min(Number(p.target_rate_pct), ceiling);
      const magnitude = (clampedRate / 100) * weight_kg * 7700 / 7;
      deltaKcal = -magnitude;
    } else if (goal === "muscle_gain" || goal === "strength" || goal === "recomposition") {
      deltaKcal = Number(p.target_kcal_delta);
    }
    const target_calories = Math.max(1200, tdee + deltaKcal);

    // ── Protein / fat / carbs ────────────────────────────────────────────
    const bmi25_ref_kg = 25 * Math.pow((Number(height_cm ?? 0) / 100), 2);
    const protein_anchor_kg = bmi25_ref_kg > 0 ? Math.min(weight_kg, bmi25_ref_kg) : weight_kg;
    let target_protein_g = protein_anchor_kg * proteinPerKg(p.goal);
    const fatFloorFromKg = weight_kg * 0.4;
    const fatFromPct = (target_calories * 0.25) / 9;
    let target_fat_g = Math.max(fatFloorFromKg, fatFromPct);
    if (target_protein_g * 4 + target_fat_g * 9 > target_calories) {
      const fat_floor_hard = weight_kg * 0.35;
      target_fat_g = Math.max(fat_floor_hard, (target_calories - target_protein_g * 4) / 9);
      if (target_protein_g * 4 + target_fat_g * 9 > target_calories) {
        target_protein_g = Math.max(0, (target_calories - target_fat_g * 9) / 4);
      }
    }
    const target_carbs_g = Math.max(0, (target_calories - target_protein_g * 4 - target_fat_g * 9) / 4);

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

    // ── Seed weight_trend_state on first calc if it doesn't exist ───────
    const { data: existingTrend } = await supa.from("weight_trend_state").select("user_id").eq("user_id", user_id).maybeSingle();
    if (!existingTrend) {
      await supa.from("weight_trend_state").insert({
        user_id, trend_kg: weight_kg, last_computed_date: today,
      });
    }

    return new Response(JSON.stringify({ ok: true, ...row }), { headers: { ...cors, "Content-Type": "application/json" } });
  } catch (e) {
    return err(500, { error: String(e instanceof Error ? e.message : e) });
  }
});
