// APEX advance-mesocycle — deterministic block clock.
//
// All week boundaries here are UTC-Monday to match generate-plan and
// weekly_plans.week_start_date. Do NOT introduce user-timezone week math —
// it desyncs the block clock from the plan. The block MUST tick on the same
// week windows the plan is generated on.
//
// Modes:
//   init   — called at onboarding. Creates one active mesocycle_state row
//            anchored to the same upcoming Monday generate-plan uses.
//   weekly — called by Monday cron. Advances / deloads / starts new block
//            based on training reality (>= 1 completed working set in the
//            finished UTC Mon–Sun window). Idempotent.
//
// Service-role writes only; mesocycle_state has no client write policies.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { authorizeCaller, requireInternalSecret, corsAllowHeaders } from "../_shared/authorize.ts";

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

// ── UTC-Monday helpers ──────────────────────────────────────────────────────
// Byte-for-byte the same math as generate-plan/upcomingMonday.
function upcomingMondayUTC(d = new Date()): string {
  const day = d.getUTCDay(); // 0 Sun .. 6 Sat
  const delta = day === 1 ? 0 : (8 - day) % 7;
  const m = new Date(d);
  m.setUTCDate(d.getUTCDate() + delta);
  return m.toISOString().slice(0, 10);
}

function addDaysISO(iso: string, n: number): string {
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Monday (UTC) of the ISO week that contains `iso`. */
function utcMondayOf(iso: string): string {
  const d = new Date(iso + "T00:00:00Z");
  const dow = d.getUTCDay();
  const delta = dow === 0 ? -6 : 1 - dow;
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
}

function todayUTCISO(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Previous completed UTC Mon–Sun relative to `todayIso`. */
function previousCompletedUTCWeek(todayIso: string): { start: string; end: string } {
  const thisMonday = utcMondayOf(todayIso);
  const start = addDaysISO(thisMonday, -7);
  const end = addDaysISO(start, 6);
  return { start, end };
}

// ── Core logic ──────────────────────────────────────────────────────────────

type MesoRow = {
  id: string;
  user_id: string;
  block_number: number;
  week_in_block: number;
  block_length_weeks: number;
  block_start_date: string;
  phase: "accumulation" | "deload";
  goal: string;
  is_active: boolean;
  updated_at: string;
};

async function loadActive(supa: any, userId: string): Promise<MesoRow | null> {
  const { data } = await supa
    .from("mesocycle_state")
    .select("*")
    .eq("user_id", userId)
    .eq("is_active", true)
    .maybeSingle();
  return (data as MesoRow) ?? null;
}

async function doInit(supa: any, userId: string) {
  const existing = await loadActive(supa, userId);
  if (existing) {
    return {
      initialized: false,
      alreadyActive: true,
      block_number: existing.block_number,
      week_in_block: existing.week_in_block,
      phase: existing.phase,
      block_start_date: existing.block_start_date,
    };
  }
  const { data: profile } = await supa
    .from("profiles")
    .select("plan_unlock_date, goal")
    .eq("user_id", userId)
    .maybeSingle();
  const goal = (profile as any)?.goal ?? "general_fitness";
  const planMonday: string =
    (profile as any)?.plan_unlock_date || upcomingMondayUTC();

  const { error } = await supa.from("mesocycle_state").insert({
    user_id: userId,
    block_number: 1,
    week_in_block: 1,
    block_length_weeks: 4,
    block_start_date: planMonday,
    phase: "accumulation",
    goal,
    is_active: true,
  });
  if (error) {
    // Partial unique index race — re-select and return current.
    const now = await loadActive(supa, userId);
    if (now) {
      return {
        initialized: false,
        alreadyActive: true,
        block_number: now.block_number,
        week_in_block: now.week_in_block,
        phase: now.phase,
        block_start_date: now.block_start_date,
      };
    }
    throw new Error(`init insert failed: ${error.message}`);
  }
  return {
    initialized: true,
    block_start_date: planMonday,
    block_number: 1,
    week_in_block: 1,
    phase: "accumulation" as const,
  };
}

async function doWeekly(supa: any, userId: string) {
  const active = await loadActive(supa, userId);
  if (!active) return { skipped: "no_active_block" };

  const todayIso = todayUTCISO();
  const thisMonday = utcMondayOf(todayIso);
  const finishedWeek = previousCompletedUTCWeek(todayIso);

  // Guard: block hasn't started yet.
  if (todayIso < active.block_start_date) {
    return {
      skipped: "block_not_started",
      block_start_date: active.block_start_date,
    };
  }

  // Idempotency: if updated_at is already >= thisMonday 00:00 UTC, we've
  // already advanced (or held) this week. Second Monday fire is a no-op.
  // (HOLD path leaves updated_at untouched, so a follow-up run that finds
  // new training data can still act — but same-week re-run is safe.)
  const thisMondayTs = new Date(thisMonday + "T00:00:00Z").getTime();
  const updatedTs = new Date(active.updated_at).getTime();
  if (updatedTs >= thisMondayTs) {
    return {
      skipped: "already_advanced_this_week",
      block_number: active.block_number,
      week_in_block: active.week_in_block,
      phase: active.phase,
    };
  }

  // Step 2 — did they train the finished UTC week?
  const { count: trainedSets } = await supa
    .from("workout_set_logs")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .eq("completed", true)
    .neq("set_type", "warmup")
    .gte("entry_date", finishedWeek.start)
    .lte("entry_date", finishedWeek.end);

  if (!trainedSets || trainedSets < 1) {
    return {
      held: true,
      reason: "no_training_last_week",
      block_number: active.block_number,
      week_in_block: active.week_in_block,
      phase: active.phase,
    };
  }

  // Step 3 — fatigue signals (only if advancing).
  const prevWeek = {
    start: addDaysISO(finishedWeek.start, -7),
    end: addDaysISO(finishedWeek.start, -1),
  };
  const { data: landmarks } = await supa
    .from("weekly_volume_landmarks")
    .select("muscle_group, completed_sets, fuel_adjusted_mrv, week_start_date")
    .eq("user_id", userId)
    .in("week_start_date", [finishedWeek.start, prevWeek.start]);

  const overreachByMuscle = new Map<string, Set<string>>(); // muscle -> weeks
  for (const r of (landmarks as any[]) ?? []) {
    const done = Number(r.completed_sets ?? 0);
    const mrv = Number(r.fuel_adjusted_mrv ?? 0);
    if (mrv > 0 && done > mrv) {
      const set = overreachByMuscle.get(r.muscle_group) ?? new Set<string>();
      set.add(r.week_start_date);
      overreachByMuscle.set(r.muscle_group, set);
    }
  }
  const chronic_overreach = [...overreachByMuscle.values()].some(
    (weeks) => weeks.has(finishedWeek.start) && weeks.has(prevWeek.start),
  );

  const sevenDaysAgo = addDaysISO(todayIso, -7);
  const { data: readiness } = await supa
    .from("readiness_scores")
    .select("final_score, training_permission")
    .eq("user_id", userId)
    .gte("entry_date", sevenDaysAgo)
    .lte("entry_date", todayIso);

  let systemic_breakdown = false;
  if ((readiness as any[])?.length >= 3) {
    const arr = readiness as any[];
    const avg = arr.reduce((s, r) => s + Number(r.final_score ?? 0), 0) / arr.length;
    const reds = arr.filter((r) => r.training_permission === "red_recover").length;
    systemic_breakdown = avg < 40 && reds >= 2;
  }

  // Step 4 — precedence A > B > C > D.
  let block_number = active.block_number;
  let week_in_block = active.week_in_block;
  let phase = active.phase;
  let block_start_date = active.block_start_date;
  let deload_reason: string | null = null;

  if (phase === "accumulation" && (chronic_overreach || systemic_breakdown)) {
    // A — early deload interrupt.
    phase = "deload";
    deload_reason =
      chronic_overreach && systemic_breakdown
        ? "both"
        : chronic_overreach
          ? "chronic_overreach"
          : "systemic_breakdown";
  } else if (phase === "accumulation" && week_in_block >= active.block_length_weeks) {
    // B — planned deload.
    phase = "deload";
    deload_reason = "planned";
  } else if (phase === "deload") {
    // C — new block.
    block_number += 1;
    week_in_block = 1;
    phase = "accumulation";
    block_start_date = thisMonday;
  } else {
    // D — normal advance.
    week_in_block = Math.min(week_in_block + 1, active.block_length_weeks);
  }

  const { error: upErr } = await supa
    .from("mesocycle_state")
    .update({
      block_number,
      week_in_block,
      phase,
      block_start_date,
      updated_at: new Date().toISOString(),
    })
    .eq("id", active.id);
  if (upErr) throw new Error(`update failed: ${upErr.message}`);

  return {
    advanced: true,
    block_number,
    week_in_block,
    phase,
    is_deload_week: phase === "deload",
    deload_reason,
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json(405, { error: "method not allowed" });

  let body: { user_id?: string; mode?: "init" | "weekly" };
  try {
    body = await req.json();
  } catch {
    return json(400, { error: "invalid json" });
  }
  const mode = body.mode ?? "weekly";

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  // Cron path: no user_id + internal secret → process all active blocks.
  if (!body.user_id) {
    const authz = await requireInternalSecret(req, supabase);
    if (!authz.ok) return json(authz.status, { error: authz.error });
    if (mode !== "weekly") return json(400, { error: "batch mode requires mode='weekly'" });

    const { data: rows, error } = await supabase
      .from("mesocycle_state")
      .select("user_id")
      .eq("is_active", true);
    if (error) return json(500, { error: `batch load failed: ${error.message}` });

    const results: any[] = [];
    for (const r of (rows as any[]) ?? []) {
      try {
        const res = await doWeekly(supabase, r.user_id);
        results.push({ user_id: r.user_id, ...res });
      } catch (e: any) {
        results.push({ user_id: r.user_id, error: e?.message ?? String(e) });
      }
    }
    return json(200, { processed: results.length, results });
  }

  // Per-user path: internal secret OR user's own bearer token.
  const authz = await authorizeCaller(req, supabase, body.user_id);
  if (!authz.ok) return json(authz.status, { error: authz.error });

  try {
    const result =
      mode === "init"
        ? await doInit(supabase, body.user_id)
        : await doWeekly(supabase, body.user_id);
    return json(200, result);
  } catch (e: any) {
    return json(500, { error: e?.message ?? String(e) });
  }
});
