// generate-plan — Claude-powered weekly workout plan.
// Input:
//   - { user_id }  — single-user (onboarding, manual regen). JWT or internal secret.
//   - {}           — fan-out mode. Internal secret only (weekly cron). Regenerates
//                    the UPCOMING UTC-Monday week for every active user; current
//                    week's plan and completed sets are never touched.
// Writes rows into public.weekly_plans keyed by (user_id, week_start_date).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { authorizeCaller, requireInternalSecret, corsAllowHeaders } from "../_shared/authorize.ts";
import {
  resolveTrainingEnvelope,
  validateGeneratedPlan,
  buildFallbackPlan,
  resolvePlanStartISO,
  pickPatternsByGoal,
  clampPlanToCeilings,
  MUSCLE_GROUPS,
  MOVEMENT_PATTERNS,
  EXERCISE_ROLES,
  PLAN_DATA_VERSION,
  type Envelope,
  type Goal,
  type Experience,
  type Equipment,
  type Permission,
  type Confidence,
  type SessionKind,
  type CardioPlacementLite,
} from "../_shared/training-rules.ts";
import { resolveCardioPrescription, placeCardioAcrossWeek } from "../_shared/cardio-rules.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": corsAllowHeaders,
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function stripFences(t: string) {
  let s = t.trim();
  if (s.startsWith("```")) s = s.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "");
  return s.trim();
}

function addDays(iso: string, days: number) {
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

// STRICTLY next UTC-Monday. Do not reuse `upcomingMonday` (returns today when
// today is Monday) or `resolvePlanStartISO` (rolling, not Monday-anchored) —
// on the fan-out path those can overwrite the in-progress week's plan.
function nextMondayStrictUTC(d = new Date()): string {
  const day = d.getUTCDay(); // 0 Sun .. 6 Sat
  const delta = day === 1 ? 7 : ((8 - day) % 7) || 7;
  const m = new Date(d);
  m.setUTCDate(d.getUTCDate() + delta);
  return m.toISOString().slice(0, 10);
}

function utcMondayOf(iso: string): string {
  const d = new Date(iso + "T00:00:00Z");
  const dow = d.getUTCDay();
  const delta = dow === 0 ? -6 : 1 - dow;
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
}

async function callClaude(apiKey: string, prompt: string) {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-6",
      max_tokens: 3000,
      system:
        "You are an expert evidence-based strength & conditioning coach. " +
        "Respond with ONLY a single JSON object, no prose, no markdown fences. " +
        "Schema: { \"plan_data_version\": 2, \"plan_start_date\": string (YYYY-MM-DD), \"plan_timezone\": string, \"days\": [ { \"day\": 1-7, \"date\": string (YYYY-MM-DD), \"day_name\": string, \"session_name\": string|null, \"session_purpose\": string|null, \"rest\": boolean, \"exercises\": [ { \"name\": string, \"sets\": int, \"reps\": string, \"rest_seconds\": int, \"cue\": string, \"muscle_group\": string, \"movement_pattern\": string, \"exercise_role\": string, \"progression_note\": string, \"target_rir\": int } ], \"cardio\": {\"modality\": string, \"minutes\": int, \"intensity_note\": string, \"optional\": boolean} | null } ], \"volume_gate_alert\": string|null }. " +
        "No other fields allowed. Do NOT emit session_note, notes, description, tempo, or any field outside this schema. " +
        "Do NOT emit training_volume_summary, exercise_media_summary, or any summary / aggregate / count field — those are computed downstream. " +
        `muscle_group MUST be one of: ${MUSCLE_GROUPS.join(", ")}. ` +
        `movement_pattern MUST be one of: ${MOVEMENT_PATTERNS.join(", ")}. ` +
        `exercise_role MUST be one of: ${EXERCISE_ROLES.join(", ")}. ` +
        "All text fields (cue, progression_note, session_purpose) must be plain prose — no markdown, no asterisks, no bold syntax, no bullet lists, no backticks, no headings. " +
        "progression_note is short (max ~10 words) — e.g. \"+2.5% from last week\", \"hold weight, RIR 2-3\", \"recovery — light technique only\", or \"new exercise — start moderate\". " +
        "session_purpose is ONE plain-prose sentence (max ~20 words) describing what this session is training and why. On rest days session_purpose must be null. " +
        "Always return exactly 7 days matching the provided calendar. Rest days have rest=true, session_name=null, session_purpose=null, exercises=[]. " +
        "The 'cue' field is ONE sharp coaching correction — the single thing you'd shout mid-set to fix that exercise's most common failure point. " +
        "Not a checklist. Not a description of correct form. One real spoken sentence, max ~18 words, second person, lead with the action.",
      messages: [{ role: "user", content: prompt }],
    }),
  });
  if (!res.ok) {
    const errBody = await res.text();
    console.error(`[callClaude] Anthropic error status=${res.status} body=${errBody}`);
    throw new Error(`Anthropic ${res.status}: ${errBody}`);
  }
  const j = await res.json();
  const text = j?.content?.[0]?.text ?? "";
  return JSON.parse(stripFences(text));
}

// planStartOverrideISO: when provided (cron fan-out path), skip the
// rolling-start resolver and pin planStartISO to the strictly-next UTC Monday.
// This is the ONLY safe way to guarantee `week_start_date` (Monday of planStartISO
// per line-508 logic) is the upcoming week and cannot collide with an in-progress
// current-week weekly_plans row via the (user_id, week_start_date) upsert.
async function generateForUser(
  supa: any,
  anth: string,
  user_id: string,
  planStartOverrideISO?: string,
) {
  const { data: p, error } = await supa
    .from("profiles")
    .select("goal, training_days_per_week, equipment_access, experience_level, timezone, training_day_codes")
    .eq("user_id", user_id)
    .maybeSingle();
  if (error || !p) throw new Error("profile not found");

  const goal: Goal = (p.goal ?? "recomposition") as Goal;
  const days = p.training_days_per_week ?? 3;
  const equip: Equipment = (p.equipment_access ?? "commercial_gym") as Equipment;
  const experience: Experience = (p.experience_level ?? "intermediate") as Experience;
  const timezone: string = (p as any).timezone ?? "UTC";

  const sevenDaysAgo = new Date();
  sevenDaysAgo.setUTCDate(sevenDaysAgo.getUTCDate() - 7);
  const sevenDaysAgoISO = sevenDaysAgo.toISOString().slice(0, 10);
  const { data: readinessRows } = await supa
    .from("readiness_scores")
    .select("score_date, final_score, confidence_level, training_permission, nutrition_modifier, load_carryover, fuelling_status, top_drivers, reason_codes, signal_quality")
    .eq("user_id", user_id)
    .gte("score_date", sevenDaysAgoISO)
    .order("score_date", { ascending: false });
  const avgReadiness = readinessRows && readinessRows.length > 0
    ? readinessRows.reduce((s: number, r: any) => s + Number(r.final_score ?? 0), 0) / readinessRows.length
    : null;

  const rowsSorted: any[] = readinessRows ?? [];
  const latestReadiness: any = rowsSorted[0] ?? null;
  const latestTrainingPermission: string | null = latestReadiness?.training_permission ?? null;
  const latestConfidenceLevel: string | null = latestReadiness?.confidence_level ?? null;
  const latestNutritionModifier: string | null = latestReadiness?.nutrition_modifier ?? null;
  const latestFuellingStatus: Record<string, any> | null =
    latestReadiness?.fuelling_status && typeof latestReadiness.fuelling_status === "object"
      ? latestReadiness.fuelling_status
      : null;
  const latestSystemicLoad: number = Number(latestReadiness?.load_carryover?.systemic_load ?? 0) || 0;

  const redDays7 = rowsSorted.filter((r: any) => r?.training_permission === "red_recover").length;
  const orangeDays7 = rowsSorted.filter((r: any) => r?.training_permission === "orange_reduce").length;
  const yellowDays7 = rowsSorted.filter((r: any) => r?.training_permission === "yellow_modify").length;
  const lowConfidenceDays7 = rowsSorted.filter((r: any) => r?.confidence_level === "LOW").length;

  const rcFreq: Record<string, number> = {};
  for (const r of rowsSorted) {
    const codes = Array.isArray(r?.reason_codes) ? r.reason_codes : [];
    for (const c of codes) rcFreq[c] = (rcFreq[c] ?? 0) + 1;
  }
  const dominantReasonCodes = Object.entries(rcFreq).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([code]) => code);

  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setUTCDate(thirtyDaysAgo.getUTCDate() - 30);
  const thirtyDaysAgoISO = thirtyDaysAgo.toISOString().slice(0, 10);
  const { data: workoutHistory } = await supa
    .from("workout_set_logs")
    .select("exercise_name, weight_kg, reps_completed, rir, entry_date")
    .eq("user_id", user_id)
    .eq("completed", true)
    .gte("entry_date", thirtyDaysAgoISO)
    .order("entry_date", { ascending: false });

  const exerciseHistory: Record<string, {
    lastWeight: number; lastReps: number; lastRIR: number;
    maxVolumeSet: string; avgRIR: number;
  }> = {};
  const rirAcc: Record<string, { sum: number; n: number }> = {};
  for (const log of workoutHistory ?? []) {
    const name = (log as any).exercise_name as string;
    const w = Number((log as any).weight_kg ?? 0);
    const r = Number((log as any).reps_completed ?? 0);
    const rir = Number((log as any).rir ?? 2);
    if (!exerciseHistory[name]) {
      exerciseHistory[name] = { lastWeight: w, lastReps: r, lastRIR: rir, maxVolumeSet: `${w}×${r}`, avgRIR: rir };
      rirAcc[name] = { sum: rir, n: 1 };
    } else {
      const cur = exerciseHistory[name];
      const [cw, cr] = cur.maxVolumeSet.split("×").map(parseFloat);
      if (w * r > (cw || 0) * (cr || 0)) cur.maxVolumeSet = `${w}×${r}`;
      rirAcc[name].sum += rir; rirAcc[name].n += 1;
      cur.avgRIR = Math.round((rirAcc[name].sum / rirAcc[name].n) * 10) / 10;
    }
  }

  const { data: macroTarget } = await supa
    .from("daily_macro_targets")
    .select("target_calories")
    .eq("user_id", user_id)
    .is("effective_end_date", null)
    .maybeSingle();
  const targetCalories = macroTarget ? Number(macroTarget.target_calories) : null;

  const { data: nutritionRows } = await supa
    .from("shield_nutrition_logs")
    .select("entry_date, estimated_calories")
    .eq("user_id", user_id)
    .eq("deleted", false)
    .in("calorie_estimate_status", ["estimated", "manual_edited"])
    .gte("entry_date", sevenDaysAgoISO);
  const intakeByDate: Record<string, number> = {};
  for (const r of nutritionRows ?? []) {
    const d = (r as any).entry_date as string;
    intakeByDate[d] = (intakeByDate[d] ?? 0) + Number((r as any).estimated_calories ?? 0);
  }
  const dailyTotals = Object.values(intakeByDate);
  const avgIntake = dailyTotals.length > 0 ? dailyTotals.reduce((a, b) => a + b, 0) / dailyTotals.length : null;

  const underFuelled = targetCalories != null && avgIntake != null && avgIntake < targetCalories * 0.80;
  const trendLow = avgReadiness != null && avgReadiness < 45;

  const weeklyReduce =
    redDays7 >= 2 || orangeDays7 >= 2 || (orangeDays7 >= 1 && redDays7 >= 1) || trendLow;

  const fuellingModifierSet = new Set([
    "hydration_priority", "protein_priority", "fuel_more",
    "deficit_caution", "recovery_day_refeed",
  ]);
  const shieldFuellingCaution =
    (latestNutritionModifier && fuellingModifierSet.has(latestNutritionModifier)) ||
    (latestFuellingStatus && (
      latestFuellingStatus.under_fuelled === true ||
      latestFuellingStatus.deficit === true ||
      typeof latestFuellingStatus.status === "string" && /deficit|under/i.test(latestFuellingStatus.status)
    ));

  const envelope: Envelope = resolveTrainingEnvelope({
    goal, experience, equipment: equip, trainingDaysPerWeek: days,
    permission: latestTrainingPermission as Permission,
    confidence: latestConfidenceLevel as Confidence,
    nutritionModifier: latestNutritionModifier,
    fuellingCaution: Boolean(underFuelled || shieldFuellingCaution),
    systemicLoad: latestSystemicLoad,
    weeklyReduce, redDays7, orangeDays7,
  });

  // Plan start date: cron override (strictly next Monday) or rolling per user tz.
  let planStartISO: string;
  if (planStartOverrideISO) {
    planStartISO = planStartOverrideISO;
  } else {
    const { data: todayWorkout } = await supa
      .from("workout_set_logs")
      .select("id")
      .eq("user_id", user_id)
      .eq("completed", true)
      .gte("entry_date", new Date().toISOString().slice(0, 10))
      .limit(1);
    const hasCompletedWorkoutToday = Array.isArray(todayWorkout) && todayWorkout.length > 0;
    planStartISO = resolvePlanStartISO(new Date(), timezone, hasCompletedWorkoutToday).planStartISO;
  }

  // B6 A1 — mesocycle block state (widened) + weekly volume landmarks for
  // week_start_date (= Monday of planStartISO). Missing rows → warn + defaults;
  // never crash.
  const { data: mesoRow } = await supa
    .from("mesocycle_state")
    .select("block_number, week_in_block, block_length_weeks, phase, is_active")
    .eq("user_id", user_id)
    .maybeSingle();
  if (!mesoRow) console.warn(`[generate-plan] no mesocycle_state for ${user_id}; defaulting`);
  const blockNumber = Number(mesoRow?.block_number ?? 1);
  const weekInBlock = Number(mesoRow?.week_in_block ?? 1);
  const blockLength = Number(mesoRow?.block_length_weeks ?? 4);
  const phase: "accumulation" | "deload" =
    (mesoRow as any)?.phase === "deload" ? "deload" : "accumulation";

  const weekStartForLandmarks = utcMondayOf(planStartISO);
  const { data: landmarkRows } = await supa
    .from("weekly_volume_landmarks")
    .select("muscle_group, target_sets, fuel_adjusted_mrv")
    .eq("user_id", user_id)
    .eq("week_start_date", weekStartForLandmarks);
  const landmarksByMuscle: Record<string, { target_sets: number; fuel_adjusted_mrv: number }> = {};
  for (const r of (landmarkRows as any[]) ?? []) {
    if (typeof r.muscle_group === "string") {
      landmarksByMuscle[r.muscle_group] = {
        target_sets: Number(r.target_sets),
        fuel_adjusted_mrv: Number(r.fuel_adjusted_mrv),
      };
    }
  }
  const hasLandmarks = Object.keys(landmarksByMuscle).length > 0;
  if (!hasLandmarks) {
    console.warn(`[generate-plan] no weekly_volume_landmarks for ${user_id} @ ${weekStartForLandmarks}; skipping volume clamp`);
  }

  const phaseLabel = phase === "deload"
    ? "Deload — recover and consolidate"
    : `Building — week ${weekInBlock} of ${blockLength}`;

  const historyNote = Object.keys(exerciseHistory).length > 0
    ? `\nRecent exercise history (last 30 days, best sets and avg RIR):\n${JSON.stringify(exerciseHistory, null, 2)}\n` +
      `Progression rule: if lastRIR 0-1 → +2.5–5% weight; RIR 2-3 → hold weight or +1 rep; RIR 4+ → deload or reduce volume. ` +
      `For unfamiliar exercises, progression_note should be "new exercise — start moderate".`
    : `\nNo recent workout history. For every exercise set progression_note to "new exercise — start moderate".`;

  const shieldContext =
    `\nShield 7-day context:\n` +
    `- avg readiness: ${avgReadiness != null ? Math.round(avgReadiness) : "n/a"}\n` +
    `- latest permission: ${latestTrainingPermission ?? "n/a"} (confidence ${latestConfidenceLevel ?? "n/a"})\n` +
    `- red/orange/yellow days: ${redDays7}/${orangeDays7}/${yellowDays7}\n` +
    `- low-confidence days: ${lowConfidenceDays7}\n` +
    `- latest systemic load carryover: ${latestSystemicLoad}\n` +
    `- latest nutrition modifier: ${latestNutritionModifier ?? "n/a"}\n` +
    `- dominant reason codes: ${dominantReasonCodes.join(", ") || "none"}`;

  const envelopeBlock =
    `\nDETERMINISTIC TRAINING ENVELOPE (hard constraints — violating any of these = invalid output):\n- ` +
    envelope.guardrails.join("\n- ");

  // Precedence: target_sets is the aim; fuel_adjusted_mrv is the clamp-enforced
  // ceiling. Weekly readiness envelope may pull volume DOWN but never above
  // ceiling. Same-day red-day cut is a separate concern (B7).
  const blockContextBlock =
    `\nBLOCK CONTEXT: block ${blockNumber}, week ${weekInBlock} of ${blockLength}, phase ${phase}. ` +
    (phase === "deload"
      ? `DELOAD week — volume low, movements crisp, target_rir skews high (3-4), no failure programming.`
      : `Building week — ramp position ${weekInBlock <= 1 ? "early" : weekInBlock >= blockLength - 1 ? "peak" : "mid"}.`);

  const volumeTargetsBlock = hasLandmarks
    ? `\nWEEKLY VOLUME TARGETS (hard, distribute across training days):\n` +
      Object.entries(landmarksByMuscle)
        .map(([m, v]) => `- ${m}: ${v.target_sets} sets across the week (ceiling ${v.fuel_adjusted_mrv})`)
        .join("\n") +
      `\nPer-muscle weekly sum must be within ±1 of target_sets. NEVER exceed fuel_adjusted_mrv. ` +
      `Muscles not listed above: minimal or no direct programming.`
    : "";

  const DOW_TO_CODE = ["sun","mon","tue","wed","thu","fri","sat"] as const;
  const rawCodes = Array.isArray((p as any).training_day_codes)
    ? ((p as any).training_day_codes as unknown[])
        .map((x) => (typeof x === "string" ? x.trim().toLowerCase() : ""))
        .filter((x) => (DOW_TO_CODE as readonly string[]).includes(x))
    : [];
  const codeSet = new Set(rawCodes);
  let restMask: boolean[] | undefined;
  if (codeSet.size > 0 && codeSet.size !== days) {
    console.warn(`[generate-plan] training_day_codes size ${codeSet.size} != training_days_per_week ${days}; trusting codes`);
  }

  const calendar = Array.from({ length: 7 }, (_, i) => {
    const dt = new Date(planStartISO + "T00:00:00Z");
    dt.setUTCDate(dt.getUTCDate() + i);
    const iso = dt.toISOString().slice(0, 10);
    const dow = dt.getUTCDay();
    const dn = ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"][dow];
    const code = DOW_TO_CODE[dow];
    const rest_flag = codeSet.size > 0 ? !codeSet.has(code) : undefined;
    return rest_flag === undefined
      ? { day: i + 1, date: iso, day_name: dn }
      : { day: i + 1, date: iso, day_name: dn, rest_flag };
  });
  if (codeSet.size > 0) restMask = calendar.map((c: any) => c.rest_flag === true);
  const trainingDaysCount = restMask ? restMask.filter((r) => !r).length : days;

  const restMaskBlock = restMask
    ? `\nREST_MASK (hard): the rest flag per day is fixed by the user's chosen training days. Do not move rest days. calendar[i].rest_flag is authoritative — each day.rest MUST equal calendar[i].rest_flag.`
    : "";

  const cardioRx = resolveCardioPrescription({ goal, experience, phase, weeklyReduce });
  const patternsForPlacement: SessionKind[] = pickPatternsByGoal(goal, trainingDaysCount);
  const sessionKinds: (string | null)[] = new Array(7).fill(null);
  if (restMask) {
    let pIdx = 0;
    for (let i = 0; i < 7; i++) {
      if (restMask[i] === false) {
        sessionKinds[i] = patternsForPlacement[pIdx % patternsForPlacement.length] ?? null;
        pIdx++;
      }
    }
  }
  const cardioPlacements: (CardioPlacementLite | null)[] = placeCardioAcrossWeek(
    cardioRx, restMask, goal, latestTrainingPermission as Permission, sessionKinds,
  );
  const cardioPlacementsBlock =
    `\nCARDIO_PLACEMENTS (hard): each day's cardio field is authoritative from the engine. ` +
    `Echo the value at index i exactly into day[i].cardio — do NOT invent, add, remove, or move cardio. ` +
    `A null value MUST be echoed as null. Placements by day index: ` +
    JSON.stringify(cardioPlacements);

  const promptSchemaNote =
    `Return ONLY a JSON object of shape: { "plan_data_version": ${PLAN_DATA_VERSION}, "plan_start_date": "${planStartISO}", "plan_timezone": "${timezone}", "days": [7 items], "volume_gate_alert": string|null }. ` +
    `Each day: { "day": 1-7, "date": string (YYYY-MM-DD, use the calendar below), "day_name": string, "rest": boolean, "session_name": string|null, "session_purpose": string|null, "exercises": [], "cardio": {"modality": "zone2"|"liss"|"intervals"|"mixed", "minutes": int, "intensity_note": string, "optional": boolean} | null }. ` +
    `Each exercise: { "name": string, "sets": int, "reps": string, "rest_seconds": int, "cue": string, "muscle_group": one of [${MUSCLE_GROUPS.join("|")}], "movement_pattern": one of [${MOVEMENT_PATTERNS.join("|")}], "exercise_role": one of [${EXERCISE_ROLES.join("|")}], "progression_note": string, "target_rir": int }. ` +
    `No other top-level or exercise fields. Do NOT emit session_note, notes, description, tempo, training_volume_summary, exercise_media_summary, or anything not in this schema. ` +
    `All text (cue, progression_note, session_purpose, cardio.intensity_note) is plain prose — no markdown/asterisks/bullets/backticks.`;

  const basePrompt =
    `Build a rolling 7-day workout plan starting ${planStartISO} (user timezone ${timezone}).\n` +
    `Use exactly this calendar (day/date/day_name${restMask ? "/rest_flag" : ""}):\n${JSON.stringify(calendar)}\n` +
    `${envelopeBlock}${restMaskBlock}${cardioPlacementsBlock}${blockContextBlock}${volumeTargetsBlock}\n` +
    `${shieldContext}\n` +
    `${(underFuelled || shieldFuellingCaution) ? `\nFUELLING CAUTION${underFuelled && targetCalories ? ` (avg intake ${Math.round(avgIntake!)} kcal vs ${Math.round(targetCalories!)} kcal target)` : ""}${latestNutritionModifier ? ` — Shield nutrition_modifier=${latestNutritionModifier}` : ""}. Do not programme to failure.` : ""}` +
    historyNote + "\n" +
    `Exactly ${trainingDaysCount} training days with APEX-named sessions (e.g. "APEX Push A", "APEX Lower A", "APEX Full Body A"), each with ${envelope.exercisesPerSession[0]}-${envelope.exercisesPerSession[1]} exercises. Each training day carries a session_purpose (one plain-prose sentence describing what the session trains and why). Remaining ${7 - trainingDaysCount} days are rest (rest=true, session_name=null, session_purpose=null, exercises=[]).\n` +
    `Include muscle_group, movement_pattern, and exercise_role per exercise (all from the closed enum lists in the schema). target_rir must be an integer inside [${envelope.targetRir[0]}, ${envelope.targetRir[1]}].\n` +
    promptSchemaNote;

  const tryClaude = (promptText: string) => callClaude(anth, promptText);

  // Per-muscle sum helper for volume-target soft-retry decisions
  const sumSetsPerMuscle = (planObj: any): Record<string, number> => {
    const s: Record<string, number> = {};
    for (const d of (planObj?.days ?? []) as any[]) {
      if (!d || d.rest === true) continue;
      for (const ex of d.exercises ?? []) {
        const mg = typeof ex?.muscle_group === "string" ? ex.muscle_group : null;
        const n = Number(ex?.sets);
        if (mg && Number.isFinite(n) && n > 0) s[mg] = (s[mg] ?? 0) + n;
      }
    }
    return s;
  };

  const findVolumeOffenders = (planObj: any): string[] => {
    if (!hasLandmarks) return [];
    const sums = sumSetsPerMuscle(planObj);
    const bad: string[] = [];
    for (const [mg, v] of Object.entries(landmarksByMuscle)) {
      const cur = sums[mg] ?? 0;
      if (Math.abs(cur - v.target_sets) > 2) {
        bad.push(`${mg}: got ${cur} sets, target ${v.target_sets} (ceiling ${v.fuel_adjusted_mrv})`);
      }
    }
    return bad;
  };

  let plan: any = null;
  let violations: string[] = [];
  let usedFallback = false;
  const claudeErrors: string[] = [];

  try { plan = await tryClaude(basePrompt); } catch (e) { const msg = e instanceof Error ? e.message : String(e); console.error(`[generate-plan] tryClaude base failed: ${msg}`); claudeErrors.push(`base: ${msg}`); plan = null; }
  if (plan) {
    const v1 = validateGeneratedPlan(plan, envelope, planStartISO, restMask, cardioPlacements);
    if (!v1.ok) {
      violations = v1.violations;
      const reprompt = basePrompt +
        `\n\nPREVIOUS OUTPUT WAS INVALID. Fix all of these violations and return corrected JSON only:\n- ` +
        violations.join("\n- ");
      try { plan = await tryClaude(reprompt); } catch { plan = null; }
    }
  }
  if (plan) {
    const v2 = validateGeneratedPlan(plan, envelope, planStartISO, restMask, cardioPlacements);
    if (!v2.ok) { violations = v2.violations; plan = null; }
  }

  // B6 A3 — soft retry on volume target mismatch (>±2 from target_sets on any muscle).
  if (plan && hasLandmarks) {
    const offenders = findVolumeOffenders(plan);
    if (offenders.length > 0) {
      const reprompt = basePrompt +
        `\n\nPREVIOUS OUTPUT MISSED THESE PER-MUSCLE WEEKLY VOLUME TARGETS (must be within ±1 of target_sets, never above ceiling):\n- ` +
        offenders.join("\n- ") +
        `\nReturn corrected JSON only.`;
      let retryPlan: any = null;
      try { retryPlan = await tryClaude(reprompt); } catch { retryPlan = null; }
      if (retryPlan) {
        const v3 = validateGeneratedPlan(retryPlan, envelope, planStartISO, restMask, cardioPlacements);
        if (v3.ok) plan = retryPlan;
      }
    }
  }

  if (!plan) {
    plan = buildFallbackPlan(envelope, planStartISO, timezone, trainingDaysCount, restMask, cardioPlacements);
    usedFallback = true;
  }

  plan.plan_start_date = planStartISO;
  plan.plan_timezone = timezone;
  plan.plan_data_version = PLAN_DATA_VERSION;

  // B6 A3 — hard clamp against fuel_adjusted_mrv. Runs on Sonnet AND fallback.
  let clampTrims: string[] = [];
  if (hasLandmarks) {
    const ceilings: Record<string, number> = {};
    for (const [m, v] of Object.entries(landmarksByMuscle)) ceilings[m] = v.fuel_adjusted_mrv;
    const clamped = clampPlanToCeilings(plan, ceilings);
    plan = clamped.plan;
    clampTrims = clamped.trims;
    if (clampTrims.length > 0) {
      console.log(`[generate-plan] clamped ${user_id}: ${clampTrims.length} trim(s)`, clampTrims);
    }
  }

  // B6 A4 — stamp block context on plan_data.
  plan.block_context = {
    block_number: blockNumber,
    week_in_block: weekInBlock,
    block_length_weeks: blockLength,
    phase,
    phase_label: phaseLabel,
  };

  // Post-validation computed summaries.
  {
    const setsPerMuscle: Record<string, number> = {};
    const setsPerPattern: Record<string, number> = {};
    let totalSets = 0;
    let totalExercises = 0;
    let trainingDays = 0;
    for (const d of (plan.days ?? []) as any[]) {
      if (!d || d.rest === true) continue;
      trainingDays += 1;
      for (const ex of (d.exercises ?? []) as any[]) {
        const s = Number(ex?.sets);
        const nSets = Number.isFinite(s) && s > 0 ? s : 0;
        totalSets += nSets;
        totalExercises += 1;
        const mg = typeof ex?.muscle_group === "string" ? ex.muscle_group : "unknown";
        const mp = typeof ex?.movement_pattern === "string" ? ex.movement_pattern : "unknown";
        setsPerMuscle[mg] = (setsPerMuscle[mg] ?? 0) + nSets;
        setsPerPattern[mp] = (setsPerPattern[mp] ?? 0) + nSets;
      }
    }
    plan.training_volume_summary = {
      total_sets: totalSets,
      training_days: trainingDays,
      sets_per_muscle: setsPerMuscle,
      sets_per_movement_pattern: setsPerPattern,
    };
    plan.exercise_media_summary = {
      media_status: "missing" as const,
      missing_count: totalExercises,
    };
  }

  const emitAlert = weeklyReduce || envelope.sessionType === "recovery" || usedFallback;
  const defaultAlert = usedFallback
    ? (envelope.sessionType === "recovery"
        ? "Safe fallback plan generated — first training day is recovery/mobility focused."
        : "Safe fallback plan generated — conservative sets and load. Review before next week.")
    : weeklyReduce
      ? "Low readiness detected — keeping volume conservative this week. Reduce to 3 sets per exercise instead of 4-5 if needed."
      : "Recovery day flagged — first training session is light/mobility focused.";
  if (emitAlert) {
    if (typeof plan.volume_gate_alert !== "string" || plan.volume_gate_alert.trim().length === 0) {
      plan.volume_gate_alert = defaultAlert;
    }
  } else {
    plan.volume_gate_alert = null;
  }

  // DB row keys stay compatible: week_start_date = Monday of planStartISO.
  // On the cron fan-out path planStartISO is strictly next Monday, so this
  // resolves to next Monday and cannot overwrite the current week.
  const week_start_date = utcMondayOf(planStartISO);
  const unlock_date = addDays(week_start_date, 7);

  const { error: upErr } = await supa
    .from("weekly_plans")
    .upsert({
      user_id,
      week_start_date,
      unlock_date,
      is_locked: true,
      plan_data: plan,
      generated_by: "claude-plan-v1",
    }, { onConflict: "user_id,week_start_date" });
  if (upErr) throw upErr;

  return {
    ok: true,
    week_start_date,
    unlock_date,
    plan_start_date: planStartISO,
    plan_timezone: timezone,
    used_fallback: usedFallback,
    violations: usedFallback ? violations : [],
    claude_errors: claudeErrors,
    clamp_trims: clampTrims,
    block_context: plan.block_context,
    plan,
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });

  const url = Deno.env.get("SUPABASE_URL")!;
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const anth = Deno.env.get("ANTHROPIC_API_KEY");
  const supa = createClient(url, key);

  try {
    let body: { user_id?: string } = {};
    try { body = await req.json(); } catch { body = {}; }

    if (!anth) return new Response(JSON.stringify({ error: "ANTHROPIC_API_KEY missing" }), {
      status: 500, headers: { ...cors, "Content-Type": "application/json" },
    });

    // Fan-out mode: no user_id + internal secret. Regenerates the UPCOMING
    // UTC-Monday week for every active-block user. Current week is immutable.
    if (!body.user_id) {
      const authz = await requireInternalSecret(req, supa);
      if (!authz.ok) return new Response(JSON.stringify({ error: authz.error }), {
        status: authz.status, headers: { ...cors, "Content-Type": "application/json" },
      });
      const planStart = nextMondayStrictUTC(new Date());
      const { data: rows, error: batchErr } = await supa
        .from("mesocycle_state")
        .select("user_id")
        .eq("is_active", true);
      if (batchErr) throw batchErr;
      const results: any[] = [];
      for (const r of (rows as { user_id: string }[]) ?? []) {
        try {
          const res = await generateForUser(supa, anth, r.user_id, planStart);
          results.push({
            user_id: r.user_id,
            week_start_date: res.week_start_date,
            used_fallback: res.used_fallback,
            clamp_trims_count: res.clamp_trims.length,
          });
        } catch (e: any) {
          results.push({ user_id: r.user_id, error: e?.message ?? String(e) });
        }
      }
      return new Response(JSON.stringify({ processed: results.length, plan_start_date: planStart, results }), {
        headers: { ...cors, "Content-Type": "application/json" },
      });
    }

    // Single-user path (onboarding, manual regen). JWT or internal secret.
    const authz = await authorizeCaller(req, supa, body.user_id);
    if (!authz.ok) return new Response(JSON.stringify({ error: authz.error }), {
      status: authz.status, headers: { ...cors, "Content-Type": "application/json" },
    });

    const result = await generateForUser(supa, anth, body.user_id);
    return new Response(JSON.stringify(result), {
      headers: { ...cors, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e instanceof Error ? e.message : e) }), {
      status: 500, headers: { ...cors, "Content-Type": "application/json" },
    });
  }
});
