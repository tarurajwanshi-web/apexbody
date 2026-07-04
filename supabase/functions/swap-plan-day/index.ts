// swap-plan-day — user-triggered rest-day swap on their current weekly_plans row.
//
// Why an edge function: weekly_plans is system-computed. Client write
// policies were re-locked to service-role only. This function is the sole
// authorized path for the RestDaySwapCard "Train anyway" feature.
//
// Auth: user JWT bearer; authorizeCaller enforces auth.uid() === body.user_id.
// Input: { user_id, plan_id, source_day_index, target_day_index }.
// Effect: swaps two days in plan_data.days, marking the source as rest.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { authorizeCaller, corsAllowHeaders } from "../_shared/authorize.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": corsAllowHeaders,
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type Day = {
  day?: number;
  date?: string;
  day_name?: string;
  session_name?: string | null;
  session_purpose?: string | null;
  rest?: boolean;
  exercises?: unknown[];
  [k: string]: unknown;
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });

  const url = Deno.env.get("SUPABASE_URL")!;
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supa = createClient(url, key);

  try {
    const body = await req.json();
    const { user_id, plan_id, source_day_index, target_day_index } = body ?? {};

    if (
      typeof user_id !== "string" ||
      typeof plan_id !== "string" ||
      typeof source_day_index !== "number" ||
      typeof target_day_index !== "number"
    ) {
      return new Response(
        JSON.stringify({
          error: "user_id, plan_id, source_day_index, target_day_index required",
        }),
        { status: 400, headers: { ...cors, "Content-Type": "application/json" } },
      );
    }

    const authz = await authorizeCaller(req, supa, user_id);
    if (!authz.ok) {
      return new Response(JSON.stringify({ error: authz.error }), {
        status: authz.status,
        headers: { ...cors, "Content-Type": "application/json" },
      });
    }

    const { data: planRow, error: fetchErr } = await supa
      .from("weekly_plans")
      .select("id, user_id, plan_data")
      .eq("id", plan_id)
      .maybeSingle();

    if (fetchErr || !planRow) {
      return new Response(JSON.stringify({ error: "plan not found" }), {
        status: 404,
        headers: { ...cors, "Content-Type": "application/json" },
      });
    }
    if (planRow.user_id !== user_id) {
      return new Response(JSON.stringify({ error: "forbidden" }), {
        status: 403,
        headers: { ...cors, "Content-Type": "application/json" },
      });
    }

    const planData = (planRow.plan_data ?? {}) as { days?: Day[] } & Record<string, unknown>;
    const days: Day[] = Array.isArray(planData.days) ? [...planData.days] : [];

    if (
      source_day_index < 0 || source_day_index >= days.length ||
      target_day_index < 0 || target_day_index >= days.length ||
      source_day_index === target_day_index
    ) {
      return new Response(JSON.stringify({ error: "invalid day indices" }), {
        status: 400,
        headers: { ...cors, "Content-Type": "application/json" },
      });
    }

    const sourceDay = days[source_day_index];
    const targetDay = days[target_day_index];
    if (!sourceDay || sourceDay.rest || !(Array.isArray(sourceDay.exercises) && sourceDay.exercises.length > 0)) {
      return new Response(JSON.stringify({ error: "source day is not a training day" }), {
        status: 400,
        headers: { ...cors, "Content-Type": "application/json" },
      });
    }

    const { data: latestReadiness } = await supa
      .from("readiness_scores")
      .select("training_permission")
      .eq("user_id", user_id)
      .order("score_date", { ascending: false })
      .limit(1)
      .maybeSingle();
    const readinessWarning =
      (latestReadiness as { training_permission?: string | null } | null)?.training_permission === "red_recover"
        ? "red_recover"
        : null;

    // Same transform as the previous client-side logic.
    const newDays: Day[] = days.map((d, i) => {
      if (i === target_day_index) {
        return { ...sourceDay, day: targetDay.day, day_name: targetDay.day_name, rest: false };
      }
      if (i === source_day_index) {
        return { ...sourceDay, rest: true, session_name: null, exercises: [] };
      }
      return d;
    });

    const newPlanData = { ...planData, days: newDays };

    const { error: updateErr } = await supa
      .from("weekly_plans")
      .update({ plan_data: newPlanData })
      .eq("id", plan_id);

    if (updateErr) throw updateErr;

    return new Response(JSON.stringify({ ok: true, plan_data: newPlanData, readiness_warning: readinessWarning }), {
      headers: { ...cors, "Content-Type": "application/json" },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[swap-plan-day] error", msg);
    return new Response(JSON.stringify({ error: msg }), {
      status: 500,
      headers: { ...cors, "Content-Type": "application/json" },
    });
  }
});
