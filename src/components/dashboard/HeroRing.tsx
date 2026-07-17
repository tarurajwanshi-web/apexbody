import { T } from "./tokens";

type Props = {
  value: number | null;
  label?: string;
  size?: number;
  thickness?: number;
};

/**
 * Single hero metric — large tabular number inside a thin brand arc.
 * No breathing, no halo. The bevel comes from a soft inner highlight.
 */
export function HeroRing({ value, label = "Readiness", size = 220, thickness = 4 }: Props) {
  const has = value != null;
  const v = Math.max(0, Math.min(100, value ?? 0));
  const r = (size - thickness) / 2;
  const c = 2 * Math.PI * r;
  const filled = (v / 100) * c;
  const cx = size / 2;

  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 14 }}>
      <div style={{ position: "relative", width: size, height: size }}>
        <svg width={size} height={size} style={{ transform: "rotate(-90deg)" }}>
          <circle cx={cx} cy={cx} r={r} fill="none" stroke={T.ringTrack} strokeWidth={thickness} />
          {has && (
            <circle
              cx={cx}
              cy={cx}
              r={r}
              fill="none"
              stroke={T.primary}
              strokeWidth={thickness}
              strokeLinecap="round"
              strokeDasharray={`${filled} ${c - filled}`}
              style={{ transition: "stroke-dasharray 320ms cubic-bezier(0.2,0.8,0.2,1)" }}
            />
          )}
        </svg>
        <div
          style={{
            position: "absolute",
            inset: 0,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            gap: 4,
          }}
        >
          <div
            style={{
              fontFamily: "var(--font-display)",
              fontSize: 72,
              fontWeight: 500,
              letterSpacing: "-0.04em",
              color: has ? T.text1 : T.disabled,
              fontVariantNumeric: "tabular-nums",
              lineHeight: 1,
            }}
            data-metric
          >
            {has ? Math.round(v) : "—"}
          </div>
          <div
            style={{
              fontSize: 11,
              letterSpacing: "0.18em",
              textTransform: "uppercase",
              color: T.text3,
              fontWeight: 500,
            }}
          >
            {label}
          </div>
        </div>
      </div>
    </div>
  );
}
