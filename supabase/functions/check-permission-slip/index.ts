import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import Anthropic from "https://esm.sh/@anthropic-ai/sdk@0.24.0";
import { requireInternalSecret, corsAllowHeaders } from "../_shared/authorize.ts";
import { buildApexSystemPrompt } from "../_shared/apex-voice.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": corsAllowHeaders,
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function getUserLocalDate(timezone: string): string {
  try {
    const fmt = new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
      year: "numeric", month: "2-digit", day: "2-digit",
    });
    return fmt.format(new Date());
  } catch {
    return new Date().toISOString().slice(0, 10);
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const anthropicKey = Deno.env.get("ANTHROPIC_API_KEY")!;

  const supa = createClient(supabaseUrl, supabaseKey);
  const anthropic = new Anthropic({ apiKey: anthropicKey });

  const authz = await requireInternalSecret(req, supa);
  if (!authz.ok) {
    return new Response(JSON.stringify({ error: authz.error }), {
      status: authz.status,
      headers: { ...cors, "Content-Type": "application/json" },
    });
  }

  let body: { user_id?: string; force?: boolean } = {};
  try { body = await req.json(); } catch {}
  const force = body.force === true;

  if (!body.user_id) {
    return new Response(
      JSON.stringify({ error: "user_id required" }),
      { status: 400, headers: { ...cors, "Content-Type": "application/json" } }
    );
  }

  const user_id = body.user_id;

  // Get profile
  const { data: profile } = await supa
    .from("profiles")
    .select("user_id, timezone, goal, measurement_weight_kg, name, experience_level")
    .eq("user_id", user_id)
    .maybeSingle();

  if (!profile) {
    return new Response(
      JSON.stringify({ ok: false, reason: "profile_not_found" }),
      { headers: { ...cors, "Content-Type": "application/json" } }
    );
  }

  const tz = profile.timezone || "Asia/Dubai";
  const today = getUserLocalDate(tz);

  // Idempotency: one permission slip per day max
  if (!force) {
    const { data: existing } = await supa
      .from("daily_coaching_cards")
      .select("id")
      .eq("user_id", user_id)
      .eq("card_date", today)
      .eq("card_type", "permission_slip")
      .maybeSingle();

    if (existing) {
      return new Response(
        JSON.stringify({ ok: false, reason: "already_generated_today" }),
        { headers: { ...cors, "Content-Type": "application/json" } }
      );
    }
  }

  // Get latest readiness score
  const { data: readiness } = await supa
    .from("readiness_scores")
    .select("final_score, score_date")
    .eq("user_id", user_id)
    .order("score_date", { ascending: false })
    .limit(1)
    .maybeSingle();

  const readinessScore = readiness?.final_score || 0;

  // Get training load from nutrition_weekly_reviews
  const { data: weeklyReview } = await supa
    .from("nutrition_weekly_reviews")
    .select("training_load_index, weekly_sets_avg")
    .eq("user_id", user_id)
    .order("week_start_date", { ascending: false })
    .limit(1)
    .maybeSingle();

  const trainingLoadIndex = weeklyReview?.training_load_index || 1.0;
  const weeklySetsAvg = weeklyReview?.weekly_sets_avg || 0;

  // Get today's carb intake vs target
  const { data: todayMeals } = await supa
    .from("nutrition_meal_full_analysis")
    .select("carbs_g")
    .eq("user_id", user_id)
    .eq("entry_date", today);

  const carbsLogged = Math.round(
    (todayMeals || []).reduce((s, m) => s + (m.carbs_g || 0), 0)
  );

  const { data: targets } = await supa
    .from("daily_macro_targets")
    .select("target_carbs_g, target_calories")
    .eq("user_id", user_id)
    .is("effective_end_date", null)
    .maybeSingle();

  const carbTarget = targets?.target_carbs_g || 170;
  const carbsPct = Math.round((carbsLogged / carbTarget) * 100);

  // Deterministic rule check
  const readinessHigh = readinessScore > 75;
  const trainingLoadHigh = trainingLoadIndex > 1.05;
  const carbsLow = carbsPct < 85;
  const shouldTrigger = force || (readinessHigh && trainingLoadHigh && carbsLow);

  if (!shouldTrigger) {
    return new Response(
      JSON.stringify({
        ok: false,
        reason: "conditions_not_met",
        debug: {
          readinessScore,
          readinessHigh,
          trainingLoadIndex,
          trainingLoadHigh,
          carbsPct,
          carbsLow,
        },
      }),
      { headers: { ...cors, "Content-Type": "application/json" } }
    );
  }

  // Conditions met — generate permission slip via Haiku
  const haikuPrompt = `You are a supportive coach giving your client permission to enjoy a high-carb meal.

Their stats today:
- Readiness score: ${readinessScore}/100 (high — they're recovered)
- Training load: ${trainingLoadIndex} (high — they've been working hard)
- Weekly sets avg: ${weeklySetsAvg} sets/week
- Carbs logged today: ${carbsLogged}g (${carbsPct}% of ${carbTarget}g target — lower than usual)
- Goal: ${profile.goal || "fat_loss"}

Write ONE permission slip (2-3 sentences max).
Rules:

- Acknowledge their training effort (use actual numbers)
- Acknowledge carbs are lower than usual
- Give clear permission to enjoy a higher-carb meal tonight
- Suggest a specific enjoyable meal (biryani, pasta, pizza, rice bowl — pick one)
- Tone: best friend/coach, not nutritionist
- No science explanations, just permission
- Sound excited for them, not clinical

Example style: "🎯 You crushed it today (readiness 79, high training load). Carbs are lower than usual. Go grab the biryani — your body earned it."

Output: 2-3 sentences only. Plain text.`;

  let slipContent: string;
  try {
    const response = await anthropic.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 150,
      system: buildApexSystemPrompt({
        proficiency: (profile as any).experience_level,
        name: (profile as any).name,
      }),
      messages: [{ role: "user", content: haikuPrompt }],
    });
    slipContent = response.content[0].type === "text"
      ? response.content[0].text
      : "🎯 You trained hard today. Carbs are low. Go enjoy a high-carb meal — you earned it.";
  } catch (e) {
    console.error("Haiku error:", e);
    slipContent = "🎯 You trained hard today. Carbs are low. Go enjoy a high-carb meal — you earned it.";
  }

  // Store as high-priority card
  await supa.from("daily_coaching_cards").upsert({
    user_id,
    card_date: today,
    card_type: "permission_slip",
    content: slipContent,
  }, { onConflict: "user_id,card_date,card_type" });

  return new Response(
    JSON.stringify({
      ok: true,
      triggered: true,
      slip: slipContent,
      debug: { readinessScore, trainingLoadIndex, carbsPct },
    }),
    { headers: { ...cors, "Content-Type": "application/json" } }
  );
});
