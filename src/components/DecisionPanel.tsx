import { type ReactNode } from "react";
import { T } from "@/components/dashboard/tokens";

export type DecisionAction = {
  label: string;
  onClick?: () => void;
  href?: string;
};

type Confidence = "high" | "medium" | "low";

type Props = {
  eyebrow?: string;
  brief: string;
  actions?: DecisionAction[];
  confidence?: Confidence;
  onWhy?: () => void;
  right?: ReactNode;
};

const confidenceColor: Record<Confidence, string> = {
  high: T.green,
  medium: T.amber,
  low: T.red,
};

/**
 * Persistent AI decision layer pinned to the top of primary screens.
 * Single brief + 1–3 action chips + confidence dot.
 */
export function DecisionPanel({
  eyebrow = "APEX BRIEF",
  brief,
  actions = [],
  confidence = "medium",
  onWhy,
  right,
}: Props) {
  return (
    <section
      aria-label="Today's decision brief"
      style={{
        background: T.surface,
        border: `1px solid ${T.border}`,
        borderLeft: `2px solid ${T.primary}`,
        borderRadius: 14,
        padding: 16,
        display: "flex",
        flexDirection: "column",
        gap: 12,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
          <span
            aria-hidden
            style={{
              width: 6,
              height: 6,
              borderRadius: "50%",
              background: confidenceColor[confidence],
              boxShadow: `0 0 8px ${confidenceColor[confidence]}`,
              flexShrink: 0,
            }}
          />
          <span
            style={{
              fontSize: 10,
              letterSpacing: "1.8px",
              textTransform: "uppercase",
              color: T.text3,
              fontWeight: 500,
            }}
          >
            {eyebrow}
          </span>
        </div>
        {right}
      </div>

      <p
        style={{
          fontSize: 16,
          lineHeight: 1.45,
          color: T.text1,
          margin: 0,
          fontFamily: 'var(--font-display)',
          letterSpacing: "-0.01em",
        }}
      >
        {brief}
      </p>

      {(actions.length > 0 || onWhy) && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
          {actions.map((a, i) => {
            const cls = "rounded-full transition-colors";
            const style: React.CSSProperties = {
              background: i === 0 ? T.primary : "transparent",
              color: i === 0 ? "#0A0A0A" : T.text1,
              border: `1px solid ${i === 0 ? T.primary : T.border}`,
              padding: "7px 14px",
              fontSize: 13,
              fontWeight: 500,
              cursor: "pointer",
              textDecoration: "none",
              display: "inline-flex",
              alignItems: "center",
            };
            if (a.href) {
              return (
                <a key={i} href={a.href} className={cls} style={style}>
                  {a.label}
                </a>
              );
            }
            return (
              <button key={i} type="button" onClick={a.onClick} className={cls} style={style}>
                {a.label}
              </button>
            );
          })}
          {onWhy && (
            <button
              type="button"
              onClick={onWhy}
              style={{
                background: "transparent",
                color: T.text3,
                border: "none",
                padding: "7px 4px",
                fontSize: 12,
                cursor: "pointer",
                marginLeft: "auto",
              }}
            >
              Why?
            </button>
          )}
        </div>
      )}
    </section>
  );
}
