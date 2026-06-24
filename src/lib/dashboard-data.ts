// Dashboard data loader — client-side batch fetch via the authenticated
// supabase browser client. RLS scopes every row to the current user.
// This file is intentionally NOT a server function: the existing dashboard
// already mixes server fns + direct browser reads, and a single batch here
// keeps the redesign self-contained without touching middleware wiring.

import { supabase } from "@/integrations/supabase/client";
import { getLocalDateISO, addDaysISO, getLocalWeekRange } from "@/lib/dates";

export type DashboardProfile = {
  name: string | null;
  goal: string | null;
  eating_pattern: string | null;
  coaching_time: string | null;
  timezone: string | null;
  profile_completed_at: string | null;
};

export type DashboardReadiness = {
  final_score: number | null;
  pillar_breakdown: Record<string, number | string | null> | null;
  score_date: string | null;
};

export type DashboardMacros = {
  total_protein: number;
  total_carbs: number;
  total_fat: number;
  compliance_pct: number | null;
  meal_count: number;
} | null;

export type DashboardTargets = {
  target_protein_g: number;
  target_carbs_g: number;
  target_fat_g: number;
  target_calories: number;
} | null;

export type DashboardCard = {
  id: string;
  card_type: string;
  content: string;
  card_date: string;
};

export type DashboardWeightTrend = {
  latest_kg: number | null;
  delta_kg: number | null; // latest - previous
  series7d: (number | null)[]; // oldest → newest, length 7
};

export type DashboardMeal = {
  id: string;
  food_sources: string[] | null;
  entry_date: string;
  meal_time: string | null;
};

export type DashboardData = {
  profile: DashboardProfile;
  readiness: DashboardReadiness | null;
  macros: DashboardMacros;
  targets: DashboardTargets;
  cards: DashboardCard[];
  weeklyPlan: any | null; // raw plan_data for current/next week
  todayPlannedSession: {
    rest: boolean;
    session_name: string | null;
    exercises: { name?: string; sets?: number }[];
  } | null;
  todaySetsCount: number;
  todayLastSetTime: string | null;
  weekSetsCount: number;
  lastWeekSetsCount: number;
  complianceAvg7d: number | null;
  weight: DashboardWeightTrend;
  todayMeals: DashboardMeal[];
  recentMeals: DashboardMeal[]; // last 30d for food_sources sampling
  lastLogDate: string | null;
  consistency7d: boolean[]; // oldest → newest, length 7
  compliance7d: (number | null)[]; // oldest → newest, length 7
};

export async function loadDashboardData(userId: string, tz: string): Promise<DashboardData> {
  const today = getLocalDateISO(tz);
  const week = getLocalWeekRange(today);
  const lastWeek = getLocalWeekRange(addDaysISO(week.start, -7));
  const sevenDaysAgo = addDaysISO(today, -6);
  const thirtyDaysAgo = addDaysISO(today, -30);

  const [
    profileRes,
    readinessRes,
    summaryRes,
    summary7Res,
    targetsRes,
    setsTodayRes,
    setsWeekRes,
    setsLastWeekRes,
    cardsRes,
    plansRes,
    weightRes,
    mealsTodayRes,
    mealsRecentRes,
    lastMealRes,
  ] = await Promise.all([
    supabase
      .from("profiles")
      .select("name, goal, eating_pattern, coaching_time, timezone, profile_completed_at")
      .eq("user_id", userId)
      .maybeSingle(),
    supabase
      .from("readiness_scores")
      .select("final_score, pillar_breakdown, score_date")
      .eq("user_id", userId)
      .eq("score_date", today)
      .maybeSingle(),
    supabase
      .from("nutrition_daily_summaries")
      .select("total_protein, total_carbs, total_fat, compliance_pct, meal_count")
      .eq("user_id", userId)
      .eq("summary_date", today)
      .maybeSingle(),
    supabase
      .from("nutrition_daily_summaries")
      .select("compliance_pct")
      .eq("user_id", userId)
      .gte("summary_date", sevenDaysAgo)
      .lte("summary_date", today),
    supabase
      .from("daily_macro_targets")
      .select("target_protein_g, target_carbs_g, target_fat_g, target_calories, effective_start_date, effective_end_date")
      .eq("user_id", userId)
      .lte("effective_start_date", today)
      .order("effective_start_date", { ascending: false })
      .limit(5),
    supabase
      .from("workout_set_logs")
      .select("id, created_at, completed")
      .eq("user_id", userId)
      .eq("entry_date", today),
    supabase
      .from("workout_set_logs")
      .select("id")
      .eq("user_id", userId)
      .gte("entry_date", week.start)
      .lte("entry_date", week.end),
    supabase
      .from("workout_set_logs")
      .select("id")
      .eq("user_id", userId)
      .gte("entry_date", lastWeek.start)
      .lte("entry_date", lastWeek.end),
    supabase
      .from("daily_coaching_cards")
      .select("id, card_type, content, card_date, created_at")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(20),
    supabase
      .from("weekly_plans")
      .select("plan_data, week_start_date")
      .eq("user_id", userId)
      .order("week_start_date", { ascending: false })
      .limit(2),
    supabase
      .from("body_measurement_events")
      .select("weight_kg, entry_date")
      .eq("user_id", userId)
      .not("weight_kg", "is", null)
      .gte("entry_date", sevenDaysAgo)
      .order("entry_date", { ascending: false })
      .limit(14),
    supabase
      .from("nutrition_meal_full_analysis")
      .select("id, food_sources, entry_date, meal_time")
      .eq("user_id", userId)
      .eq("entry_date", today)
      .order("meal_time", { ascending: false }),
    supabase
      .from("nutrition_meal_full_analysis")
      .select("id, food_sources, entry_date, meal_time")
      .eq("user_id", userId)
      .gte("entry_date", thirtyDaysAgo)
      .order("entry_date", { ascending: false })
      .limit(60),
    supabase
      .from("nutrition_meal_full_analysis")
      .select("entry_date")
      .eq("user_id", userId)
      .order("entry_date", { ascending: false })
      .limit(1),
  ]);

  const profile: DashboardProfile = {
    name: (profileRes.data as any)?.name ?? null,
    goal: (profileRes.data as any)?.goal ?? null,
    eating_pattern: (profileRes.data as any)?.eating_pattern ?? null,
    coaching_time: (profileRes.data as any)?.coaching_time ?? null,
    timezone: (profileRes.data as any)?.timezone ?? null,
    profile_completed_at: (profileRes.data as any)?.profile_completed_at ?? null,
  };

  const readiness: DashboardReadiness | null = readinessRes.data
    ? {
        final_score: Number((readinessRes.data as any).final_score ?? 0),
        pillar_breakdown: (readinessRes.data as any).pillar_breakdown ?? null,
        score_date: (readinessRes.data as any).score_date ?? null,
      }
    : null;

  const summary = summaryRes.data as any;
  const macros: DashboardMacros = summary
    ? {
        total_protein: Number(summary.total_protein ?? 0),
        total_carbs: Number(summary.total_carbs ?? 0),
        total_fat: Number(summary.total_fat ?? 0),
        compliance_pct: summary.compliance_pct != null ? Number(summary.compliance_pct) : null,
        meal_count: Number(summary.meal_count ?? 0),
      }
    : null;

  // pick the targets row whose [start,end] window contains today
  const targetRows = ((targetsRes.data as any[]) ?? []).filter((r) => {
    if (!r) return false;
    if (r.effective_end_date && r.effective_end_date < today) return false;
    return true;
  });
  const targetsRow = targetRows[0] ?? null;
  const targets: DashboardTargets = targetsRow
    ? {
        target_protein_g: Number(targetsRow.target_protein_g),
        target_carbs_g: Number(targetsRow.target_carbs_g),
        target_fat_g: Number(targetsRow.target_fat_g),
        target_calories: Number(targetsRow.target_calories),
      }
    : null;

  const setsToday = (setsTodayRes.data as any[]) ?? [];
  const todaySetsCount = setsToday.filter((s) => s.completed).length;
  const todayLastSetTime =
    setsToday
      .map((s) => s.created_at as string)
      .filter(Boolean)
      .sort()
      .reverse()[0] ?? null;

  const complianceVals = ((summary7Res.data as any[]) ?? [])
    .map((r) => r?.compliance_pct)
    .filter((v) => typeof v === "number") as number[];
  const complianceAvg7d =
    complianceVals.length > 0
      ? Math.round(complianceVals.reduce((a, b) => a + b, 0) / complianceVals.length)
      : null;

  const weightRows = (weightRes.data as any[]) ?? [];
  const weight: DashboardWeightTrend = {
    latest_kg: weightRows[0]?.weight_kg != null ? Number(weightRows[0].weight_kg) : null,
    delta_kg:
      weightRows[0]?.weight_kg != null && weightRows[1]?.weight_kg != null
        ? Number(weightRows[0].weight_kg) - Number(weightRows[1].weight_kg)
        : null,
  };

  // Today's planned session from the most recent weekly plan.
  const latestPlan = ((plansRes.data as any[]) ?? [])[0]?.plan_data ?? null;
  const days = (latestPlan?.days as any[]) ?? [];
  const jsDay = new Date().getDay();
  const todayIdx = (jsDay + 6) % 7;
  const todayPlannedRaw = days[todayIdx] ?? null;
  const todayPlannedSession = todayPlannedRaw
    ? {
        rest: !!todayPlannedRaw.rest,
        session_name: todayPlannedRaw.session_name ?? null,
        exercises: (todayPlannedRaw.exercises ?? []) as any[],
      }
    : null;

  const todayMeals = ((mealsTodayRes.data as any[]) ?? []) as DashboardMeal[];
  const recentMeals = ((mealsRecentRes.data as any[]) ?? []) as DashboardMeal[];
  const lastLogDate = (lastMealRes.data as any[])?.[0]?.entry_date ?? null;

  return {
    profile,
    readiness,
    macros,
    targets,
    cards: ((cardsRes.data as any[]) ?? []) as DashboardCard[],
    weeklyPlan: latestPlan,
    todayPlannedSession,
    todaySetsCount,
    todayLastSetTime,
    weekSetsCount: ((setsWeekRes.data as any[]) ?? []).length,
    lastWeekSetsCount: ((setsLastWeekRes.data as any[]) ?? []).length,
    complianceAvg7d,
    weight,
    todayMeals,
    recentMeals,
    lastLogDate,
  };
}
