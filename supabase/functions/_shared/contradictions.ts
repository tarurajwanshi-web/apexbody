// MIRROR of src/lib/contradictions.ts — keep in sync.
// Pure rules. No deps. No I/O.

export type ContradictionType =
  | "muscle_gain_deficit"
  | "overreaching"
  | "fat_loss_collapse"
  | "volume_readiness";

export type Severity = "high" | "medium";

export type Contradiction = {
  type: ContradictionType;
  severity: Severity;
  message: string;
  actionTitle: string;
  actionBody: string;
};

export type ContradictionCtx = {
  goal: string | null;
  adjustmentKcal: number | null;
  adherencePct: number | null;
  avgStrain7d: number | null;
  avgRir7d: number | null;
  sets7d: number;
  readinessToday: number | null;
};

export type ContradictionResult = {
  detected: boolean;
  contradictions: Contradiction[];
};

export function detectContradictions(ctx: ContradictionCtx): ContradictionResult {
  const out: Contradiction[] = [];

  if (
    ctx.goal === "muscle_gain" &&
    typeof ctx.adjustmentKcal === "number" &&
    ctx.adjustmentKcal < -200
  ) {
    const deficit = Math.abs(Math.round(ctx.adjustmentKcal));
    out.push({
      type: "muscle_gain_deficit",
      severity: "high",
      message: `You want to gain muscle but are in a ${deficit} kcal deficit. Your body can't build lean mass without fuel.`,
      actionTitle: "Eat at maintenance",
      actionBody: "Increase calories to match your TDEE this week. Resume any deficit next week if needed.",
    });
  }

  if (
    typeof ctx.avgStrain7d === "number" && ctx.avgStrain7d > 10 &&
    typeof ctx.readinessToday === "number" && ctx.readinessToday < 45 &&
    typeof ctx.avgRir7d === "number" && ctx.avgRir7d < 1.5
  ) {
    out.push({
      type: "overreaching",
      severity: "high",
      message: "You've trained hard for 7 days with low readiness and low RIR. You're in overreaching territory — injury and illness risk climbs from here.",
      actionTitle: "Deload this week",
      actionBody: "Reduce volume 30 percent, keep weight at 80 percent or above, and prioritise sleep.",
    });
  }

  if (
    ctx.goal === "fat_loss" &&
    typeof ctx.adherencePct === "number" && ctx.adherencePct < 50 &&
    typeof ctx.adjustmentKcal === "number" && ctx.adjustmentKcal < -200
  ) {
    const adh = Math.round(ctx.adherencePct);
    out.push({
      type: "fat_loss_collapse",
      severity: "high",
      message: `You're logging only ${adh} percent of meals and the plan just cut you deeper. You can't adapt to a moving target.`,
      actionTitle: "Pause adjustments",
      actionBody: "Stop chasing cuts. Log 5 plus meals a day for two weeks, then revisit the deficit.",
    });
  }

  if (ctx.sets7d > 20 && typeof ctx.readinessToday === "number") {
    if (ctx.readinessToday < 40) {
      out.push({
        type: "volume_readiness",
        severity: "high",
        message: `${ctx.sets7d} sets this week with readiness at ${Math.round(ctx.readinessToday)}. Hard training on a depleted system is how injuries happen.`,
        actionTitle: "Cut today's volume",
        actionBody: "Drop to 50 percent volume today and focus on movement quality.",
      });
    } else if (ctx.readinessToday <= 50) {
      out.push({
        type: "volume_readiness",
        severity: "medium",
        message: `${ctx.sets7d} sets this week with readiness at ${Math.round(ctx.readinessToday)}. Volume is outrunning recovery.`,
        actionTitle: "Trim volume",
        actionBody: "Cut today's volume 30 percent and watch sleep and stress.",
      });
    }
  }

  out.sort((a, b) => (a.severity === b.severity ? 0 : a.severity === "high" ? -1 : 1));

  return { detected: out.length > 0, contradictions: out };
}
