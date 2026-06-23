import { T } from "./tokens";
import type { StreakState } from "@/lib/dashboard-state";
import type { DashboardData } from "@/lib/dashboard-data";

type Signal = { label: string; value: string; color: string };

export function WhatApexKnows({
  d,
  streak,
}: {
  d: DashboardData;
  streak: StreakState;
}) {
  const signals: Signal[] = [];

  // Training
  if (d.todayPlannedSession?.rest) {
    signals.push({ label: "Training", value: "Rest day", color: T.green });
  } else if (d.todaySetsCount > 0) {
    signals.push({ label: "Training", value: `Logged ${d.todaySetsCount} sets`, color: T.green });
  } else {
    signals.push({ label: "Training", value: "Not yet logged", color: T.amber });
  }

  // Meals
  const meals = d.todayMeals.length;
  signals.push({
    label: "Meals today",
    value: `${meals} logged`,
    color: meals >= 3 ? T.green : meals >= 1 ? T.amber : T.red,
  });

  // Streak
  if (streak.kind === "active" || streak.kind === "milestone") {
    signals.push({ label: "Streak", value: `${streak.days} days active`, color: T.amber });
  } else if (streak.kind === "protected") {
    signals.push({ label: "Streak", value: `${streak.days} days · protected`, color: T.green });
  } else if (d.profile.eating_pattern?.toLowerCase().includes("intermittent")) {
    signals.push({ label: "Pattern", value: "IF user (noon break)", color: T.primary });
  } else if (d.weight.latest_kg != null) {
    signals.push({
      label: "Weight",
      value:
        d.weight.delta_kg != null
          ? `Last logged · ${d.weight.delta_kg >= 0 ? "+" : ""}${d.weight.delta_kg.toFixed(1)} kg`
          : "Logged today",
      color: T.green,
    });
  } else {
    signals.push({ label: "Weight", value: "Not yet logged", color: T.amber });
  }

  return (
    <div
      style={{
        background: T.surface,
        border: `0.5px solid ${T.border}`,
        borderRadius: 12,
        padding: "12px 14px",
      }}
    >
      <div
        style={{
          fontSize: 9,
          letterSpacing: "1.5px",
          textTransform: "uppercase",
          color: T.text3,
          fontWeight: 500,
          marginBottom: 10,
        }}
      >
        What APEX knows right now
      </div>
      <div className="space-y-2">
        {signals.slice(0, 3).map((s) => (
          <div key={s.label} className="flex items-center gap-2">
            <span
              style={{
                width: 8,
                height: 8,
                borderRadius: 999,
                background: s.color,
              }}
            />
            <span style={{ fontSize: 11, color: T.text2, flex: 1 }}>{s.label}</span>
            <span style={{ fontSize: 11, color: s.color }}>{s.value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
