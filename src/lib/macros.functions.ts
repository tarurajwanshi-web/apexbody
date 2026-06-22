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

  main_weekly_driver: string;
  weekly_diagnosis: string;
  coach_note: string;

  pending_meal_count: number;
  failed_meal_count: number;
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

    // Cap evaluation at min(anchor, today, weekEnd).
    const cap = [anchorISO, todayISO, weekEndISO].sort()[0];
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

      // Day score: average of quality + adherence when both exist, else either.
      const dayAdh = adhDays > 0 ? sumAdh / adhDays : null; // not per-day; recompute below
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

      main_weekly_driver,
      weekly_diagnosis,
      coach_note,

      pending_meal_count,
      failed_meal_count,
    };
  });

