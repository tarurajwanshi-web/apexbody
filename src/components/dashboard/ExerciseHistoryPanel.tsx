import { useSuspenseQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getExerciseHistory } from "@/lib/coach.functions";
import { Sparkline } from "@/components/Sparkline";
import { T } from "./tokens";

export function ExerciseHistoryPanel() {
  const fn = useServerFn(getExerciseHistory);
  const { data } = useSuspenseQuery({
    queryKey: ["coach", "exerciseHistory"],
    queryFn: () => fn(),
    staleTime: 1000 * 60 * 60,
    gcTime: 1000 * 60 * 60 * 2,
  });

  if (!data?.exercises?.length) {
    return (
      <div
        style={{
          background: T.surface,
          border: `1px solid ${T.border}`,
          borderRadius: 12,
          padding: 16,
          fontSize: 13,
          color: T.text3,
        }}
      >
        Log a few sessions to see your exercise history.
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {data.exercises.map((ex) => {
        const rirColor = ex.rirTrend >= 0 ? T.green : T.red;
        return (
          <div
            key={ex.name}
            style={{
              background: T.surface,
              border: `1px solid ${T.border}`,
              borderRadius: 12,
              padding: 14,
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 12,
                marginBottom: 10,
              }}
            >
              <div style={{ fontSize: 14, color: T.text1 }}>{ex.name}</div>
              <Sparkline points={ex.volumeSeries} width={80} height={20} color={T.primary} />
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 4, marginBottom: 8 }}>
              {ex.lastFiveSessions.map((s, i) => (
                <div
                  key={i}
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    fontSize: 12,
                    color: T.text2,
                    fontVariantNumeric: "tabular-nums",
                  }}
                >
                  <span style={{ color: T.text3 }}>{s.date}</span>
                  <span>
                    {s.weight}kg × {s.reps}
                    {s.rir != null ? ` · RIR ${s.rir}` : ""}
                  </span>
                </div>
              ))}
            </div>

            {ex.bestSet && (
              <div style={{ fontSize: 12, color: T.text3, marginBottom: 8 }}>
                Best: {ex.bestSet.weight}kg × {ex.bestSet.reps} ({ex.bestSet.date})
              </div>
            )}

            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 12,
                paddingTop: 8,
                borderTop: `1px solid ${T.border}`,
              }}
            >
              <span
                style={{
                  fontSize: 10,
                  letterSpacing: "0.18em",
                  textTransform: "uppercase",
                  color: T.label,
                }}
              >
                RIR Trend
              </span>
              <Sparkline points={ex.rirSeries} width={80} height={20} color={rirColor} />
            </div>

            {ex.deloadSuggested && (
              <div
                style={{
                  marginTop: 10,
                  padding: "8px 10px",
                  borderRadius: 8,
                  background: "rgba(245,181,68,0.08)",
                  border: `1px solid rgba(245,181,68,0.25)`,
                  color: T.amber,
                  fontSize: 12,
                }}
              >
                Approaching fatigue. Deload recommended.
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
