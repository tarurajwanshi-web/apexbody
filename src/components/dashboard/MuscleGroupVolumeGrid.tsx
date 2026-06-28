import { useSuspenseQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getMuscleGroupWeeklyVolume } from "@/lib/coach.functions";
import { T } from "./tokens";

const MUSCLE_GROUPS: Array<{ key: keyof Groups; label: string }> = [
  { key: "chest", label: "Chest" },
  { key: "back", label: "Back" },
  { key: "shoulders", label: "Shoulders" },
  { key: "legs", label: "Legs" },
  { key: "arms", label: "Arms" },
  { key: "core", label: "Core" },
];

type Groups = {
  chest: number; back: number; shoulders: number;
  legs: number; arms: number; core: number;
};

function color(sets: number) {
  if (sets >= 10 && sets <= 20) return T.green;
  if (sets < 5 || sets > 25) return T.red;
  return T.amber;
}

export function MuscleGroupVolumeGrid() {
  const fn = useServerFn(getMuscleGroupWeeklyVolume);
  const { data } = useSuspenseQuery({
    queryKey: ["coach", "muscleGroupVolume"],
    queryFn: () => fn(),
    staleTime: 1000 * 60 * 60,
    gcTime: 1000 * 60 * 60 * 2,
  });

  return (
    <div className="grid grid-cols-3 md:grid-cols-6 gap-2">
      {MUSCLE_GROUPS.map(({ key, label }) => {
        const sets = data?.groups?.[key] ?? 0;
        const c = color(sets);
        return (
          <div
            key={key}
            style={{
              background: T.surface,
              border: `1px solid ${T.border}`,
              borderRadius: 12,
              padding: 12,
              textAlign: "center",
              borderTop: `2px solid ${c}`,
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
              {label}
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
