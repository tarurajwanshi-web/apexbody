// Daily fuelling adequacy evaluation. Runs hourly via pg_cron; per user the
// function only executes when it is 6 AM in the user's local timezone.
// Optional { user_id } payload bypasses the time gate (manual run).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { requireInternalSecret, corsAllowHeaders } from "../_shared/authorize.ts";
import { DEFAULT_TIMEZONE } from "../_shared/time-helpers.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": corsAllowHeaders,
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function fmtLocalDate(tz: string, d: Date): string {
  try {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit",
    }).format(d);
  } catch {
    return d.toISOString().slice(0, 10);
  }
}

function localHour(tz: string, d: Date = new Date()): number {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: tz, hour: "numeric", hour12: false,
    }).formatToParts(d);
    return parseInt(parts.find((p) => p.type === "hour")?.value ?? "0", 10);
  } catch { return -1; }
}

function addDays(iso: string, n: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

async function miniExplain(
  lovableKey: string,
  ctx: {
    total_sets: number; total_calories: number; bmr: number;
    training_cost: number; shortfall: number; goal: string | null;
    avg_rir: number | null;
  },
): Promise<{ explanation: string; protocol: string } | null> {
  if (!lovableKey) return null;
  const sys =
    "Explain fuelling adequacy in simple language for a fitness enthusiast. " +
    "User did heavy training. Explain why calories matter for recovery. " +
    "Be specific to their data. " +
    'Output ONLY JSON: { "explanation": string, "protocol": string }. ' +
    "Plain text, no markdown, no emoji. Keep each field under 240 chars.";
  const user =
    `Yesterday the user did ${ctx.total_sets} sets and ate ${Math.round(ctx.total_calories)} kcal. ` +
    `BMR is ${Math.round(ctx.bmr)} kcal, training cost is ~${Math.round(ctx.training_cost)} kcal, ` +
    `total energy need ~${Math.round(ctx.bmr + ctx.training_cost)} kcal. ` +
    `Shortfall: ${Math.round(ctx.shortfall)} kcal. ` +
    `Goal: ${ctx.goal ?? "general"}. ` +
    `Avg RIR: ${ctx.avg_rir != null ? ctx.avg_rir.toFixed(1) : "unknown"}. ` +
    "Explain why this matters for recovery and strength. What should they do?";
  try {
    const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Lovable-API-Key": lovableKey,
        "X-Lovable-AIG-SDK": "vercel-ai-sdk",
      },
      body: JSON.stringify({
        model: "openai/gpt-5-mini",
        messages: [
          { role: "system", content: sys },
          { role: "user", content: user },
        ],
        response_format: { type: "json_object" },
      }),
    });
    if (!res.ok) { console.error("miniExplain failed", res.status, await res.text()); return null; }
    const json = await res.json();
    const text = json?.choices?.[0]?.message?.content ?? "";
    const parsed = JSON.parse(text);
    if (parsed && typeof parsed.explanation === "string" && typeof parsed.protocol === "string") {
      return { explanation: parsed.explanation, protocol: parsed.protocol };
    }
    return null;
  } catch (e) { console.error("miniExplain error", e); return null; }
}

type Eval = {
  total_sets: number;
  avg_rir: number | null;
  total_calories: number;
  bmr: number;
  training_cost: number;
  shortfall: number;
  severity: "underfuelled" | "marginal" | "adequate";
  severity_score: 1 | 2 | 3;
  message: string;
  action: string;
};

function evaluate(
  total_sets: number,
  avg_rir: number | null,
  total_calories: number,
  bmr: number,
): Eval {
  // Training caloric cost: ~5 kcal/set + small cardiovascular estimate.
  const training_cost = total_sets * 5 + 80;
  const target = bmr + training_cost;
  const shortfall = Math.max(0, target - total_calories);

  if (total_calories < target - 200) {
    return {
      total_sets, avg_rir, total_calories, bmr, training_cost,
      shortfall,
      severity: "underfuelled",
      severity_score: 3,
      message:
        `Yesterday: ${total_sets} sets, ${Math.round(total_calories)} kcal consumed. ` +
        `On ${total_sets} sets, you need ~${Math.round(target)} kcal to recover. ` +
        `You're ~${Math.round(target - total_calories)} kcal short.` +
        (avg_rir != null
          ? ` This is why your RIR averages ${avg_rir.toFixed(1)} (harder to recover).`
          : ""),
      action:
        "Add 200-300 kcal next heavy training day. Front-load carbs 2-3 hours pre-workout.",
    };
  }
  if (total_calories < target) {
    return {
      total_sets, avg_rir, total_calories, bmr, training_cost,
      shortfall,
      severity: "marginal",
      severity_score: 2,
      message:
        `Fuelling is marginal. ${Math.round(total_calories)} kcal for ${total_sets} sets ` +
        "is at threshold. Next high-volume day, add 100-150 kcal.",
      action: "Monitor RIR next week. If avg RIR > 2.5, increase calories.",
    };
  }
  return {
    total_sets, avg_rir, total_calories, bmr, training_cost,
    shortfall,
    severity: "adequate",
    severity_score: 1,
    message:
      `Your ${Math.round(total_calories)} kcal fuelled ${total_sets} sets well. ` +
      "RIR recovery is on track.",
    action: "Maintain current approach.",
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });

  const url = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const lovableKey = Deno.env.get("LOVABLE_API_KEY") ?? "";
  const supa = createClient(url, serviceKey, { auth: { persistSession: false } });

  // Internal-secret only (cron / manual admin trigger)
  const authz = await requireInternalSecret(req, supa);
  if (!authz.ok) {
    return new Response(JSON.stringify({ error: authz.error }), {
      status: authz.status, headers: { ...cors, "Content-Type": "application/json" },
    });
  }

  let body: { user_id?: string } = {};
  try { body = await req.json(); } catch { /* empty body ok */ }

  const now = new Date();

  // Profile set to evaluate
  let profileQuery = supa
    .from("profiles")
    .select("user_id, timezone, goal, experience_level");
  if (body.user_id) profileQuery = profileQuery.eq("user_id", body.user_id);
  const { data: profiles, error: profErr } = await profileQuery;
  if (profErr) {
    return new Response(JSON.stringify({ error: profErr.message }), {
      status: 500, headers: { ...cors, "Content-Type": "application/json" },
    });
  }

  const results: Array<Record<string, unknown>> = [];

  for (const p of profiles ?? []) {
    const tz = (p as { timezone?: string }).timezone || "UTC";
    // Time gate (unless explicit user_id override)
    if (!body.user_id && localHour(tz, now) !== 6) {
      continue;
    }

    const yesterdayLocal = addDays(fmtLocalDate(tz, now), -1);

    const { data: sets } = await supa
      .from("workout_set_logs")
      .select("rir, completed")
      .eq("user_id", p.user_id)
      .eq("entry_date", yesterdayLocal)
      .eq("completed", true);
    const total_sets = sets?.length ?? 0;

    // Volume tier filter — high-volume day only
    if (total_sets < 15) { continue; }

    const rirs = (sets ?? [])
      .map((s) => (s as { rir: number | null }).rir)
      .filter((v): v is number => typeof v === "number");
    const avg_rir_check = rirs.length ? rirs.reduce((a, b) => a + b, 0) / rirs.length : null;

    // Eligibility: high volume AND pushed near failure (RIR ≤2) — the actual
    // overreaching/recovery-risk case, not a population percentile.
    if (avg_rir_check === null || avg_rir_check > 2) { continue; }

    const avg_rir = avg_rir_check;

    const { data: meals } = await supa
      .from("shield_nutrition_logs")
      .select("calories, protein_g, carbs_g, fat_g, deleted")
      .eq("user_id", p.user_id)
      .eq("entry_date", yesterdayLocal);
    const totalCalories =
      (meals ?? [])
        .filter((m) => !(m as { deleted: boolean }).deleted)
        .reduce((a, m) => a + (Number((m as { calories: number | null }).calories) || 0), 0);

    const { data: targets } = await supa
      .from("daily_macro_targets")
      .select("bmr, target_calories")
      .eq("user_id", p.user_id)
      .lte("effective_start_date", yesterdayLocal)
      .order("effective_start_date", { ascending: false })
      .limit(1)
      .maybeSingle();
    const bmr = Number(targets?.bmr) || Math.round(((targets?.target_calories ?? 2000) as number) * 0.65);

    // Most-recent readiness row (unbounded — same-day directive, not a trend).
    const { data: latestReadinessRow } = await supa
      .from("readiness_scores")
      .select("nutrition_modifier, training_permission, final_score, score_date")
      .eq("user_id", p.user_id)
      .order("score_date", { ascending: false })
      .limit(1)
      .maybeSingle();
    const readinessNutritionMod =
      (latestReadinessRow as { nutrition_modifier?: string | null } | null)?.nutrition_modifier ?? null;
    const readinessTrainingPerm =
      (latestReadinessRow as { training_permission?: string | null } | null)?.training_permission ?? null;
    const readinessFlagged =
      readinessNutritionMod === "deficit_caution" || readinessTrainingPerm === "red_recover";

    const ev = evaluate(total_sets, avg_rir, totalCalories, bmr);

    // Severity nudge: promote marginal → underfuelled when readiness independently flags caution.
    if (ev.severity === "marginal" && readinessFlagged) {
      ev.severity = "underfuelled";
      ev.severity_score = 3;
    }

    // Message reinforcement when both engines converge on a problem.
    if (ev.severity_score >= 2 && readinessFlagged) {
      ev.message = `${ev.message} This lines up with your readiness — Shield already flagged today for caution.`;
    }

    const readiness_modifier_at_eval: string | null =
      readinessNutritionMod ?? readinessTrainingPerm ?? null;

    let mini_explanation: string | null = null;
    if (ev.severity_score >= 2) {
      const explained = await miniExplain(lovableKey, {
        total_sets, total_calories: totalCalories, bmr,
        training_cost: ev.training_cost, shortfall: ev.shortfall,
        goal: (p as { goal: string | null }).goal ?? null,
        avg_rir,
      });
      if (explained) {
        mini_explanation = `${explained.explanation} ${explained.protocol}`.trim();
      }
    }

    const { error: upsertErr } = await supa
      .from("user_fuelling_evaluations")
      .upsert(
        {
          user_id: p.user_id,
          evaluation_date: yesterdayLocal,
          total_sets,
          avg_rir,
          calories_consumed: totalCalories,
          calories_target: ev.bmr + ev.training_cost,
          shortfall: ev.shortfall,
          bmr: ev.bmr,
          training_cost: ev.training_cost,
          severity: ev.severity,
          severity_score: ev.severity_score,
          message: ev.message,
          action: ev.action,
          mini_explanation,
          readiness_modifier_at_eval,
        },
        { onConflict: "user_id,evaluation_date" },
      );

    results.push({
      user_id: p.user_id,
      date: yesterdayLocal,
      severity: ev.severity,
      total_sets,
      total_calories: totalCalories,
      stored: !upsertErr,
      error: upsertErr?.message,
    });
  }

  return new Response(
    JSON.stringify({ ok: true, processed: results.length, results }),
    { headers: { ...cors, "Content-Type": "application/json" } },
  );
});
