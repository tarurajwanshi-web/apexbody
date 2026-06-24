import { T, cardStyle, microLabel } from "./tokens";
import { Sparkline, BarGrid } from "@/components/Sparkline";
import type { ReactNode } from "react";

type WeightProps = {
  deltaKg: number | null;
  goal: string | null;
  trend?: (number | null)[];
};

type ConsistencyProps = {
  daysLogged: number;
  series?: boolean[];
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
  trend,
}: {
  label: string;
  value: string;
  valueColor: string;
  sub: string;
  trend?: ReactNode;
}) {
  return (
    <div
      style={{
        ...cardStyle,
        padding: 14,
        borderRadius: 12,
        display: "flex",
        flexDirection: "column",
        gap: 6,
        flex: 1,
        minWidth: 0,
      }}
    >
      <div style={microLabel}>{label}</div>
      <div
        style={{
          fontSize: 22,
          fontWeight: 500,
          color: valueColor,
          letterSpacing: "-0.02em",
          lineHeight: 1.1,
          fontFamily: "var(--font-display)",
          fontVariantNumeric: "tabular-nums",
        }}
      >
        {value}
      </div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 6 }}>
        <div style={{ fontSize: 10, color: T.text3 }}>{sub}</div>
        {trend && <div style={{ flexShrink: 0 }}>{trend}</div>}
      </div>
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
  let weightCol: string = T.disabled;
  if (weight.deltaKg != null) {
    const d = weight.deltaKg;
    weightVal = `${d > 0 ? "+" : ""}${d.toFixed(1)}kg`;
    weightCol = weightColor(d, weight.goal);
  }
  const weightTrend = weight.trend && weight.trend.some((p) => p != null)
    ? <Sparkline points={weight.trend} color={weightCol === T.disabled ? T.text3 : weightCol} width={56} height={20} />
    : null;

  // Consistency
  const pct = Math.round((consistency.daysLogged / 7) * 100);
  const consistencyCol =
    pct >= 85 ? T.zoneBuild : pct >= 70 ? T.zoneSteady : T.zoneRecover;
  const consistencyTrend = consistency.series && consistency.series.length === 7
    ? <BarGrid values={consistency.series} color={consistency.daysLogged > 0 ? consistencyCol : T.text3} width={56} height={20} />
    : null;

  // Streak
  const streakVal = `${streak.days}d`;
  const streakSub =
    streak.protected ? "Protected" : streak.days > 0 ? "Keep going" : "Start today";

  return (
    <div style={{ display: "flex", gap: 10 }}>
      <ValueBlock label="Weight" value={weightVal} valueColor={weightCol} sub="7-day" trend={weightTrend} />
      <ValueBlock
        label="Consistency"
        value={`${pct}%`}
        valueColor={consistency.daysLogged > 0 ? consistencyCol : T.disabled}
        sub={`${consistency.daysLogged} of 7`}
        trend={consistencyTrend}
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
