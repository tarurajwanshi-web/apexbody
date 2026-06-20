// Score nutrition logs using Anthropic Claude
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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const anthropicKey = Deno.env.get("ANTHROPIC_API_KEY");
  const supabase = createClient(supabaseUrl, serviceKey);

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

    if (!anthropicKey) {
      const { data: updated } = await supabase
        .from("shield_nutrition_logs")
        .update({ claude_score_status: "failed" })
        .eq("id", nutrition_log_id)
        .select()
        .single();
      console.error("ANTHROPIC_API_KEY secret missing");
      return new Response(JSON.stringify({ error: "ANTHROPIC_API_KEY not configured", row: updated }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const systemPrompt =
      'You evaluate meal quality for an athletic performance app. Respond with ONLY a single JSON object, no prose, no markdown: { "quality_score": <number 0-100>, "reasoning": "<one short sentence>" }. Consider protein adequacy, micronutrient density, processing level, and athletic recovery value.';

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
      text: `Meal description: ${row.meal_description ?? "(none provided)"}`,
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
          max_tokens: 300,
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
      const score = Number(parsed.quality_score);
      if (!Number.isFinite(score)) throw new Error("invalid quality_score");

      const { data: updated, error: upErr } = await supabase
        .from("shield_nutrition_logs")
        .update({
          claude_quality_score: score,
          claude_score_status: "scored",
        })
        .eq("id", nutrition_log_id)
        .select()
        .single();

      if (upErr) throw upErr;

      return new Response(JSON.stringify({ row: updated, reasoning: parsed.reasoning }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    } catch (err) {
      console.error("Scoring failed:", err);
      const { data: updated } = await supabase
        .from("shield_nutrition_logs")
        .update({ claude_score_status: "failed" })
        .eq("id", nutrition_log_id)
        .select()
        .single();
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
