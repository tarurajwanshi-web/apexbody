// generate-plan — Claude-powered weekly workout plan.
// Input: { user_id }. Writes a row into public.weekly_plans.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { authorizeCaller, corsAllowHeaders } from "../_shared/authorize.ts";

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
        "Schema: { \"days\": [ { \"day\": 1-7, \"day_name\": \"Monday\"...\"Sunday\", \"session_name\": string|null, \"rest\": boolean, \"exercises\": [ { \"name\": string, \"sets\": int, \"reps\": string, \"rest_seconds\": int, \"cue\": string } ] } ] }. " +
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
      .select("goal, training_days_per_week, equipment_access")
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

    const prompt =
      `Build a 7-day workout plan.\n` +
      `Goal: ${goal}. Training days per week: ${days}. Equipment: ${equip}.\n` +
      `Programming rule: ${goalRule}\n` +
      `Equipment rule: ${equipRule}\n` +
      `Exactly ${days} training days with named sessions (e.g. Push/Pull/Legs, Upper/Lower, or Full Body depending on frequency), ` +
      `each with 4-6 exercises (name, sets, reps, rest_seconds). The remaining ${7 - days} days are rest. ` +
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

    return new Response(JSON.stringify({ ok: true, week_start_date, unlock_date, plan }), {
      headers: { ...cors, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e instanceof Error ? e.message : e) }), {
      status: 500, headers: { ...cors, "Content-Type": "application/json" },
    });
  }
});
