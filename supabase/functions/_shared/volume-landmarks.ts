// APEX volume landmarks — canonical source for per-muscle weekly set targets.
// Pure module (no I/O, no Deno APIs) so it can be re-exported by the browser
// bundle via src/lib/volume-landmarks.ts.
//
// Keyed EXACTLY to MUSCLE_GROUPS in _shared/training-rules.ts. Trainable
// muscles get MEV/MAV/MRV (Renaissance Periodization / Israetel published
// values). Non-hypertrophy groups return null and are excluded from volume
// math.

export type Landmarks = { mev: number; mav: number; mrv: number };

export const VOLUME_LANDMARKS: Record<string, Landmarks | null> = {
  chest:      { mev: 10, mav: 16, mrv: 22 },
  back:       { mev: 10, mav: 18, mrv: 25 },
  shoulders:  { mev: 8,  mav: 16, mrv: 22 },
  quads:      { mev: 8,  mav: 14, mrv: 20 },
  hamstrings: { mev: 6,  mav: 12, mrv: 16 },
  glutes:     { mev: 4,  mav: 12, mrv: 16 },
  calves:     { mev: 8,  mav: 14, mrv: 20 },
  biceps:     { mev: 8,  mav: 16, mrv: 20 },
  triceps:    { mev: 6,  mav: 14, mrv: 18 },
  forearms:   { mev: 4,  mav: 10, mrv: 14 },
  core:       { mev: 6,  mav: 16, mrv: 25 },
  full_body:  null,
  cardio:     null,
  mobility:   null,
};

export const EXPERIENCE_MULTIPLIER: Record<string, number> = {
  beginner: 0.6,
  intermediate: 1.0,
  advanced: 1.15,
};

// Goal multiplier applies to MAV only (RP convention — goal shifts the
// productive ceiling, not the floor or true max).
// Includes the 5 canonical Goal enum values plus 2 harmless dead keys
// (`hypertrophy`, `general_fitness`) in case profiles.goal drifts.
export const GOAL_MAV_MULTIPLIER: Record<string, number> = {
  muscle_gain: 1.0,
  recomposition: 1.0,
  hypertrophy: 1.0,
  strength: 0.75,
  fat_loss: 0.85,
  general_fitness: 0.9,
  athletic_performance: 0.8,
};

/**
 * Effective landmarks for (muscle, experience, goal). Returns null for
 * non-hypertrophy muscles. Unknown experience / goal → 1.0 fallback,
 * never throws.
 */
export function effectiveLandmarks(
  muscle: string,
  experience: string | null | undefined,
  goal: string | null | undefined,
): Landmarks | null {
  const base = VOLUME_LANDMARKS[muscle];
  if (!base) return null;
  const expMult = EXPERIENCE_MULTIPLIER[(experience ?? "").toLowerCase()] ?? 1.0;
  const goalMavMult = GOAL_MAV_MULTIPLIER[(goal ?? "").toLowerCase()] ?? 1.0;
  return {
    mev: Math.max(1, Math.round(base.mev * expMult)),
    mav: Math.max(1, Math.round(base.mav * expMult * goalMavMult)),
    mrv: Math.max(1, Math.round(base.mrv * expMult)),
  };
}

// Canonical MUSCLE_GROUPS keys, ordered for the heat map: hypertrophy first,
// non-scored (full_body/cardio/mobility) grouped last.
export const MUSCLE_GROUP_DISPLAY_ORDER = [
  "chest", "back", "shoulders", "quads", "hamstrings", "glutes",
  "calves", "biceps", "triceps", "forearms", "core",
  "full_body", "cardio", "mobility",
] as const;

// Legacy alias map — snapshot of the strings previously written by older
// clients. Real production data (queried at build time) shows only canonical
// keys, but we keep the aliases so any older row silently normalises.
export const MUSCLE_GROUP_ALIASES: Record<string, string> = {
  lats: "back",
  delts: "shoulders",
  deltoids: "shoulders",
  quadriceps: "quads",
  abs: "core",
  obliques: "core",
  legs: "quads", // coarse legacy bucket — best-guess to the largest sub-muscle
  arms: "biceps",
};

/**
 * Normalise a raw muscle_group string to a canonical MUSCLE_GROUPS key.
 * Returns null when the string is empty / unknown so callers can bucket it
 * into an "unclassified" count and warn — never silently drop.
 */
export function normaliseMuscleGroup(raw: string | null | undefined): string | null {
  const g = (raw ?? "").toLowerCase().trim();
  if (!g) return null;
  if (VOLUME_LANDMARKS[g] !== undefined) return g;
  if (MUSCLE_GROUP_ALIASES[g]) return MUSCLE_GROUP_ALIASES[g];
  return null;
}

export const MUSCLE_GROUP_LABELS: Record<string, string> = {
  chest: "Chest",
  back: "Back",
  shoulders: "Shoulders",
  quads: "Quads",
  hamstrings: "Hamstrings",
  glutes: "Glutes",
  calves: "Calves",
  biceps: "Biceps",
  triceps: "Triceps",
  forearms: "Forearms",
  core: "Core",
  full_body: "Full Body",
  cardio: "Cardio",
  mobility: "Mobility",
};
