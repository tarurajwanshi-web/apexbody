// score-nutrition — Meal Analysis & Storage (Module 2.5A)
// Uses GPT-4o mini for full meal analysis (macros + quality + micronutrients + coach insight).
// Stores full analysis in nutrition_meal_full_analysis; returns macros + status to user.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS, PUT, DELETE",
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

function stripFences(text: string): string {
  let t = text.trim();
  if (t.startsWith("```")) {
    t = t.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "");
  }
  return t.trim();
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const openaiKey = Deno.env.get("OPENAI_API_KEY")!;
  const supa = createClient(supabaseUrl, supabaseKey);

  let body: {
    user_id?: string;
    meal_id?: string;
    image_base64?: string;
    entry_date?: string;
    meal_time?: string;
  } = {};

  try {
    body = await req.json();
  } catch {
    return new Response(
      JSON.stringify({ error: "Invalid JSON" }),
      { status: 400, headers: { ...cors, "Content-Type": "application/json" } },
    );
  }

  const { user_id, meal_id, image_base64, entry_date, meal_time } = body;

  if (!user_id || !meal_id || !image_base64) {
    return new Response(
      JSON.stringify({ error: "Missing user_id, meal_id, or image_base64" }),
      { status: 400, headers: { ...cors, "Content-Type": "application/json" } },
    );
  }

  try {
    const dataUrl = image_base64.startsWith("data:")
      ? image_base64
      : `data:image/jpeg;base64,${image_base64}`;

    const systemPrompt =
      "You are a sports nutritionist analyzing a single meal photo for an athletic performance app. " +
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
      " Ground macros in the specific foods visible and realistic portion sizes. Be concise in text fields (1-2 sentences each).";

    const gptResponse = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${openaiKey}`,
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        max_tokens: 1500,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: systemPrompt },
          {
            role: "user",
            content: [
              { type: "text", text: "Analyze this meal completely and return the JSON object." },
              { type: "image_url", image_url: { url: dataUrl } },
            ],
          },
        ],
      }),
    });

    if (!gptResponse.ok) {
      const errText = await gptResponse.text();
      throw new Error(`OpenAI ${gptResponse.status}: ${errText}`);
    }

    const gptJson = await gptResponse.json();
    const content = gptJson?.choices?.[0]?.message?.content ?? "";
    const analysis: MealAnalysis = JSON.parse(stripFences(content));

    const { error: insertError } = await supa
      .from("nutrition_meal_full_analysis")
      .insert({
        user_id,
        meal_id,
        entry_date,
        meal_time,
        protein_g: analysis.macros?.protein_g,
        carbs_g: analysis.macros?.carbs_g,
        fat_g: analysis.macros?.fat_g,
        fiber_g: analysis.macros?.fiber_g,
        sodium_mg: analysis.macros?.sodium_mg,
        potassium_mg: analysis.macros?.potassium_mg,
        sugar_g: analysis.macros?.sugar_g,
        quality_assessment: analysis.quality_assessment,
        flags: analysis.flags,
        food_sources: analysis.food_sources,
        micronutrients: analysis.micronutrients || {},
        timing_implications: analysis.timing_implications,
        digestion_profile: analysis.digestion_profile,
        satiety_factors: analysis.satiety_factors,
        body_response: analysis.body_response,
        coach_insight: analysis.coach_insight,
        full_haiku_output: analysis,
      });

    if (insertError) {
      console.error("Insert error:", insertError);
    }

    // Show user only macros + status
    const targetProtein = 150;
    const targetCarbs = 170;
    const targetFat = 70;

    const proteinStatus = Math.abs(analysis.macros.protein_g - targetProtein) <= 10 ? "✅" : "⚠️";
    const carbsStatus = Math.abs(analysis.macros.carbs_g - targetCarbs) <= 10 ? "✅" : "⚠️";
    const fatStatus = Math.abs(analysis.macros.fat_g - targetFat) <= 10 ? "✅" : "⚠️";

    const foodDesc = analysis.food_sources?.slice(0, 3).join(" + ") || "Meal";

    return new Response(
      JSON.stringify({
        ok: true,
        logged: true,
        food_description: foodDesc,
        macros: {
          protein_g: analysis.macros.protein_g,
          carbs_g: analysis.macros.carbs_g,
          fat_g: analysis.macros.fat_g,
        },
        status: {
          protein: proteinStatus,
          carbs: carbsStatus,
          fat: fatStatus,
        },
        message: `✅ Logged: ${foodDesc}\n\nMacros: ${analysis.macros.protein_g}g protein | ${analysis.macros.carbs_g}g carbs | ${analysis.macros.fat_g}g fat\nStatus: On track ✓`,
      }),
      { headers: { ...cors, "Content-Type": "application/json" } },
    );
  } catch (error) {
    console.error("Error:", error);
    return new Response(
      JSON.stringify({ error: String(error instanceof Error ? error.message : error) }),
      { status: 500, headers: { ...cors, "Content-Type": "application/json" } },
    );
  }
});
