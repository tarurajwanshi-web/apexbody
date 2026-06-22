// Shared user-local date utilities. Pure & runtime-agnostic — no DOM, no Supabase.
// Source-of-truth timezone priority lives in callers:
//   profiles.timezone  →  Intl.DateTimeFormat().resolvedOptions().timeZone  →  'UTC'
//
// All functions accept an explicit `timezone` arg so server fns can pass the
// user's stored timezone and the client can pass profile/browser TZ.

import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export const UTC = "UTC";

export function getBrowserTimezone(): string {
  try {
    if (typeof Intl !== "undefined") {
      const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
      if (tz) return tz;
    }
  } catch {}
  return UTC;
}

/** YYYY-MM-DD for `at` (default now) in `timezone`. Uses Intl parts → no drift. */
export function getLocalDateISO(timezone: string, at: Date = new Date()): string {
  try {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(at);
    const y = parts.find((p) => p.type === "year")?.value ?? "1970";
    const m = parts.find((p) => p.type === "month")?.value ?? "01";
    const d = parts.find((p) => p.type === "day")?.value ?? "01";
    return `${y}-${m}-${d}`;
  } catch {
    // Fallback: UTC slice
    return at.toISOString().slice(0, 10);
  }
}

/** Convert any timestamp (ms or Date) to a YYYY-MM-DD local date in `timezone`. */
export function toLocalDateISO(timestamp: number | Date | string, timezone: string): string {
  const d = typeof timestamp === "number" ? new Date(timestamp) : typeof timestamp === "string" ? new Date(timestamp) : timestamp;
  return getLocalDateISO(timezone, d);
}

/** ISO date arithmetic — purely string-based, no TZ shifts. */
export function addDaysISO(iso: string, n: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  // Construct UTC to avoid host-TZ DST drift; we only care about pure date math.
  const dt = new Date(Date.UTC(y, (m ?? 1) - 1, d ?? 1));
  dt.setUTCDate(dt.getUTCDate() + n);
  const yy = dt.getUTCFullYear();
  const mm = String(dt.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(dt.getUTCDate()).padStart(2, "0");
  return `${yy}-${mm}-${dd}`;
}

export function isTodayLocal(iso: string, timezone: string): boolean {
  return iso === getLocalDateISO(timezone);
}

export function isYesterdayLocal(iso: string, timezone: string): boolean {
  return iso === addDaysISO(getLocalDateISO(timezone), -1);
}

/** Monday-Sunday range containing `anchorISO` (interpreted as a local date). */
export function getLocalWeekRange(anchorISO: string): { start: string; end: string } {
  const [y, m, d] = anchorISO.split("-").map(Number);
  const dt = new Date(Date.UTC(y, (m ?? 1) - 1, d ?? 1));
  const dow = dt.getUTCDay(); // 0=Sun..6=Sat
  const toMon = dow === 0 ? -6 : 1 - dow;
  const start = addDaysISO(anchorISO, toMon);
  const end = addDaysISO(start, 6);
  return { start, end };
}

/** Previous completed Mon-Sun in user TZ. */
export function getPreviousCompletedLocalWeek(timezone: string): { start: string; end: string } {
  const today = getLocalDateISO(timezone);
  const thisWeek = getLocalWeekRange(today);
  return getLocalWeekRange(addDaysISO(thisWeek.start, -7));
}

/** "Today" / "Yesterday" / "Mon, 22 Jun" — uses TZ-aware comparison. */
export function formatNiceDate(iso: string, timezone: string): string {
  if (isTodayLocal(iso, timezone)) return "Today";
  if (isYesterdayLocal(iso, timezone)) return "Yesterday";
  return formatShortDate(iso, { withWeekday: true });
}

export function formatShortDate(iso: string, opts?: { withWeekday?: boolean }): string {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(y, (m ?? 1) - 1, d ?? 1);
  return dt.toLocaleDateString(undefined, {
    ...(opts?.withWeekday ? { weekday: "short" } : {}),
    day: "2-digit",
    month: "short",
  });
}

// ---------------- Client hook ----------------
// Reads profile.timezone once per session; falls back to browser TZ.
// Auto-saves browser TZ when profile.timezone is NULL (one-time, never overwrites).

let cachedTimezone: string | null = null;

export function useUserTimezone(): string {
  const [tz, setTz] = useState<string>(() => cachedTimezone ?? getBrowserTimezone());

  useEffect(() => {
    if (cachedTimezone) {
      if (cachedTimezone !== tz) setTz(cachedTimezone);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const { data: u } = await supabase.auth.getUser();
        if (!u.user) return;
        const { data } = await supabase
          .from("profiles")
          .select("timezone")
          .eq("user_id", u.user.id)
          .maybeSingle();
        let resolved = (data?.timezone as string | null) || null;
        if (!resolved) {
          const browserTz = getBrowserTimezone();
          // One-time write — column is now nullable, so NULL means "never set".
          await supabase
            .from("profiles")
            .update({ timezone: browserTz })
            .eq("user_id", u.user.id)
            .is("timezone", null);
          resolved = browserTz;
        }
        cachedTimezone = resolved;
        if (!cancelled) setTz(resolved);
      } catch {
        // keep browser fallback
      }
    })();
    return () => { cancelled = true; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return tz;
}

// ---------------- Server helper ----------------
// Resolves the user's stored timezone from profiles; falls back to UTC.
// Server fns call this inside their handler.

export async function resolveUserTimezone(
  supabaseClient: { from: (t: string) => any },
  userId: string,
): Promise<string> {
  try {
    const { data } = await supabaseClient
      .from("profiles")
      .select("timezone")
      .eq("user_id", userId)
      .maybeSingle();
    const tz = (data?.timezone as string | null) || null;
    return tz || UTC;
  } catch {
    return UTC;
  }
}

/** Strict IANA validator: must parse via Intl and match a sane shape. */
const TZ_REGEX = /^[A-Za-z_]+(?:\/[A-Za-z0-9_+\-]+){0,2}$/;
function isValidIanaTimezone(tz: string): boolean {
  if (!tz || tz.length > 64) return false;
  try {
    new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(new Date());
    return TZ_REGEX.test(tz);
  } catch {
    return false;
  }
}

/** Same as resolveUserTimezone, but falls back to a client-supplied IANA hint
 *  when profiles.timezone is NULL. Closes the first-session write race where
 *  the browser TZ persist from useUserTimezone() hasn't committed yet. */
export async function resolveUserTimezoneWithHint(
  supabaseClient: { from: (t: string) => any },
  userId: string,
  hint?: string | null,
): Promise<string> {
  try {
    const { data } = await supabaseClient
      .from("profiles")
      .select("timezone")
      .eq("user_id", userId)
      .maybeSingle();
    const stored = (data?.timezone as string | null) || null;
    if (stored) return stored;
    if (hint && isValidIanaTimezone(hint)) return hint;
    return UTC;
  } catch {
    if (hint && isValidIanaTimezone(hint)) return hint;
    return UTC;
  }
}
