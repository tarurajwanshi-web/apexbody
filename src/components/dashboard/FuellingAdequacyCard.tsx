import { useSuspenseQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getFuellingAdequacy } from "@/lib/fuelling.functions";
import { T } from "./tokens";
import { cleanCardText } from "./text";

export function FuellingAdequacyCard() {
  const fn = useServerFn(getFuellingAdequacy);
  const { data } = useSuspenseQuery({
    queryKey: ["fuelling-adequacy"],
    queryFn: () => fn(),
    staleTime: 1000 * 60 * 60 * 6,
    gcTime: 1000 * 60 * 60 * 12,
  });

  if (!data) return null;
  if (data.severity_score < 2) return null;

  const isUnder = data.severity === "underfuelled";
  const issueColor = isUnder ? T.red ?? "#EF4444" : T.amber ?? "#F59E0B";

  return (
    <div
      style={{
        background: T.surface,
        border: `1px solid ${T.border}`,
        borderLeft: `2px solid ${issueColor}`,
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
          marginBottom: 8,
        }}
      >
        Fuelling Evaluation
      </div>
      <div style={{ fontSize: 14, color: T.text1, marginBottom: 6 }}>
        {data.total_sets} sets · {Math.round(data.calories_consumed)} kcal
      </div>
      <div
        style={{
          fontSize: 13,
          color: issueColor,
          lineHeight: 1.5,
          marginBottom: 10,
        }}
      >
        {cleanCardText(data.message)}
      </div>
      {data.mini_explanation && (
        <div
          style={{
            fontSize: 12,
            color: T.text3,
            lineHeight: 1.5,
            fontStyle: "italic",
            marginBottom: 10,
          }}
        >
          {cleanCardText(data.mini_explanation)}
        </div>
      )}
      <div
        style={{
          background: T.surface2,
          border: `1px solid ${T.border}`,
          borderRadius: 12,
          padding: 12,
        }}
      >
        <div
          style={{
            fontSize: 10,
            letterSpacing: "0.18em",
            textTransform: "uppercase",
            color: T.label,
            marginBottom: 4,
          }}
        >
          Action
        </div>
        <div style={{ fontSize: 12, color: T.text1, lineHeight: 1.5, fontWeight: 500 }}>
          {cleanCardText(data.action)}
        </div>
      </div>
    </div>
  );
}
