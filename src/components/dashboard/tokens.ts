// Shared APEX dashboard tokens — applied via inline styles to avoid touching
// global CSS. Keep this list in sync with the spec.

export const T = {
  bg: "#09091A",
  surface: "#10142A",
  surface2: "#161C38",
  border: "#1E2445",
  primary: "#7B6EF6",
  green: "#2DD4A0",
  amber: "#F5A623",
  red: "#E05252",
  victory: "#A8FF78",
  text1: "#E2E2F0",
  text2: "#8888A8",
  text3: "#44446A",
  dotted: "rgba(123, 110, 246, 0.25)",
  dottedSoft: "rgba(123, 110, 246, 0.2)",
} as const;

export const cardStyle: React.CSSProperties = {
  background: T.surface,
  border: `0.5px solid ${T.border}`,
  borderRadius: 16,
  padding: 16,
};

export const nestedCardStyle: React.CSSProperties = {
  background: T.surface,
  border: `0.5px solid ${T.border}`,
  borderRadius: 12,
  padding: 16,
};

export const microLabel: React.CSSProperties = {
  fontSize: 10,
  letterSpacing: "1.5px",
  textTransform: "uppercase",
  color: T.text3,
  fontWeight: 500,
};

export const bodyText: React.CSSProperties = {
  fontSize: 14,
  fontWeight: 400,
  lineHeight: 1.6,
  color: T.text1,
};
