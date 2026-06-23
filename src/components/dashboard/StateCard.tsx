import { T, cardStyle, microLabel } from "./tokens";

type Props = {
  readiness: number | null;
};

function zoneFor(r: number): { name: string; color: string } {
  if (r < 40) return { name: "Recover", color: T.zoneRecover };
  if (r < 60) return { name: "Steady", color: T.zoneSteady };
  if (r < 80) return { name: "Build", color: T.zoneBuild };
  return { name: "Peak", color: T.zonePeak };
}

export function StateCard({ readiness }: Props) {
  const has = readiness != null;
  const r = Math.max(0, Math.min(100, readiness ?? 0));
  const z = has ? zoneFor(r) : { name: "—", color: T.disabled };
  return (
    <div style={cardStyle}>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: 16,
        }}
      >
        <div style={microLabel}>Your State</div>
        <div style={{ fontSize: 13, fontWeight: 500, color: z.color, letterSpacing: "-0.2px" }}>
          {z.name}
        </div>
      </div>
      <div style={{ position: "relative", height: 16, marginBottom: 12 }}>
        <div
          style={{
            position: "absolute",
            left: 0,
            right: 0,
            top: 3,
            height: 10,
            borderRadius: 5,
            background: T.spectrum,
          }}
        />
        <div
          style={{
            position: "absolute",
            left: 0,
            right: 0,
            top: 3,
            height: 10,
            borderRadius: 5,
            background:
              "linear-gradient(180deg, rgba(255,255,255,0.13) 0%, rgba(255,255,255,0) 60%)",
            pointerEvents: "none",
          }}
        />
        {has && (
          <div
            style={{
              position: "absolute",
              top: 0,
              left: `calc(${r}% - 8px)`,
              width: 16,
              height: 16,
              borderRadius: "50%",
              background: "#FFFFFF",
              border: `2.5px solid ${T.surface}`,
              boxShadow: "0 1px 4px rgba(0,0,0,0.4)",
            }}
          />
        )}
      </div>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          fontSize: 9,
          color: T.label,
          letterSpacing: "1.8px",
          textTransform: "uppercase",
        }}
      >
        <span>Rest</span>
        <span>Maintain</span>
        <span>Build</span>
        <span>Peak</span>
      </div>
    </div>
  );
}
