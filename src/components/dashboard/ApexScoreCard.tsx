import { T, cardStyle } from "./tokens";
import type { DashboardReadiness } from "@/lib/dashboard-data";

type Props = {
  readiness: DashboardReadiness | null;
};

const PILLARS: { key: string; label: string }[] = [
  { key: "recovery", label: "Recovery" },
  { key: "sleep", label: "Sleep" },
  { key: "nutrition", label: "Nutrition" },
  { key: "training", label: "Training" },
  { key: "mood", label: "Mood" },
];

function statusFor(score: number | null): { label: string; color: string } {
  if (score == null) return { label: "No data", color: T.text3 };
  if (score >= 80) return { label: "Excellent", color: T.green };
  if (score >= 65) return { label: "Ready", color: T.primary };
  if (score >= 50) return { label: "Building", color: T.amber };
  return { label: "Recover", color: T.red };
}

function pillarPillStyle(v: number | null): React.CSSProperties {
  if (v == null) {
    return {
      background: T.surface2,
      color: T.text3,
      border: `0.5px solid ${T.border}`,
    };
  }
  if (v >= 70) {
    return {
      background: "#071E14",
      color: T.green,
      border: "0.5px solid #0A2A1C",
    };
  }
  if (v >= 50) {
    return {
      background: "#1E1500",
      color: T.amber,
      border: "0.5px solid #2A1E00",
    };
  }
  return {
    background: "#1E0808",
    color: T.red,
    border: "0.5px solid #2A1010",
  };
}

export function ApexScoreCard({ readiness }: Props) {
  const score = readiness?.final_score ?? null;
  const status = statusFor(score);
  const breakdown = readiness?.pillar_breakdown ?? null;

  return (
    <div style={cardStyle}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-baseline gap-1">
          <span
            style={{
              fontSize: 40,
              fontWeight: 400,
              color: T.text1,
              lineHeight: 1,
              fontVariantNumeric: "tabular-nums",
            }}
          >
            {score ?? "—"}
          </span>
          <span style={{ fontSize: 14, color: T.text3 }}>/100</span>
        </div>
        <div className="text-right">
          <div style={{ fontSize: 13, fontWeight: 500, color: status.color }}>
            {status.label}
          </div>
          <div style={{ fontSize: 10, color: T.text3, marginTop: 2 }}>
            APEX Score · just now
          </div>
        </div>
      </div>
      <div className="flex flex-wrap gap-1.5 mt-3">
        {PILLARS.map((p) => {
          const raw = breakdown?.[p.key];
          const v = typeof raw === "number" ? raw : null;
          const s = pillarPillStyle(v);
          return (
            <span
              key={p.key}
              style={{
                ...s,
                padding: "3px 10px",
                borderRadius: 20,
                fontSize: 10,
                fontWeight: 500,
              }}
            >
              {p.label} {v != null ? Math.round(v) : "—"}
            </span>
          );
        })}
      </div>
    </div>
  );
}
