// APEX compute-volume-landmarks — deterministic weekly per-muscle prescription.
//
// Fuel + readiness shrink the recovery ceiling; block/phase shapes the target.
// Runs Monday cron BEFORE advance-mesocycle (see 05:40 vs 05:45) so the
// just-finished week's completed_sets is backfilled before B4 reads it.
//
// Two writes per run:
//  1) BACKFILL — update last week's landmark rows' completed_sets with the
//     final count from workout_set_logs (does not insert missing rows —
//     if no targets existed for last week, there's nothing to compare).
//  2) TARGETS — upsert this week's row per trainable muscle with mev/mav/
//     mrv/fuel_adjusted_mrv/target_sets. completed_sets stays at default 0
//     until next Monday's backfill.
//
// Auth: internal secret (cron / DB trigger) OR user's own bearer.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { authorizeCaller, requireInternalSecret, corsAllowHeaders } from "../_shared/authorize.ts";
import {
  VOLUME_LANDMARKS,
  effectiveLandmarks,
  MUSCLE_GROUP_DISPLAY_ORDER,
  normaliseMuscleGroup,
} from "../_shared/volume-landmarks.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": corsAllowHeaders,
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "content-type": "application/json" },
  });
}

// UTC-Monday helpers — byte-for-byte match advance-mesocycle / generate-plan.
function utcMondayOf(iso: string): string {
  const d = new Date(iso + "T00:00:00Z");
  const dow = d.getUTCDay();
  const delta = dow === 0 ? -6 : 1 - dow;
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
}
function addDaysISO(iso: string, n: number): string {
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
function todayUTCISO(): string {
  return new Date().toISOString().slice(0, 10);
}

// Trainable muscles only — non-hypertrophy groups return null from VOLUME_LANDMARKS.
const TRAINABLE_MUSCLES = MUSCLE_GROUP_DISPLAY_ORDER.filter(
  (m) => VOLUME_LANDMARKS[m] !== null,
);

async function countMuscleSetsInWindow(
  supa: any,
  userId: string,
  startISO: string,
  endISO: string,
): Promise<Record<string, number>> {
  const { data, error } = await supa
    .from("workout_set_logs")
    .select("muscle_group")
    .eq("user_id", userId)
    .eq("completed", true)
    .neq("set_type", "warmup")
    .gte("entry_date", startISO)
    .lte("entry_date", endISO);
  if (error) throw new Error(`count failed: ${error.message}`);

  const counts: Record<string, number> = {};
  for (const r of (data as { muscle_group: string | null }[]) ?? []) {
    const canonical = normaliseMuscleGroup(r.muscle_group ?? "");
    if (!canonical) continue;
    counts[canonical] = (counts[canonical] ?? 0) + 1;
  }
  return counts;
}

async function computeForUser(supa: any, userId: string) {
  // 1) Context
  const { data: meso } = await supa
    .from("mesocycle_state")
    .select("block_number, week_in_block, block_length_weeks, phase")
    .eq("user_id", userId)
    .eq("is_active", true)
    .maybeSingle();
  if (!meso) return { skipped: "no_active_block" };

  const { data: profile } = await supa
    .from("profiles")
    .select("goal, experience_level")
    .eq("user_id", userId)
    .maybeSingle();
  if (!profile || !profile.goal || !profile.experience_level) {
    return { skipped: "incomplete_profile" };
  }
  const goal = profile.goal as string;
  const experience = profile.experience_level as string;

  const today = todayUTCISO();
  const thisMonday = utcMondayOf(today);
  const lastMonday = addDaysISO(thisMonday, -7);
  const lastSunday = addDaysISO(thisMonday, -1);

  // 2) BACKFILL last week's completed_sets on any existing landmark rows.
  const lastWeekCounts = await countMuscleSetsInWindow(
    supa,
    userId,
    lastMonday,
    lastSunday,
  );
  const { data: lastRows } = await supa
    .from("weekly_volume_landmarks")
    .select("id, muscle_group")
    .eq("user_id", userId)
    .eq("week_start_date", lastMonday);
  let backfilled = 0;
  for (const r of (lastRows as { id: string; muscle_group: string }[]) ?? []) {
    const done = lastWeekCounts[r.muscle_group] ?? 0;
    const { error: bfErr } = await supa
      .from("weekly_volume_landmarks")
      .update({ completed_sets: done, updated_at: new Date().toISOString() })
      .eq("id", r.id);
    if (!bfErr) backfilled++;
  }

  // 3) FUEL factor — goal-target keyed, thin-data safe.
  const nutritionWindowStart = addDaysISO(today, -7);
  const [{ data: intakeRows }, { data: activeTarget }] = await Promise.all([
    supa
      .from("shield_nutrition_logs")
      .select("entry_date, estimated_calories, calorie_estimate_status, deleted")
      .eq("user_id", userId)
      .eq("deleted", false)
      .in("calorie_estimate_status", ["estimated", "manual_edited"])
      .gte("entry_date", nutritionWindowStart)
      .lt("entry_date", today),
    supa
      .from("daily_macro_targets")
      .select("target_calories, effective_start_date, effective_end_date")
      .eq("user_id", userId)
      .is("effective_end_date", null)
      .order("effective_start_date", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  // Aggregate by day so a user logging 3 meals on one day counts as 1 day.
  const byDay = new Map<string, number>();
  for (const r of (intakeRows as any[]) ?? []) {
    const kcal = Number(r.estimated_calories ?? 0);
    if (!Number.isFinite(kcal) || kcal <= 0) continue;
    byDay.set(r.entry_date, (byDay.get(r.entry_date) ?? 0) + kcal);
  }
  const loggedDays = byDay.size;
  const target = Number((activeTarget as any)?.target_calories ?? 0);

  let fuelFactor = 1.0;
  let intakePct: number | null = null;
  if (loggedDays >= 4 && target > 0) {
    const avgIntake =
      [...byDay.values()].reduce((s, v) => s + v, 0) / loggedDays;
    intakePct = avgIntake / target;
    if (intakePct >= 0.95) fuelFactor = 1.0;
    else if (intakePct >= 0.80) fuelFactor = 0.85;
    else fuelFactor = 0.7;
  }

  // 4) READINESS factor.
  const readinessWindowStart = addDaysISO(today, -7);
  const { data: readinessRows } = await supa
    .from("readiness_scores")
    .select("final_score")
    .eq("user_id", userId)
    .gte("entry_date", readinessWindowStart)
    .lte("entry_date", today)
    .not("final_score", "is", null);
  const scores = ((readinessRows as any[]) ?? [])
    .map((r) => Number(r.final_score))
    .filter((n) => Number.isFinite(n));
  let readinessFactor = 1.0;
  if (scores.length >= 3) {
    const avg = scores.reduce((s, v) => s + v, 0) / scores.length;
    if (avg < 45) readinessFactor = 0.9;
  }

  // 5) Per-muscle landmarks.
  const nowIso = new Date().toISOString();
  const muscles: any[] = [];
  const rowsToUpsert: any[] = [];
  for (const muscle of TRAINABLE_MUSCLES) {
    const base = effectiveLandmarks(muscle, experience, goal);
    if (!base) continue;
    const mev = base.mev;
    const mav = base.mav;
    const mrv = base.mrv;
    const fuel_adjusted_mrv = Math.max(
      mev,
      Math.round(mrv * fuelFactor * readinessFactor),
    );

    let target_sets: number;
    if (meso.phase === "deload") {
      target_sets = Math.max(Math.round(mev * 0.5), 2);
    } else {
      const accumWeeks = Math.max(1, meso.block_length_weeks - 1);
      const progress =
        accumWeeks <= 1
          ? 1
          : Math.min(1, Math.max(0, (meso.week_in_block - 1) / (accumWeeks - 1)));
      const ramp = mev + (mav - mev) * progress;
      const baselineClimb = Math.min(Math.max(meso.block_number - 1, 0), 3);
      target_sets = Math.round(ramp) + baselineClimb;
    }
    target_sets = Math.min(target_sets, fuel_adjusted_mrv);
    target_sets = Math.max(1, target_sets); // smallint safety floor

    rowsToUpsert.push({
      user_id: userId,
      week_start_date: thisMonday,
      muscle_group: muscle,
      mev,
      mav,
      mrv,
      fuel_adjusted_mrv,
      target_sets,
      updated_at: nowIso,
    });
    muscles.push({ muscle_group: muscle, mev, mav, mrv, fuel_adjusted_mrv, target_sets });
  }

  // 6) UPSERT this week's targets. completed_sets defaults to 0 in schema and
  // is intentionally omitted so re-runs don't clobber mid-week backfills.
  const { error: upErr } = await supa
    .from("weekly_volume_landmarks")
    .upsert(rowsToUpsert, { onConflict: "user_id,week_start_date,muscle_group" });
  if (upErr) throw new Error(`upsert failed: ${upErr.message}`);

  return {
    week_start_date: thisMonday,
    phase: meso.phase,
    block_number: meso.block_number,
    week_in_block: meso.week_in_block,
    fuelFactor,
    intakePct,
    loggedDays,
    readinessFactor,
    readinessSamples: scores.length,
    backfilled_last_week_rows: backfilled,
    muscles,
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json(405, { error: "method not allowed" });

  let body: { user_id?: string };
  try {
    body = await req.json();
  } catch {
    return json(400, { error: "invalid json" });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  // Batch path: internal secret + no user_id → all active blocks.
  if (!body.user_id) {
    const authz = await requireInternalSecret(req, supabase);
    if (!authz.ok) return json(authz.status, { error: authz.error });

    const { data: rows, error } = await supabase
      .from("mesocycle_state")
      .select("user_id")
      .eq("is_active", true);
    if (error) return json(500, { error: `batch load failed: ${error.message}` });

    const results: any[] = [];
    for (const r of (rows as { user_id: string }[]) ?? []) {
      try {
        const res = await computeForUser(supabase, r.user_id);
        results.push({ user_id: r.user_id, ...res });
      } catch (e: any) {
        results.push({ user_id: r.user_id, error: e?.message ?? String(e) });
      }
    }
    return json(200, { processed: results.length, results });
  }

  const authz = await authorizeCaller(req, supabase, body.user_id);
  if (!authz.ok) return json(authz.status, { error: authz.error });

  try {
    const result = await computeForUser(supabase, body.user_id);
    return json(200, result);
  } catch (e: any) {
    return json(500, { error: e?.message ?? String(e) });
  }
});
