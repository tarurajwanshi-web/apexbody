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

function isUserLocalFridayEvening(timezone: string): boolean {
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
    return weekday === "Friday" && hour === 20;
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
    .select("user_id, timezone, goal, measurement_weight_kg, biological_sex, age")
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
    const weekStart = addDays(today, -7);

    // Time gate: Friday 8 PM user local time
    if (!force && !isUserLocalFridayEvening(tz)) {
      results.push({ user_id: profile.user_id, status: "skipped", reason: "not_friday_8pm" });
      continue;
    }

    // Idempotency: one weekly pattern per week
    const { data: existing } = await supa
      .from("daily_coaching_cards")
      .select("id")
      .eq("user_id", profile.user_id)
      .eq("card_date", today)
      .eq("card_type", "weekly_pattern")
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

    // Get last 7 days of meals
    const { data: meals } = await supa
      .from("nutrition_meal_full_analysis")
      .select("entry_date, protein_g, carbs_g, fat_g, fiber_g, sodium_mg, food_sources, flags, coach_insight, quality_assessment, micronutrients")
      .eq("user_id", profile.user_id)
      .gte("entry_date", weekStart)
      .lte("entry_date", today)
      .order("entry_date", { ascending: true });

    // Edge case: insufficient data
    if (!meals || meals.length < 3) {
      const lowDataCard = `📊 Weekly Review\n\nNot enough meals logged this week to generate a pattern (${meals?.length || 0} meals found — need at least 3).\n\nLog consistently next week and I'll give you a full weekly breakdown with patterns, insights, and experiments to try.`;
      await supa.from("daily_coaching_cards").upsert({
        user_id: profile.user_id,
        card_date: today,
        card_type: "weekly_pattern",
        content: lowDataCard,
      }, { onConflict: "user_id,card_date,card_type" });
      results.push({ user_id: profile.user_id, status: "insufficient_data" });
      continue;
    }

    // Aggregate weekly data
    const daysLogged = new Set(meals.map(m => m.entry_date)).size;
    const totalMeals = meals.length;
    const avgProtein = Math.round(meals.reduce((s, m) => s + (m.protein_g || 0), 0) / daysLogged);
    const avgCarbs = Math.round(meals.reduce((s, m) => s + (m.carbs_g || 0), 0) / daysLogged);
    const avgFat = Math.round(meals.reduce((s, m) => s + (m.fat_g || 0), 0) / daysLogged);
    const avgFiber = Math.round(meals.reduce((s, m) => s + (m.fiber_g || 0), 0) / daysLogged);
    const avgSodium = Math.round(meals.reduce((s, m) => s + (m.sodium_mg || 0), 0) / daysLogged);

    // Food frequency
    const foodFrequency: Record<string, number> = {};
    for (const meal of meals) {
      for (const food of meal.food_sources || []) {
        foodFrequency[food] = (foodFrequency[food] || 0) + 1;
      }
    }
    const topFoods = Object.entries(foodFrequency)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([food, count]) => `${food} (${count}x)`);

    // Flag frequency
    const flagFrequency: Record<string, number> = {};
    for (const meal of meals) {
      for (const flag of meal.flags || []) {
        flagFrequency[flag] = (flagFrequency[flag] || 0) + 1;
      }
    }
    const topFlags = Object.entries(flagFrequency)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([flag, count]) => `${flag} (${count} meals)`);

    // All coach insights from week
    const weekInsights = meals
      .map(m => m.coach_insight)
      .filter(Boolean)
      .slice(0, 5);

    // Weight trend
    const { data: weights } = await supa
      .from("body_measurement_events")
      .select("entry_date, weight_kg")
      .eq("user_id", profile.user_id)
      .gte("entry_date", weekStart)
      .lte("entry_date", today)
      .order("entry_date", { ascending: true });

    let weightTrend = "no weight data logged this week";
    if (weights && weights.length >= 2) {
      const startWeight = Number(weights[0].weight_kg);
      const endWeight = Number(weights[weights.length - 1].weight_kg);
      const delta = endWeight - startWeight;
      weightTrend = delta < 0
        ? `down ${Math.abs(delta).toFixed(1)}kg (${startWeight}kg → ${endWeight}kg)`
        : delta > 0
        ? `up ${delta.toFixed(1)}kg (${startWeight}kg → ${endWeight}kg)`
        : `stable at ${startWeight}kg`;
    }

    // Training data
    const { data: trainingLogs } = await supa
      .from("shield_training_logs")
      .select("entry_date, strain_value, session_notes")
      .eq("user_id", profile.user_id)
      .gte("entry_date", weekStart)
      .lte("entry_date", today);

    const { data: setLogs } = await supa
      .from("workout_set_logs")
      .select("entry_date")
      .eq("user_id", profile.user_id)
      .eq("completed", true)
      .gte("entry_date", weekStart)
      .lte("entry_date", today);

    const totalSets = setLogs?.length || 0;
    const avgStrain = trainingLogs && trainingLogs.length > 0
      ? (trainingLogs.reduce((s, t) => s + (t.strain_value || 0), 0) / trainingLogs.length).toFixed(1)
      : "0";
    const trainingDays = new Set(trainingLogs?.map(t => t.entry_date) || []).size;

    // Build Sonnet prompt
    const sonnetPrompt = `You are a world-class personal nutrition and performance coach doing a Friday weekly review for your client.

CLIENT PROFILE:
- Goal: ${profile.goal || "fat_loss"}
- Weight: ${profile.measurement_weight_kg || "unknown"}kg
- Sex: ${profile.biological_sex || "not specified"}
- Age: ${profile.age || "not specified"}

MACRO TARGETS:
- Protein: ${targets?.target_protein_g || 150}g/day
- Carbs: ${targets?.target_carbs_g || 170}g/day
- Fat: ${targets?.target_fat_g || 70}g/day
- Calories: ${targets?.target_calories || 1800}/day

THIS WEEK'S NUTRITION:
- Days logged: ${daysLogged}/7
- Total meals: ${totalMeals}
- Avg daily protein: ${avgProtein}g (target: ${targets?.target_protein_g || 150}g)
- Avg daily carbs: ${avgCarbs}g (target: ${targets?.target_carbs_g || 170}g)
- Avg daily fat: ${avgFat}g (target: ${targets?.target_fat_g || 70}g)
- Avg daily fiber: ${avgFiber}g
- Avg daily sodium: ${avgSodium}mg

TOP FOODS THIS WEEK: ${topFoods.join(", ") || "not enough data"}

RECURRING FLAGS: ${topFlags.join(", ") || "none"}

INSIGHTS FROM MEALS: ${weekInsights.join(". ") || "none"}

WEIGHT TREND: ${weightTrend}

TRAINING THIS WEEK:
- Training days: ${trainingDays}
- Total sets completed: ${totalSets}
- Avg strain: ${avgStrain}

Generate a weekly pattern review (250-300 words). Structure:

1. **What's Working** (celebrate 3-4 specific wins — use their actual data, not generic)
2. **Pattern to Notice** (one recurring pattern from their actual foods/flags — not judgment, just observation)
3. **One Experiment to Try Next Week** (specific, actionable, with expected outcome)
4. **Your Body This Week** (connect training + nutrition + weight trend — what actually happened)

Rules:
- Use their actual foods by name (not "protein sources" — say "chicken" or "eggs")
- If weight trending correctly for goal → celebrate + reinforce
- If weight wrong direction → suggest one adjustment (not multiple)
- If daysLogged < 5 → mention logging consistency as the priority
- If totalSets > 0 → connect training to nutrition (carbs fueling sets, protein supporting recovery)
- If totalSets = 0 → focus purely on nutrition patterns
- Goal = fat_loss: celebrate deficit adherence, protein consistency, variety
- Goal = muscle_gain: celebrate surplus, carb timing, protein above target
- Goal = recomposition: celebrate protein max, calorie balance, "scale flat is good"
- Goal = strength: celebrate carbs, power, performance
- Tone: excited coach who genuinely cares, not a nutrition textbook
- End with one motivating sentence for next week

Output: Plain text, 250-300 words. Start with 📊`;

    let weeklyCard: string;
    try {
      const response = await anthropic.messages.create({
        model: "claude-sonnet-4-6",
        max_tokens: 600,
        messages: [{ role: "user", content: sonnetPrompt }],
      });
      weeklyCard = response.content[0].type === "text"
        ? response.content[0].text
        : "Weekly review unavailable. Check back next Friday.";
    } catch (e) {
      console.error("Sonnet error:", e);
      weeklyCard = "Weekly review unavailable. Check back next Friday.";
    }

    // Store card
    await supa.from("daily_coaching_cards").upsert({
      user_id: profile.user_id,
      card_date: today,
      card_type: "weekly_pattern",
      content: weeklyCard,
    }, { onConflict: "user_id,card_date,card_type" });

    results.push({
      user_id: profile.user_id,
      status: "generated",
      preview: weeklyCard.slice(0, 150) + "...",
    });
  }

  return new Response(
    JSON.stringify({ ok: true, processed: profiles?.length ?? 0, results }),
    { headers: { ...cors, "Content-Type": "application/json" } }
  );
});
