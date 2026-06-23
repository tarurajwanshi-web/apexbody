import { T, cardStyle, microLabel } from "./tokens";

type WeightProps = {
  deltaKg: number | null;
  goal: string | null;
};

type ConsistencyProps = {
  daysLogged: number;
};

type StreakProps = {
  days: number;
  protected: boolean;
};

function weightColor(delta: number, goal: string | null): string {
  const g = (goal ?? "").toLowerCase();
  if (g.includes("fat") || g.includes("loss")) return delta < 0 ? T.zoneBuild : T.zoneRecover;
  if (g.includes("muscle") || g.includes("gain")) return delta > 0 ? T.zoneBuild : T.zoneSteady;
  return Math.abs(delta) <= 0.5 ? T.zoneBuild : T.zoneSteady;
}

function ValueBlock({
  label,
  value,
  valueColor,
  sub,
}: {
  label: string;
  value: string;
  valueColor: string;
  sub: string;
}) {
  return (
    <div
      style={{
        ...cardStyle,
        padding: 16,
        borderRadius: 14,
        display: "flex",
        flexDirection: "column",
        gap: 8,
        flex: 1,
      }}
    >
      <div style={microLabel}>{label}</div>
      <div
        style={{
          fontSize: 19,
          fontWeight: 300,
          color: valueColor,
          letterSpacing: "-0.4px",
          lineHeight: 1.1,
        }}
      >
        {value}
      </div>
      <div style={{ fontSize: 10, color: T.label }}>{sub}</div>
    </div>
  );
}

export function MetricCards({
  weight,
  consistency,
  streak,
}: {
  weight: WeightProps;
  consistency: ConsistencyProps;
  streak: StreakProps;
}) {
  // Weight
  let weightVal = "—";
  let weightCol = T.disabled;
  if (weight.deltaKg != null) {
    const d = weight.deltaKg;
    weightVal = `${d > 0 ? "+" : ""}${d.toFixed(1)}kg`;
    weightCol = weightColor(d, weight.goal);
  }

  // Consistency
  const pct = Math.round((consistency.daysLogged / 7) * 100);
  const consistencyCol =
    pct >= 85 ? T.zoneBuild : pct >= 70 ? T.zoneSteady : T.zoneRecover;

  // Streak
  const streakVal = `${streak.days}d`;
  const streakSub =
    streak.protected ? "Protected" : streak.days > 0 ? "Keep going" : "Start today";

  return (
    <div style={{ display: "flex", gap: 10 }}>
      <ValueBlock label="Weight" value={weightVal} valueColor={weightCol} sub="This week" />
      <ValueBlock
        label="Consistency"
        value={`${pct}%`}
        valueColor={consistency.daysLogged > 0 ? consistencyCol : T.disabled}
        sub={`${consistency.daysLogged} of 7 days`}
      />
      <ValueBlock
        label="Streak"
        value={streak.days > 0 ? streakVal : "—"}
        valueColor={streak.days > 0 ? T.amber : T.disabled}
        sub={streakSub}
      />
    </div>
  );
}
