// Single source of truth for "which plan day is today".
// generate-plan writes plan_data.days[i].date as an explicit ISO date
// (rolling plan start, not necessarily Monday — see resolvePlanStartISO
// in _shared/training-rules.ts). Both Dashboard and Workouts must resolve
// "today" the same way, or they silently disagree on which session is
// active — this was confirmed live in production plan data during audit.
//
// Resolution order:
//   1. Match by explicit day.date === todayISO (correct, timezone-aware).
//   2. Fallback: Monday-indexed weekday position, only for legacy plans
//      generated before the date field existed.

export type PlanDay = {
  day: number;
  date?: string;
  day_name: string;
  session_name: string | null;
  rest: boolean;
  exercises: any[];
};

export function todayMondayIndex(): number {
  const js = new Date().getDay(); // 0 Sun .. 6 Sat
  return (js + 6) % 7;
}

/**
 * Returns { idx, day } for today's plan day, or null if no plan/days.
 * todayISO must be the caller's timezone-correct local date
 * (e.g. from getLocalDateISO(tz)) — never new Date().toISOString().
 */
export function resolveTodayPlanDay(
  days: PlanDay[] | null | undefined,
  todayISO: string,
): { idx: number; day: PlanDay } | null {
  if (!days || days.length === 0) return null;
  const byDate = days.findIndex((d) => d?.date === todayISO);
  if (byDate !== -1) return { idx: byDate, day: days[byDate] };
  // Legacy fallback — only reached for plans generated before the date
  // field existed. Logs a warning so we can see if this path still fires
  // in production after the fix ships.
  const idx = todayMondayIndex();
  if (days[idx]) {
    console.warn("[resolveTodayPlanDay] no date match, using weekday fallback — stale plan?");
    return { idx, day: days[idx] };
  }
  return null;
}
