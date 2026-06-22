import { ChevronLeft, ChevronRight, Calendar } from "lucide-react";

/** Local YYYY-MM-DD (user's timezone). */
export function todayLocalISO(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function addDaysLocal(iso: string, delta: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(y, (m ?? 1) - 1, d ?? 1);
  dt.setDate(dt.getDate() + delta);
  const yy = dt.getFullYear();
  const mm = String(dt.getMonth() + 1).padStart(2, "0");
  const dd = String(dt.getDate()).padStart(2, "0");
  return `${yy}-${mm}-${dd}`;
}

export function formatNutritionDateLabel(iso: string): string {
  const today = todayLocalISO();
  if (iso === today) return "Today";
  if (iso === addDaysLocal(today, -1)) return "Yesterday";
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(y, (m ?? 1) - 1, d ?? 1);
  return dt.toLocaleDateString(undefined, { weekday: "short", day: "2-digit", month: "short" });
}

/** Short label for inline use, e.g. "22 Jun". */
export function formatShortDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(y, (m ?? 1) - 1, d ?? 1);
  return dt.toLocaleDateString(undefined, { day: "2-digit", month: "short" });
}

type Props = {
  selectedDate: string;
  onChange: (next: string) => void;
};

export function NutritionDateHeader({ selectedDate, onChange }: Props) {
  const today = todayLocalISO();
  const isToday = selectedDate === today;
  const label = formatNutritionDateLabel(selectedDate);

  return (
    <div className="mx-5 mt-3 flex items-center justify-between rounded-2xl bg-bg-2 border border-white/5 px-2 py-2">
      <button
        type="button"
        aria-label="Previous day"
        onClick={() => onChange(addDaysLocal(selectedDate, -1))}
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
        onClick={() => !isToday && onChange(addDaysLocal(selectedDate, 1))}
        className="p-2 rounded-full text-text-secondary active:scale-95 transition disabled:opacity-30 disabled:active:scale-100"
      >
        <ChevronRight size={20} />
      </button>
    </div>
  );
}
