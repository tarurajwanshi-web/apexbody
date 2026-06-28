import { useSuspenseQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getBodyCompState } from "@/lib/body-comp.functions";
import { T } from "./tokens";

function formatKg(n: number): string {
  const sign = n > 0 ? "+" : n < 0 ? "−" : "";
  return `${sign}${Math.abs(n).toFixed(1)} kg`;
}
function formatPct(n: number): string {
  const sign = n > 0 ? "+" : n < 0 ? "−" : "";
  return `${sign}${Math.abs(n).toFixed(1)}%`;
}

export function BodyCompCard() {
  const fn = useServerFn(getBodyCompState);
  const { data } = useSuspenseQuery({
    queryKey: ["coach", "body-comp"],
    queryFn: () => fn(),
    staleTime: 1000 * 60 * 60,
    gcTime: 1000 * 60 * 60 * 2,
  });

  const weightColor =
    data.weight_change > 0 ? T.amber : data.weight_change < 0 ? T.green : T.text3;
  const strengthColor =
    data.strength_change > 0 ? T.green : data.strength_change < 0 ? T.red : T.text3;

  const confColor =
    data.confidence === "high"
      ? T.green
      : data.confidence === "medium"
        ? T.amber
        : T.text3;

  return (
    <div
      style={{
        background: T.surface,
        border: `1px solid ${T.border}`,
        borderRadius: 16,
        padding: 16,
        boxShadow: "inset 0 1px 0 rgba(255,255,255,0.04)",
      }}
    >
      <div
        style={{
          fontSize: 10,
          letterSpacing: "0.22em",
          textTransform: "uppercase",
          color: T.label,
          marginBottom: 10,
        }}
      >
        Body composition
      </div>

      <div
        style={{
          fontSize: 13,
          lineHeight: 1.5,
          color: T.text1,
          marginBottom: 10,
        }}
      >
        {data.message}
      </div>

      <div
        style={{
          fontSize: 12,
          color: T.text2,
          marginBottom: 12,
          fontVariantNumeric: "tabular-nums",
        }}
      >
        <span style={{ color: T.text3 }}>Weight </span>
        <span style={{ color: weightColor }}>{formatKg(data.weight_change)}</span>
        <span style={{ color: T.text3 }}> · Strength </span>
        <span style={{ color: strengthColor }}>{formatPct(data.strength_change)}</span>
      </div>

      <div
        style={{
          background: T.surface2,
          border: `1px solid ${T.border}`,
          borderRadius: 12,
          padding: 12,
          marginBottom: 10,
        }}
      >
        <div
          style={{
            fontSize: 12,
            letterSpacing: "0.18em",
            textTransform: "uppercase",
            color: T.label,
            marginBottom: 4,
          }}
        >
          Next
        </div>
        <div style={{ fontSize: 12, color: T.text2, lineHeight: 1.5 }}>
          {data.action}
        </div>
      </div>

      <div
        style={{
          display: "flex",
          justifyContent: "flex-end",
        }}
      >
        <span
          style={{
            fontSize: 10,
            letterSpacing: "0.18em",
            textTransform: "uppercase",
            color: confColor,
          }}
        >
          {data.confidence} confidence
        </span>
      </div>
    </div>
  );
}
