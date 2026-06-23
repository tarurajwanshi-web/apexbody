import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { requireInternalSecret, corsAllowHeaders } from "../_shared/authorize.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": corsAllowHeaders,
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// Convert UTC time to user local time and check if it matches target hour
function isUserLocalHour(timezone: string, targetHour: number): boolean {
  try {
    const now = new Date();
    const fmt = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      hour: "numeric",
      hour12: false,
    });
    const localHour = parseInt(fmt.format(now));
    return localHour === targetHour;
  } catch {
    return false;
  }
}

// Get user local date (YYYY-MM-DD)
function getUserLocalDate(timezone: string): string {
  try {
    const fmt = new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
    return fmt.format(new Date());
  } catch {
    return new Date().toISOString().slice(0, 10);
  }
}

// Format dotted separator line
function dottedLine(): string {
  return "••••••••••••••••••••••••••••••••••••";
}

// Status icon based on actual vs target
function macroStatus(actual: number, target: number, tolerance = 10): string {
  if (actual >= target - tolerance) return "✅";
  if (actual >= target * 0.85) return "⚠️";
  return "❌";
}

// Format sodium display
function formatSodium(mg: number): string {
  if (mg >= 1000) return `${(mg / 1000).toFixed(1)}k mg`;
  return `${Math.round(mg)} mg`;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supa = createClient(supabaseUrl, supabaseKey);

  // Auth check
  const authz = await requireInternalSecret(req, supa);
  if (!authz.ok) {
    return new Response(JSON.stringify({ error: authz.error }), {
      status: authz.status,
      headers: { ...cors, "Content-Type": "application/json" },
    });
  }

  let body: { user_id?: string; force?: boolean } = {};
  try { body = await req.json(); } catch { /* cron has no body */ }

  const force = body.force === true;

  // Fetch profiles
  let profiles: any[];
  try {
    const query = supa
      .from("profiles")
      .select("user_id, timezone, coaching_time")
      .not("profile_completed_at", "is", null);

    if (body.user_id) query.eq("user_id", body.user_id);

    const { data, error } = await query;
    if (error) throw error;
    profiles = data ?? [];
  } catch (e) {
    return new Response(
      JSON.stringify({ ok: false, error: String(e instanceof Error ? e.message : e) }),
      { status: 500, headers: { ...cors, "Content-Type": "application/json" } }
    );
  }

  const results = [];

  for (const profile of profiles) {
    const tz = profile.timezone || "Asia/Dubai";
    const coachingHour = profile.coaching_time
      ? parseInt(profile.coaching_time.split(":")[0])
      : 21; // Default 9 PM

    const today = getUserLocalDate(tz);

    // Check if it's time (skip if not forced)
    if (!force && !isUserLocalHour(tz, coachingHour)) {
      results.push({ user_id: profile.user_id, status: "skipped", reason: "not_coaching_time" });
      continue;
    }

    // Idempotency: skip if scorecard already generated today
    const { data: existing } = await supa
      .from("daily_coaching_cards")
      .select("id")
      .eq("user_id", profile.user_id)
      .eq("card_date", today)
      .eq("card_type", "daily_scorecard")
      .maybeSingle();

    if (existing && !force) {
      results.push({ user_id: profile.user_id, status: "skipped", reason: "already_generated" });
      continue;
    }

    // Get user's macro targets
    const { data: targets } = await supa
      .from("daily_macro_targets")
      .select("target_calories, target_protein_g, target_carbs_g, target_fat_g")
      .eq("user_id", profile.user_id)
      .is("effective_end_date", null)
      .maybeSingle();

    const targetProtein = targets?.target_protein_g || 150;
    const targetCarbs = targets?.target_carbs_g || 170;
    const targetFat = targets?.target_fat_g || 70;
    const targetCalories = targets?.target_calories || 1800;

    // Aggregate today's meals from nutrition_meal_full_analysis
    const { data: meals } = await supa
      .from("nutrition_meal_full_analysis")
      .select("protein_g, carbs_g, fat_g, fiber_g, sodium_mg")
      .eq("user_id", profile.user_id)
      .eq("entry_date", today);

    // Edge case: no meals logged
    if (!meals || meals.length === 0) {
      const noMealCard = "No meals logged today. Log something to get your daily coaching note. 📱";

      await supa.from("daily_coaching_cards").upsert({
        user_id: profile.user_id,
        card_date: today,
        card_type: "daily_scorecard",
        content: noMealCard,
      }, { onConflict: "user_id,card_date,card_type" });

      results.push({ user_id: profile.user_id, status: "no_meals", card: noMealCard });
      continue;
    }

    // Aggregate macros
    const totalProtein = Math.round(meals.reduce((s, m) => s + (m.protein_g || 0), 0));
    const totalCarbs = Math.round(meals.reduce((s, m) => s + (m.carbs_g || 0), 0));
    const totalFat = Math.round(meals.reduce((s, m) => s + (m.fat_g || 0), 0));
    const totalFiber = Math.round(meals.reduce((s, m) => s + (m.fiber_g || 0), 0));
    const totalSodium = Math.round(meals.reduce((s, m) => s + (m.sodium_mg || 0), 0));
    const mealCount = meals.length;
    const totalCalories = Math.round(totalProtein * 4 + totalCarbs * 4 + totalFat * 9);
    const compliancePct = Math.round((totalCalories / targetCalories) * 100);

    // Store daily summary
    await supa.from("nutrition_daily_summaries").upsert({
      user_id: profile.user_id,
      summary_date: today,
      total_protein: totalProtein,
      total_carbs: totalCarbs,
      total_fat: totalFat,
      total_fiber: totalFiber,
      total_sodium: totalSodium,
      meal_count: mealCount,
      compliance_pct: Math.min(compliancePct, 100),
    }, { onConflict: "user_id,summary_date" });

    // Format scorecard
    const now = new Date();
    const timeStr = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    }).format(now);

    // Late meal note
    const lateMealNote = mealCount > 0
      ? "\n\n⏰ Logged meals after this time will appear in tomorrow's summary."
      : "";

    const card = `📊 Today's Summary (${timeStr})

Protein: ${totalProtein}g / ${targetProtein}g ${macroStatus(totalProtein, targetProtein)}
${dottedLine()}

Carbs: ${totalCarbs}g / ${targetCarbs}g ${macroStatus(totalCarbs, targetCarbs)}
${dottedLine()}

Fat: ${totalFat}g / ${targetFat}g ${macroStatus(totalFat, targetFat)}
${dottedLine()}

Fiber: ${totalFiber}g ${totalFiber >= 20 ? "✅" : "⚠️"} | Sodium: ${formatSodium(totalSodium)} ${totalSodium > 2500 ? "⚠️" : "✅"}

Meals Logged: ${mealCount}
Compliance: ${Math.min(compliancePct, 100)}%${lateMealNote}`;

    // Store card (upsert for idempotency)
    await supa.from("daily_coaching_cards").upsert({
      user_id: profile.user_id,
      card_date: today,
      card_type: "daily_scorecard",
      content: card,
    }, { onConflict: "user_id,card_date,card_type" });

    results.push({
      user_id: profile.user_id,
      status: "generated",
      card,
      totals: { totalProtein, totalCarbs, totalFat, totalFiber, totalSodium, mealCount, compliancePct },
    });
  }

  return new Response(
    JSON.stringify({ ok: true, processed: profiles.length, results }),
    { headers: { ...cors, "Content-Type": "application/json" } }
  );
});
