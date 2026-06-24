import { T } from "@/components/dashboard/tokens";

type Props = {
  value: number | null; // 0-100
  size?: number;
  label?: string;
  color?: string;
  track?: string;
  thickness?: number;
  suffix?: string;
};

/**
 * Compact ring with centered numeric value. Conic-gradient via SVG arc.
 * Null value renders as an empty track with an em-dash.
 */
export function MetricRing({
  value,
  size = 56,
  label,
  color = T.primary,
  track = T.surface2,
  thickness = 5,
  suffix = "",
}: Props) {
  const r = (size - thickness) / 2;
  const c = 2 * Math.PI * r;
  const pct = value == null ? 0 : Math.max(0, Math.min(100, value));
  const dash = (pct / 100) * c;

  return (
    <div style={{ display: "inline-flex", flexDirection: "column", alignItems: "center", gap: 4 }}>
      <div style={{ position: "relative", width: size, height: size }}>
        <svg width={size} height={size} style={{ transform: "rotate(-90deg)" }}>
          <circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            fill="none"
            stroke={track}
            strokeWidth={thickness}
          />
          {value != null && (
            <circle
              cx={size / 2}
              cy={size / 2}
              r={r}
              fill="none"
              stroke={color}
              strokeWidth={thickness}
              strokeLinecap="round"
              strokeDasharray={`${dash} ${c - dash}`}
              style={{ transition: "stroke-dasharray 320ms cubic-bezier(0.4, 0, 0.2, 1)" }}
            />
          )}
        </svg>
        <div
          style={{
            position: "absolute",
            inset: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: Math.max(11, Math.round(size * 0.28)),
            fontFamily: "var(--font-display)",
            fontWeight: 500,
            color: value == null ? T.text3 : T.text1,
            fontVariantNumeric: "tabular-nums",
            letterSpacing: "-0.02em",
          }}
        >
          {value == null ? "—" : `${Math.round(pct)}${suffix}`}
        </div>
      </div>
      {label && (
        <div
          style={{
            fontSize: 9,
            letterSpacing: "1.4px",
            textTransform: "uppercase",
            color: T.text3,
            fontWeight: 500,
          }}
        >
          {label}
        </div>
      )}
    </div>
  );
}
