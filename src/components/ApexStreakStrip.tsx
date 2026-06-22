import { Flame } from "lucide-react";

export type ApexStreakDay = {
  date: string;        // YYYY-MM-DD (user-local)
  label: string;       // short letter "M", "T", "W"…
  is_today: boolean;
  is_logged: boolean;
};

type Props = {
  days: ApexStreakDay[]; // length 7, oldest -> newest (today last)
  variant?: "coach" | "nutrition" | "macro_review";
  compact?: boolean;
};

/** Shared 7-day streak strip. */
export function ApexStreakStrip({ days, compact = false }: Props) {
  const size = compact ? "h-7 w-7 text-[10px]" : "h-9 w-9 text-[11px]";

  return (
    <div className="grid grid-cols-7 gap-2">
      {days.map((d) => {
        const gradientBg = "linear-gradient(135deg, #7C3AED 0%, #3B82F6 100%)";
        let style: React.CSSProperties;
        let opacityClass = "";

        if (d.is_logged && d.is_today) {
          style = {
            background: gradientBg,
            color: "white",
            boxShadow:
              "0 0 0 2px rgba(255,255,255,0.3), 0 0 10px rgba(124,58,237,0.4)",
          };
        } else if (d.is_logged) {
          style = {
            background: gradientBg,
            color: "white",
            boxShadow: "0 0 10px rgba(124,58,237,0.4)",
          };
        } else if (d.is_today) {
          style = {
            background: "var(--bg-2, rgba(255,255,255,0.04))",
            border: "1px solid rgba(255,255,255,0.30)",
            color: "white",
          };
        } else {
          style = {
            background: "var(--bg-2, rgba(255,255,255,0.04))",
            border: "1px solid rgba(255,255,255,0.05)",
            color: "#9CA3AF",
          };
          opacityClass = "opacity-40";
        }

        return (
          <div key={d.date} className="flex flex-col items-center gap-1">
            <div
              className={`${size} ${opacityClass} rounded-xl flex items-center justify-center font-bold transition`}
              style={style}
              aria-label={`${d.label} ${d.is_logged ? "logged" : "not logged"}`}
            >
              {d.is_logged ? <Flame size={compact ? 12 : 14} /> : d.label}
            </div>
            {d.is_today && (
              <span className="text-[9px] text-text-accent uppercase tracking-wider font-semibold">
                Today
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}
