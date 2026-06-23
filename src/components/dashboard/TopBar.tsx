import { Link } from "@tanstack/react-router";
import { Flame, ShieldCheck, Trophy } from "lucide-react";
import { T } from "./tokens";
import type { StreakState } from "@/lib/dashboard-state";

type Props = {
  greeting: string;
  name: string;
  subline: string;
  streak: StreakState;
};

export function TopBar({ greeting, name, subline, streak }: Props) {
  const initial = (name || "A").trim().charAt(0).toUpperCase();
  return (
    <header className="flex items-start justify-between gap-3">
      <div className="min-w-0 flex-1">
        <h1
          style={{
            fontSize: 17,
            fontWeight: 500,
            color: T.text1,
            lineHeight: 1.3,
          }}
        >
          {greeting}, {name || "Athlete"}
        </h1>
        <p style={{ fontSize: 11, color: T.text3, marginTop: 4 }}>{subline}</p>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <StreakBadge streak={streak} />
        <Link
          to="/settings"
          aria-label="Profile and settings"
          style={{
            height: 36,
            width: 36,
            borderRadius: 999,
            background: T.surface2,
            border: `0.5px solid ${T.border}`,
            color: T.text1,
            fontSize: 13,
            fontWeight: 500,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          {initial}
        </Link>
      </div>
    </header>
  );
}

function StreakBadge({ streak }: { streak: StreakState }) {
  const base: React.CSSProperties = {
    background: T.surface2,
    border: `0.5px solid ${T.border}`,
    borderRadius: 20,
    padding: "5px 12px",
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    fontSize: 12,
    fontWeight: 500,
    color: T.text1,
  };

  if (streak.kind === "protected") {
    return (
      <span style={{ ...base, borderColor: "#0A2A1C", background: "#071E14" }}>
        <ShieldCheck size={13} color={T.green} />
        <span style={{ color: T.green }}>Protected</span>
      </span>
    );
  }
  if (streak.kind === "resting") {
    return (
      <span style={base}>
        <Flame size={13} color={T.text3} />
        <span style={{ color: T.text2 }}>Resting</span>
      </span>
    );
  }
  if (streak.kind === "milestone") {
    return (
      <span
        style={{
          ...base,
          border: `1px solid ${T.primary}`,
          animation: "apex-pulse 2.4s ease-in-out infinite",
        }}
      >
        <Trophy size={13} color={T.primary} />
        <span>{streak.days} days</span>
      </span>
    );
  }
  if (streak.kind === "reset") {
    return (
      <span style={base}>
        <Flame size={13} color={T.text3} />
        <span style={{ color: T.text2 }}>Start new streak</span>
      </span>
    );
  }
  // active / silent-miss-1 both render normally
  return (
    <span style={base}>
      <Flame size={13} color={T.amber} />
      <span>{streak.days} days</span>
    </span>
  );
}
