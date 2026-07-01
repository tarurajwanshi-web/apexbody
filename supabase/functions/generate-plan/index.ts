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
        "Schema: { \"days\": [ { \"day\": 1-7, \"day_name\": \"Monday\"...\"Sunday\", \"session_name\": string|null, \"rest\": boolean, \"exercises\": [ { \"name\": string, \"sets\": int, \"reps\": string, \"rest_seconds\": int, \"cue\": string, \"muscle_group\": string, \"progression_note\": string } ] } ], \"volume_gate_alert\": string|null }. " +
        "progression_note is short (max ~8 words) guidance based on the user's recent history for that exercise — e.g. \"+2.5% from last week\", \"hold weight, +1 rep\", \"deload 10%\", or \"new exercise — start moderate\". " +
        "Always return exactly 7 days starting Monday. Rest days have rest=true, session_name=null, exercises=[]. " +
        "The 'cue' field is ONE sharp coaching correction — the single thing you'd shout mid-set to fix that exercise's most common failure point. " +
        "Not a checklist. Not a description of correct form. One real spoken sentence, max ~18 words, second person, lead with the action. " +
        "Examples of the bar: \"Send your hips back first — if your knees lead, you'll lose your chest.\" / \"Pull the bar into you, don't reach for it.\" / \"Squeeze your glutes at the top before you even think about lowering.\"",
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
      .select("goal, training_days_per_week, equipment_access, experience_level")
      .eq("user_id", user_id)
      .maybeSingle();
    if (error || !p) {
      return new Response(JSON.stringify({ error: "profile not found" }), {
        status: 404, headers: { ...cors, "Content-Type": "application/json" },
      });
    }

    const goal = p.goal ?? "recomposition";
    const days = p.training_days_per_week ?? 3;
    const equip = p.equipment_access ?? "commercial_gym";
    const experience = p.experience_level ?? "intermediate";

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

    const equipRule = equip === "bodyweight_only"
      ? "STRICTLY bodyweight only. Do NOT prescribe any dumbbell, barbell, machine, or cable exercises."
      : equip === "home_gym_db_only"
      ? "Dumbbells only — no barbell, machines, or cables. Bands and bodyweight OK."
      : equip === "limited_equipment"
      ? "Limited equipment (basic dumbbells, maybe a bench/bands). Avoid barbell or machines."
      : "Full commercial gym available — barbell, dumbbells, machines, cables all OK.";

    const goalRule =
      goal === "muscle_gain" ? "Hypertrophy programming: 6-12 reps, 4 sets typical, 60-120s rest." :
      goal === "strength" ? "Strength programming: 3-6 reps on main lifts, 4-5 sets, 2-4min rest, accessories 8-10." :
      goal === "fat_loss" ? "Hypertrophy-leaning with density: 8-15 reps, shorter rests (45-75s), keep volume up." :
      goal === "athletic_performance" ? "Mixed: power/explosive lifts (3-5 reps), accessories (6-10), include conditioning blocks." :
      "Recomposition: balanced hypertrophy 6-12 reps with some heavier 4-6 sets, 75-120s rest.";

    const experienceRule =
      experience === "beginner"
        ? "Beginner: 3 sets max per exercise, compound movements only, no exercise requiring advanced technique (no Olympic lifts, no deficit deadlifts). 10-15 reps."
        : experience === "advanced"
        ? "Advanced: 4-5 sets, include periodisation variety (heavy compounds + isolation accessories), RIR-based intensity — note target RIR 2-3 for working sets."
        : "Intermediate: 3-4 sets, balanced compound + accessory split, standard rep ranges for the goal.";

    // Layered readiness note — acute guardrail applies to FIRST non-rest training session (plan starts Monday, not necessarily today).
    const readinessLines: string[] = [];
    if (acuteRecover) {
      readinessLines.push(
        `ACUTE RECOVERY: Latest readiness = red_recover. The FIRST non-rest training day in the plan must be recovery-focused — light mobility, technique, easy conditioning, or converted to rest. Express this via exercise selection (mobility/technique work, low sets, high RIR) and progression_note ("recovery — light technique only"). Remaining training days progress normally unless a weekly reduction also applies.`
      );
    } else if (acuteReduce) {
      readinessLines.push(
        `ACUTE REDUCE: Latest readiness = orange_reduce. The FIRST non-rest training day must drop 1 set on compound lifts and keep RIR >= 2 (encode via progression_note "hold weight, RIR 2-3"). Rest of week unchanged unless a weekly reduction applies.`
      );
    } else if (acuteModify) {
      readinessLines.push(
        `ACUTE MODIFY: Latest readiness = yellow_modify. Keep programming intact but avoid forced progression on the first training day — progression_note should read "warm-up readiness check — hold weight if bar speed is off".`
      );
    } else if (lowConfidenceGate) {
      readinessLines.push(
        `LOW CONFIDENCE: Latest confidence_level = LOW. Do NOT prescribe aggressive unqualified progression. Use conservative progression_note ("hold weight, +1 rep if easy"). Do not cut volume — manual/no-wearable users must not be penalised.`
      );
    }

    if (weeklyReduce) {
      readinessLines.push(
        `WEEKLY REDUCE: Repeated low readiness this week (red=${redDays7}, orange=${orangeDays7}, avg=${avgReadiness != null ? Math.round(avgReadiness) : "n/a"}). Reduce total weekly volume by ~20% (drop 1 set per exercise). Set "volume_gate_alert" to: "Low readiness detected — keeping volume conservative this week. Reduce to 3 sets per exercise instead of 4-5 if needed."`
      );
    }

    if (highLoadCarryover) {
      readinessLines.push(
        `HIGH LOAD CARRYOVER: systemic_load=${latestSystemicLoad}. Start the week conservatively — first working session should feel like RPE 6. Encode via progression_note "hold weight, RIR 3".`
      );
    } else if (mildLoadCarryover) {
      readinessLines.push(
        `Mild residual training load (systemic_load=${latestSystemicLoad}). No volume change — first session progression_note may read "monitor bar speed".`
      );
    }

    const readinessNote = readinessLines.length > 0 ? "\n" + readinessLines.join("\n") : "\nReadiness is adequate. Set \"volume_gate_alert\" to null.";

    const fuelNote = (underFuelled || shieldFuellingCaution)
      ? `\nFUELLING CAUTION${underFuelled ? ` (avg intake ${Math.round(avgIntake!)} kcal vs ${Math.round(targetCalories!)} kcal target)` : ""}${latestNutritionModifier ? ` — Shield nutrition_modifier=${latestNutritionModifier}` : ""}. Do not programme to failure. Reflect this in progression_note ("stop 2-3 reps short of failure") and avoid aggressive metabolic finishers.`
      : "";

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
      `- dominant reason codes: ${dominantReasonCodes.join(", ") || "none"}\n` +
      `Use this as context only. Do not invent new plan JSON fields — express all adjustments via existing schema (sets, reps, rest_seconds, cue, progression_note, exercise selection, session_name, volume_gate_alert).`;

    const prompt =
      `Build a 7-day workout plan.\n` +
      `Goal: ${goal}. Training days per week: ${days}. Equipment: ${equip}. Experience: ${experience}.\n` +
      `Programming rule: ${goalRule}\n` +
      `Equipment rule: ${equipRule}\n` +
      `Experience rule: ${experienceRule}\n` +
      `Include muscle_group for each exercise (e.g. "chest", "quads", "back", "shoulders", "hamstrings", "glutes", "biceps", "triceps", "full_body", "cardio").` +
      `${shieldContext}${readinessNote}${fuelNote}${historyNote}\n` +
      `Exactly ${days} training days with named sessions (e.g. Push/Pull/Legs, Upper/Lower, or Full Body depending on frequency), ` +
      `each with 4-6 exercises (name, sets, reps, rest_seconds, cue, muscle_group, progression_note). The remaining ${7 - days} days are rest. ` +
      `Return JSON matching the schema.`;

    let plan: any;
    try {
      plan = await callClaude(anth, prompt);
    } catch (e1) {
      try {
        plan = await callClaude(anth, prompt);
      } catch (e2) {
        return new Response(JSON.stringify({ error: "Claude failed twice", detail: String(e2 instanceof Error ? e2.message : e2) }), {
          status: 502, headers: { ...cors, "Content-Type": "application/json" },
        });
      }
    }

    const week_start_date = upcomingMonday();
    const unlock_date = addDays(week_start_date, 7);

    const { days: planDays, volume_gate_alert: planAlert } = plan ?? {};
    const emitAlert = weeklyReduce || acuteRecover;
    const defaultAlert = weeklyReduce
      ? "Low readiness detected — keeping volume conservative this week. Reduce to 3 sets per exercise instead of 4-5 if needed."
      : "Recovery day flagged — first training session is light/mobility focused.";
    const normalized = {
      days: planDays ?? [],
      volume_gate_alert: emitAlert
        ? (typeof planAlert === "string" && planAlert.trim().length > 0 ? planAlert : defaultAlert)
        : null,
    };

    const { error: upErr } = await supa
      .from("weekly_plans")
      .upsert({
        user_id,
        week_start_date,
        unlock_date,
        is_locked: true,
        plan_data: normalized,
        generated_by: "claude-plan-v1",
      }, { onConflict: "user_id,week_start_date" });
    if (upErr) throw upErr;

    return new Response(JSON.stringify({ ok: true, week_start_date, unlock_date, plan: normalized }), {
      headers: { ...cors, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e instanceof Error ? e.message : e) }), {
      status: 500, headers: { ...cors, "Content-Type": "application/json" },
    });
  }
});
