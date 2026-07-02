import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import Anthropic from "https://esm.sh/@anthropic-ai/sdk@0.24.0";
import { requireInternalSecret, corsAllowHeaders } from "../_shared/authorize.ts";
import { buildApexSystemPrompt } from "../_shared/apex-voice.ts";
import { isRollingCadenceDue } from "../_shared/time-helpers.ts";

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

type DetectedPattern = {
  pattern_type: string;
  pattern_key: string;
  description: string;
  data_points: number;
  correlation_coeff: number | null;
  metadata: Record<string, unknown>;
};

async function generatePatternExplanation(
  lovableKey: string,
  pattern: DetectedPattern,
  ctx: { age: number | null; goal: string | null; proficiency: string | null },
): Promise<{ explanation: string; protocol: string } | null> {
  if (!lovableKey) return null;
  const sys =
    "You're explaining a user's unique recovery pattern based on 4+ weeks of data. " +
    "Be concrete and personal. Don't be generic. Explain the physiology simply. " +
    "Provide a specific weekly protocol they can follow. " +
    'Output ONLY JSON: { "explanation": string, "protocol": string }. ' +
    "Plain text, no markdown, no emoji. Keep each field under 240 chars.";
  const user =
    `Pattern: ${pattern.description}\n` +
    `Type: ${pattern.pattern_type}\n` +
    `Key: ${pattern.pattern_key}\n` +
    `Observations: ${pattern.data_points}\n` +
    `Metadata: ${JSON.stringify(pattern.metadata)}\n` +
    `User age: ${ctx.age ?? "unknown"}\n` +
    `Goal: ${ctx.goal ?? "general"}\n` +
    `Proficiency: ${ctx.proficiency ?? "intermediate"}\n\n` +
    "Explain why this happens (physiology, 1-2 sentences). Provide a weekly protocol (1-2 sentences, specific days/intensities).";
  try {
    const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Lovable-API-Key": lovableKey,
        "X-Lovable-AIG-SDK": "vercel-ai-sdk",
      },
      body: JSON.stringify({
        model: "openai/gpt-5-mini",
        messages: [
          { role: "system", content: sys },
          { role: "user", content: user },
        ],
        response_format: { type: "json_object" },
      }),
    });
    if (!res.ok) {
      console.error("pattern explanation failed:", res.status, await res.text());
      return null;
    }
    const json = await res.json();
    const text = json?.choices?.[0]?.message?.content ?? "";
    const parsed = JSON.parse(text);
    if (parsed && typeof parsed.explanation === "string" && typeof parsed.protocol === "string") {
      return { explanation: parsed.explanation, protocol: parsed.protocol };
    }
    return null;
  } catch (e) {
    console.error("pattern explanation error:", e);
    return null;
  }
}

function detectExerciseLagPatterns(
  setRows: Array<{ exercise_name: string; entry_date: string }>,
  readinessByDate: Map<string, number>,
): DetectedPattern[] {
  const patterns: DetectedPattern[] = [];
  if (!setRows.length || readinessByDate.size === 0) return patterns;

  // top exercises by frequency of distinct workout dates
  const datesByExercise = new Map<string, Set<string>>();
  for (const r of setRows) {
    if (!r.exercise_name) continue;
    const key = r.exercise_name.toLowerCase().trim();
    if (!datesByExercise.has(key)) datesByExercise.set(key, new Set());
    datesByExercise.get(key)!.add(r.entry_date);
  }

  const allReadiness = [...readinessByDate.values()];
  const baseline =
    allReadiness.reduce((s, n) => s + n, 0) / Math.max(1, allReadiness.length);

  const candidates = [...datesByExercise.entries()]
    .filter(([, dates]) => dates.size >= 4)
    .sort((a, b) => b[1].size - a[1].size)
    .slice(0, 3);

  for (const [exercise, dateSet] of candidates) {
    const lagScores: number[] = [];
    for (const d of dateSet) {
      const dt = new Date(d + "T00:00:00Z");
      dt.setUTCDate(dt.getUTCDate() + 2);
      const lagDate = dt.toISOString().slice(0, 10);
      const r = readinessByDate.get(lagDate);
      if (typeof r === "number") lagScores.push(r);
    }
    if (lagScores.length < 4) continue;
    const avgLag = lagScores.reduce((s, n) => s + n, 0) / lagScores.length;
    const delta = avgLag - baseline; // negative = readiness dips
    if (delta <= -3) {
      patterns.push({
        pattern_type: "exercise_lag",
        pattern_key: exercise,
        description: `Readiness drops ${Math.abs(delta).toFixed(1)} points two days after ${exercise} (${lagScores.length} observations).`,
        data_points: lagScores.length,
        correlation_coeff: Number((-delta / 10).toFixed(3)),
        metadata: {
          exercise,
          days_to_recover: 2,
          avg_lag_readiness: Number(avgLag.toFixed(1)),
          baseline_readiness: Number(baseline.toFixed(1)),
          delta: Number(delta.toFixed(1)),
        },
      });
    }
  }
  return patterns;
}

function detectSleepEffectPattern(
  sleepByDate: Map<string, number>,
  readinessByDate: Map<string, number>,
): DetectedPattern | null {
  const pairs: Array<{ sleep: number; readiness: number }> = [];
  for (const [date, sleep] of sleepByDate.entries()) {
    const dt = new Date(date + "T00:00:00Z");
    dt.setUTCDate(dt.getUTCDate() + 1);
    const next = dt.toISOString().slice(0, 10);
    const r = readinessByDate.get(next);
    if (typeof r === "number") pairs.push({ sleep, readiness: r });
  }
  if (pairs.length < 4) return null;

  const n = pairs.length;
  const meanX = pairs.reduce((s, p) => s + p.sleep, 0) / n;
  const meanY = pairs.reduce((s, p) => s + p.readiness, 0) / n;
  let num = 0;
  let denX = 0;
  let denY = 0;
  for (const p of pairs) {
    const dx = p.sleep - meanX;
    const dy = p.readiness - meanY;
    num += dx * dy;
    denX += dx * dx;
    denY += dy * dy;
  }
  if (denX <= 0 || denY <= 0) return null;
  const slope = num / denX; // readiness pts per hour of sleep
  const r = num / Math.sqrt(denX * denY);
  if (Math.abs(r) < 0.4 || Math.abs(slope) < 1) return null;

  return {
    pattern_type: "sleep_effect",
    pattern_key: "sleep_to_readiness",
    description: `Each extra hour of sleep adds ${slope.toFixed(1)} readiness points the next day (${n} observations).`,
    data_points: n,
    correlation_coeff: Number(r.toFixed(3)),
    metadata: {
      slope_per_hour: Number(slope.toFixed(2)),
      mean_sleep_h: Number(meanX.toFixed(1)),
      mean_readiness: Number(meanY.toFixed(1)),
    },
  };
}


Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const anthropicKey = Deno.env.get("ANTHROPIC_API_KEY")!;
  const lovableKey = Deno.env.get("LOVABLE_API_KEY") || "";

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
    .select("user_id, timezone, goal, measurement_weight_kg, biological_sex, age, name, experience_level")
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

Generate a weekly pattern review (250-300 words) as flowing plain-text paragraphs — no markdown, no numbering, no bold, no headers. Cover these four things in order, as natural prose transitions, not labeled sections:

Start by celebrating 3-4 specific wins from their actual data, not generic praise. Then note one recurring pattern from their actual foods or flags, framed as observation, not judgment. Then suggest one specific, actionable experiment to try next week with an expected outcome. Close by connecting training, nutrition, and weight trend into what actually happened to their body this week.

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
        system: buildApexSystemPrompt({
          proficiency: (profile as any).experience_level,
          name: (profile as any).name,
        }),
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

    // --- Recovery pattern memory: detect + explain + persist (30d window) ---
    let patternsStored = 0;
    try {
      const patternStart = addDays(today, -30);

      const { data: setRows30 } = await supa
        .from("workout_set_logs")
        .select("exercise_name, entry_date")
        .eq("user_id", profile.user_id)
        .eq("completed", true)
        .gte("entry_date", patternStart)
        .lte("entry_date", today);

      const { data: readiness30 } = await supa
        .from("readiness_scores")
        .select("score_date, final_score")
        .eq("user_id", profile.user_id)
        .gte("score_date", patternStart)
        .lte("score_date", today);

      const { data: sleep30 } = await supa
        .from("shield_manual_inputs")
        .select("entry_date, sleep_hours")
        .eq("user_id", profile.user_id)
        .gte("entry_date", patternStart)
        .lte("entry_date", today)
        .not("sleep_hours", "is", null);

      const readinessByDate = new Map<string, number>();
      for (const r of readiness30 ?? []) {
        if (r.score_date && typeof r.final_score === "number") {
          readinessByDate.set(r.score_date, Number(r.final_score));
        }
      }
      const sleepByDate = new Map<string, number>();
      for (const r of sleep30 ?? []) {
        if (r.entry_date && r.sleep_hours != null) {
          sleepByDate.set(r.entry_date, Number(r.sleep_hours));
        }
      }

      const detected: DetectedPattern[] = [];
      detected.push(
        ...detectExerciseLagPatterns(
          (setRows30 ?? []) as Array<{ exercise_name: string; entry_date: string }>,
          readinessByDate,
        ),
      );
      const sleepPattern = detectSleepEffectPattern(sleepByDate, readinessByDate);
      if (sleepPattern) detected.push(sleepPattern);

      const proficiency =
        (profile as { experience_level?: string }).experience_level ?? null;

      for (const p of detected) {
        if (p.data_points < 4) continue;
        const explained = await generatePatternExplanation(lovableKey, p, {
          age: (profile.age as number | null) ?? null,
          goal: (profile.goal as string | null) ?? null,
          proficiency,
        });
        const { error: upsertErr } = await supa
          .from("user_recovery_patterns")
          .upsert(
            {
              user_id: profile.user_id,
              pattern_type: p.pattern_type,
              pattern_key: p.pattern_key,
              description: p.description,
              explanation: explained?.explanation ?? null,
              protocol: explained?.protocol ?? null,
              data_points: p.data_points,
              correlation_coeff: p.correlation_coeff,
              metadata: p.metadata,
              detected_at: new Date().toISOString(),
            },
            { onConflict: "user_id,pattern_type,pattern_key" },
          );
        if (!upsertErr) patternsStored += 1;
        else console.error("pattern upsert error:", upsertErr);
      }
    } catch (e) {
      console.error("pattern memory phase error:", e);
    }

    results.push({
      user_id: profile.user_id,
      status: "generated",
      patterns_stored: patternsStored,
      preview: weeklyCard.slice(0, 150) + "...",
    });
  }

  return new Response(
    JSON.stringify({ ok: true, processed: profiles?.length ?? 0, results }),
    { headers: { ...cors, "Content-Type": "application/json" } }
  );
});
