// APEX detect-prs — deterministic PR detection.
// Called from the client after a completed set upsert. Loads full history
// for (user, exercise_name), computes prior bests, flags today's sets, and
// writes strictly-better rows into personal_records (service-role only).
//
// Epley (1985): est1rm = weight * (1 + reps / 30). Skipped when reps > 12
// (formula drifts at higher reps; other PR types still eligible).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { authorizeCaller, corsAllowHeaders } from "../_shared/authorize.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": corsAllowHeaders,
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type PrType = "max_weight" | "max_est_1rm" | "max_reps_at_weight" | "max_volume";
const PRIORITY: PrType[] = ["max_est_1rm", "max_weight", "max_volume", "max_reps_at_weight"];

type SetRow = {
  id: string;
  entry_date: string;
  weight_kg: number;
  reps_completed: number;
  set_number: number;
};

function epley(weight: number, reps: number): number {
  return weight * (1 + reps / 30);
}

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "content-type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json(405, { error: "method not allowed" });

  let body: { user_id?: string; entry_date?: string; exercise_name?: string };
  try { body = await req.json(); } catch { return json(400, { error: "invalid json" }); }
  const { user_id, entry_date, exercise_name } = body;
  if (!user_id || !entry_date || !exercise_name) {
    return json(400, { error: "user_id, entry_date, exercise_name required" });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const authz = await authorizeCaller(req, supabase, user_id);
  if (!authz.ok) return json(authz.status, { error: authz.error });

  // 1) Load full completed working-set history for (user, exercise).
  const { data: allSets, error: loadErr } = await supabase
    .from("workout_set_logs")
    .select("id, entry_date, weight_kg, reps_completed, set_number")
    .eq("user_id", user_id)
    .eq("exercise_name", exercise_name)
    .eq("completed", true)
    .neq("set_type", "warmup")
    .not("weight_kg", "is", null)
    .not("reps_completed", "is", null)
    .gt("reps_completed", 0);

  if (loadErr) return json(500, { error: `load failed: ${loadErr.message}` });

  const rows: SetRow[] = ((allSets ?? []) as any[])
    .map((r) => ({
      id: r.id as string,
      entry_date: r.entry_date as string,
      weight_kg: Number(r.weight_kg),
      reps_completed: Number(r.reps_completed),
      set_number: Number(r.set_number ?? 0),
    }))
    .filter((r) => Number.isFinite(r.weight_kg) && r.weight_kg > 0 && r.reps_completed > 0);

  const today = rows
    .filter((r) => r.entry_date === entry_date)
    .sort((a, b) => a.set_number - b.set_number);
  const history = rows.filter((r) => r.entry_date < entry_date);

  // 2) Always wipe today's is_pr/pr_type first — idempotent recompute.
  const { error: wipeErr } = await supabase
    .from("workout_set_logs")
    .update({ is_pr: false, pr_type: null })
    .eq("user_id", user_id)
    .eq("exercise_name", exercise_name)
    .eq("entry_date", entry_date);
  if (wipeErr) return json(500, { error: `wipe failed: ${wipeErr.message}` });

  // First-ever entry: no baseline, no PRs.
  if (history.length === 0 || today.length === 0) return json(200, { prs: [] });

  // 3) Prior bests from history only.
  let bestWeight = 0;
  let bestEst1rm = 0;
  let bestVolume = 0;
  const bestRepsAtWeight = new Map<number, number>();
  for (const r of history) {
    if (r.weight_kg > bestWeight) bestWeight = r.weight_kg;
    if (r.reps_completed <= 12) {
      const e = epley(r.weight_kg, r.reps_completed);
      if (e > bestEst1rm) bestEst1rm = e;
    }
    const vol = r.weight_kg * r.reps_completed;
    if (vol > bestVolume) bestVolume = vol;
    const prev = bestRepsAtWeight.get(r.weight_kg) ?? 0;
    if (r.reps_completed > prev) bestRepsAtWeight.set(r.weight_kg, r.reps_completed);
  }

  // 4) Iterate today's sets in order; running bests update per-set so a
  // repeat of the same weight later in the session doesn't double-flag.
  type Detected = { pr_type: PrType; value: number; set: SetRow };
  const detected: Detected[] = [];
  const setTopType = new Map<string, PrType>();

  for (const s of today) {
    const est = epley(s.weight_kg, s.reps_completed);
    const vol = s.weight_kg * s.reps_completed;
    const priorReps = bestRepsAtWeight.get(s.weight_kg) ?? 0;
    const hits: Detected[] = [];

    if (s.weight_kg > bestWeight) {
      hits.push({ pr_type: "max_weight", value: s.weight_kg, set: s });
    }
    if (s.reps_completed <= 12 && est > bestEst1rm) {
      hits.push({ pr_type: "max_est_1rm", value: Math.round(est * 10) / 10, set: s });
    }
    if (s.reps_completed > priorReps) {
      hits.push({ pr_type: "max_reps_at_weight", value: s.reps_completed, set: s });
    }
    if (vol > bestVolume) {
      hits.push({ pr_type: "max_volume", value: vol, set: s });
    }

    if (hits.length > 0) {
      // Update running bests so subsequent same-day sets don't re-trigger.
      if (s.weight_kg > bestWeight) bestWeight = s.weight_kg;
      if (s.reps_completed <= 12 && est > bestEst1rm) bestEst1rm = est;
      if (vol > bestVolume) bestVolume = vol;
      if (s.reps_completed > priorReps) bestRepsAtWeight.set(s.weight_kg, s.reps_completed);

      const top = PRIORITY.find((p) => hits.some((h) => h.pr_type === p))!;
      setTopType.set(s.id, top);
      detected.push(...hits);
    }
  }

  // 5) Flip is_pr / pr_type on the triggering sets.
  const flips = [...setTopType.entries()];
  for (const [setId, top] of flips) {
    const { error: flipErr } = await supabase
      .from("workout_set_logs")
      .update({ is_pr: true, pr_type: top })
      .eq("id", setId);
    if (flipErr) return json(500, { error: `flag failed: ${flipErr.message}` });
  }

  // 6) De-dupe against all-time best in personal_records (authoritative
  // ledger). Write only strictly-better rows.
  const inserted: Array<{ pr_type: PrType; value: number; exercise_name: string }> = [];
  for (const d of detected) {
    const { data: best } = await supabase
      .from("personal_records")
      .select("value")
      .eq("user_id", user_id)
      .eq("exercise_name", exercise_name)
      .eq("pr_type", d.pr_type)
      .order("value", { ascending: false })
      .limit(1)
      .maybeSingle();
    const prevBest = (best as any)?.value != null ? Number((best as any).value) : null;
    if (prevBest != null && d.value <= prevBest) continue;

    const { error: insErr } = await supabase.from("personal_records").insert({
      user_id,
      exercise_name,
      pr_type: d.pr_type,
      value: d.value,
      reps: d.set.reps_completed,
      weight_kg: d.set.weight_kg,
      achieved_date: entry_date,
      set_log_id: d.set.id,
    });
    if (insErr) {
      console.warn("[detect-prs] insert failed", insErr.message);
      continue;
    }
    inserted.push({ pr_type: d.pr_type, value: d.value, exercise_name });
  }

  return json(200, { prs: inserted });
});
