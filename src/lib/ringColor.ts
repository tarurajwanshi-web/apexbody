/**
 * Ring color helpers — traffic-light semantics for readiness / APEX scores.
 *
 *   ≥ 67 → high (green)
 *   34–66 → medium (yellow)
 *   < 34  → low (red)
 *   null  → grey (no data)
 *
 * Every ring rendering in the app must consume these — never hardcode.
 */

export function ringGradient(score: number | null): string {
  if (score === null || !Number.isFinite(score))
    return "linear-gradient(135deg, #6B6D82 0%, #A8A8C8 100%)";
  if (score >= 67) return "linear-gradient(135deg, #22C55E 0%, #86EFAC 100%)";
  if (score >= 34) return "linear-gradient(135deg, #EAB308 0%, #FDE047 100%)";
  return "linear-gradient(135deg, #EF4444 0%, #FCA5A5 100%)";
}

export function ringGlow(score: number | null): string {
  if (score === null || !Number.isFinite(score)) return "none";
  if (score >= 67) return "drop-shadow(0 0 40px rgba(34, 197, 94, 0.20))";
  if (score >= 34) return "drop-shadow(0 0 40px rgba(234, 179, 8, 0.20))";
  return "drop-shadow(0 0 40px rgba(239, 68, 68, 0.20))";
}

/** Solid stroke color (for the endpoint dot and single-color contexts). */
export function ringSolid(score: number | null): string {
  if (score === null || !Number.isFinite(score)) return "#A8A8C8";
  if (score >= 67) return "#22C55E";
  if (score >= 34) return "#EAB308";
  return "#EF4444";
}

/** Return two gradient stops as a tuple, for inline <linearGradient> stops. */
export function ringStops(score: number | null): [string, string] {
  if (score === null || !Number.isFinite(score)) return ["#6B6D82", "#A8A8C8"];
  if (score >= 67) return ["#22C55E", "#86EFAC"];
  if (score >= 34) return ["#EAB308", "#FDE047"];
  return ["#EF4444", "#FCA5A5"];
}
