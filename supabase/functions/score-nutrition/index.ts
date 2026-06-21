// Score nutrition logs across protein / carb-quality / timing dimensions
// using Anthropic Claude Haiku.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function stripFences(text: string): string {
  let t = text.trim();
  if (t.startsWith("```")) {
    t = t.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "");
  }
  return t.trim();
}

function clamp(n: unknown): number {
  const v = Math.round(Number(n));
  if (!Number.isFinite(v)) throw new Error("invalid score");
  return Math.max(0, Math.min(100, v));
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const anthropicKey = Deno.env.get("ANTHROPIC_API_KEY");
  const supabase = createClient(supabaseUrl, serviceKey);

  const markFailed = async (id: string) => {
    const { data } = await supabase
      .from("shield_nutrition_logs")
      .update({ claude_score_status: "failed" })
      .eq("id", id)
      .select()
      .single();
    return data;
  };

  try {
    const { nutrition_log_id } = await req.json();
    if (!nutrition_log_id) {
      return new Response(JSON.stringify({ error: "nutrition_log_id required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: row, error: fetchErr } = await supabase
      .from("shield_nutrition_logs")
      .select("*")
      .eq("id", nutrition_log_id)
      .single();

    if (fetchErr || !row) {
      return new Response(JSON.stringify({ error: "log not found", details: fetchErr?.message }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Pull training context for same date (if any) for timing evaluation.
    const { data: training } = await supabase
      .from("shield_training_logs")
      .select("*")
      .eq("user_id", row.user_id)
      .eq("entry_date", row.entry_date)
      .maybeSingle();

    if (!anthropicKey) {
      const updated = await markFailed(nutrition_log_id);
      console.error("ANTHROPIC_API_KEY secret missing");
      return new Response(
        JSON.stringify({ error: "ANTHROPIC_API_KEY not configured", row: updated }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const trainingContext = training
      ? `Training session that day: strain=${training.strain_value ?? "unknown"}, notes=${training.session_notes ?? "(none)"}.`
      : "No training session logged for this day.";

    const systemPrompt =
      'You evaluate a single meal for an athletic performance app along three dimensions. ' +
      'Respond with ONLY a single JSON object, no prose, no markdown fences: ' +
      '{ "protein_tier": <0-100>, "carb_quality_score": <0-100>, "timing_score": <0-100>, "reasoning": "<one short sentence>" }. ' +
      'protein_tier: protein adequacy & quality for athletic recovery. ' +
      'carb_quality_score: carbohydrate quality (whole vs processed, fiber, glycemic profile). ' +
      'timing_score: how well meal timing aligns with that day\'s training session. ' +
      'If no training session is logged for the day, score timing_score against general meal-spacing quality; ' +
      'default toward 70 when there is no strong signal either way.';

    const userContent: Array<Record<string, unknown>> = [];
    if (row.meal_photo_url) {
      try {
        const imgRes = await fetch(row.meal_photo_url);
        const buf = new Uint8Array(await imgRes.arrayBuffer());
        let bin = "";
        for (let i = 0; i < buf.length; i++) bin += String.fromCharCode(buf[i]);
        const b64 = btoa(bin);
        const media_type = imgRes.headers.get("content-type") || "image/jpeg";
        userContent.push({
          type: "image",
          source: { type: "base64", media_type, data: b64 },
        });
      } catch (e) {
        console.error("Failed to fetch meal photo:", e);
      }
    }
    userContent.push({
      type: "text",
      text: `Meal description: ${row.meal_description ?? "(none provided)"}\n${trainingContext}`,
    });

    try {
      const aRes = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": anthropicKey,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model: "claude-haiku-4-5-20251001",
          max_tokens: 400,
          system: systemPrompt,
          messages: [{ role: "user", content: userContent }],
        }),
      });

      if (!aRes.ok) {
        throw new Error(`Anthropic ${aRes.status}: ${await aRes.text()}`);
      }

      const aJson = await aRes.json();
      const text = aJson?.content?.[0]?.text ?? "";
      const parsed = JSON.parse(stripFences(text));

      const protein_tier = clamp(parsed.protein_tier);
      const carb_quality_score = clamp(parsed.carb_quality_score);
      const timing_score = clamp(parsed.timing_score);
      // claude_quality_score is a generated column in the DB — don't write it directly.
      const claude_quality_score = Math.round(
        0.4 * protein_tier + 0.35 * carb_quality_score + 0.25 * timing_score,
      );

      const { data: updated, error: upErr } = await supabase
        .from("shield_nutrition_logs")
        .update({
          protein_tier,
          carb_quality_score,
          timing_score,
          claude_score_status: "scored",
        })
        .eq("id", nutrition_log_id)
        .select()
        .single();

      if (upErr) throw upErr;

      // SEPARATE, parallel call: calorie/macro estimation from the photo.
      // This MUST NOT affect protein_tier/carb_quality_score/timing_score.
      let estimate: { calories: number; protein_g: number; carbs_g: number; fat_g: number } | null = null;
      if (row.meal_photo_url) {
        try {
          const estContent: Array<Record<string, unknown>> = [];
          try {
            const imgRes = await fetch(row.meal_photo_url);
            const buf = new Uint8Array(await imgRes.arrayBuffer());
            let bin = ""; for (let i = 0; i < buf.length; i++) bin += String.fromCharCode(buf[i]);
            const b64 = btoa(bin);
            const media_type = imgRes.headers.get("content-type") || "image/jpeg";
            estContent.push({ type: "image", source: { type: "base64", media_type, data: b64 } });
          } catch (_) { /* ignore */ }
          estContent.push({
            type: "text",
            text: `Description: ${row.meal_description ?? "(none)"}. Estimate total calories and macros for the WHOLE meal shown.`,
          });
          const estRes = await fetch("https://api.anthropic.com/v1/messages", {
            method: "POST",
            headers: { "Content-Type": "application/json", "x-api-key": anthropicKey, "anthropic-version": "2023-06-01" },
            body: JSON.stringify({
              model: "claude-haiku-4-5-20251001",
              max_tokens: 250,
              system:
                "You estimate calories and macros from a meal photo + description. " +
                "Respond with ONLY a single JSON object, no prose, no fences: " +
                "{ \"estimated_calories\": <number>, \"estimated_protein_g\": <number>, \"estimated_carbs_g\": <number>, \"estimated_fat_g\": <number> }. " +
                "Be realistic; this is an estimate, not precise tracking.",
              messages: [{ role: "user", content: estContent }],
            }),
          });
          if (estRes.ok) {
            const j = await estRes.json();
            const txt = j?.content?.[0]?.text ?? "";
            const ep = JSON.parse(stripFences(txt));
            estimate = {
              calories: Math.max(0, Math.round(Number(ep.estimated_calories))),
              protein_g: Math.max(0, Math.round(Number(ep.estimated_protein_g))),
              carbs_g: Math.max(0, Math.round(Number(ep.estimated_carbs_g))),
              fat_g: Math.max(0, Math.round(Number(ep.estimated_fat_g))),
            };
          }
        } catch (e) { console.error("Macro estimate failed:", e); }
      }

      if (estimate) {
        await supabase.from("shield_nutrition_logs").update({
          estimated_calories: estimate.calories,
          estimated_protein_g: estimate.protein_g,
          estimated_carbs_g: estimate.carbs_g,
          estimated_fat_g: estimate.fat_g,
          calorie_estimate_status: "estimated",
        }).eq("id", nutrition_log_id);
      } else {
        await supabase.from("shield_nutrition_logs").update({
          calorie_estimate_status: "failed",
        }).eq("id", nutrition_log_id);
      }

      return new Response(
        JSON.stringify({
          row: updated,
          scores: { protein_tier, carb_quality_score, timing_score, claude_quality_score },
          estimate,
          reasoning: parsed.reasoning,
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    } catch (err) {
      console.error("Scoring failed:", err);
      const updated = await markFailed(nutrition_log_id);
      return new Response(
        JSON.stringify({ error: String(err instanceof Error ? err.message : err), row: updated }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }
  } catch (err) {
    console.error("Unhandled:", err);
    return new Response(JSON.stringify({ error: String(err instanceof Error ? err.message : err) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
