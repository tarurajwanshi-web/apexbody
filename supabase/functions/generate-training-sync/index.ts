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

function isUserLocalThursdayEvening(timezone: string): boolean {
  try {
    const now = new Date();
    const fmt = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      weekday: "long",
      hour: "numeric",
      hour12: false,
    });
    const parts = fmt.formatToParts(now);
    const weekday = parts.find(p => p.type === "weekday")?.value;
    const hour = parseInt(parts.find(p => p.type === "hour")?.value || "0");
    return weekday === "Thursday" && hour === 18;
  } catch {
    return false;
  }
}

function addDays(isoDate: string, days: number): string {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
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

  const profileQuery = supa
    .from("profiles")
    .select("user_id, timezone, goal, measurement_weight_kg, name, experience_level")
    .not("profile_completed_at", "is", null);
  if (body.user_id) profileQuery.eq("user_id", body.user_id);
  const { data: profiles, error: profileErr } = await profileQuery;
  if (profileErr) {
    return new Response(
      JSON.stringify({ ok: false, error: profileErr.message }),
      { status: 500, headers: { ...cors, "Content-Type": "application/json" } }
    );
  }

  const results = [];

  for (const profile of profiles ?? []) {
    const tz = profile.timezone || "Asia/Dubai";
    const today = getUserLocalDate(tz);
    const nextWeekStart = addDays(today, 1);
    const nextWeekEnd = addDays(today, 7);

    // Time gate: Thursday 6 PM user local time
    if (!force && !isUserLocalThursdayEvening(tz)) {
      results.push({ user_id: profile.user_id, status: "skipped", reason: "not_thursday_6pm" });
      continue;
    }

    // Idempotency
    const { data: existing } = await supa
      .from("daily_coaching_cards")
      .select("id")
      .eq("user_id", profile.user_id)
      .eq("card_date", today)
      .eq("card_type", "training_sync")
      .maybeSingle();

    if (existing && !force) {
      results.push({ user_id: profile.user_id, status: "skipped", reason: "already_generated" });
      continue;
    }

    // Get macro targets
    const { data: targets } = await supa
      .from("daily_macro_targets")
      .select("target_protein_g, target_carbs_g, target_fat_g, target_calories")
      .eq("user_id", profile.user_id)
      .is("effective_end_date", null)
      .maybeSingle();

    // Get next week's training plan
    const { data: weeklyPlan } = await supa
      .from("weekly_plans")
      .select("*")
      .eq("user_id", profile.user_id)
      .gte("week_start_date", nextWeekStart)
      .lte("week_start_date", nextWeekEnd)
      .order("week_start_date", { ascending: true })
      .limit(1)
      .maybeSingle();

    // Edge case: no training plan
    if (!weeklyPlan) {
      const noPlanCard = `🏋️ Training-Nutrition Sync\n\nNo training plan found for next week.\n\nGenerate your weekly training plan first, and I'll align your nutrition targets to fuel each session optimally.`;
      await supa.from("daily_coaching_cards").upsert({
        user_id: profile.user_id,
        card_date: today,
        card_type: "training_sync",
        content: noPlanCard,
      }, { onConflict: "user_id,card_date,card_type" });
      results.push({ user_id: profile.user_id, status: "no_plan" });
      continue;
    }

    // Get this week's readiness trend (7-day avg of final_score)
    const { data: readiness } = await supa
      .from("readiness_scores")
      .select("score_date, final_score, confidence_level, training_permission, nutrition_modifier, load_carryover")
      .eq("user_id", profile.user_id)
      .gte("score_date", addDays(today, -7))
      .lte("score_date", today)
      .order("score_date", { ascending: false });

    const avgReadiness = readiness && readiness.length > 0
      ? Math.round(readiness.reduce((s, r) => s + (r.final_score || 0), 0) / readiness.length)
      : null;

    // Most-recent readiness row (unbounded — same-day directive, not a trend).
    const { data: latestReadiness } = await supa
      .from("readiness_scores")
      .select("training_permission, confidence_level, nutrition_modifier, score_date")
      .eq("user_id", profile.user_id)
      .order("score_date", { ascending: false })
      .limit(1)
      .maybeSingle();
    const todayPermission = (latestReadiness as { training_permission?: string | null } | null)?.training_permission ?? "unknown";
    const todayConfidence = (latestReadiness as { confidence_level?: string | null } | null)?.confidence_level ?? "unknown";
    const todayNutritionMod = (latestReadiness as { nutrition_modifier?: string | null } | null)?.nutrition_modifier ?? "unknown";

    // Build Sonnet prompt
    const sonnetPrompt = `You are a performance nutrition coach helping your client prepare nutritionally for next week's training.

CLIENT:
- Goal: ${profile.goal || "fat_loss"}
- Weight: ${profile.measurement_weight_kg || "unknown"}kg

CURRENT DAILY MACRO TARGETS:
- Protein: ${targets?.target_protein_g || 150}g
- Carbs: ${targets?.target_carbs_g || 170}g
- Fat: ${targets?.target_fat_g || 70}g
- Calories: ${targets?.target_calories || 1800}

THIS WEEK'S READINESS TREND: ${avgReadiness ? `avg ${avgReadiness}/100` : "no data"}

NEXT WEEK'S TRAINING PLAN:
${JSON.stringify(weeklyPlan, null, 2)}

Generate a training-nutrition sync card (150-200 words). Structure:

1. **Next Week's Training Overview** (2-3 sentences summarizing the plan — use actual day names)
2. **Carb Strategy** (specific carb targets per day type):
   - High volume days (legs, upper, push/pull, >15 sets): +20-30g carbs from current target
   - Light/rest/conditioning days: -10-20g carbs from current target
   - List each day with suggested carb target
3. **One Key Nutrition Focus** (single most important thing for this training block)
4. **User Choice** (end with "Adjust targets? Reply Y to apply or keep current targets")

Rules:
- Be specific to their actual plan (use exercise names, day names from the plan)
- If no clear high/low volume split: keep carbs flat, focus on timing
- If readiness was low this week: suggest extra carbs for recovery
- If readiness was high: maintain current targets
- Tone: logistics coach, practical, no fluff
- Keep it actionable not educational

Output: Plain text, 150-200 words. Start with 🏋️`;

    let trainingCard: string;
    try {
      const response = await anthropic.messages.create({
        model: "claude-sonnet-4-6",
        max_tokens: 400,
        system: buildApexSystemPrompt({
          proficiency: (profile as any).experience_level,
          name: (profile as any).name,
        }),
        messages: [{ role: "user", content: sonnetPrompt }],
      });
      trainingCard = response.content[0].type === "text"
        ? response.content[0].text
        : "Training sync unavailable. Check back Thursday evening.";
    } catch (e) {
      console.error("Sonnet error:", e);
      trainingCard = "Training sync unavailable. Check back Thursday evening.";
    }

    // Store card
    await supa.from("daily_coaching_cards").upsert({
      user_id: profile.user_id,
      card_date: today,
      card_type: "training_sync",
      content: trainingCard,
    }, { onConflict: "user_id,card_date,card_type" });

    results.push({
      user_id: profile.user_id,
      status: "generated",
      preview: trainingCard.slice(0, 150) + "...",
    });
  }

  return new Response(
    JSON.stringify({ ok: true, processed: profiles?.length ?? 0, results }),
    { headers: { ...cors, "Content-Type": "application/json" } }
  );
});
