// Score nutrition logs across protein / carb-quality / timing dimensions
// using Anthropic Claude Haiku.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { authorizeCaller, corsAllowHeaders } from "../_shared/authorize.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": corsAllowHeaders,
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

    // Audit #3: ownership check — caller must be the row's user (via JWT) or
    // an internal-secret dispatcher. Performed AFTER fetch since the body
    // identifies the row by id, not by user_id.
    const authz = await authorizeCaller(req, supabase, row.user_id);
    if (!authz.ok) {
      return new Response(JSON.stringify({ error: authz.error }), {
        status: authz.status, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Split idempotency: quality and macros are independent. Re-run only what
    // is actually missing/failed. Critical: `manual_edited` is treated as
    // locked for macros — never overwrite a user-corrected meal even if a
    // retry forces claude_score_status back to 'pending'.
    const skipQuality = row.claude_score_status === "scored";
    const skipMacros =
      row.calorie_estimate_status === "estimated" ||
      row.calorie_estimate_status === "manual_edited";
    if (skipQuality && skipMacros) {
      return new Response(JSON.stringify({ skipped: true, row }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
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

      // SEPARATE, parallel call: calorie/macro estimation.
      // Runs whenever we have a photo OR a description (text-only meals
      // are estimated from the description alone). Priority order:
      //   - photo + description: both image + description text
      //   - description only:    text-only call
      //   - photo only:          image + "(none)" description
      //   - neither:             skip
      let estimate: { calories: number; protein_g: number; carbs_g: number; fat_g: number } | null = null;
      const hasDescription = !!(row.meal_description && String(row.meal_description).trim().length > 0);
      const hasPhoto = !!row.meal_photo_url;
      if (hasPhoto || hasDescription) {
        try {
          const estContent: Array<Record<string, unknown>> = [];
          if (hasPhoto) {
            try {
              const imgRes = await fetch(row.meal_photo_url);
              const buf = new Uint8Array(await imgRes.arrayBuffer());
              let bin = ""; for (let i = 0; i < buf.length; i++) bin += String.fromCharCode(buf[i]);
              const b64 = btoa(bin);
              const media_type = imgRes.headers.get("content-type") || "image/jpeg";
              estContent.push({ type: "image", source: { type: "base64", media_type, data: b64 } });
            } catch (_) { /* ignore — fall through to text-only */ }
          }
          const promptText = hasPhoto
            ? (`Description (user override, takes priority): ${row.meal_description ?? "(none)"}. ` +
              `Decompose this plate into its visible components. For each component, estimate weight in grams (for discrete items like fries or nuggets, also include approximate count, e.g. "~85g (approx. 25 fries)"). ` +
              `Use visible reference cues: plate diameter (~26-28cm standard), utensil size, hand size, and branded packaging known sizes (e.g. McDonald's medium fries ≈ 110g, Hardee's small burger patty ≈ 60-80g). ` +
              `For each component, recall its real nutritional profile per estimated weight — protein is dominated by what's actually present (meat, fish, eggs, dairy, legumes, tofu, protein powder); refined-flour breads, rice, potatoes, fried doughs, fruits and most vegetables are LOW protein regardless of portion. ` +
              `If a sauce, oil, or hidden ingredient is likely but uncertain, include it as a labelled line with a sensible default — never silently omit. ` +
              `Sum item macros to plate totals. Return only the final JSON.`)
            : (`Meal description (text-only — no photo available): ${row.meal_description}. ` +
              `Decompose this meal into its named components based on the description. For each component, estimate a sensible weight in grams (use standard portion sizes when the user didn't specify). ` +
              `Recall the real nutritional profile per estimated weight — protein comes from meat, fish, eggs, dairy, legumes, tofu, protein powder; refined-flour breads, rice, potatoes, fried doughs, fruits and most vegetables are LOW protein regardless of portion. ` +
              `If a sauce, oil, or hidden ingredient is likely but the user didn't mention it, include it as a labelled line with a sensible default — never silently omit. ` +
              `Sum item macros to plate totals. Return only the final JSON.`);
          estContent.push({ type: "text", text: promptText });
          const estRes = await fetch("https://api.anthropic.com/v1/messages", {
            method: "POST",
            headers: { "Content-Type": "application/json", "x-api-key": anthropicKey, "anthropic-version": "2023-06-01" },
            body: JSON.stringify({
              model: "claude-haiku-4-5-20251001",
              max_tokens: 900,
              system:
                "You estimate the itemized contents of a meal. " +
                "Always decompose the meal into 1+ named components — never return a single combined dish-label. Even for a single-item meal, return the item + estimated grams. " +
                "Ground every macro in the specific food + estimated grams, not in proportional distribution of total calories. A larger portion of a low-protein food is still low protein. " +
                "Respond with ONLY a single JSON object, no prose, no fences: " +
                "{ \"items\": [ { \"name\": <string, includes qty/approx if useful e.g. 'French fries, small (~25 fries)'>, \"grams\": <number>, \"calories\": <number>, \"protein_g\": <number>, \"carbs_g\": <number>, \"fat_g\": <number> } ], " +
                "\"estimated_calories\": <sum>, \"estimated_protein_g\": <sum>, \"estimated_carbs_g\": <sum>, \"estimated_fat_g\": <sum> }. " +
                "Be realistic; this is an estimate, not precise tracking.",
              messages: [{ role: "user", content: estContent }],
            }),
          });
          if (estRes.ok) {
            const j = await estRes.json();
            const txt = j?.content?.[0]?.text ?? "";
            const ep = JSON.parse(stripFences(txt));
            const rawItems = Array.isArray(ep.items) ? ep.items : [];
            const items = rawItems.map((it: any) => ({
              name: String(it.name ?? "item"),
              grams: Math.max(0, Math.round(Number(it.grams) || 0)),
              calories: Math.max(0, Math.round(Number(it.calories) || 0)),
              protein_g: Math.max(0, Math.round(Number(it.protein_g) || 0)),
              carbs_g: Math.max(0, Math.round(Number(it.carbs_g) || 0)),
              fat_g: Math.max(0, Math.round(Number(it.fat_g) || 0)),
            }));
            const sumOr = (k: "calories"|"protein_g"|"carbs_g"|"fat_g", fallback: number) =>
              items.length ? items.reduce((a: number, b: any) => a + (b[k]||0), 0) : Math.max(0, Math.round(Number(fallback) || 0));
            estimate = {
              calories: sumOr("calories", ep.estimated_calories),
              protein_g: sumOr("protein_g", ep.estimated_protein_g),
              carbs_g: sumOr("carbs_g", ep.estimated_carbs_g),
              fat_g: sumOr("fat_g", ep.estimated_fat_g),
            };
            (estimate as any).items = items;
          }
        } catch (e) { console.error("Macro estimate failed:", e); }
      }

      if (estimate) {
        const macroPatch: Record<string, unknown> = {
          estimated_calories: estimate.calories,
          estimated_protein_g: estimate.protein_g,
          estimated_carbs_g: estimate.carbs_g,
          estimated_fat_g: estimate.fat_g,
          estimated_items: (estimate as any).items ?? null,
          calorie_estimate_status: "estimated",
        };
        // Preserve the original AI baseline: only set original_* on first estimate.
        if (row.original_estimated_items == null && row.original_estimated_calories == null) {
          macroPatch.original_estimated_items = (estimate as any).items ?? null;
          macroPatch.original_estimated_calories = estimate.calories;
          macroPatch.original_estimated_protein_g = estimate.protein_g;
          macroPatch.original_estimated_carbs_g = estimate.carbs_g;
          macroPatch.original_estimated_fat_g = estimate.fat_g;
        }
        await supabase.from("shield_nutrition_logs").update(macroPatch).eq("id", nutrition_log_id);
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
