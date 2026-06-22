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

// ============================================================================
// Phase 3B — Weekly Nutrition Insight (compact, deterministic, no LLM)
// ============================================================================

export type WeeklyDay = {
  entry_date: string;
  weekday_label: string;
  in_future: boolean;
  has_logged_meals: boolean;
  pending_meal_count: number;
  failed_meal_count: number;

  consumed_calories: number;
  consumed_protein_g: number;
  consumed_carbs_g: number;
  consumed_fat_g: number;

  protein_calories: number;
  carb_calories: number;
  fat_calories: number;
  macro_total_calories: number;

  target_calories: number | null;
  target_protein_g: number | null;
  target_carbs_g: number | null;
  target_fat_g: number | null;
};

export type WeeklyNutritionInsight = {
  week_start_date: string;
  week_end_date: string;
  anchor_date: string;
  days_elapsed: number;
  logged_days: number;

  avg_calories: number;
  avg_protein_g: number;
  avg_carbs_g: number;
  avg_fat_g: number;

  avg_target_calories: number | null;
  avg_target_protein_g: number | null;
  avg_target_carbs_g: number | null;
  avg_target_fat_g: number | null;

  calorie_on_target_days: number;
  protein_hit_days: number;
  carb_on_target_days: number;
  fat_on_target_days: number;

  avg_meal_quality_score: number | null;
  avg_macro_adherence_score: number | null;
  weekly_nutrition_score: number | null;

  confidence_label: "low" | "ok";
  main_weekly_driver: string;
  weekly_diagnosis: string;
  coach_note: string;
  decision_insight: string;
  early_signal: string;

  pending_meal_count: number;
  failed_meal_count: number;

  days: WeeklyDay[];
};

/** Parse YYYY-MM-DD as a UTC date (no TZ drift). */
function parseISO(d: string): Date {
  const [y, m, day] = d.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, day));
}
function toISO(d: Date): string {
  return d.toISOString().slice(0, 10);
}
function addDays(d: Date, n: number): Date {
  const r = new Date(d);
  r.setUTCDate(r.getUTCDate() + n);
  return r;
}
/** Monday of the week containing anchor (UTC). */
function mondayOf(anchor: Date): Date {
  const dow = anchor.getUTCDay(); // 0=Sun..6=Sat
  const delta = dow === 0 ? -6 : 1 - dow;
  return addDays(anchor, delta);
}

const weeklyInput = z
  .object({ anchorDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional() })
  .optional();

export const getWeeklyNutritionInsight = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => weeklyInput.parse(d))
  .handler(async ({ data, context }): Promise<WeeklyNutritionInsight> => {
    const anchorISO = data?.anchorDate ?? today();
    const todayISO = today();
    const anchor = parseISO(anchorISO);
    const weekStart = mondayOf(anchor);
    const weekEnd = addDays(weekStart, 6);
    const weekStartISO = toISO(weekStart);
    const weekEndISO = toISO(weekEnd);

    // Cap evaluation at min(today, weekEnd) — never include future days, but
    // do include the full week when the user is viewing a past week.
    // NOTE: anchorISO is intentionally NOT in this min — for a past-week
    // anchor (Mon 15 Jun), including it would collapse the cap to a single
    // day and starve the weekly query.
    const cap = todayISO < weekEndISO ? todayISO : weekEndISO;
    const capDate = parseISO(cap);
    const days_elapsed = Math.max(
      1,
      Math.round((capDate.getTime() - weekStart.getTime()) / 86400000) + 1,
    );

    // Build list of evaluated dates.
    const dates: string[] = [];
    for (let i = 0; i < days_elapsed; i++) dates.push(toISO(addDays(weekStart, i)));

    // Fetch all meals in the evaluated window in one query.
    const { data: rawMeals } = await context.supabase
      .from("shield_nutrition_logs")
      .select(
        "entry_date, estimated_calories, estimated_protein_g, estimated_carbs_g, estimated_fat_g, calorie_estimate_status, claude_quality_score, claude_score_status, deleted",
      )
      .eq("user_id", context.userId)
      .gte("entry_date", weekStartISO)
      .lte("entry_date", cap)
      .eq("deleted", false);

    // Fetch all target rows that could overlap the window.
    const { data: rawTargets } = await context.supabase
      .from("daily_macro_targets")
      .select("target_calories, target_protein_g, target_carbs_g, target_fat_g, effective_start_date, effective_end_date")
      .eq("user_id", context.userId)
      .lte("effective_start_date", cap)
      .or(`effective_end_date.is.null,effective_end_date.gt.${weekStartISO}`)
      .order("effective_start_date", { ascending: false });

    const meals = (rawMeals ?? []) as Array<any>;
    const targets = (rawTargets ?? []) as Array<any>;

    function targetFor(dateISO: string) {
      return targets.find(
        (t) =>
          t.effective_start_date <= dateISO &&
          (t.effective_end_date == null || t.effective_end_date > dateISO),
      );
    }

    let logged_days = 0;
    let calorie_on_target_days = 0;
    let protein_hit_days = 0;
    let carb_on_target_days = 0;
    let fat_on_target_days = 0;
    let cal_over_days = 0;
    let fat_over_days = 0;
    let carb_over_days = 0;

    let sumCal = 0, sumP = 0, sumC = 0, sumF = 0;
    let sumTCal = 0, sumTP = 0, sumTC = 0, sumTF = 0;
    let tgtDays = 0;

    let sumQ = 0, qDays = 0;
    let sumAdh = 0, adhDays = 0;
    let sumDayScore = 0, dayScoreDays = 0;

    let pending_meal_count = 0;
    let failed_meal_count = 0;

    for (const dateISO of dates) {
      const dayMeals = meals.filter((m) => m.entry_date === dateISO);
      if (dayMeals.length === 0) continue;
      const counted = dayMeals.filter((m) =>
        ["estimated", "manual_edited"].includes(m.calorie_estimate_status),
      );
      pending_meal_count += dayMeals.filter((m) => m.calorie_estimate_status === "pending").length;
      failed_meal_count += dayMeals.filter((m) => m.calorie_estimate_status === "failed").length;

      logged_days++;

      const cal = counted.reduce((s, m) => s + Number(m.estimated_calories ?? 0), 0);
      const p = counted.reduce((s, m) => s + Number(m.estimated_protein_g ?? 0), 0);
      const c = counted.reduce((s, m) => s + Number(m.estimated_carbs_g ?? 0), 0);
      const f = counted.reduce((s, m) => s + Number(m.estimated_fat_g ?? 0), 0);

      sumCal += cal; sumP += p; sumC += c; sumF += f;

      const t = targetFor(dateISO);
      const tCal = t?.target_calories != null ? Number(t.target_calories) : 0;
      const tP = t?.target_protein_g != null ? Number(t.target_protein_g) : 0;
      const tC = t?.target_carbs_g != null ? Number(t.target_carbs_g) : 0;
      const tF = t?.target_fat_g != null ? Number(t.target_fat_g) : 0;

      if (tCal > 0) {
        sumTCal += tCal; sumTP += tP; sumTC += tC; sumTF += tF; tgtDays++;
        const rCal = cal / tCal;
        const rP = tP > 0 ? p / tP : 0;
        const rC = tC > 0 ? c / tC : 0;
        const rF = tF > 0 ? f / tF : 0;
        if (rCal >= 0.9 && rCal <= 1.05) calorie_on_target_days++;
        if (rCal > 1.05) cal_over_days++;
        if (rP >= 0.95) protein_hit_days++;
        if (rC >= 0.8 && rC <= 1.2) carb_on_target_days++;
        if (rC > 1.2) carb_over_days++;
        if (rF >= 0.8 && rF <= 1.15) fat_on_target_days++;
        if (rF > 1.15) fat_over_days++;

        if (counted.length > 0) {
          const sP = scoreProtein(p, tP);
          const sCal = scoreCalories(cal, tCal);
          const sC = scoreCarbs(c, tC);
          const sF = scoreFat(f, tF);
          const adh = sP * 0.4 + sCal * 0.35 + sC * 0.15 + sF * 0.1;
          sumAdh += adh; adhDays++;
        }
      }

      const scored = dayMeals.filter(
        (m) => m.claude_score_status === "scored" && m.claude_quality_score != null,
      );
      let q: number | null = null;
      if (scored.length) {
        q = scored.reduce((s, m) => s + Number(m.claude_quality_score), 0) / scored.length;
        sumQ += q; qDays++;
      }

    }


    // Recompute per-day day_score average more cleanly:
    sumDayScore = 0; dayScoreDays = 0;
    for (const dateISO of dates) {
      const dayMeals = meals.filter((m) => m.entry_date === dateISO);
      if (dayMeals.length === 0) continue;
      const counted = dayMeals.filter((m) =>
        ["estimated", "manual_edited"].includes(m.calorie_estimate_status),
      );
      const t = targetFor(dateISO);
      const tCal = t?.target_calories != null ? Number(t.target_calories) : 0;
      let adh: number | null = null;
      if (tCal > 0 && counted.length > 0) {
        const p = counted.reduce((s, m) => s + Number(m.estimated_protein_g ?? 0), 0);
        const c = counted.reduce((s, m) => s + Number(m.estimated_carbs_g ?? 0), 0);
        const f = counted.reduce((s, m) => s + Number(m.estimated_fat_g ?? 0), 0);
        const cal = counted.reduce((s, m) => s + Number(m.estimated_calories ?? 0), 0);
        const tP = Number(t.target_protein_g ?? 0);
        const tC = Number(t.target_carbs_g ?? 0);
        const tF = Number(t.target_fat_g ?? 0);
        adh = scoreProtein(p, tP) * 0.4 + scoreCalories(cal, tCal) * 0.35 +
              scoreCarbs(c, tC) * 0.15 + scoreFat(f, tF) * 0.1;
      }
      const scored = dayMeals.filter(
        (m) => m.claude_score_status === "scored" && m.claude_quality_score != null,
      );
      const q = scored.length
        ? scored.reduce((s, m) => s + Number(m.claude_quality_score), 0) / scored.length
        : null;
      let ds: number | null = null;
      if (adh != null && q != null) ds = (adh + q) / 2;
      else if (adh != null) ds = adh;
      else if (q != null) ds = q;
      if (ds != null) { sumDayScore += ds; dayScoreDays++; }
    }

    const avg = (s: number, n: number) => (n > 0 ? Math.round(s / n) : 0);
    const avgN = (s: number, n: number) => (n > 0 ? Math.round(s / n) : null);

    const avg_calories = avg(sumCal, logged_days);
    const avg_protein_g = avg(sumP, logged_days);
    const avg_carbs_g = avg(sumC, logged_days);
    const avg_fat_g = avg(sumF, logged_days);
    const avg_target_calories = avgN(sumTCal, tgtDays);
    const avg_target_protein_g = avgN(sumTP, tgtDays);
    const avg_target_carbs_g = avgN(sumTC, tgtDays);
    const avg_target_fat_g = avgN(sumTF, tgtDays);
    const avg_meal_quality_score = avgN(sumQ, qDays);
    const avg_macro_adherence_score = avgN(sumAdh, adhDays);
    const weekly_nutrition_score = avgN(sumDayScore, dayScoreDays);

    // Main weekly driver — priority order.
    let main_weekly_driver: string;
    if (logged_days < 3) {
      main_weekly_driver = "Not enough logged days yet.";
    } else if (cal_over_days >= 3) {
      main_weekly_driver = "Calories are repeatedly over target.";
    } else if (protein_hit_days < logged_days / 2) {
      main_weekly_driver = "Protein consistency is the main gap.";
    } else if (fat_over_days >= 3) {
      main_weekly_driver = "Fat intake is repeatedly high.";
    } else if (carb_over_days >= 3) {
      main_weekly_driver = "Carbs are repeatedly high.";
    } else {
      main_weekly_driver = "Weekly pattern is broadly aligned.";
    }

    // Weekly diagnosis (one short sentence).
    let weekly_diagnosis: string;
    if (logged_days === 0) {
      weekly_diagnosis = "No meals logged this week yet.";
    } else if (logged_days < 3) {
      weekly_diagnosis = `You logged ${logged_days} of ${days_elapsed} elapsed day${days_elapsed === 1 ? "" : "s"}. Keep logging before reading the pattern.`;
    } else if (cal_over_days >= 3) {
      weekly_diagnosis = `Calories are above target on ${cal_over_days} day${cal_over_days === 1 ? "" : "s"} this week.`;
    } else if (protein_hit_days < logged_days / 2) {
      weekly_diagnosis = `Protein was hit on only ${protein_hit_days} of ${logged_days} logged day${logged_days === 1 ? "" : "s"}.`;
    } else if (fat_over_days >= 3) {
      weekly_diagnosis = "Fat is the main pressure point this week.";
    } else if (carb_over_days >= 3) {
      weekly_diagnosis = "Carbs are running high across the week.";
    } else {
      weekly_diagnosis = "Good consistency so far this week.";
    }

    // Coach note (one actionable line).
    let coach_note: string;
    if (logged_days < 3) {
      coach_note = "Log at least 3 days before reading the weekly pattern.";
    } else if (pending_meal_count > 0 || failed_meal_count > 0) {
      coach_note = "Some meals are incomplete, so the weekly view may update.";
    } else if (protein_hit_days < logged_days / 2) {
      coach_note = "Fix protein consistency before changing calories.";
    } else if (
      calorie_on_target_days < logged_days / 2 &&
      avg_target_calories != null &&
      avg_calories > avg_target_calories
    ) {
      coach_note = "Portion control is the main lever this week.";
    } else if (
      fat_on_target_days < logged_days / 2 &&
      avg_target_fat_g != null &&
      avg_fat_g > avg_target_fat_g
    ) {
      coach_note = "Keep meals leaner before changing targets.";
    } else if (weekly_nutrition_score != null && weekly_nutrition_score >= 80) {
      coach_note = "Good adherence. Stay consistent.";
    } else {
      coach_note = "Tighten the main driver before adjusting macros.";
    }
    const confidence_label: "low" | "ok" = logged_days < 3 ? "low" : "ok";

    // Decision insight — one short Apple-style sentence.
    let decision_insight: string;
    if (logged_days < 3) {
      decision_insight = "Early signal only. Log at least 3 days before changing targets.";
    } else if (
      calorie_on_target_days < logged_days / 2 &&
      avg_target_calories != null &&
      avg_calories > avg_target_calories
    ) {
      decision_insight = "Portion control is the main lever this week.";
    } else if (fat_over_days >= 3) {
      decision_insight = "Fat intake is the main pressure point this week.";
    } else if (protein_hit_days < logged_days / 2) {
      decision_insight = "Protein consistency is the priority this week.";
    } else if (weekly_nutrition_score != null && weekly_nutrition_score >= 80) {
      decision_insight = "Good weekly adherence. Stay consistent.";
    } else {
      decision_insight = "Tighten the main driver before adjusting macros.";
    }

    // Early signal for the compact preview.
    let early_signal: string;
    if (logged_days === 0) {
      early_signal = "Start with today's first meal to unlock your weekly view.";
    } else if (logged_days < 3) {
      const remaining = Math.max(1, 3 - logged_days);
      early_signal = `Log ${remaining} more day${remaining === 1 ? "" : "s"} to unlock a reliable weekly pattern.`;
    } else if (fat_over_days >= 3) {
      early_signal = "Early signal: fat intake is running high.";
    } else if (cal_over_days >= 3) {
      early_signal = "Early signal: calories are trending over target.";
    } else if (protein_hit_days < logged_days / 2) {
      early_signal = "Early signal: protein is missing on most days.";
    } else if (weekly_nutrition_score != null && weekly_nutrition_score >= 80) {
      early_signal = "On track for a strong week.";
    } else {
      early_signal = "Pattern is holding — keep logging.";
    }

    // Build full Mon–Sun series for the graph (includes future days as empty).
    const WEEKDAY = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
    const days: WeeklyDay[] = [];
    for (let i = 0; i < 7; i++) {
      const d = addDays(weekStart, i);
      const dateISO = toISO(d);
      const inFuture = dateISO > todayISO;
      const dayMeals = meals.filter((m) => m.entry_date === dateISO);
      const counted = dayMeals.filter((m) =>
        ["estimated", "manual_edited"].includes(m.calorie_estimate_status),
      );
      const cal = Math.round(counted.reduce((s, m) => s + Number(m.estimated_calories ?? 0), 0));
      const p = Math.round(counted.reduce((s, m) => s + Number(m.estimated_protein_g ?? 0), 0));
      const c = Math.round(counted.reduce((s, m) => s + Number(m.estimated_carbs_g ?? 0), 0));
      const f = Math.round(counted.reduce((s, m) => s + Number(m.estimated_fat_g ?? 0), 0));
      const t = targetFor(dateISO);
      const pCal = p * 4;
      const cCal = c * 4;
      const fCal = f * 9;
      days.push({
        entry_date: dateISO,
        weekday_label: WEEKDAY[i],
        in_future: inFuture,
        has_logged_meals: counted.length > 0,
        pending_meal_count: dayMeals.filter((m) => m.calorie_estimate_status === "pending").length,
        failed_meal_count: dayMeals.filter((m) => m.calorie_estimate_status === "failed").length,
        consumed_calories: cal,
        consumed_protein_g: p,
        consumed_carbs_g: c,
        consumed_fat_g: f,
        protein_calories: pCal,
        carb_calories: cCal,
        fat_calories: fCal,
        macro_total_calories: pCal + cCal + fCal,
        target_calories: t?.target_calories != null ? Number(t.target_calories) : null,
        target_protein_g: t?.target_protein_g != null ? Number(t.target_protein_g) : null,
        target_carbs_g: t?.target_carbs_g != null ? Number(t.target_carbs_g) : null,
        target_fat_g: t?.target_fat_g != null ? Number(t.target_fat_g) : null,
      });
    }

    return {
      week_start_date: weekStartISO,
      week_end_date: weekEndISO,
      anchor_date: anchorISO,
      days_elapsed,
      logged_days,

      avg_calories,
      avg_protein_g,
      avg_carbs_g,
      avg_fat_g,

      avg_target_calories,
      avg_target_protein_g,
      avg_target_carbs_g,
      avg_target_fat_g,

      calorie_on_target_days,
      protein_hit_days,
      carb_on_target_days,
      fat_on_target_days,

      avg_meal_quality_score,
      avg_macro_adherence_score,
      weekly_nutrition_score,

      confidence_label,
      main_weekly_driver,
      weekly_diagnosis,
      coach_note,
      decision_insight,
      early_signal,

      pending_meal_count,
      failed_meal_count,

      days,
    };
  });

// ============================================================================
// Macro adjustment review — conservative, review-only (no auto-apply)
// ============================================================================

export type MacroReviewDecision =
  | "Hold"
  | "Ready to adjust"
  | "Insufficient data"
  | "Abnormal week"
  | "Applied";

export type MacroAdjustmentReview = {
  review_week_start: string;
  review_week_end: string;
  decision: MacroReviewDecision;
  confidence: "low" | "medium" | "high";
  reason: string;
  logged_days: number;
  required_logged_days: number;
  weigh_in_count: number;
  required_weigh_ins: number;
  avg_calories: number;
  avg_target_calories: number | null;
  avg_protein_g: number;
  avg_target_protein_g: number | null;
  adherence_score: number | null;
  weight_trend_kg: number | null;
  observed_tdee: number | null;
  current_target_calories: number | null;
  recommended_target_calories: number | null;
  calorie_delta: number;
  recommended_protein_g: number | null;
  recommended_carbs_g: number | null;
  recommended_fat_g: number | null;
  can_apply: boolean;
  blockers: string[];
  coach_note: string;
  /** Streak helpers for the locked-state UI. last7Days oldest→today, true if a meal was logged. */
  last7_logged_days: boolean[];
  goal: string | null;
};

function localTodayISO(): string {
  // YYYY-MM-DD in the user's local timezone.
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function priorMondayRange(): { start: string; end: string } {
  // Previous completed Mon–Sun in local time.
  const today = new Date();
  const dow = today.getDay(); // 0=Sun..6=Sat
  // Days back to *this* week's Monday:
  const toMon = dow === 0 ? 6 : dow - 1;
  const thisMon = new Date(today);
  thisMon.setDate(today.getDate() - toMon);
  const prevMon = new Date(thisMon);
  prevMon.setDate(thisMon.getDate() - 7);
  const prevSun = new Date(prevMon);
  prevSun.setDate(prevMon.getDate() + 6);
  const fmt = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  return { start: fmt(prevMon), end: fmt(prevSun) };
}

export const getMacroAdjustmentReview = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<MacroAdjustmentReview> => {
    const { start: weekStart, end: weekEnd } = priorMondayRange();
    const REQ_DAYS = 3;
    const REQ_WEIGH = 3;

    // Build last-7-day streak (ending today).
    const today = localTodayISO();
    const last7Dates: string[] = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      last7Dates.push(
        `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`,
      );
    }
    const streakStart = last7Dates[0];

    const [mealsRes, weighRes, targetRes, profileRes] = await Promise.all([
      context.supabase
        .from("shield_nutrition_logs")
        .select(
          "entry_date, estimated_calories, estimated_protein_g, estimated_carbs_g, estimated_fat_g, calorie_estimate_status, deleted",
        )
        .eq("user_id", context.userId)
        .gte("entry_date", streakStart)
        .lte("entry_date", weekEnd)
        .eq("deleted", false),
      context.supabase
        .from("body_measurement_events")
        .select("entry_date, weight_kg")
        .eq("user_id", context.userId)
        .gte("entry_date", weekStart)
        .lte("entry_date", weekEnd)
        .not("weight_kg", "is", null)
        .order("entry_date", { ascending: true }),
      context.supabase
        .from("daily_macro_targets")
        .select(
          "target_calories, target_protein_g, target_carbs_g, target_fat_g, bmr, effective_start_date, effective_end_date",
        )
        .eq("user_id", context.userId)
        .lte("effective_start_date", weekEnd)
        .or(`effective_end_date.is.null,effective_end_date.gt.${weekStart}`)
        .order("effective_start_date", { ascending: false })
        .limit(1)
        .maybeSingle(),
      context.supabase
        .from("profiles")
        .select("goal, measurement_weight_kg, dexa_lean_mass_kg, dexa_body_fat_pct")
        .eq("user_id", context.userId)
        .maybeSingle(),
    ]);

    const allMeals = (mealsRes.data ?? []) as Array<any>;
    const weekMeals = allMeals.filter((m) => m.entry_date >= weekStart && m.entry_date <= weekEnd);
    const target = targetRes.data ?? null;
    const profile = (profileRes.data ?? {}) as any;

    // Last-7 streak (logged = at least one estimated/manual_edited meal that day).
    const loggedDateSet = new Set<string>();
    for (const m of allMeals) {
      if (["estimated", "manual_edited"].includes(m.calorie_estimate_status)) {
        loggedDateSet.add(m.entry_date);
      }
    }
    const last7_logged_days = last7Dates.map((d) => loggedDateSet.has(d));

    // Logged days in the review week.
    const loggedInWeek = new Set<string>();
    let hasPendingOrFailed = false;
    for (const m of weekMeals) {
      if (["estimated", "manual_edited"].includes(m.calorie_estimate_status)) {
        loggedInWeek.add(m.entry_date);
      }
      if (m.calorie_estimate_status === "pending" || m.calorie_estimate_status === "failed") {
        hasPendingOrFailed = true;
      }
    }
    const logged_days = loggedInWeek.size;

    const weighRows = (weighRes.data ?? []) as Array<{ entry_date: string; weight_kg: number }>;
    const weigh_in_count = weighRows.length;

    // Weekly intake averages.
    const counted = weekMeals.filter((m) =>
      ["estimated", "manual_edited"].includes(m.calorie_estimate_status),
    );
    const sumCal = counted.reduce((s, m) => s + Number(m.estimated_calories ?? 0), 0);
    const sumP = counted.reduce((s, m) => s + Number(m.estimated_protein_g ?? 0), 0);
    const sumC = counted.reduce((s, m) => s + Number(m.estimated_carbs_g ?? 0), 0);
    const sumF = counted.reduce((s, m) => s + Number(m.estimated_fat_g ?? 0), 0);
    const avg_calories = logged_days > 0 ? Math.round(sumCal / logged_days) : 0;
    const avg_protein_g = logged_days > 0 ? Math.round(sumP / logged_days) : 0;
    const avg_carbs_g = logged_days > 0 ? Math.round(sumC / logged_days) : 0;
    const avg_fat_g = logged_days > 0 ? Math.round(sumF / logged_days) : 0;

    const tCal = target?.target_calories != null ? Number(target.target_calories) : null;
    const tP = target?.target_protein_g != null ? Number(target.target_protein_g) : null;
    const tC = target?.target_carbs_g != null ? Number(target.target_carbs_g) : null;
    const tF = target?.target_fat_g != null ? Number(target.target_fat_g) : null;
    const bmr = target?.bmr != null ? Number(target.bmr) : null;

    // Weight trend (kg over the week) — linear slope * 7 days.
    let weight_trend_kg: number | null = null;
    if (weighRows.length >= 2) {
      const xs = weighRows.map((r) => {
        const [y, m, d] = r.entry_date.split("-").map(Number);
        return new Date(y, m - 1, d).getTime() / 86400000; // day index
      });
      const ys = weighRows.map((r) => Number(r.weight_kg));
      const n = xs.length;
      const meanX = xs.reduce((a, b) => a + b, 0) / n;
      const meanY = ys.reduce((a, b) => a + b, 0) / n;
      let num = 0, den = 0;
      for (let i = 0; i < n; i++) {
        num += (xs[i] - meanX) * (ys[i] - meanY);
        den += (xs[i] - meanX) ** 2;
      }
      const slopePerDay = den > 0 ? num / den : 0;
      weight_trend_kg = Math.round(slopePerDay * 7 * 100) / 100;
    }

    // Observed TDEE (very rough): avg intake + (-trend kg/week * 7700 kcal/kg / 7 days)
    let observed_tdee: number | null = null;
    if (logged_days >= 3 && weight_trend_kg != null) {
      observed_tdee = Math.round(avg_calories - (weight_trend_kg * 7700) / 7);
    }

    // Adherence ratio: |intake - target| / target.
    let adherence_score: number | null = null;
    if (tCal && tCal > 0 && logged_days > 0) {
      const gap = Math.abs(avg_calories - tCal) / tCal; // 0 best
      adherence_score = Math.max(0, Math.min(100, Math.round(100 - gap * 200)));
    }

    // Estimate weight for safety floors.
    let weightKg: number | null = null;
    if (weighRows.length > 0) weightKg = Number(weighRows[weighRows.length - 1].weight_kg);
    if (!weightKg && profile.measurement_weight_kg) weightKg = Number(profile.measurement_weight_kg);
    if (!weightKg && profile.dexa_lean_mass_kg && profile.dexa_body_fat_pct != null) {
      const lean = Number(profile.dexa_lean_mass_kg);
      const bf = Number(profile.dexa_body_fat_pct);
      if (lean > 0 && bf >= 0 && bf < 95) weightKg = Math.round((lean / (1 - bf / 100)) * 10) / 10;
    }

    // Gates.
    const blockers: string[] = [];
    if (logged_days < REQ_DAYS) blockers.push(`Log at least ${REQ_DAYS} nutrition days before changing targets.`);
    if (weigh_in_count < REQ_WEIGH) blockers.push(`Add at least ${REQ_WEIGH} weigh-ins before changing targets.`);
    if (hasPendingOrFailed) blockers.push("Some meals are incomplete, so targets are held.");
    if (!tCal) blockers.push("No active macro target for the review week.");

    const goal = (profile.goal as string | null) ?? null;

    if (blockers.length > 0) {
      return {
        review_week_start: weekStart,
        review_week_end: weekEnd,
        decision: "Insufficient data",
        confidence: "low",
        reason: blockers[0],
        logged_days,
        required_logged_days: REQ_DAYS,
        weigh_in_count,
        required_weigh_ins: REQ_WEIGH,
        avg_calories,
        avg_target_calories: tCal,
        avg_protein_g,
        avg_target_protein_g: tP,
        adherence_score,
        weight_trend_kg,
        observed_tdee,
        current_target_calories: tCal,
        recommended_target_calories: tCal,
        calorie_delta: 0,
        recommended_protein_g: tP,
        recommended_carbs_g: tC,
        recommended_fat_g: tF,
        can_apply: false,
        blockers,
        coach_note: blockers[0],
        last7_logged_days,
        goal,
      };
    }

    // Decision rules (gates passed).
    let delta = 0;
    let reason = "Holding targets.";
    let decision: MacroReviewDecision = "Hold";
    const adherenceHigh = (adherence_score ?? 0) >= 75;
    const trend = weight_trend_kg ?? 0;
    const proteinRatio = tP && tP > 0 ? avg_protein_g / tP : 1;
    const proteinConsistent = proteinRatio >= 0.9;

    if (goal === "fat_loss") {
      if (!proteinConsistent) { decision = "Hold"; reason = "Protein consistency is low. Fix adherence before changing calories."; }
      else if (trend > -0.1 && trend <= 0.2 && adherenceHigh) { delta = -150; decision = "Ready to adjust"; reason = "Fat-loss target, adherence high, weight trend flat."; }
      else if (trend < -0.7) { delta = +100; decision = "Ready to adjust"; reason = "Weight dropping too fast — small increase to protect lean mass."; }
      else { decision = "Hold"; reason = "Trend within expected range — hold targets."; }
    } else if (goal === "muscle_gain") {
      if (!proteinConsistent) { decision = "Hold"; reason = "Protein consistency is low. Fix adherence before changing calories."; }
      else if (trend < 0.1 && adherenceHigh) { delta = +150; decision = "Ready to adjust"; reason = "Muscle-gain target, adherence high, weight trend flat."; }
      else if (trend > 0.5) { delta = -100; decision = "Ready to adjust"; reason = "Weight rising too fast — small reduction to limit fat gain."; }
      else { decision = "Hold"; reason = "Trend within expected range — hold targets."; }
    } else {
      // maintenance / recomposition / strength / athletic — default hold.
      if (!proteinConsistent) { decision = "Hold"; reason = "Protein consistency is low. Hold and coach protein."; }
      else if (Math.abs(trend) <= 0.3) { decision = "Hold"; reason = "Trend is flat — maintenance holding."; }
      else { decision = "Hold"; reason = "Trend unclear — hold until pattern is consistent."; }
    }

    // Safety clamps.
    let recommended = (tCal ?? 0) + delta;
    if (bmr && recommended < bmr) {
      recommended = Math.round(bmr);
      reason = "Adjustment capped to keep calories above BMR floor.";
      delta = recommended - (tCal ?? 0);
    }
    // Fat floor: max(0.4 g/kg, 25% kcal).
    let recommended_fat_g = tF;
    if (recommended > 0 && weightKg) {
      const fatFromKcal = (recommended * 0.25) / 9;
      const fatFromWeight = weightKg * 0.4;
      recommended_fat_g = Math.max(Math.round(fatFromKcal), Math.round(fatFromWeight));
    }
    const recommended_protein_g = tP; // hold protein; coach drives protein separately.
    // Carbs back-fill remaining calories.
    let recommended_carbs_g: number | null = tC;
    if (recommended > 0 && recommended_protein_g != null && recommended_fat_g != null) {
      const remaining = recommended - recommended_protein_g * 4 - recommended_fat_g * 9;
      recommended_carbs_g = Math.max(0, Math.round(remaining / 4));
    }

    const confidence: "low" | "medium" | "high" =
      logged_days >= 5 && weigh_in_count >= 4 ? "high" : logged_days >= 4 ? "medium" : "low";

    return {
      review_week_start: weekStart,
      review_week_end: weekEnd,
      decision,
      confidence,
      reason,
      logged_days,
      required_logged_days: REQ_DAYS,
      weigh_in_count,
      required_weigh_ins: REQ_WEIGH,
      avg_calories,
      avg_target_calories: tCal,
      avg_protein_g,
      avg_target_protein_g: tP,
      adherence_score,
      weight_trend_kg,
      observed_tdee,
      current_target_calories: tCal,
      recommended_target_calories: recommended,
      calorie_delta: delta,
      recommended_protein_g,
      recommended_carbs_g,
      recommended_fat_g,
      // Apply deferred in this patch — review only.
      can_apply: false,
      blockers: [],
      coach_note: reason,
      last7_logged_days,
      goal,
    };
  });

