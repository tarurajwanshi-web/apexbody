import type { ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { T } from "./tokens";

type Props = {
  label: string;
  value: ReactNode;
  meta?: ReactNode;
  to?: string;
};

/**
 * A single hairline row — label on the left, value + optional meta on the right.
 * Used for Today and This Week sections. No card chrome.
 */
export function QuietRow({ label, value, meta, to }: Props) {
  const body = (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 16,
        padding: "14px 0",
        borderBottom: `1px solid ${T.border}`,
        textDecoration: "none",
      }}
    >
      <div
        style={{
          fontSize: 13,
          color: T.text3,
          letterSpacing: "0.02em",
          flexShrink: 0,
          minWidth: 80,
        }}
      >
        {label}
      </div>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          minWidth: 0,
          flex: 1,
          justifyContent: "flex-end",
          fontFamily: "var(--font-display)",
          fontSize: 15,
          color: T.text1,
          fontWeight: 400,
          fontVariantNumeric: "tabular-nums",
          textAlign: "right",
        }}
      >
        {meta && (
          <span style={{ fontSize: 12, color: T.text3, fontFamily: "var(--font-sans)" }}>
            {meta}
          </span>
        )}
        <span data-metric>{value}</span>
      </div>
    </div>
  );
  if (to) {
    return (
      <Link to={to} style={{ display: "block", textDecoration: "none" }}>
        {body}
      </Link>
    );
  }
  return body;
}

export function SectionLabel({ children }: { children: ReactNode }) {
  return (
    <div
      style={{
        fontSize: 11,
        letterSpacing: "0.22em",
        textTransform: "uppercase",
        color: T.label,
        fontWeight: 500,
        padding: "20px 0 6px",
      }}
    >
      {children}
    </div>
  );
}
