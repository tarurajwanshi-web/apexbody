// APEX design tokens — royal-blue signature, teal secondary.
// Ring semantics follow traffic-light (green/yellow/red) via
// src/lib/ringColor.ts — never hardcode ring color at call sites.

export const T = {
  // Surfaces (cool blue-grey charcoals)
  bg: "#101518",
  surface: "#1A2126",
  surface2: "#232B31",
  border: "rgba(255,255,255,0.06)",
  borderStrong: "rgba(255,255,255,0.10)",

  // Signature accent — royal blue (AI / decisions / interactive)
  primary: "#4F6BF6",
  primaryGlow: "rgba(79,107,246,0.24)",

  // Semantic (traffic-light)
  green: "#22C55E",
  amber: "#EAB308", // repurposed: WARN yellow (not the old orange amber)
  red: "#EF4444",
  victory: "#22C55E",

  // Typography tiers
  text1: "#F0F0F5",
  text2: "#A8A8C8",
  text3: "#6B6D82",
  label: "#3E4052",
  disabled: "#2A2E40",

  // Ring colors (metric-neutral defaults; use ringGradient() for readiness)
  ringRecovery: "#22C55E",
  ringFuel: "#4F6BF6",
  ringEffort: "#A8A8C8",
  ringTrack: "rgba(255,255,255,0.05)",

  // State zones
  zoneRecover: "#EF4444",
  zoneSteady: "#EAB308",
  zoneBuild: "#22C55E",
  zonePeak: "#4F6BF6",

  // Spectrum (weight-delta etc — use sparingly)
  spectrum:
    "linear-gradient(90deg,#EF4444 0%,#EAB308 33%,#A8A8C8 50%,#22C55E 66%,#4F6BF6 100%)",
  dotted: "rgba(79,107,246,0.20)",
  dottedSoft: "rgba(79,107,246,0.12)",
} as const;

export const cardStyle: React.CSSProperties = {
  background: T.surface,
  border: `1px solid ${T.border}`,
  borderRadius: 16,
  padding: 18,
  boxShadow:
    "inset 0 1px 0 rgba(255,255,255,0.04), 0 24px 60px rgba(0,0,0,0.45)",
};

export const nestedCardStyle: React.CSSProperties = {
  background: T.surface2,
  border: `1px solid ${T.border}`,
  borderRadius: 12,
  padding: 14,
};

export const microLabel: React.CSSProperties = {
  fontSize: 11,
  letterSpacing: "0.18em",
  textTransform: "uppercase",
  color: T.label,
  fontWeight: 500,
  fontVariantNumeric: "tabular-nums",
};

export const bodyText: React.CSSProperties = {
  fontSize: 15,
  fontWeight: 400,
  lineHeight: 1.55,
  color: T.text2,
};
