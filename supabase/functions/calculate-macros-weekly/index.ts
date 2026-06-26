// calculate-macros-weekly — Adaptive Macro Engine (Module 5) — HTTP shell.
//
// Runs once per week (Mon 13:00 UTC via pg_cron). For each profile, defers
// all calculation work to the shared `calculateMacrosForUser` engine so the
// same logic is reusable from the single-user HTTP trigger.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { requireInternalSecret, corsAllowHeaders } from "../_shared/authorize.ts";
import {
  calculateMacrosForUser,
  type CalculationResult,
  type Profile,
} from "../_shared/macro-calculation.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": corsAllowHeaders,
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });

  const url = Deno.env.get("SUPABASE_URL")!;
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supa = createClient(url, key);

  let body: { user_id?: string; force_recalculate?: boolean } = {};
  try { body = await req.json(); } catch { /* empty body OK for cron */ }
  const force = body.force_recalculate === true;

  // Internal-only (DB cron / dispatch). No JWT fallback.
  const authz = await requireInternalSecret(req, supa);
  if (!authz.ok) {
    return new Response(JSON.stringify({ error: authz.error }), {
      status: authz.status, headers: { ...cors, "Content-Type": "application/json" },
    });
  }

  let profiles: Profile[];
  try {
    const select = "user_id, timezone, goal, biological_sex, age, measurement_height_cm, measurement_weight_kg, body_data_type, dexa_lean_mass_kg, user_marked_abnormal_week_start";
    if (body.user_id) {
      const { data, error } = await supa.from("profiles").select(select).eq("user_id", body.user_id);
      if (error) throw error;
      profiles = (data ?? []) as Profile[];
    } else {
      const { data, error } = await supa.from("profiles").select(select).not("profile_completed_at", "is", null);
      if (error) throw error;
      profiles = (data ?? []) as Profile[];
    }
  } catch (e) {
    return new Response(
      JSON.stringify({ ok: false, error: String(e instanceof Error ? e.message : e) }),
      { status: 500, headers: { ...cors, "Content-Type": "application/json" } },
    );
  }

  const results: CalculationResult[] = [];
  for (const p of profiles) {
    try {
      results.push(await calculateMacrosForUser(p.user_id, p, supa, new Date(), { force }));
    } catch (e) {
      const msg = String(e instanceof Error ? e.message : e);
      if (msg.startsWith("review_exists:")) {
        results.push({ user_id: p.user_id, status: "skipped" });
      } else {
        results.push({ user_id: p.user_id, status: "error", error: msg });
      }
    }
  }

  return new Response(
    JSON.stringify({
      ok: true,
      processed: results.length,
      summary: results.reduce<Record<string, number>>((acc, r) => {
        acc[r.status] = (acc[r.status] ?? 0) + 1;
        return acc;
      }, {}),
      results,
    }),
    { headers: { ...cors, "Content-Type": "application/json" } },
  );
});
