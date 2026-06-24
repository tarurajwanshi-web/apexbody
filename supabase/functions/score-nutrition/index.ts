// score-nutrition — Meal Analysis & Quality Scoring (Module 2.5A)
// Triggered by DB webhook when shield_nutrition_logs.claude_score_status='pending'.
// Calls GPT-4o-mini vision, computes 3 sub-scores (protein_tier, carb_quality_score,
// timing_score), writes them back to shield_nutrition_logs (claude_quality_score is
// GENERATED ALWAYS from those), inserts full analysis into nutrition_meal_full_analysis,
// then dispatches calculate-score to refresh readiness rings.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { authorizeCaller, corsAllowHeaders } from "../_shared/authorize.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": corsAllowHeaders,
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

interface MealAnalysis {
  macros: {
    protein_g: number;
    carbs_g: number;
    fat_g: number;
    fiber_g: number;
    sodium_mg: number;
    potassium_mg: number;
    sugar_g: number;
  };
  quality_assessment: string;
  flags: string[];
  food_sources: string[];
  micronutrients: {
    iron_mg?: number;
    calcium_mg?: number;
    vitd_iu?: number;
    magnesium_mg?: number;
    zinc_mg?: number;
  };
  timing_implications: string;
  digestion_profile: string;
  satiety_factors: string;
  body_response: string;
  coach_insight: string;
}

function stripFences(t: string): string {
  let s = t.trim();
  if (s.startsWith("```")) s = s.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "");
  return s.trim();
}

function clamp(n: number, lo = 0, hi = 100): number {
  return Math.max(lo, Math.min(hi, Math.round(n)));
}

function computeProteinTier(protein_g: number, daily_target_g: number): number {
  const perMeal = Math.max(1, daily_target_g / 3);
  const ratio = protein_g / perMeal;
  if (ratio >= 1 && ratio <= 1.2) return 90;
  if (ratio < 1) return clamp(90 * ratio);
  return clamp(90 - (ratio - 1.2) * 50, 60, 100);
}

const HIGH_CARB_TOKENS = [
  "oat", "oats", "quinoa", "brown rice", "whole grain", "whole-wheat", "whole wheat",
  "lentil", "bean", "chickpea", "legume", "sweet potato", "fruit", "berry", "berries",
  "vegetable", "broccoli", "spinach", "kale", "barley", "farro",
];
const REFINED_CARB_TOKENS = [
  "white bread", "white rice", "soda", "candy", "cookie", "cake", "pastry",
  "donut", "doughnut", "sugar", "syrup", "juice", "chips",
];

function computeCarbQuality(food_sources: string[], fiber_g: number, sugar_g: number): number {
  const haystack = (food_sources ?? []).join(" ").toLowerCase();
  let score = 60;
  let bonus = 0;
  for (const t of HIGH_CARB_TOKENS) if (haystack.includes(t)) bonus += 8;
  score += Math.min(30, bonus);
  let penalty = 0;
  for (const t of REFINED_CARB_TOKENS) if (haystack.includes(t)) penalty += 10;
  score -= Math.min(30, penalty);
  if (fiber_g > 0 && sugar_g >= 0) {
    const ratio = fiber_g / Math.max(sugar_g, 1);
    if (ratio >= 0.5) score += 10;
    else if (ratio < 0.1 && sugar_g > 15) score -= 10;
  }
  return clamp(score);
}

function parseHour(meal_time: string | null | undefined, fallback: number): number {
  if (!meal_time) return fallback;
  const m = /^(\d{1,2}):(\d{2})/.exec(meal_time);
  if (!m) return fallback;
  return Math.max(0, Math.min(23, parseInt(m[1], 10)));
}

function computeTimingScore(meal_slot: string | null | undefined, hour: number): number {
  const slot = (meal_slot ?? "").toLowerCase();
  const windows: Record<string, [number, number, number]> = {
    breakfast: [6, 10, 90],
    lunch: [11, 15, 90],
    dinner: [17, 21, 85],
  };
  const w = windows[slot];
  if (!w) return 75;
  const [lo, hi, peak] = w;
  if (hour >= lo && hour <= hi) return peak;
  const dist = hour < lo ? lo - hour : hour - hi;
  return clamp(peak - 15 * dist, 40, 100);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const openaiKey = Deno.env.get("OPENAI_API_KEY")!;
  const supa = createClient(supabaseUrl, supabaseKey);

  const json = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...cors, "Content-Type": "application/json" },
    });

  let body: { nutrition_log_id?: string } = {};
  try {
    body = await req.json();
  } catch {
    return json(400, { error: "Invalid JSON" });
  }
  const { nutrition_log_id } = body;
  if (!nutrition_log_id) return json(400, { error: "Missing nutrition_log_id" });

  const authz = await authorizeCaller(req, supa);
  if (!authz.ok) return json(authz.status, { error: authz.error });

  // Load meal row
  const { data: meal, error: mealErr } = await supa
    .from("shield_nutrition_logs")
    .select(
      "id, user_id, entry_date, meal_photo_url, meal_slot, meal_description, confirmed_items, calorie_estimate_status, claude_score_status, created_at",
    )
    .eq("id", nutrition_log_id)
    .maybeSingle();

  if (mealErr || !meal) return json(404, { error: "Meal not found" });

  // JWT path: must own the meal
  if (authz.userId && authz.userId !== meal.user_id) {
    return json(403, { error: "forbidden: meal not owned by caller" });
  }

  // Idempotency
  if (meal.claude_score_status === "scored") {
    return json(200, { ok: true, skipped: true });
  }

  const markFailed = async () => {
    try {
      await supa
        .from("shield_nutrition_logs")
        .update({ claude_score_status: "failed" })
        .eq("id", nutrition_log_id);
    } catch (_) {
      /* swallow */
    }
  };

  try {
    // Load context in parallel
    const [profileRes, targetRes] = await Promise.all([
      supa
        .from("profiles")
        .select("measurement_weight_kg, goal, biological_sex")
        .eq("user_id", meal.user_id)
        .maybeSingle(),
      supa
        .from("daily_macro_targets")
        .select("target_calories, target_protein_g, target_carbs_g, target_fat_g")
        .eq("user_id", meal.user_id)
        .lte("effective_start_date", meal.entry_date)
        .or(`effective_end_date.is.null,effective_end_date.gt.${meal.entry_date}`)
        .order("effective_start_date", { ascending: false })
        .limit(1)
        .maybeSingle(),
    ]);

    const profile = profileRes.data ?? null;
    const target = targetRes.data ?? {
      target_calories: 2000,
      target_protein_g: 120,
      target_carbs_g: 200,
      target_fat_g: 70,
    };

    // Build GPT messages
    const systemPrompt =
      "You are a sports nutritionist analyzing a single meal for an athletic performance app. " +
      "Return ONLY a single JSON object (no prose, no markdown fences) with this exact shape: " +
      `{
  "macros": { "protein_g": number, "carbs_g": number, "fat_g": number, "fiber_g": number, "sodium_mg": number, "potassium_mg": number, "sugar_g": number },
  "quality_assessment": string,
  "flags": string[],
  "food_sources": string[],
  "micronutrients": { "iron_mg"?: number, "calcium_mg"?: number, "vitd_iu"?: number, "magnesium_mg"?: number, "zinc_mg"?: number },
  "timing_implications": string,
  "digestion_profile": string,
  "satiety_factors": string,
  "body_response": string,
  "coach_insight": string
}` +
      " food_sources must list specific items shown or described (e.g. \"oats\", \"chicken breast\", \"white rice\", \"berries\"). " +
      "Ground macros in realistic portion sizes. Be concise in text fields (1-2 sentences each).";

    const userTextParts: string[] = [];
    if (meal.meal_description) userTextParts.push(`User description: ${meal.meal_description}`);
    if (meal.confirmed_items) {
      userTextParts.push(`User-confirmed items (anchor to these): ${JSON.stringify(meal.confirmed_items)}`);
    }
    userTextParts.push(
      `Context — goal: ${profile?.goal ?? "unknown"}, weight_kg: ${profile?.measurement_weight_kg ?? "unknown"}, sex: ${profile?.biological_sex ?? "unknown"}.`,
    );
    userTextParts.push("Analyze this meal and return the JSON object.");

    const userContent: Array<Record<string, unknown>> = [
      { type: "text", text: userTextParts.join("\n") },
    ];
    if (meal.meal_photo_url && /^https?:\/\//.test(meal.meal_photo_url)) {
      userContent.push({ type: "image_url", image_url: { url: meal.meal_photo_url } });
    }

    const gptResponse = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${openaiKey}` },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        max_tokens: 1500,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userContent },
        ],
      }),
    });

    if (!gptResponse.ok) {
      const errText = await gptResponse.text();
      console.error("OpenAI error:", gptResponse.status, errText);
      await markFailed();
      return json(502, { error: `OpenAI ${gptResponse.status}` });
    }

    const gptJson = await gptResponse.json();
    const content = gptJson?.choices?.[0]?.message?.content ?? "";
    let analysis: MealAnalysis;
    try {
      analysis = JSON.parse(stripFences(content));
    } catch (e) {
      console.error("Parse error:", e, content);
      await markFailed();
      return json(502, { error: "Invalid GPT JSON" });
    }

    const macros = analysis.macros ?? ({} as MealAnalysis["macros"]);
    const protein_g = Number(macros.protein_g) || 0;
    const carbs_g = Number(macros.carbs_g) || 0;
    const fat_g = Number(macros.fat_g) || 0;
    const fiber_g = Number(macros.fiber_g) || 0;
    const sugar_g = Number(macros.sugar_g) || 0;

    // Sub-scores
    const protein_tier = computeProteinTier(protein_g, Number(target.target_protein_g) || 120);
    const carb_quality_score = computeCarbQuality(analysis.food_sources ?? [], fiber_g, sugar_g);

    const createdAt = meal.created_at ? new Date(meal.created_at as string) : new Date();
    const slotHourFallback: Record<string, number> = { breakfast: 8, lunch: 13, dinner: 19, snack: 15 };
    const fallbackHour = slotHourFallback[(meal.meal_slot ?? "").toLowerCase()] ?? createdAt.getUTCHours();
    const timing_score = computeTimingScore(meal.meal_slot, fallbackHour);

    // Estimated calories — derived if user hasn't manually edited
    const estCalories = Math.round(protein_g * 4 + carbs_g * 4 + fat_g * 9);

    const updatePayload: Record<string, unknown> = {
      protein_tier,
      carb_quality_score,
      timing_score,
      claude_score_status: "scored",
    };
    if (meal.calorie_estimate_status !== "manual_edited") {
      updatePayload.estimated_calories = estCalories;
      updatePayload.estimated_protein_g = Math.round(protein_g * 10) / 10;
      updatePayload.estimated_carbs_g = Math.round(carbs_g * 10) / 10;
      updatePayload.estimated_fat_g = Math.round(fat_g * 10) / 10;
    }

    const { error: updErr } = await supa
      .from("shield_nutrition_logs")
      .update(updatePayload)
      .eq("id", nutrition_log_id);

    if (updErr) {
      console.error("shield_nutrition_logs update error:", updErr);
      await markFailed();
      return json(500, { error: "Failed to write sub-scores" });
    }

    // Upsert full analysis row
    const { error: insErr } = await supa
      .from("nutrition_meal_full_analysis")
      .upsert(
        {
          user_id: meal.user_id,
          meal_id: nutrition_log_id,
          entry_date: meal.entry_date,
          protein_g,
          carbs_g,
          fat_g,
          fiber_g,
          sodium_mg: Number(macros.sodium_mg) || 0,
          potassium_mg: Number(macros.potassium_mg) || 0,
          sugar_g,
          quality_assessment: analysis.quality_assessment ?? "",
          flags: analysis.flags ?? [],
          food_sources: analysis.food_sources ?? [],
          micronutrients: analysis.micronutrients ?? {},
          timing_implications: analysis.timing_implications ?? "",
          digestion_profile: analysis.digestion_profile ?? "",
          satiety_factors: analysis.satiety_factors ?? "",
          body_response: analysis.body_response ?? "",
          coach_insight: analysis.coach_insight ?? "",
          full_haiku_output: analysis,
        },
        { onConflict: "meal_id" },
      );

    if (insErr) {
      console.error("nutrition_meal_full_analysis upsert error:", insErr);
      // sub-scores already written; don't mark failed
    }

    // Fire-and-forget readiness recompute
    try {
      const { data: secret } = await supa.rpc("get_dispatch_secret");
      if (typeof secret === "string" && secret) {
        fetch(`${supabaseUrl}/functions/v1/calculate-score`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-internal-secret": secret },
          body: JSON.stringify({ user_id: meal.user_id, entry_date: meal.entry_date }),
        }).catch((e) => console.error("dispatch calculate-score failed:", e));
      }
    } catch (e) {
      console.error("dispatch calculate-score setup failed:", e);
    }

    const foodDesc = (analysis.food_sources ?? []).slice(0, 3).join(" + ") || "Meal";

    return json(200, {
      ok: true,
      food_description: foodDesc,
      scores: { protein_tier, carb_quality: carb_quality_score, timing: timing_score },
      macros: { protein_g, carbs_g, fat_g },
    });
  } catch (error) {
    console.error("score-nutrition fatal:", error);
    await markFailed();
    return json(500, { error: String(error instanceof Error ? error.message : error) });
  }
});
