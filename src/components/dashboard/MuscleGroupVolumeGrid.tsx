import { useSuspenseQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getMuscleGroupWeeklyVolume } from "@/lib/coach.functions";
import {
  MUSCLE_GROUP_DISPLAY_ORDER,
  MUSCLE_GROUP_LABELS,
  effectiveLandmarks,
  type Landmarks,
} from "@/lib/volume-landmarks";
import { T } from "./tokens";

type Band = "neutral" | "undertrained" | "productive" | "high" | "overreach";

function bandFor(sets: number, l: Landmarks | null): Band {
  if (!l) return "neutral";
  if (sets < l.mev) return "undertrained";
  if (sets < l.mav) return "productive";
  if (sets <= l.mrv) return "high";
  return "overreach";
}

function colorFor(band: Band): string {
  switch (band) {
    case "productive": return T.green;
    case "high": return T.amber;
    case "overreach": return T.red;
    case "undertrained": return T.text3;
    case "neutral": default: return T.text3;
  }
}

export function MuscleGroupVolumeGrid() {
  const fn = useServerFn(getMuscleGroupWeeklyVolume);
  const { data } = useSuspenseQuery({
    queryKey: ["coach", "muscleGroupVolume"],
    queryFn: () => fn(),
    staleTime: 1000 * 60 * 60,
    gcTime: 1000 * 60 * 60 * 2,
  });

  const groups = (data?.groups ?? {}) as Record<string, number>;
  const experience = data?.profile?.experience_level ?? null;
  const goal = data?.profile?.goal ?? null;

  return (
    <div className="grid grid-cols-3 md:grid-cols-4 lg:grid-cols-7 gap-2">
      {MUSCLE_GROUP_DISPLAY_ORDER.map((key) => {
        const sets = groups[key] ?? 0;
        // TODO(B5): after weekly_volume_landmarks.fuel_adjusted_mrv is written
        // per week, prefer that row's MRV over effectiveLandmarks().mrv when
        // one exists for the current week.
        const landmarks = effectiveLandmarks(key, experience, goal);
        const band = bandFor(sets, landmarks);
        const c = colorFor(band);
        return (
          <div
            key={key}
            style={{
              background: T.surface,
              border: `1px solid ${T.border}`,
              borderRadius: 12,
              padding: 12,
              textAlign: "center",
              borderTop: band === "neutral" ? `1px solid ${T.border}` : `2px solid ${c}`,
            }}
          >
            <div
              style={{
                fontSize: 10,
                letterSpacing: "0.18em",
                textTransform: "uppercase",
                color: T.label,
                marginBottom: 6,
              }}
            >
              {MUSCLE_GROUP_LABELS[key]}
            </div>
            <div
              style={{
                fontSize: 20,
                color: c,
                fontVariantNumeric: "tabular-nums",
                lineHeight: 1,
              }}
            >
              {sets}
            </div>
            <div style={{ fontSize: 10, color: T.text3, marginTop: 4 }}>sets</div>
          </div>
        );
      })}
    </div>
  );
}
