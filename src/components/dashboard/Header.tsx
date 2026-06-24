import { Link } from "@tanstack/react-router";
import { T } from "./tokens";

type Props = {
  greeting: string;
  name: string;
  day: number;
};

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).slice(0, 2);
  return parts.map((p) => p[0]?.toUpperCase() ?? "").join("") || "A";
}

function phaseLine(day: number): string {
  if (day <= 6) return `Day ${day} — Calibrating to your patterns`;
  if (day <= 29) return `Day ${day} — Learning your body`;
  return "Coached by APEX";
}

export function Header({ greeting, name, day }: Props) {
  const first = name.split(/\s+/)[0] || "Athlete";
  return (
    <div className="flex items-center justify-between" style={{ padding: "4px 2px 8px" }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        <div
          style={{
            fontSize: 20,
            fontWeight: 400,
            color: T.text1,
            letterSpacing: "-0.4px",
            lineHeight: 1.2,
          }}
        >
          {greeting}, {first}
        </div>
        <div style={{ fontSize: 12, color: T.label, fontWeight: 400 }}>
          {phaseLine(day)}
        </div>
      </div>
      <Link
        to="/settings"
        style={{
          width: 38,
          height: 38,
          borderRadius: "50%",
          background: T.surface2,
          border: `0.5px solid ${T.border}`,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: T.text2,
          fontSize: 13,
          fontWeight: 500,
          letterSpacing: "0.5px",
          textDecoration: "none",
        }}
        className="active:scale-95 transition-transform"
        aria-label="Profile"
      >
        {initials(name)}
      </Link>
    </div>
  );
}
