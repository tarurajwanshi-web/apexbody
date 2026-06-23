import { T } from "./tokens";
import type { Momentum } from "@/lib/dashboard-state";

export function MomentumBar({ m }: { m: Momentum }) {
  return (
    <div className="grid grid-cols-3 gap-2">
      <Card label="Weight" value={m.weight.value} color={m.weight.color} sub={m.weight.label} hideSub />
      <Card label="Training" value={m.training.value} color={m.training.color} sub={m.training.label} />
      <Card label="Compliance" value={m.compliance.value} color={m.compliance.color} sub={m.compliance.label} hideSub />
    </div>
  );
}

function Card({
  label,
  value,
  color,
  sub,
  hideSub,
}: {
  label: string;
  value: string;
  color: string;
  sub: string;
  hideSub?: boolean;
}) {
  return (
    <div
      style={{
        background: T.surface,
        border: `0.5px solid ${T.border}`,
        borderRadius: 12,
        padding: "10px 8px",
        display: "flex",
        flexDirection: "column",
        alignItems: "flex-start",
        gap: 4,
        minHeight: 64,
      }}
    >
      <span
        style={{
          fontSize: 9,
          letterSpacing: "1.5px",
          textTransform: "uppercase",
          color: T.text3,
          fontWeight: 500,
        }}
      >
        {label}
      </span>
      <span style={{ fontSize: 18, fontWeight: 400, color, lineHeight: 1.2 }}>
        {value}
      </span>
      {!hideSub && (
        <span style={{ fontSize: 10, color: T.text3 }}>{sub}</span>
      )}
    </div>
  );
}
