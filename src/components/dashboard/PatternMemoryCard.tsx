import { useSuspenseQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getRecoveryPatterns, type RecoveryPattern } from "@/lib/pattern-memory.functions";
import { T } from "./tokens";
import { cleanCardText } from "./text";

function humanizeTitle(p: RecoveryPattern): string {
  if (p.pattern_type === "exercise_lag") {
    const ex = p.pattern_key.replace(/\b\w/g, (c) => c.toUpperCase());
    return `${ex} Recovery Lag`;
  }
  if (p.pattern_type === "sleep_effect") return "Sleep → Readiness";
  return p.pattern_key.replace(/_/g, " ");
}

export function PatternMemoryCard() {
  const fn = useServerFn(getRecoveryPatterns);
  const { data } = useSuspenseQuery({
    queryKey: ["recovery-patterns"],
    queryFn: () => fn(),
    staleTime: 1000 * 60 * 60,
    gcTime: 1000 * 60 * 60 * 2,
  });

  const patterns = (data ?? []).filter((p) => p.data_points >= 4).slice(0, 3);
  if (patterns.length === 0) return null;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {patterns.map((p) => {
        const title = humanizeTitle(p);
        const observation = cleanCardText(p.description);
        const explanation = cleanCardText(p.explanation ?? "");
        const protocol = cleanCardText(p.protocol ?? "");
        return (
          <div
            key={`${p.pattern_type}:${p.pattern_key}`}
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
                fontSize: 14,
                color: T.text1,
                marginBottom: 6,
              }}
            >
              {title}
            </div>
            <div
              style={{
                fontSize: 13,
                color: T.text2,
                lineHeight: 1.5,
                marginBottom: 8,
              }}
            >
              {observation}
            </div>
            {explanation && (
              <div
                style={{
                  fontSize: 12,
                  color: T.text3,
                  lineHeight: 1.5,
                  marginBottom: 10,
                }}
              >
                {explanation}
              </div>
            )}
            {protocol && (
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
                    fontSize: 10,
                    letterSpacing: "0.18em",
                    textTransform: "uppercase",
                    color: T.label,
                    marginBottom: 4,
                  }}
                >
                  Protocol
                </div>
                <div
                  style={{
                    fontSize: 12,
                    color: T.text1,
                    lineHeight: 1.5,
                    fontWeight: 500,
                  }}
                >
                  {protocol}
                </div>
              </div>
            )}
            <div style={{ display: "flex", justifyContent: "flex-end" }}>
              <span
                style={{
                  fontSize: 10,
                  letterSpacing: "0.18em",
                  textTransform: "uppercase",
                  color: T.text3,
                }}
              >
                High ({p.data_points} observations)
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}
