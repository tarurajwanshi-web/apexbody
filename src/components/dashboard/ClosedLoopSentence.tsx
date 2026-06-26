import { T } from "./tokens";

export type EngineState = {
  readiness?: boolean;
  load?: boolean;
  nutrition?: boolean;
  recovery?: boolean;
};

type Props = {
  sentence: string;
  engines?: EngineState;
};

/**
 * Four engine dots followed by a single sentence.
 * Filled violet = engine drove the decision. Hollow = engine is neutral.
 * Ambient evidence of the closed-loop reasoning across all four engines.
 */
export function ClosedLoopSentence({ sentence, engines = {} }: Props) {
  const order: (keyof EngineState)[] = ["readiness", "load", "nutrition", "recovery"];
  return (
    <div
      style={{
        display: "flex",
        alignItems: "flex-start",
        gap: 12,
        padding: "4px 2px",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 4,
          paddingTop: 8,
          flexShrink: 0,
        }}
        aria-hidden
      >
        {order.map((k) => (
          <span
            key={k}
            style={{
              width: 6,
              height: 6,
              borderRadius: "50%",
              background: engines[k] ? T.primary : "transparent",
              border: `1px solid ${engines[k] ? T.primary : T.borderStrong}`,
            }}
          />
        ))}
      </div>
      <p
        style={{
          margin: 0,
          fontFamily: "var(--font-display)",
          fontSize: 17,
          lineHeight: 1.45,
          letterSpacing: "-0.01em",
          color: T.text1,
          fontWeight: 400,
        }}
      >
        {sentence}
      </p>
    </div>
  );
}
