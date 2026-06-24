import { T, cardStyle, microLabel } from "./tokens";

type Props = {
  recovery: number | null;
  fuel: number | null;
  effort: number | null;
  readiness: number | null;
  sentence: string;
};

function Ring({ value, color, label }: { value: number | null; color: string; label: string }) {
  const has = value != null && value > 0;
  const v = Math.max(0, Math.min(100, value ?? 0));
  const r = 34;
  const c = 2 * Math.PI * r;
  const filled = (v / 100) * c;
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 8 }}>
      <div style={{ position: "relative", width: 82, height: 82 }}>
        <svg width={82} height={82} style={{ transform: "rotate(-90deg)" }}>
          <circle cx={41} cy={41} r={r} fill="none" stroke={T.ringTrack} strokeWidth={7} />
          {has && (
            <circle
              cx={41}
              cy={41}
              r={r}
              fill="none"
              stroke={color}
              strokeWidth={7}
              strokeLinecap="round"
              strokeDasharray={`${filled} ${c - filled}`}
              strokeDashoffset={0}
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
            fontSize: 21,
            fontWeight: 300,
            letterSpacing: "-0.4px",
            color: has ? color : T.disabled,
          }}
        >
          {has ? Math.round(v) : "—"}
        </div>
      </div>
      <div style={{ fontSize: 10, color: T.text3, fontWeight: 400 }}>{label}</div>
    </div>
  );
}

export function TodayCard({ recovery, fuel, effort, readiness, sentence }: Props) {
  const hasAnyData = recovery != null || fuel != null || effort != null;
  return (
    <div style={cardStyle}>
      <div style={{ ...microLabel, marginBottom: 14 }}>Today</div>
      <div style={{ display: "flex", justifyContent: "space-around", alignItems: "center" }}>
        <Ring value={recovery} color={T.ringRecovery} label="Recovery" />
        <Ring value={fuel} color={T.ringFuel} label="Fuel" />
        <Ring value={effort} color={T.ringEffort} label="Effort" />
      </div>
      {!hasAnyData && (
        <div
          style={{
            marginTop: 14,
            fontSize: 12,
            color: T.text3,
            textAlign: "center",
            lineHeight: 1.5,
          }}
        >
          Log a meal or recovery check-in to see your scores
        </div>
      )}
      <div
        style={{
          marginTop: 18,
          paddingTop: 14,
          borderTop: `0.5px solid ${T.border}`,
        }}
      >
        <div style={{ ...microLabel, marginBottom: 8 }}>
          APEX · {readiness != null ? Math.round(readiness) : "—"}
        </div>
        <div style={{ fontSize: 13, color: T.text2, lineHeight: 1.55 }}>{sentence}</div>
      </div>
    </div>
  );
}
