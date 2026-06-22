import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

const dateInput = z
  .object({ entryDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional() })
  .optional();

export type MacroSummary = {
  entry_date: string;
  has_target: boolean;

  consumed_calories: number;
  consumed_protein_g: number;
  consumed_carbs_g: number;
  consumed_fat_g: number;
  meals_estimated: number;

  target_calories: number | null;
  target_protein_g: number | null;
  target_carbs_g: number | null;
  target_fat_g: number | null;

  remaining_calories: number | null;
  remaining_protein_g: number | null;
  remaining_carbs_g: number | null;
  remaining_fat_g: number | null;

  goal: string | null;

  meal_quality_score: number | null;
  macro_adherence_score: number | null;
  nutrition_day_score: number | null;

  verdict: string;
  main_driver: string;
  coaching_line: string;

  meal_count: number;
  pending_meal_count: number;
  failed_meal_count: number;
};

/** Macro adherence sub-scores. Deterministic, no LLM.
 *  Weights: protein 40%, calories 35%, carbs 15%, fat 10%. */
function scoreProtein(consumed: number, target: number): number {
  if (target <= 0) return 0;
  const r = consumed / target;
  if (r >= 1 && r <= 1.3) return 100;
  if (r < 1) return Math.min(100, Math.max(0, r * 100));
  // r > 1.3 — mild penalty only
  const over = r - 1.3;
  return Math.max(60, 100 - over * 50);
}
function scoreCalories(consumed: number, target: number): number {
  if (target <= 0) return 0;
  const r = consumed / target;
  if (r >= 0.9 && r <= 1.05) return 100;
  if (r < 0.9) {
    const gap = 0.9 - r; // 0..0.9
    return Math.max(0, 100 - gap * 150);
  }
  // r > 1.05 — stronger penalty
  const over = r - 1.05;
  return Math.max(0, 100 - over * 200);
}
function scoreCarbs(consumed: number, target: number): number {
  if (target <= 0) return 0;
  const r = consumed / target;
  if (r >= 0.8 && r <= 1.2) return 100;
  if (r < 0.8) return Math.max(0, 100 - (0.8 - r) * 150);
  return Math.max(0, 100 - (r - 1.2) * 150);
}
function scoreFat(consumed: number, target: number): number {
  if (target <= 0) return 0;
  const r = consumed / target;
  if (r >= 0.8 && r <= 1.15) return 100;
  if (r < 0.8) return Math.max(0, 100 - (0.8 - r) * 120);
  // fat over penalized more strongly
  return Math.max(0, 100 - (r - 1.15) * 220);
}

export const getTodayMacroSummary = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => dateInput.parse(d))
  .handler(async ({ data, context }): Promise<MacroSummary> => {
    const entryDate = data?.entryDate ?? today();

    // Pull all non-deleted meals for the day; we need quality scores and
    // pending/failed counts in addition to consumed macros.
    const { data: allMeals } = await context.supabase
      .from("shield_nutrition_logs")
      .select(
        "estimated_calories, estimated_protein_g, estimated_carbs_g, estimated_fat_g, calorie_estimate_status, claude_quality_score, claude_score_status, deleted, entry_date",
      )
      .eq("user_id", context.userId)
      .eq("entry_date", entryDate)
      .eq("deleted", false);

    const meals = (allMeals ?? []) as Array<any>;
    const counted = meals.filter((m) =>
      ["estimated", "manual_edited"].includes(m.calorie_estimate_status),
    );
    const pendingMeals = meals.filter((m) => m.calorie_estimate_status === "pending");
    const failedMeals = meals.filter((m) => m.calorie_estimate_status === "failed");

    const sum = (arr: any[], key: string) =>
      arr.reduce((s: number, m: any) => s + Number(m[key] ?? 0), 0);

    const consumed_calories = Math.round(sum(counted, "estimated_calories"));
    const consumed_protein_g = Math.round(sum(counted, "estimated_protein_g"));
    const consumed_carbs_g = Math.round(sum(counted, "estimated_carbs_g"));
    const consumed_fat_g = Math.round(sum(counted, "estimated_fat_g"));

    // Active effective-dated target for the selected date.
    const { data: target } = await context.supabase
      .from("daily_macro_targets")
      .select("target_calories, target_protein_g, target_carbs_g, target_fat_g, effective_start_date, effective_end_date")
      .eq("user_id", context.userId)
      .lte("effective_start_date", entryDate)
      .or(`effective_end_date.is.null,effective_end_date.gt.${entryDate}`)
      .order("effective_start_date", { ascending: false })
      .limit(1)
      .maybeSingle();

    const { data: profile } = await context.supabase
      .from("profiles")
      .select("goal")
      .eq("user_id", context.userId)
      .maybeSingle();

    const target_calories = target?.target_calories != null ? Number(target.target_calories) : null;
    const target_protein_g = target?.target_protein_g != null ? Number(target.target_protein_g) : null;
    const target_carbs_g = target?.target_carbs_g != null ? Number(target.target_carbs_g) : null;
    const target_fat_g = target?.target_fat_g != null ? Number(target.target_fat_g) : null;
    const has_target = target_calories != null && target_calories > 0;

    const remaining = (t: number | null, c: number): number | null =>
      t == null ? null : Math.round(t - c);

    // Quality score: average over scored meals.
    const scored = meals.filter(
      (m) => m.claude_score_status === "scored" && m.claude_quality_score != null,
    );
    const meal_quality_score = scored.length
      ? Math.round(scored.reduce((s, m) => s + Number(m.claude_quality_score), 0) / scored.length)
      : null;

    // Macro adherence — only when target exists AND we have counted meals.
    let macro_adherence_score: number | null = null;
    if (has_target && counted.length > 0) {
      const p = scoreProtein(consumed_protein_g, target_protein_g ?? 0);
      const c = scoreCalories(consumed_calories, target_calories ?? 0);
      const cb = scoreCarbs(consumed_carbs_g, target_carbs_g ?? 0);
      const f = scoreFat(consumed_fat_g, target_fat_g ?? 0);
      macro_adherence_score = Math.round(p * 0.4 + c * 0.35 + cb * 0.15 + f * 0.1);
    }

    const nutrition_day_score =
      meal_quality_score != null && macro_adherence_score != null
        ? Math.round((meal_quality_score + macro_adherence_score) / 2)
        : meal_quality_score ?? macro_adherence_score;

    // Verdict.
    const isToday = entryDate === today();
    let verdict: string;
    if (counted.length === 0 && pendingMeals.length === 0 && failedMeals.length === 0) {
      verdict = "No meals logged";
    } else if (pendingMeals.length > 0 || failedMeals.length > 0) {
      verdict = "Incomplete";
    } else if (!has_target) {
      verdict = "Macro target not set";
    } else if (nutrition_day_score == null) {
      verdict = "Incomplete";
    } else if (nutrition_day_score >= 80) {
      verdict = "On track";
    } else if (nutrition_day_score >= 60) {
      verdict = "Slightly off";
    } else {
      verdict = "Off target";
    }

    // Main driver — prioritized macro diagnosis. Avoids duplicating the
    // calorie gap line shown directly under the kcal headline; surfaces a
    // macro lever first when possible.
    let main_driver = "";
    const tP = target_protein_g ?? 0;
    const tC = target_carbs_g ?? 0;
    const tF = target_fat_g ?? 0;
    const tCal2 = target_calories ?? 0;
    const ratioP = tP > 0 ? consumed_protein_g / tP : 1;
    const ratioC = tC > 0 ? consumed_carbs_g / tC : 1;
    const ratioF = tF > 0 ? consumed_fat_g / tF : 1;
    const ratioCal = tCal2 > 0 ? consumed_calories / tCal2 : 1;

    if (counted.length === 0 && pendingMeals.length === 0 && failedMeals.length === 0) {
      main_driver = "No meals logged for this day.";
    } else if (pendingMeals.length > 0 || failedMeals.length > 0) {
      main_driver = "Some meals are still estimating.";
    } else if (!has_target) {
      main_driver = "No macro target set.";
    } else if (ratioF > 1.3) {
      main_driver = `Fat was ${Math.max(0, consumed_fat_g - tF)}g over target.`;
    } else if (ratioP < 0.9) {
      main_driver = `Protein was ${Math.max(0, tP - consumed_protein_g)}g below target.`;
    } else if (ratioC > 1.3) {
      main_driver = `Carbs were ${Math.max(0, consumed_carbs_g - tC)}g over target.`;
    } else if (ratioCal > 1.05) {
      main_driver = `Calories were ${Math.max(0, consumed_calories - tCal2).toLocaleString()} kcal over target.`;
    } else if (ratioCal < 0.9) {
      main_driver = `Calories were ${Math.max(0, tCal2 - consumed_calories).toLocaleString()} kcal under target.`;
    } else {
      main_driver = "Macros were broadly aligned.";
    }

    // Coaching line.
    let coaching_line = "";
    const proteinLow = has_target && ratioP < 0.9;
    const calOver = has_target && ratioCal > 1.05;
    const fatHigh = has_target && ratioF > 1.3;
    const carbHigh = has_target && ratioC > 1.3;
    const onTrack = has_target && !proteinLow && !calOver && !fatHigh && !carbHigh;

    if (isToday) {
      if (counted.length === 0) coaching_line = "Start with 40–50g protein to anchor the day.";
      else if (proteinLow) coaching_line = "Next meal: 40–50g lean protein before adding more carbs or fats.";
      else if (fatHigh) coaching_line = "Next meal: keep it low-fat and protein-led.";
      else if (carbHigh) coaching_line = "Next meal: keep it protein-forward and lower-carb.";
      else if (calOver) coaching_line = "Next meal: keep it light and protein-led. Don't compensate aggressively.";
      else coaching_line = "Stay consistent. Keep the next meal aligned with remaining macros.";
    } else {
      if (counted.length === 0) coaching_line = "No meals logged for this day.";
      else if (onTrack) coaching_line = "Good adherence for this day.";
      else if (fatHigh) coaching_line = "Lesson: high-fat meals pushed the day over target.";
      else if (carbHigh) coaching_line = "Lesson: carb-heavy meals drove the overage.";
      else if (proteinLow) coaching_line = "Lesson: protein needed to be front-loaded earlier.";
      else if (calOver) coaching_line = "Lesson: portion size pushed the day over target.";
      else coaching_line = "Good adherence for this day.";
    }

    return {
      entry_date: entryDate,
      has_target,

      consumed_calories,
      consumed_protein_g,
      consumed_carbs_g,
      consumed_fat_g,
      meals_estimated: counted.length,

      target_calories,
      target_protein_g,
      target_carbs_g,
      target_fat_g,

      remaining_calories: remaining(target_calories, consumed_calories),
      remaining_protein_g: remaining(target_protein_g, consumed_protein_g),
      remaining_carbs_g: remaining(target_carbs_g, consumed_carbs_g),
      remaining_fat_g: remaining(target_fat_g, consumed_fat_g),

      goal: (profile?.goal as string | null) ?? null,

      meal_quality_score,
      macro_adherence_score,
      nutrition_day_score,

      verdict,
      main_driver,
      coaching_line,

      meal_count: counted.length,
      pending_meal_count: pendingMeals.length,
      failed_meal_count: failedMeals.length,
    };
  });

/** Alias: Phase 3A consumers prefer this name. Same shape, same handler. */
export const getDayNutritionSummary = getTodayMacroSummary;
