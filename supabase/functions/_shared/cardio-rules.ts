// B5.5 — Deterministic, goal-dosed cardio prescription.
//
// Cardio intentionally does NOT feed the calorie target — adaptive TDEE
// (weight-trend-based, see macro-calculation.ts line 232) already captures
// cardio burn; adding it here would double-count and stall fat loss.
//
// Cardio DOES feed systemic fatigue via shield_training_logs.strain_value
// (0-21 scale, combined with lifting) — see the recompute_daily_training_strain
// DB function.
//
// Evidence: Barbell Medicine 150 min/wk aerobic baseline; concurrent-training
// reviews indicate LISS 60-150 min/wk minimizes hypertrophy interference;
// HIIT small-dose (4-12 min hard work) drives VO2max without extra strain.

import type { Goal, Experience, Permission } from "./training-rules.ts";

export type CardioModality = "zone2" | "liss" | "intervals" | "mixed";

export interface CardioPrescription {
  weekly_sessions: number;
  minutes_per_session: number;
  modality: CardioModality;
  intensity_note: string;
  placement_note: string;
  rationale: string;
  allow_interval_swap: boolean;
}

interface CardioInput {
  goal: Goal;
  experience: Experience;
  phase: "accumulation" | "deload";
  weeklyReduce: boolean;
}

function baseline(goal: Goal): CardioPrescription {
  switch (goal) {
    case "fat_loss":
      return {
        weekly_sessions: 3,
        minutes_per_session: 30,
        modality: "zone2",
        intensity_note: "Conversational pace, ~60–70% max HR.",
        placement_note: "Rest days, or after lifting — never before a strength session.",
        rationale: "Zone 2 raises weekly energy burn with minimal recovery cost, protecting muscle while you lean out.",
        allow_interval_swap: true,
      };
    case "muscle_gain":
      return {
        weekly_sessions: 2,
        minutes_per_session: 25,
        modality: "zone2",
        intensity_note: "Easy, conversational.",
        placement_note: "Separate day from heavy legs, or after upper-body lifting.",
        rationale: "Enough cardio to protect heart health and recovery between sets, without eating into growth.",
        allow_interval_swap: false,
      };
    case "recomposition":
      return {
        weekly_sessions: 3,
        minutes_per_session: 25,
        modality: "zone2",
        intensity_note: "Conversational.",
        placement_note: "Rest days or post-lift.",
        rationale: "Steady cardio supports the small deficit recomp needs while preserving training quality.",
        allow_interval_swap: false,
      };
    case "strength":
      return {
        weekly_sessions: 2,
        minutes_per_session: 20,
        modality: "zone2",
        intensity_note: "Easy, low impact — steady-state only.",
        placement_note: "Far from heavy lower-body days — never pair intervals with heavy squat/deadlift.",
        rationale: "A conditioning base so you don't gas out on heavy sets; minimal and easy to protect strength recovery.",
        allow_interval_swap: false,
      };
    case "athletic_performance":
      return {
        weekly_sessions: 3,
        minutes_per_session: 25,
        modality: "mixed",
        intensity_note: "2 easy zone 2 sessions plus 1 interval session (~6–12 min hard work).",
        placement_note: "Intervals on their own day; zone 2 flexible.",
        rationale: "Mixed conditioning builds both aerobic base and top-end for performance.",
        allow_interval_swap: true,
      };
  }
}

/** Resolve the goal- and experience-adjusted cardio prescription for the week. */
export function resolveCardioPrescription(input: CardioInput): CardioPrescription {
  const p = { ...baseline(input.goal) };

  // Experience scaling.
  if (input.experience === "beginner") {
    p.weekly_sessions = Math.max(1, p.weekly_sessions - 1);
    p.minutes_per_session = Math.max(15, p.minutes_per_session - 5);
    p.modality = "zone2";
    p.allow_interval_swap = false;
    p.intensity_note = "Easy, conversational — build the habit first.";
  } else if (input.experience === "advanced") {
    // upper end is already the baseline; keep interval swap flag as set
  }

  // Deload OR weekly-reduce gate — back cardio off in lock-step with lifting.
  if (input.phase === "deload" || input.weeklyReduce) {
    p.weekly_sessions = Math.max(1, p.weekly_sessions - 1);
    p.minutes_per_session = Math.max(15, p.minutes_per_session - 5);
    p.modality = p.modality === "intervals" ? "zone2" : p.modality;
    p.allow_interval_swap = false;
    p.intensity_note = "Steady-state only this week — cardio backs off with your lifting.";
  }

  return p;
}

/** Per-day readiness softening applied to a placed cardio session. */
export function cardioReadinessSoftening(permission: Permission): {
  optional: boolean;
  minutes_delta: number;
  force_zone2: boolean;
} {
  if (permission === "red_recover") return { optional: true, minutes_delta: -15, force_zone2: true };
  if (permission === "orange_reduce") return { optional: true, minutes_delta: -10, force_zone2: true };
  return { optional: false, minutes_delta: 0, force_zone2: false };
}

export interface CardioPlacement {
  modality: CardioModality;
  minutes: number;
  intensity_note: string;
  optional: boolean;
}

/**
 * Deterministically distribute weekly cardio sessions across the 7-day
 * calendar. Priority: rest days first, then training days that don't
 * fall immediately before another training day. For strength goal, never
 * placed on the same day as a training session (rest-day preferred only).
 *
 * `sessionKinds[i]` (optional): the fallback SessionKind for training slot i,
 * used to avoid stacking cardio on heavy-lower days when known.
 *
 * Returns a 7-length array where non-cardio days are null.
 */
export function placeCardioAcrossWeek(
  prescription: CardioPrescription,
  restMask: boolean[] | undefined,
  goal: Goal,
  permission: Permission,
  sessionKinds?: (string | null)[],
): (CardioPlacement | null)[] {
  const placements: (CardioPlacement | null)[] = new Array(7).fill(null);
  const needed = Math.max(0, Math.min(7, prescription.weekly_sessions));
  if (needed === 0) return placements;

  const isRest = (i: number): boolean =>
    Array.isArray(restMask) && restMask.length === 7 ? restMask[i] === true : false;

  const isDayBeforeTraining = (i: number): boolean => {
    if (!Array.isArray(restMask) || restMask.length !== 7) return false;
    const next = (i + 1) % 7;
    return restMask[next] === false;
  };

  const isHeavyLower = (i: number): boolean => {
    if (!sessionKinds) return false;
    const k = sessionKinds[i];
    return k === "lower" || k === "power" || k === "full";
  };

  // Priority 1: rest days, earliest first.
  const restCandidates: number[] = [];
  const trainingSafe: number[] = [];
  const trainingOther: number[] = [];
  for (let i = 0; i < 7; i++) {
    if (isRest(i)) restCandidates.push(i);
    else if (goal === "strength") continue; // strength: rest-only
    else if (isHeavyLower(i) || isDayBeforeTraining(i)) trainingOther.push(i);
    else trainingSafe.push(i);
  }

  const ordered = [...restCandidates, ...trainingSafe, ...trainingOther];
  const chosen = new Set<number>();
  for (const idx of ordered) {
    if (chosen.size >= needed) break;
    chosen.add(idx);
  }

  const soft = cardioReadinessSoftening(permission);
  for (const idx of chosen) {
    const modality: CardioModality = soft.force_zone2 ? "zone2" : prescription.modality;
    const minutes = Math.max(10, prescription.minutes_per_session + soft.minutes_delta);
    placements[idx] = {
      modality,
      minutes,
      intensity_note: prescription.intensity_note,
      optional: soft.optional,
    };
  }
  return placements;
}
