import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import Anthropic from "https://esm.sh/@anthropic-ai/sdk@0.24.0";
import { requireInternalSecret, corsAllowHeaders } from "../_shared/authorize.ts";

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

function isUserLocalHour(timezone: string, targetHour: number, targetMinute = 0): boolean {
  try {
    const now = new Date();
    const fmt = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      hour: "numeric",
      minute: "2-digit",
      hour12: false,
    });
    const parts = fmt.formatToParts(now);
    const hour = parseInt(parts.find(p => p.type === "hour")?.value || "0");
    const minute = parseInt(parts.find(p => p.type === "minute")?.value || "0");
    return hour === targetHour && minute >= targetMinute && minute < targetMinute + 5;
  } catch {
    return false;
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

  // Fetch profiles
  const profileQuery = supa
    .from("profiles")
    .select("user_id, timezone, coaching_time, goal, measurement_weight_kg, biological_sex, age")
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
    const coachingHour = profile.coaching_time
      ? parseInt(profile.coaching_time.split(":")[0])
      : 21;
    const noteHour = coachingHour;
    const noteMinute = 5; // 5 min after scorecard

    const today = getUserLocalDate(tz);

    // Time gate
    if (!force && !isUserLocalHour(tz, noteHour, noteMinute)) {
      results.push({ user_id: profile.user_id, status: "skipped", reason: "not_coaching_time" });
      continue;
    }

    // Idempotency
    const { data: existing } = await supa
      .from("daily_coaching_cards")
      .select("id")
      .eq("user_id", profile.user_id)
      .eq("card_date", today)
      .eq("card_type", "daily_note")
      .maybeSingle();

    if (existing && !force) {
      results.push({ user_id: profile.user_id, status: "skipped", reason: "already_generated" });
      continue;
    }

    // Edge case: no meals logged
    const { data: meals } = await supa
      .from("nutrition_meal_full_analysis")
      .select("protein_g, carbs_g, fat_g, fiber_g, sodium_mg, food_sources, flags, quality_assessment, coach_insight, timing_implications, micronutrients")
      .eq("user_id", profile.user_id)
      .eq("entry_date", today);

    if (!meals || meals.length === 0) {
      const noMealNote = "No meals logged today — nothing to coach on. Log your meals tomorrow and I'll give you a full daily breakdown. 💪";
      await supa.from("daily_coaching_cards").upsert({
        user_id: profile.user_id,
        card_date: today,
        card_type: "daily_note",
        content: noMealNote,
      }, { onConflict: "user_id,card_date,card_type" });
      results.push({ user_id: profile.user_id, status: "no_meals" });
      continue;
    }

    // Get macro targets
    const { data: targets } = await supa
      .from("daily_macro_targets")
      .select("target_protein_g, target_carbs_g, target_fat_g, target_calories")
      .eq("user_id", profile.user_id)
      .is("effective_end_date", null)
      .maybeSingle();

    const targetProtein = targets?.target_protein_g || 150;
    const targetCarbs = targets?.target_carbs_g || 170;
    const targetFat = targets?.target_fat_g || 70;

    // Aggregate today's totals
    const totalProtein = Math.round(meals.reduce((s, m) => s + (m.protein_g || 0), 0));
    const totalCarbs = Math.round(meals.reduce((s, m) => s + (m.carbs_g || 0), 0));
    const totalFat = Math.round(meals.reduce((s, m) => s + (m.fat_g || 0), 0));
    const totalFiber = Math.round(meals.reduce((s, m) => s + (m.fiber_g || 0), 0));
    const totalSodium = Math.round(meals.reduce((s, m) => s + (m.sodium_mg || 0), 0));

    // Collect all food sources + insights from today's meals
    const allFoodSources = meals.flatMap(m => m.food_sources || []);
    const allFlags = meals.flatMap(m => m.flags || []);
    const allInsights = meals.map(m => m.coach_insight).filter(Boolean);
    const allTimings = meals.map(m => m.timing_implications).filter(Boolean);

    // Get this week's food frequency (last 7 days)
    const weekAgo = new Date();
    weekAgo.setDate(weekAgo.getDate() - 7);
    const weekAgoStr = weekAgo.toISOString().slice(0, 10);

    const { data: weekMeals } = await supa
      .from("nutrition_meal_full_analysis")
      .select("food_sources, flags, coach_insight")
      .eq("user_id", profile.user_id)
      .gte("entry_date", weekAgoStr)
      .lt("entry_date", today);

    // Count food frequency this week
    const foodFrequency: Record<string, number> = {};
    for (const meal of weekMeals ?? []) {
      for (const food of meal.food_sources || []) {
        foodFrequency[food] = (foodFrequency[food] || 0) + 1;
      }
    }
    const topWeekFoods = Object.entries(foodFrequency)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([food, count]) => `${food} (${count}x this week)`);

    // Get flags already shown this week (avoid repeating same flag)
    const weekFlags = (weekMeals ?? []).flatMap(m => m.flags || []);
    const weekInsights = (weekMeals ?? []).map(m => m.coach_insight).filter(Boolean);

    // Build Haiku prompt
    const haikuPrompt = `You are a personal nutrition coach reviewing your client's eating for today.

User profile:
- Goal: ${profile.goal || "fat_loss"}
- Weight: ${profile.measurement_weight_kg || 75}kg
- Sex: ${profile.biological_sex || "not specified"}
- Age: ${profile.age || "not specified"}

Daily macro targets:
- Protein: ${targetProtein}g
- Carbs: ${targetCarbs}g  
- Fat: ${targetFat}g

Today's totals:
- Protein: ${totalProtein}g (${totalProtein >= targetProtein ? "✅ hit" : `❌ short ${targetProtein - totalProtein}g`})
- Carbs: ${totalCarbs}g (${totalCarbs >= targetCarbs * 0.9 ? "✅ hit" : `⚠️ short ${targetCarbs - totalCarbs}g`})
- Fat: ${totalFat}g (${totalFat <= targetFat * 1.1 ? "✅ on track" : `⚠️ over by ${totalFat - targetFat}g`})
- Fiber: ${totalFiber}g ${totalFiber >= 20 ? "(✅ good)" : "(⚠️ low)"}
- Sodium: ${totalSodium}mg ${totalSodium > 2500 ? "(⚠️ high)" : "(✅ ok)"}
- Meals logged: ${meals.length}

Today's foods eaten: ${allFoodSources.join(", ")}

What GPT-4o mini found in today's meals:
${allInsights.join(". ")}

Timing observations:
${allTimings.join(". ")}

Today's flags: ${allFlags.join(", ") || "none"}

This week's most frequent foods: ${topWeekFoods.join(", ") || "not enough data yet"}

Flags already shown this week (DO NOT repeat these): ${[...new Set(weekFlags)].join(", ") || "none"}

Instructions:
1. Write a daily coach note (150-200 words)
2. Start by celebrating ONE specific win from today (protein hit, good timing, great food choice, micronutrient, etc)
3. Then give ONE observation or suggestion (something NEW — not already in this week's flags)
4. If goal = fat_loss: focus on protein, satiety, variety, calorie balance
5. If goal = muscle_gain: focus on surplus, carbs, post-workout timing
6. If goal = recomposition: focus on protein + calorie balance
7. If goal = strength or athletic_performance: focus on carbs, power, performance
8. Mention specific foods they ate today (not generic)
9. If sodium high: mention water retention expectation (scale might be up tomorrow, it's water not fat)
10. If fiber low: suggest specific high-fiber food for tomorrow
11. Tone: proud coach, not judge. Warm, specific, encouraging.
12. End with one forward-looking sentence about tomorrow.
13. DO NOT use generic statements like "great job" or "keep it up" — be specific to their actual meals.`;

    let coachNote: string;
    try {
      const response = await anthropic.messages.create({
        model: "claude-3-5-haiku-20241022",
        max_tokens: 400,
        messages: [{ role: "user", content: haikuPrompt }],
      });
      coachNote = response.content[0].type === "text"
        ? response.content[0].text
        : "Great logging today. Keep it up tomorrow.";
    } catch (e) {
      console.error("Haiku error:", e);
      coachNote = "Great logging today. Check back tomorrow for your coaching note.";
    }

    // Store card
    await supa.from("daily_coaching_cards").upsert({
      user_id: profile.user_id,
      card_date: today,
      card_type: "daily_note",
      content: coachNote,
    }, { onConflict: "user_id,card_date,card_type" });

    results.push({
      user_id: profile.user_id,
      status: "generated",
      note_preview: coachNote.slice(0, 100) + "...",
    });
  }

  return new Response(
    JSON.stringify({ ok: true, processed: profiles?.length ?? 0, results }),
    { headers: { ...cors, "Content-Type": "application/json" } }
  );
});
