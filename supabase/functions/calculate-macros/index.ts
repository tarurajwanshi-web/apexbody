// calculate-macros — deterministic BMR/TDEE & macro targets.
// Input: { user_id }. Upserts into public.daily_macro_targets.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function activityMult(days: number | null | undefined): number {
  if (!days) return 1.375;
  if (days <= 2) return 1.375;
  if (days <= 4) return 1.55;
  return 1.725;
}

function goalMult(goal: string | null | undefined): number {
  switch (goal) {
    case "fat_loss": return 0.80;
    case "muscle_gain": return 1.10;
    case "strength": return 1.05;
    case "athletic_performance": return 1.0;
    case "recomposition":
    default: return 1.0;
  }
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

    const tdee = bmr * activityMult(p.training_days_per_week);
    const target_calories = tdee * goalMult(p.goal);
    const wForProtein = Number(p.measurement_weight_kg ?? 0) || 40; // 40kg * 2 = 80g default
    const target_protein_g = wForProtein * 2.0;
    const target_fat_g = (target_calories * 0.25) / 9;
    const remaining = target_calories - target_protein_g * 4 - target_fat_g * 9;
    const target_carbs_g = Math.max(0, remaining / 4);

    const row = {
      user_id,
      calculated_at: new Date().toISOString(),
      bmr: Math.round(bmr),
      tdee: Math.round(tdee),
      target_calories: Math.round(target_calories),
      target_protein_g: Math.round(target_protein_g),
      target_carbs_g: Math.round(target_carbs_g),
      target_fat_g: Math.round(target_fat_g),
      formula_used,
    };

    const { error: upErr } = await supa
      .from("daily_macro_targets")
      .upsert(row, { onConflict: "user_id" });
    if (upErr) throw upErr;

    return new Response(JSON.stringify({ ok: true, ...row }), {
      headers: { ...cors, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e instanceof Error ? e.message : e) }), {
      status: 500, headers: { ...cors, "Content-Type": "application/json" },
    });
  }
});
