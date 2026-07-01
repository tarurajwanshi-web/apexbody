// generate-plan — Claude-powered weekly workout plan.
// Input: { user_id }. Writes a row into public.weekly_plans.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { authorizeCaller, corsAllowHeaders } from "../_shared/authorize.ts";
import {
  resolveTrainingEnvelope,
  validateGeneratedPlan,
  buildFallbackPlan,
  resolvePlanStartISO,
  type Envelope,
  type Goal,
  type Experience,
  type Equipment,
  type Permission,
  type Confidence,
} from "../_shared/training-rules.ts";

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

function upcomingMonday(d = new Date()): string {
  const day = d.getUTCDay(); // 0 Sun .. 6 Sat
  const delta = day === 1 ? 0 : (8 - day) % 7;
  const m = new Date(d);
  m.setUTCDate(d.getUTCDate() + delta);
  return m.toISOString().slice(0, 10);
}

function addDays(iso: string, days: number) {
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
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
        "Schema: { \"plan_start_date\": string (YYYY-MM-DD), \"plan_timezone\": string, \"days\": [ { \"day\": 1-7, \"date\": string (YYYY-MM-DD), \"day_name\": string, \"session_name\": string|null, \"rest\": boolean, \"exercises\": [ { \"name\": string, \"sets\": int, \"reps\": string, \"rest_seconds\": int, \"cue\": string, \"muscle_group\": string, \"progression_note\": string, \"target_rir\": int } ] } ], \"volume_gate_alert\": string|null }. " +
        "No other fields allowed. Do NOT emit session_note, notes, description, tempo, or any field outside this schema. " +
        "progression_note is short (max ~10 words) — e.g. \"+2.5% from last week\", \"hold weight, RIR 2-3\", \"recovery — light technique only\", or \"new exercise — start moderate\". " +
        "Always return exactly 7 days matching the provided calendar. Rest days have rest=true, session_name=null, exercises=[]. " +
        "The 'cue' field is ONE sharp coaching correction — the single thing you'd shout mid-set to fix that exercise's most common failure point. " +
        "Not a checklist. Not a description of correct form. One real spoken sentence, max ~18 words, second person, lead with the action.",
      messages: [{ role: "user", content: prompt }],
    }),
  });
  if (!res.ok) throw new Error(`Anthropic ${res.status}: ${await res.text()}`);
  const j = await res.json();
  const text = j?.content?.[0]?.text ?? "";
  return JSON.parse(stripFences(text));
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });

  const url = Deno.env.get("SUPABASE_URL")!;
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const anth = Deno.env.get("ANTHROPIC_API_KEY");
  const supa = createClient(url, key);

  try {
    const { user_id } = await req.json();
    if (!user_id) return new Response(JSON.stringify({ error: "user_id required" }), {
      status: 400, headers: { ...cors, "Content-Type": "application/json" },
    });
    // Audit #3: caller's JWT user.id must match body.user_id (or internal-secret).
    const authz = await authorizeCaller(req, supa, user_id);
    if (!authz.ok) {
      return new Response(JSON.stringify({ error: authz.error }), {
        status: authz.status, headers: { ...cors, "Content-Type": "application/json" },
      });
    }
    if (!anth) return new Response(JSON.stringify({ error: "ANTHROPIC_API_KEY missing" }), {
      status: 500, headers: { ...cors, "Content-Type": "application/json" },
    });

    const { data: p, error } = await supa
      .from("profiles")
      .select("goal, training_days_per_week, equipment_access, experience_level, timezone")
      .eq("user_id", user_id)
      .maybeSingle();
    if (error || !p) {
      return new Response(JSON.stringify({ error: "profile not found" }), {
        status: 404, headers: { ...cors, "Content-Type": "application/json" },
      });
    }

    const goal: Goal = (p.goal ?? "recomposition") as Goal;
    const days = p.training_days_per_week ?? 3;
    const equip: Equipment = (p.equipment_access ?? "commercial_gym") as Equipment;
    const experience: Experience = (p.experience_level ?? "intermediate") as Experience;
    const timezone: string = (p as any).timezone ?? "UTC";

    // Readiness: avg final_score last 7 days
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

    // Shield v6.3 derived context (null/empty-safe for legacy rows)
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
    const latestReasonCodes: string[] = Array.isArray(latestReadiness?.reason_codes) ? latestReadiness.reason_codes : [];

    const redDays7 = rowsSorted.filter((r: any) => r?.training_permission === "red_recover").length;
    const orangeDays7 = rowsSorted.filter((r: any) => r?.training_permission === "orange_reduce").length;
    const yellowDays7 = rowsSorted.filter((r: any) => r?.training_permission === "yellow_modify").length;
    const lowConfidenceDays7 = rowsSorted.filter((r: any) => r?.confidence_level === "LOW").length;

    const rcFreq: Record<string, number> = {};
    for (const r of rowsSorted) {
      const codes = Array.isArray(r?.reason_codes) ? r.reason_codes : [];
      for (const c of codes) rcFreq[c] = (rcFreq[c] ?? 0) + 1;
    }
    const dominantReasonCodes = Object.entries(rcFreq)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([code]) => code);

    // Workout history: last 30 days, group by exercise for progressive overload.
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
        exerciseHistory[name] = {
          lastWeight: w, lastReps: r, lastRIR: rir,
          maxVolumeSet: `${w}×${r}`, avgRIR: rir,
        };
        rirAcc[name] = { sum: rir, n: 1 };
      } else {
        const cur = exerciseHistory[name];
        const [cw, cr] = cur.maxVolumeSet.split("×").map(parseFloat);
        if (w * r > (cw || 0) * (cr || 0)) cur.maxVolumeSet = `${w}×${r}`;
        rirAcc[name].sum += rir; rirAcc[name].n += 1;
        cur.avgRIR = Math.round((rirAcc[name].sum / rirAcc[name].n) * 10) / 10;
      }
    }

    // Fuelling: current target vs avg intake last 7 days
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
    const avgIntake = dailyTotals.length > 0
      ? dailyTotals.reduce((a, b) => a + b, 0) / dailyTotals.length
      : null;

    const underFuelled = targetCalories != null && avgIntake != null && avgIntake < targetCalories * 0.80;
    const trendLow = avgReadiness != null && avgReadiness < 45;

    // Shield decisions
    const acuteRecover = latestTrainingPermission === "red_recover";
    const acuteReduce  = latestTrainingPermission === "orange_reduce";
    const acuteModify  = latestTrainingPermission === "yellow_modify";
    const lowConfidenceGate = latestConfidenceLevel === "LOW";
    const weeklyReduce =
      redDays7 >= 2 ||
      orangeDays7 >= 2 ||
      (orangeDays7 >= 1 && redDays7 >= 1) ||
      trendLow;
    const highLoadCarryover = latestSystemicLoad >= 25;
    const mildLoadCarryover = latestSystemicLoad > 0 && latestSystemicLoad < 25;

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

    // Resolve deterministic envelope (rules-first, before Sonnet)
    const envelope: Envelope = resolveTrainingEnvelope({
      goal,
      experience,
      equipment: equip,
      trainingDaysPerWeek: days,
      permission: latestTrainingPermission as Permission,
      confidence: latestConfidenceLevel as Confidence,
      nutritionModifier: latestNutritionModifier,
      fuellingCaution: Boolean(underFuelled || shieldFuellingCaution),
      systemicLoad: latestSystemicLoad,
      weeklyReduce,
      redDays7,
      orangeDays7,
    });

    // Rolling plan start date in user's local timezone
    const { data: todayWorkout } = await supa
      .from("workout_set_logs")
      .select("id")
      .eq("user_id", user_id)
      .eq("completed", true)
      .gte("entry_date", new Date().toISOString().slice(0, 10))
      .limit(1);
    const hasCompletedWorkoutToday = Array.isArray(todayWorkout) && todayWorkout.length > 0;
    const { planStartISO } = resolvePlanStartISO(new Date(), timezone, hasCompletedWorkoutToday);

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

    // Compute expected calendar for the prompt (day/date/day_name)
    const calendar = Array.from({ length: 7 }, (_, i) => {
      const dt = new Date(planStartISO + "T00:00:00Z");
      dt.setUTCDate(dt.getUTCDate() + i);
      const iso = dt.toISOString().slice(0, 10);
      const dn = ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"][dt.getUTCDay()];
      return { day: i + 1, date: iso, day_name: dn };
    });

    const promptSchemaNote =
      `Return ONLY a JSON object of shape: { "plan_start_date": "${planStartISO}", "plan_timezone": "${timezone}", "days": [7 items], "volume_gate_alert": string|null }. ` +
      `Each day: { "day": 1-7, "date": string (YYYY-MM-DD, use the calendar below), "day_name": string, "rest": boolean, "session_name": string|null, "exercises": [] }. ` +
      `Each exercise: { "name": string, "sets": int, "reps": string, "rest_seconds": int, "cue": string, "muscle_group": string, "progression_note": string, "target_rir": int }. ` +
      `No other top-level or exercise fields. Do NOT emit session_note, notes, description, tempo, or anything not in this schema.`;

    const basePrompt =
      `Build a rolling 7-day workout plan starting ${planStartISO} (user timezone ${timezone}).\n` +
      `Use exactly this calendar (day/date/day_name):\n${JSON.stringify(calendar)}\n` +
      `${envelopeBlock}\n` +
      `${shieldContext}\n` +
      `${(underFuelled || shieldFuellingCaution) ? `\nFUELLING CAUTION${underFuelled && targetCalories ? ` (avg intake ${Math.round(avgIntake!)} kcal vs ${Math.round(targetCalories!)} kcal target)` : ""}${latestNutritionModifier ? ` — Shield nutrition_modifier=${latestNutritionModifier}` : ""}. Do not programme to failure.` : ""}` +
      historyNote + "\n" +
      `Exactly ${days} training days with APEX-named sessions (e.g. "APEX Push A", "APEX Lower A", "APEX Full Body A"), each with ${envelope.exercisesPerSession[0]}-${envelope.exercisesPerSession[1]} exercises. Remaining ${7 - days} days are rest (rest=true, session_name=null, exercises=[]).\n` +
      `Include muscle_group per exercise. target_rir must be an integer inside [${envelope.targetRir[0]}, ${envelope.targetRir[1]}].\n` +
      promptSchemaNote;

    async function tryClaude(promptText: string) {
      return await callClaude(anth, promptText);
    }

    let plan: any = null;
    let violations: string[] = [];
    let usedFallback = false;

    try {
      plan = await tryClaude(basePrompt);
    } catch (e) {
      plan = null;
    }
    if (plan) {
      const v1 = validateGeneratedPlan(plan, envelope, planStartISO);
      if (!v1.ok) {
        violations = v1.violations;
        const reprompt = basePrompt +
          `\n\nPREVIOUS OUTPUT WAS INVALID. Fix all of these violations and return corrected JSON only:\n- ` +
          violations.join("\n- ");
        try {
          plan = await tryClaude(reprompt);
        } catch {
          plan = null;
        }
      }
    }
    if (plan) {
      const v2 = validateGeneratedPlan(plan, envelope, planStartISO);
      if (!v2.ok) {
        violations = v2.violations;
        plan = null;
      }
    }
    if (!plan) {
      plan = buildFallbackPlan(envelope, planStartISO, timezone, days);
      usedFallback = true;
    }

    // Ensure top-level plan_start_date / plan_timezone are set
    plan.plan_start_date = planStartISO;
    plan.plan_timezone = timezone;

    // Determine volume_gate_alert
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

    // DB row keys stay compatible: week_start_date = Monday of planStartISO's ISO week
    const week_start_date = (() => {
      const d = new Date(planStartISO + "T00:00:00Z");
      const dow = d.getUTCDay(); // 0=Sun..6=Sat
      const delta = dow === 0 ? -6 : 1 - dow;
      d.setUTCDate(d.getUTCDate() + delta);
      return d.toISOString().slice(0, 10);
    })();
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

    return new Response(JSON.stringify({
      ok: true,
      week_start_date,
      unlock_date,
      plan_start_date: planStartISO,
      plan_timezone: timezone,
      used_fallback: usedFallback,
      violations: usedFallback ? violations : [],
      plan,
    }), {
      headers: { ...cors, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e instanceof Error ? e.message : e) }), {
      status: 500, headers: { ...cors, "Content-Type": "application/json" },
    });
  }
});
