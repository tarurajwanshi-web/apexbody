import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { resolveUserTimezone, getLocalDateISO } from "@/lib/dates";

export type BodyCompState =
  | "clean_bulk"
  | "excess_fat_gain"
  | "perfect_recomposition"
  | "good_cut"
  | "muscle_loss"
  | "body_recomposition_plateau";

export type BodyCompResult = {
  state: BodyCompState;
  weight_change: number;
  strength_change: number;
  message: string;
  action: string;
  confidence: "high" | "medium" | "low";
};

function addDays(iso: string, days: number): string {
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export const getBodyCompState = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<BodyCompResult> => {
    const { supabase, userId } = context;
    const tz = await resolveUserTimezone(supabase, userId);
    const today = getLocalDateISO(tz);
    const startDate = addDays(today, -6);

    // Weight
    const { data: weights } = await supabase
      .from("body_measurement_events")
      .select("weight_kg, entry_date")
      .eq("user_id", userId)
      .gte("entry_date", startDate)
      .lte("entry_date", today)
      .not("weight_kg", "is", null)
      .order("entry_date", { ascending: true });

    const weightRows = (weights ?? []).filter(
      (r) => typeof r.weight_kg === "number" || (r.weight_kg as any) != null,
    );
    const earliestWeight =
      weightRows.length > 0 ? Number(weightRows[0].weight_kg) : null;
    const latestWeight =
      weightRows.length > 0
        ? Number(weightRows[weightRows.length - 1].weight_kg)
        : null;
    const weightChange =
      latestWeight != null && earliestWeight != null
        ? latestWeight - earliestWeight
        : 0;
    const weightPct =
      earliestWeight && earliestWeight > 0
        ? Math.abs((weightChange / earliestWeight) * 100)
        : 0;

    // Strength: top 3 exercises by set count in window
    const { data: sets } = await supabase
      .from("workout_set_logs")
      .select("exercise_name, weight_kg, reps_completed, entry_date")
      .eq("user_id", userId)
      .eq("completed", true)
      .gte("entry_date", startDate)
      .lte("entry_date", today)
      .order("entry_date", { ascending: true });

    const setRows = (sets ?? []).filter(
      (r: any) => r.exercise_name && r.weight_kg != null && r.reps_completed != null,
    ) as Array<{ exercise_name: string; weight_kg: number; reps_completed: number; entry_date: string }>;

    const byExercise = new Map<
      string,
      Array<{ vol: number; date: string }>
    >();
    for (const r of setRows) {
      const key = String(r.exercise_name);
      const vol = Number(r.weight_kg) * Number(r.reps_completed);
      if (!byExercise.has(key)) byExercise.set(key, []);
      byExercise.get(key)!.push({ vol, date: r.entry_date as string });
    }
    const top3 = [...byExercise.entries()]
      .sort((a, b) => b[1].length - a[1].length)
      .slice(0, 3);

    let sumLatest = 0;
    let sumEarliest = 0;
    for (const [, arr] of top3) {
      // arr is already date-asc from the query
      sumEarliest += arr[0].vol;
      sumLatest += arr[arr.length - 1].vol;
    }
    const strengthChange =
      sumEarliest > 0 ? ((sumLatest - sumEarliest) / sumEarliest) * 100 : 0;
    const strengthAbs = Math.abs(strengthChange);

    // Confidence
    const distinctSetDays = new Set(setRows.map((r) => r.entry_date as string)).size;
    let confidence: "high" | "medium" | "low" = "low";
    if (weightRows.length >= 2 && setRows.length >= 2 && distinctSetDays >= 2) {
      confidence = "high";
    } else if (weightRows.length >= 1 && setRows.length >= 1) {
      confidence = "medium";
    }

    const round1 = (n: number) => Math.round(n * 10) / 10;

    // Insufficient data
    if (latestWeight == null || setRows.length === 0) {
      return {
        state: "body_recomposition_plateau",
        weight_change: round1(weightChange),
        strength_change: round1(strengthChange),
        message:
          "Not enough data yet. Log weight and at least one workout this week.",
        action: "Add a weight entry and a logged set to unlock this signal.",
        confidence: "low",
      };
    }

    const wUp = weightChange > 0 && weightPct > 2;
    const wDown = weightChange < 0 && weightPct > 2;
    const wFlat = weightPct <= 2;
    const sUp = strengthChange > 0 && strengthAbs > 2;
    const sDown = strengthChange < 0 && strengthAbs > 2;
    const sFlat = strengthAbs <= 2;

    let state: BodyCompState = "body_recomposition_plateau";
    let message =
      "Body composition stable. This is normal every 3-4 weeks.";
    let action =
      "Monitor for next 7 days. If still flat, adjust macros.";

    if (wUp && sUp) {
      state = "clean_bulk";
      message =
        "Lean gains: gaining muscle and some fat (healthy). Keep going.";
      action = "Maintain current macros. Monitor if fat gain accelerates.";
    } else if (wUp && sFlat) {
      state = "excess_fat_gain";
      message =
        "Weight up but strength flat. Too much fat gain. Reduce calories 100-150.";
      action = "Cut 100-150 kcal this week.";
    } else if (wDown && sUp) {
      state = "perfect_recomposition";
      message =
        "Recomposition working: losing fat, gaining strength.";
      action = "This is the dream state. Maintain current approach.";
    } else if (wDown && sFlat) {
      state = "good_cut";
      message = "Good cut: losing weight, maintaining strength.";
      action = "Continue. You're preserving muscle.";
    } else if (wDown && sDown) {
      state = "muscle_loss";
      message =
        "Muscle loss: weight down, strength down. Deficit too aggressive.";
      action =
        "Increase calories 200-300 kcal. Prioritize protein and carbs on heavy days.";
    }

    return {
      state,
      weight_change: round1(weightChange),
      strength_change: round1(strengthChange),
      message,
      action,
      confidence,
    };
  });
