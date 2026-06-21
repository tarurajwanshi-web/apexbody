/**
 * Continuous color-zone system used across the score ring, macro rings,
 * pillar dots, and any indicator that communicates "where does this number
 * fall on a 0-100 performance scale". Interpolates smoothly between zones:
 *   0-20  red       (#EF4444)
 *  20-45  amber     (#F59E0B)
 *  45-70  yellow-gn (#A3E635)
 *  70-100 green     (#10B981)
 */

type RGB = [number, number, number];

const STOPS: { at: number; rgb: RGB }[] = [
  { at: 0,   rgb: [239, 68, 68] },   // red-500
  { at: 20,  rgb: [239, 68, 68] },   // red-500 (hold to ~20)
  { at: 45,  rgb: [245, 158, 11] },  // amber-500
  { at: 70,  rgb: [163, 230, 53] },  // lime-400
  { at: 100, rgb: [16, 185, 129] },  // emerald-500
];

function lerp(a: number, b: number, t: number) { return a + (b - a) * t; }

function toHex([r, g, b]: RGB) {
  const h = (n: number) => Math.round(n).toString(16).padStart(2, "0");
  return `#${h(r)}${h(g)}${h(b)}`;
}

export function scoreColor(score: number | null | undefined): string {
  if (score == null || Number.isNaN(score)) return "#4A566A"; // neutral grey
  const s = Math.max(0, Math.min(100, score));
  for (let i = 0; i < STOPS.length - 1; i++) {
    const a = STOPS[i], b = STOPS[i + 1];
    if (s >= a.at && s <= b.at) {
      const t = (s - a.at) / (b.at - a.at || 1);
      return toHex([
        lerp(a.rgb[0], b.rgb[0], t),
        lerp(a.rgb[1], b.rgb[1], t),
        lerp(a.rgb[2], b.rgb[2], t),
      ]);
    }
  }
  return toHex(STOPS[STOPS.length - 1].rgb);
}

/** True at the genuine extremes — used to add a slightly stronger halo. */
export function isExtreme(score: number | null | undefined): boolean {
  if (score == null) return false;
  return score < 20 || score > 70;
}

/** rgba helper for glow colors. */
export function scoreColorRgba(score: number | null | undefined, alpha = 0.5): string {
  const hex = scoreColor(score).replace("#", "");
  const r = parseInt(hex.slice(0, 2), 16);
  const g = parseInt(hex.slice(2, 4), 16);
  const b = parseInt(hex.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}
