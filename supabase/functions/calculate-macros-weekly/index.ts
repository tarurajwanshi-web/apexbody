// calculate-macros-weekly — Adaptive Macro Engine (Module 5) — HTTP shell.
//
// Runs once per week (Mon 13:00 UTC via pg_cron) as a safety net. For each
// active profile, defers all calculation work to the shared
// `calculateMacrosForUser` engine so the same logic is reusable from the
// single-user HTTP trigger (`trigger-weekly-macro-review`).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { requireInternalSecret, corsAllowHeaders } from "../_shared/authorize.ts";
import {
  calculateMacrosForUser,
  type Profile,
} from "../_shared/macro-calculation.ts";
import { userLocalDayOfWeek, DEFAULT_TIMEZONE } from "../_shared/time-helpers.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": corsAllowHeaders,
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type ProcessResult = {
  user_id: string;
  status: "hold" | "adjusted" | "skipped" | "error";
  decision?: string;
  error?: string;
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });

  const url = Deno.env.get("SUPABASE_URL")!;
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supa = createClient(url, key);

  // Optional body params for manual ops re-runs (cron sends empty body).
  let body: { user_id?: string; force_recalculate?: boolean } = {};
  try { body = await req.json(); } catch { /* empty body OK for cron */ }
  const force = body.force_recalculate === true;

  // Internal-only (DB cron / dispatch). No JWT fallback.
  const authz = await requireInternalSecret(req, supa);
  if (!authz.ok) {
    return new Response(JSON.stringify({ error: authz.error }), {
      status: authz.status,
      headers: { ...cors, "Content-Type": "application/json" },
    });
  }

  // Fetch active profiles (onboarding-complete).
  const select =
    "user_id, timezone, goal, biological_sex, age, measurement_height_cm, measurement_weight_kg, body_data_type, dexa_lean_mass_kg, user_marked_abnormal_week_start, target_weight_kg, target_rate_pct, reached_target_at, target_kcal_delta";

  let profiles: Profile[] = [];
  try {
    const query = body.user_id
      ? supa.from("profiles").select(select).eq("user_id", body.user_id)
      : supa.from("profiles").select(select).not("profile_completed_at", "is", null);
    const { data, error } = await query;
    if (error) throw error;
    profiles = (data ?? []) as Profile[];
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[calculate-macros-weekly] profile fetch failed", msg);
    return new Response(
      JSON.stringify({ error: "Failed to fetch profiles", details: msg }),
      { status: 500, headers: { ...cors, "Content-Type": "application/json" } },
    );
  }

  // Process each user sequentially to avoid overwhelming the database.
  const results: ProcessResult[] = [];
  for (const profile of profiles) {
    try {
      const tz = profile.timezone || DEFAULT_TIMEZONE;
      if (!force && userLocalDayOfWeek(tz) !== 1) {
        results.push({ user_id: profile.user_id, status: "skipped", decision: "not_local_monday" });
        continue;
      }
      const result = await calculateMacrosForUser(
        profile.user_id,
        profile,
        supa,
        new Date(),
        { force },
      );
      results.push({
        user_id: profile.user_id,
        status: result.status,
        decision: result.decision,
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.startsWith("review_exists:")) {
        results.push({ user_id: profile.user_id, status: "skipped" });
      } else {
        console.error(`[calculate-macros-weekly] user ${profile.user_id} failed`, msg);
        results.push({ user_id: profile.user_id, status: "error", error: msg });
      }
    }
  }

  const summary = {
    timestamp: new Date().toISOString(),
    total_users: profiles.length,
    processed: results.length,
    adjusted: results.filter((r) => r.status === "adjusted").length,
    held: results.filter((r) => r.status === "hold").length,
    skipped: results.filter((r) => r.status === "skipped").length,
    errors: results.filter((r) => r.status === "error").length,
    results,
  };

  console.log("[calculate-macros-weekly] summary", summary);

  return new Response(JSON.stringify(summary), {
    status: 200,
    headers: { ...cors, "Content-Type": "application/json" },
  });
});
