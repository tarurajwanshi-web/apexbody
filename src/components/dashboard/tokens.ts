// Midnight Bevel — premium APEX palette.
// Single violet accent (#8B7FF7) for AI / interactive; teal reserved for
// positive metric movement only. No neon, no signal cyan, no electric green.

export const T = {
  // Surfaces
  bg: "#0A0E1A",
  surface: "#10162A",
  surface2: "#161B2E",
  border: "rgba(255,255,255,0.06)",
  borderStrong: "rgba(255,255,255,0.10)",

  // Single accent
  primary: "#8B7FF7", // violet — AI / decisions / interactive
  green: "#5FE3C4",   // teal — positive movement
  amber: "#F5B544",
  red: "#F2727A",
  victory: "#5FE3C4",

  // Typography tiers
  text1: "#F5F5F7",
  text2: "#A8ADBD",
  text3: "#5E6478",
  label: "#3E4256",
  disabled: "#2A2E40",

  // Ring colors — quiet, monochrome-leaning
  ringRecovery: "#5FE3C4",
  ringFuel: "#8B7FF7",
  ringEffort: "#A8ADBD",
  ringTrack: "rgba(255,255,255,0.05)",

  // State zones
  zoneRecover: "#F2727A",
  zoneSteady: "#F5B544",
  zoneBuild: "#5FE3C4",
  zonePeak: "#8B7FF7",

  // Subtle spectrum (used sparingly, e.g. weight delta gradient)
  spectrum:
    "linear-gradient(90deg,#F2727A 0%,#F5B544 33%,#A8ADBD 50%,#5FE3C4 66%,#8B7FF7 100%)",
  dotted: "rgba(139,127,247,0.20)",
  dottedSoft: "rgba(139,127,247,0.12)",
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
