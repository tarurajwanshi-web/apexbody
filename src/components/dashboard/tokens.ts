// Shared APEX dashboard tokens — Whoop Obsidian palette.
// Near-black canvas, electric data accents. Same shape as before so existing
// dashboard components inherit the new palette without per-file edits.

export const T = {
  // Surfaces
  bg: "#0A0A0A",
  surface: "#141416",
  surface2: "#1C1C1F",
  border: "#26262A",
  borderStrong: "#3A3A3F",

  // Accents — primary is now signal cyan (AI/decision), data is electric green
  primary: "#7DF9FF", // signal cyan — AI / interactive
  green: "#00E5A0",  // electric green — positive metrics
  amber: "#FFB627",
  red: "#FF5A5F",
  victory: "#00E5A0",

  // Typography tiers
  text1: "#F5F5F7", // headlines / large numbers
  text2: "#A1A1A6", // body / descriptions
  text3: "#6E6E73", // ring labels / metric sublabels
  label: "#4A4A4F", // uppercase labels / hints
  disabled: "#2A2A2D", // empty states / dashes

  // Ring colors — cyan/green spectrum, no purple
  ringRecovery: "#00E5A0",
  ringFuel: "#FFB627",
  ringEffort: "#7DF9FF",
  ringTrack: "#1C1C1F",

  // State zones
  zoneRecover: "#FF5A5F",
  zoneSteady: "#FFB627",
  zoneBuild: "#00E5A0",
  zonePeak: "#7DF9FF",

  // Spectrum gradient — obsidian → cyan
  spectrum:
    "linear-gradient(90deg,#3A0F12 0%,#7A2A0A 16%,#B05010 33%,#C8820A 50%,#00E5A0 66%,#33D6E0 83%,#7DF9FF 100%)",
  dotted: "rgba(125, 249, 255, 0.22)",
  dottedSoft: "rgba(125, 249, 255, 0.14)",
} as const;

export const cardStyle: React.CSSProperties = {
  background: T.surface,
  border: `1px solid ${T.border}`,
  borderRadius: 14,
  padding: 18,
};

export const nestedCardStyle: React.CSSProperties = {
  background: T.surface2,
  border: `1px solid ${T.border}`,
  borderRadius: 10,
  padding: 14,
};

export const microLabel: React.CSSProperties = {
  fontSize: 10,
  letterSpacing: "1.8px",
  textTransform: "uppercase",
  color: T.label,
  fontWeight: 500,
  fontVariantNumeric: "tabular-nums",
};

export const bodyText: React.CSSProperties = {
  fontSize: 14,
  fontWeight: 400,
  lineHeight: 1.6,
  color: T.text2,
};
