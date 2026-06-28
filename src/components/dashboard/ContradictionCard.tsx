import { useSuspenseQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getContradictions } from "@/lib/coach.functions";
import { T } from "./tokens";

export function ContradictionCard() {
  const fn = useServerFn(getContradictions);
  const { data } = useSuspenseQuery({
    queryKey: ["coach", "contradictions"],
    queryFn: () => fn(),
    staleTime: 1000 * 60 * 60,
    gcTime: 1000 * 60 * 60 * 2,
  });

  if (!data?.detected || !data.contradictions?.length) return null;

  const primary = data.contradictions[0]; // already sorted high first
  const others = data.contradictions.length - 1;
  const accent = primary.severity === "high" ? T.red : T.amber;

  return (
    <div
      style={{
        background: T.surface,
        border: `1px solid ${T.border}`,
        borderLeft: `2px solid ${accent}`,
        borderRadius: 12,
        padding: 16,
        marginBottom: 12,
        boxShadow: "inset 0 1px 0 rgba(255,255,255,0.04)",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
        <div
          style={{
            width: 20,
            height: 20,
            borderRadius: 10,
            background: accent,
            color: T.bg,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 12,
            lineHeight: 1,
          }}
        >
          !
        </div>
        <div
          style={{
            fontSize: 10,
            letterSpacing: "0.22em",
            textTransform: "uppercase",
            color: T.label,
          }}
        >
          Your plan has a contradiction
        </div>
      </div>

      <div
        style={{
          fontFamily: "var(--font-display)",
          fontSize: 14,
          lineHeight: 1.5,
          color: T.text1,
          letterSpacing: "-0.005em",
          marginBottom: 12,
        }}
      >
        {primary.message}
      </div>

      <div
        style={{
          background: T.surface2,
          border: `1px solid ${T.border}`,
          borderRadius: 10,
          padding: 12,
          marginBottom: 10,
        }}
      >
        <div
          style={{
            fontSize: 10,
            letterSpacing: "0.22em",
            textTransform: "uppercase",
            color: T.label,
            marginBottom: 6,
          }}
        >
          {primary.actionTitle}
        </div>
        <div style={{ fontSize: 13, lineHeight: 1.5, color: T.text2 }}>
          {primary.actionBody}
        </div>
      </div>

      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
        }}
      >
        <span
          style={{
            fontSize: 10,
            letterSpacing: "0.18em",
            textTransform: "uppercase",
            color: accent,
          }}
        >
          {primary.severity === "high" ? "High confidence" : "Medium confidence"}
        </span>
        {others > 0 && (
          <span style={{ fontSize: 12, color: T.text3 }}>
            +{others} other signal{others > 1 ? "s" : ""}
          </span>
        )}
      </div>
    </div>
  );
}
