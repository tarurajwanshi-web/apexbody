// Shared timezone / date helpers for weekly macro engine and friends.

/** Compute the user-local Monday (YYYY-MM-DD) for "now" in IANA tz. */
export function userLocalMonday(tz: string, now: Date = new Date()): string {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric", month: "2-digit", day: "2-digit",
  });
  const parts = fmt.formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)!.value;
  const localDateStr = `${get("year")}-${get("month")}-${get("day")}`;
  const d = new Date(`${localDateStr}T00:00:00Z`);
  const dayIdx = (d.getUTCDay() + 6) % 7; // Mon→0 .. Sun→6
  d.setUTCDate(d.getUTCDate() - dayIdx);
  return d.toISOString().slice(0, 10);
}

/** Convert a UTC timestamp ISO string to the user-local YYYY-MM-DD. */
export function tsToLocalDate(tsIso: string, tz: string): string {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit",
  });
  const parts = fmt.formatToParts(new Date(tsIso));
  const get = (t: string) => parts.find((p) => p.type === t)!.value;
  return `${get("year")}-${get("month")}-${get("day")}`;
}

/** Add N days to a YYYY-MM-DD date string; returns YYYY-MM-DD. */
export function addDays(isoDate: string, days: number): string {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** ISO 8601 week number (1–53). */
export function getISOWeek(date: Date): number {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const dayNum = (d.getUTCDay() + 6) % 7; // Mon=0
  d.setUTCDate(d.getUTCDate() - dayNum + 3); // nearest Thursday
  const firstThursday = new Date(Date.UTC(d.getUTCFullYear(), 0, 4));
  const diff = (d.getTime() - firstThursday.getTime()) / 86400000;
  return 1 + Math.round((diff - ((firstThursday.getUTCDay() + 6) % 7) + 3) / 7);
}

/**
 * Rolling cadence gate: fires only when it's `targetHour` in `tz` AND at least
 * `intervalDays` have passed since the last card (or, if never, since profile
 * completion). Replaces fixed weekday-of-week gates so users who miss a slot
 * still get their card on the next available day at the target hour.
 */
export function isRollingCadenceDue(
  tz: string,
  now: Date,
  lastCardAtIso: string | null,
  profileCompletedAtIso: string | null,
  targetHour = 20,
  intervalDays = 7,
): boolean {
  const hour = parseInt(
    new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "numeric", hour12: false })
      .formatToParts(now).find((p) => p.type === "hour")?.value ?? "0", 10,
  );
  if (hour !== targetHour) return false;
  const anchorIso = lastCardAtIso ?? profileCompletedAtIso;
  if (!anchorIso) return false;
  const anchorLocalDate = tsToLocalDate(anchorIso, tz);
  const todayLocalDate = tsToLocalDate(now.toISOString(), tz);
  return todayLocalDate >= addDays(anchorLocalDate, intervalDays);
}

export const DEFAULT_TIMEZONE = "Asia/Dubai";

/** Day-of-week (0=Sun..6=Sat) for "now" in the given IANA timezone. */
export function userLocalDayOfWeek(tz: string, now: Date = new Date()): number {
  const wd = new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "short" })
    .format(now);
  const map: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return map[wd] ?? -1;
}
