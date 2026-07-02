// trigger-weekly-macro-review — JWT-gated client trigger.
//
// Called from the Fuel page on Monday morning (user-local) so the weekly
// review is computed immediately instead of waiting for the Monday 13:00 UTC
// cron safety net. Delegates all calculation to the shared engine.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { authorizeCaller, corsAllowHeaders } from "../_shared/authorize.ts";
import {
  calculateMacrosForUser,
  type Profile,
} from "../_shared/macro-calculation.ts";
import { userLocalMonday, userLocalDayOfWeek, DEFAULT_TIMEZONE } from "../_shared/time-helpers.ts";

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

  // JWT-only: authorizeCaller's JWT branch returns userId; reject internal-secret path.
  const authz = await authorizeCaller(req, supa);
  if (!authz.ok) {
    return new Response(JSON.stringify({ error: authz.error }), {
      status: authz.status,
      headers: { ...cors, "Content-Type": "application/json" },
    });
  }
  if (!authz.userId) {
    return new Response(JSON.stringify({ error: "unauthorized: bearer token required" }), {
      status: 401,
      headers: { ...cors, "Content-Type": "application/json" },
    });
  }
  const user_id = authz.userId;

  // Fetch profile.
  const select =
    "user_id, timezone, goal, biological_sex, age, measurement_height_cm, measurement_weight_kg, body_data_type, dexa_lean_mass_kg, user_marked_abnormal_week_start";
  const { data: profile, error: profileError } = await supa
    .from("profiles")
    .select(select)
    .eq("user_id", user_id)
    .single();

  if (profileError || !profile) {
    console.error("[trigger-weekly-macro-review] profile fetch failed", profileError);
    return new Response(JSON.stringify({ error: "Profile not found" }), {
      status: 404,
      headers: { ...cors, "Content-Type": "application/json" },
    });
  }

  const tz = (profile as Profile).timezone || DEFAULT_TIMEZONE;
  const now = new Date();

  // Gate: must be Monday in user's local timezone.
  const dow = userLocalDayOfWeek(tz, now);
  if (dow !== 1) {
    console.log(`[trigger-weekly-macro-review] user ${user_id} not Monday (dow=${dow}, tz=${tz})`);
    return new Response(JSON.stringify({ status: "not_monday" }), {
      status: 200,
      headers: { ...cors, "Content-Type": "application/json" },
    });
  }

  const weekStart = userLocalMonday(tz, now);

  // Idempotency: already computed for this week?
  const { data: existing, error: checkError } = await supa
    .from("nutrition_weekly_reviews")
    .select("id, decision, applied_target_id")
    .eq("user_id", user_id)
    .eq("week_start_date", weekStart)
    .maybeSingle();

  if (checkError) {
    console.error("[trigger-weekly-macro-review] existing review check failed", checkError);
    return new Response(JSON.stringify({ error: checkError.message }), {
      status: 500,
      headers: { ...cors, "Content-Type": "application/json" },
    });
  }

  if (existing) {
    console.log(`[trigger-weekly-macro-review] user ${user_id} already computed for ${weekStart}`);
    return new Response(
      JSON.stringify({
        status: "already_computed",
        review_id: existing.id,
        decision: existing.decision,
        applied_target_id: existing.applied_target_id,
      }),
      { status: 200, headers: { ...cors, "Content-Type": "application/json" } },
    );
  }

  // Compute synchronously via the shared engine.
  try {
    console.log(`[trigger-weekly-macro-review] computing for user ${user_id}`);
    const result = await calculateMacrosForUser(user_id, profile as Profile, supa, now);

    const response = {
      status: "computed",
      user_id,
      decision: result.decision,
      applied_target_id: result.applied_target_id ?? null,
    };
    console.log("[trigger-weekly-macro-review] success", response);
    return new Response(JSON.stringify(response), {
      status: 200,
      headers: { ...cors, "Content-Type": "application/json" },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);

    // Race: another caller (cron or parallel tab) inserted the review between
    // our check and our compute. Re-read and return already_computed.
    if (msg.startsWith("review_exists:")) {
      const { data: race } = await supa
        .from("nutrition_weekly_reviews")
        .select("id, decision, applied_target_id")
        .eq("user_id", user_id)
        .eq("week_start_date", weekStart)
        .maybeSingle();
      if (race) {
        return new Response(
          JSON.stringify({
            status: "already_computed",
            review_id: race.id,
            decision: race.decision,
            applied_target_id: race.applied_target_id,
          }),
          { status: 200, headers: { ...cors, "Content-Type": "application/json" } },
        );
      }
    }

    console.error(`[trigger-weekly-macro-review] failed for user ${user_id}`, msg);
    return new Response(JSON.stringify({ error: msg }), {
      status: 500,
      headers: { ...cors, "Content-Type": "application/json" },
    });
  }
});
