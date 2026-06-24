// Shared APEX dashboard tokens — applied via inline styles to avoid touching
// global CSS. Keep this list in sync with the spec.

export const T = {
  bg: "#0A0E1A",
  surface: "#10142A",
  surface2: "#161C38",
  border: "#1E2445",
  primary: "#7B6EF6",
  green: "#2DD4A0",
  amber: "#F5A623",
  red: "#E05252",
  victory: "#A8FF78",
  // Typography tiers (dashboard spec)
  text1: "#EEEEF6", // headlines / large numbers
  text2: "#A8A8C8", // body / descriptions
  text3: "#6668A0", // ring labels / metric sublabels
  label: "#44466A", // uppercase labels / hints
  disabled: "#2A2C3A", // empty states / dashes
  // Ring colors
  ringRecovery: "#7B6EF6",
  ringFuel: "#F5A623",
  ringEffort: "#2DD4A0",
  ringTrack: "#111320",
  // State zones
  zoneRecover: "#E05252",
  zoneSteady: "#F5A623",
  zoneBuild: "#2DD4A0",
  zonePeak: "#7B6EF6",
  // Spectrum gradient
  spectrum:
    "linear-gradient(90deg,#4A1010 0%,#7A2A0A 16%,#B05010 33%,#C8820A 50%,#1A9A6A 66%,#2A7ACC 83%,#6A54E0 100%)",
  dotted: "rgba(123, 110, 246, 0.25)",
  dottedSoft: "rgba(123, 110, 246, 0.2)",
} as const;

export const cardStyle: React.CSSProperties = {
  background: T.surface,
  border: `0.5px solid ${T.border}`,
  borderRadius: 22,
  padding: 18,
};

export const nestedCardStyle: React.CSSProperties = {
  background: T.surface2,
  border: `0.5px solid ${T.border}`,
  borderRadius: 14,
  padding: 14,
};

export const microLabel: React.CSSProperties = {
  fontSize: 9,
  letterSpacing: "1.8px",
  textTransform: "uppercase",
  color: T.label,
  fontWeight: 500,
};

export const bodyText: React.CSSProperties = {
  fontSize: 13,
  fontWeight: 400,
  lineHeight: 1.6,
  color: T.text2,
};
