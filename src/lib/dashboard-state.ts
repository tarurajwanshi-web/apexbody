// Pure dashboard state helpers — no DOM, no Supabase, no React.
// Used by dashboard.tsx to derive UI state from the loaded DashboardData.

import { addDaysISO, getLocalDateISO } from "@/lib/dates";
import type { DashboardData } from "@/lib/dashboard-data";

export type ContextPriority = "P0" | "P1" | "P2" | "P3" | "P4" | "P5" | "P6" | "P7";

export type StreakState =
  | { kind: "active"; days: number }
  | { kind: "silent-miss-1"; days: number }
  | { kind: "resting"; days: number }
  | { kind: "protected"; days: number }
  | { kind: "milestone"; days: number }
  | { kind: "reset" };

export function getUserLocalHour(tz: string, now: Date = new Date()): number {
  try {
    const parts = new Intl.DateTimeFormat("en-GB", {
      timeZone: tz,
      hour: "2-digit",
      hour12: false,
    }).formatToParts(now);
    const h = parts.find((p) => p.type === "hour")?.value ?? "0";
    return parseInt(h, 10);
  } catch {
    return now.getHours();
  }
}

export function minutesSince(iso: string | null): number | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return null;
  return Math.floor((Date.now() - t) / 60000);
}

export function pctOf(value: number, target: number | undefined | null): number {
  if (!target || target <= 0) return 0;
  return value / target;
}

export function detectContext(d: DashboardData, tz: string): ContextPriority {
  const hour = getUserLocalHour(tz);
  const targets = d.targets;
  const p = d.macros?.total_protein ?? 0;
  const c = d.macros?.total_carbs ?? 0;
  const f = d.macros?.total_fat ?? 0;

  const proteinPct = pctOf(p, targets?.target_protein_g);
  const carbsPct = pctOf(c, targets?.target_carbs_g);
  const fatPct = pctOf(f, targets?.target_fat_g);

  const trainingLogged = d.todaySetsCount > 0;
  const allMacrosHit =
    !!targets && proteinPct >= 0.9 && carbsPct >= 0.85 && fatPct <= 1.15;
  const carbsLow = !!targets && carbsPct < 0.7;
  const minsSinceTraining = minutesSince(d.todayLastSetTime);
  const coachingNoteReady = d.cards.some(
    (c) => c.card_type === "daily_note" && c.card_date === getLocalDateISO(tz),
  );
  const coachingHour = parseCoachingHour(d.profile.coaching_time);
  const trainingPlanned = !!d.todayPlannedSession && !d.todayPlannedSession.rest;
  const mealsLogged = d.todayMeals.length;
  const today = getLocalDateISO(tz);
  const daysSinceLog = d.lastLogDate
    ? diffDaysISO(today, d.lastLogDate)
    : 999;
  const eatingPattern = (d.profile.eating_pattern ?? "").toLowerCase();
  const isIF =
    eatingPattern.includes("intermittent") || eatingPattern === "if";

  if (trainingLogged && allMacrosHit && hour < 20) return "P0";
  if (
    trainingLogged &&
    carbsLow &&
    minsSinceTraining != null &&
    minsSinceTraining < 90
  )
    return "P1";
  if (coachingNoteReady && hour >= coachingHour) return "P2";
  if (trainingPlanned && !trainingLogged && hour < 18) return "P3";
  if (mealsLogged >= 1) return "P4";
  if (isIF && hour < 12) return "P5";
  if (daysSinceLog >= 2) return "P7";
  return "P6";
}

function parseCoachingHour(t: string | null): number {
  if (!t) return 18;
  // accept "HH:MM" or "HH:MM:SS"
  const m = /^(\d{1,2})/.exec(t);
  if (!m) return 18;
  const h = parseInt(m[1], 10);
  return Number.isFinite(h) ? h : 18;
}

function diffDaysISO(a: string, b: string): number {
  const [ay, am, ad] = a.split("-").map(Number);
  const [by, bm, bd] = b.split("-").map(Number);
  const ta = Date.UTC(ay, (am ?? 1) - 1, ad ?? 1);
  const tb = Date.UTC(by, (bm ?? 1) - 1, bd ?? 1);
  return Math.round((ta - tb) / 86400000);
}

// Streak — derived from consecutive meal-log days ending at "today" (or yesterday).
export function detectStreak(d: DashboardData, tz: string): StreakState {
  const today = getLocalDateISO(tz);
  if (!d.lastLogDate) return { kind: "reset" };
  const daysMissed = diffDaysISO(today, d.lastLogDate);

  // Count consecutive days back from lastLogDate using recentMeals entry_dates.
  const dates = Array.from(new Set(d.recentMeals.map((m) => m.entry_date))).sort().reverse();
  let streak = 0;
  let cursor = d.lastLogDate;
  for (const date of dates) {
    if (date === cursor) {
      streak += 1;
      cursor = addDaysISO(cursor, -1);
    } else if (date < cursor) {
      break;
    }
  }
  if (streak === 0) streak = 1;

  const todayIsRest =
    !!d.todayPlannedSession && d.todayPlannedSession.rest && d.todaySetsCount === 0;

  if (daysMissed === 0) {
    if ([7, 14, 30, 60, 100].includes(streak)) return { kind: "milestone", days: streak };
    if (todayIsRest && streak > 0) return { kind: "protected", days: streak };
    return { kind: "active", days: streak };
  }
  if (daysMissed === 1) return { kind: "silent-miss-1", days: streak };
  if (daysMissed === 2) return { kind: "resting", days: streak };
  return { kind: "reset" };
}

export type Momentum = {
  weight: { value: string; color: string; label: string };
  training: { value: string; color: string; label: string };
  compliance: { value: string; color: string; label: string };
};

const COLOR_GREEN = "#2DD4A0";
const COLOR_AMBER = "#F5A623";
const COLOR_RED = "#E05252";
const COLOR_PRIMARY = "#7B6EF6";
const COLOR_TEXT_3 = "#44446A";

export function computeMomentum(d: DashboardData): Momentum {
  // Weight
  const goal = (d.profile.goal ?? "").toLowerCase();
  let weightValue = "—";
  let weightColor = COLOR_TEXT_3;
  if (d.weight.delta_kg != null) {
    const delta = d.weight.delta_kg;
    const sign = delta > 0 ? "+" : "";
    weightValue = `${sign}${delta.toFixed(1)} kg`;
    if (goal.includes("fat") || goal.includes("loss")) {
      weightColor = delta < 0 ? COLOR_GREEN : COLOR_AMBER;
    } else if (goal.includes("muscle") || goal.includes("gain")) {
      weightColor = delta > 0 ? COLOR_GREEN : COLOR_AMBER;
    } else {
      // recomposition / maintenance
      weightColor = Math.abs(delta) <= 0.5 ? COLOR_GREEN : COLOR_AMBER;
    }
  }

  // Training momentum: sets this week vs last week
  const setsDelta = d.weekSetsCount - d.lastWeekSetsCount;
  const trainingValue =
    d.weekSetsCount === 0 && d.lastWeekSetsCount === 0
      ? "—"
      : `${d.weekSetsCount} sets`;
  const trainingLabel =
    setsDelta === 0
      ? "vs last wk"
      : setsDelta > 0
        ? `+${setsDelta} vs last wk`
        : `${setsDelta} vs last wk`;

  // Compliance
  const pct = d.macros?.compliance_pct ?? d.complianceAvg7d;
  let complianceValue = "—";
  let complianceColor = COLOR_TEXT_3;
  if (pct != null) {
    complianceValue = `${Math.round(pct)}%`;
    complianceColor = pct >= 85 ? COLOR_GREEN : pct >= 70 ? COLOR_AMBER : COLOR_RED;
  }

  return {
    weight: { value: weightValue, color: weightColor, label: "Weight" },
    training: { value: trainingValue, color: COLOR_PRIMARY, label: trainingLabel },
    compliance: { value: complianceValue, color: complianceColor, label: "Compliance" },
  };
}

export function topFoodSources(meals: { food_sources: string[] | null }[]): string[] {
  const counts = new Map<string, number>();
  for (const m of meals) {
    for (const f of m.food_sources ?? []) {
      const key = String(f).trim();
      if (!key) continue;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([k]) => k);
}
