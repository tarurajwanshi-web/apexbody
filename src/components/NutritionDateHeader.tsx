import { ChevronLeft, ChevronRight, Calendar } from "lucide-react";
import {
  getBrowserTimezone,
  getLocalDateISO,
  addDaysISO,
  formatNiceDate,
  formatShortDate as formatShortDateShared,
} from "@/lib/dates";

/** Back-compat: local YYYY-MM-DD using browser timezone (no profile lookup).
 *  Prefer `getLocalDateISO(useUserTimezone())` for new code. */
export function todayLocalISO(): string {
  return getLocalDateISO(getBrowserTimezone());
}

/** Back-compat: "Today" / "Yesterday" / "Mon, 22 Jun" using browser TZ. */
export function formatNutritionDateLabel(iso: string, timezone?: string): string {
  return formatNiceDate(iso, timezone ?? getBrowserTimezone());
}

export function formatShortDate(iso: string): string {
  return formatShortDateShared(iso);
}

type Props = {
  selectedDate: string;
  onChange: (next: string) => void;
  /** Optional: user's profile timezone for the "is today" disabled check. */
  timezone?: string;
};

export function NutritionDateHeader({ selectedDate, onChange, timezone }: Props) {
  const tz = timezone ?? getBrowserTimezone();
  const today = getLocalDateISO(tz);
  const isToday = selectedDate === today;
  const label = formatNiceDate(selectedDate, tz);

  return (
    <div className="mx-5 mt-3 flex items-center justify-between rounded-2xl bg-bg-2 border border-white/5 px-2 py-2">
      <button
        type="button"
        aria-label="Previous day"
        onClick={() => onChange(addDaysISO(selectedDate, -1))}
        className="p-2 rounded-full text-text-secondary active:scale-95 transition"
      >
        <ChevronLeft size={20} />
      </button>
      <div className="flex items-center gap-2 min-w-0">
        <span className="text-sm font-semibold tracking-tight text-white truncate">{label}</span>
        <Calendar size={14} className="text-text-tertiary opacity-60" aria-hidden />
      </div>
      <button
        type="button"
        aria-label="Next day"
        disabled={isToday}
        onClick={() => !isToday && onChange(addDaysISO(selectedDate, 1))}
        className="p-2 rounded-full text-text-secondary active:scale-95 transition disabled:opacity-30 disabled:active:scale-100"
      >
        <ChevronRight size={20} />
      </button>
    </div>
  );
}
