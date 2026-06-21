// backfill-cues — adds beginner execution cues to existing weekly_plans
// rows that were generated before the cue feature shipped.
// Input: { user_id }. Updates the user's latest weekly_plan in place.
// Does NOT regenerate sets/reps/exercise structure — only adds cue strings.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function stripFences(t: string) {
  let s = t.trim();
  if (s.startsWith("```")) s = s.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "");
  return s.trim();
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });

  try {
    const url = Deno.env.get("SUPABASE_URL")!;
    const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const anth = Deno.env.get("ANTHROPIC_API_KEY");
    if (!anth) {
      return new Response(JSON.stringify({ error: "ANTHROPIC_API_KEY missing" }), {
        status: 500, headers: { ...cors, "Content-Type": "application/json" },
      });
    }
    const supa = createClient(url, key);

    const { user_id, force } = await req.json();
    if (!user_id) {
      return new Response(JSON.stringify({ error: "user_id required" }), {
        status: 400, headers: { ...cors, "Content-Type": "application/json" },
      });
    }

    const { data: planRow, error: fErr } = await supa
      .from("weekly_plans")
      .select("id, plan_data")
      .eq("user_id", user_id)
      .order("week_start_date", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (fErr || !planRow) {
      return new Response(JSON.stringify({ error: "no plan found" }), {
        status: 404, headers: { ...cors, "Content-Type": "application/json" },
      });
    }

    const plan = planRow.plan_data as any;
    const days = Array.isArray(plan?.days) ? plan.days : [];
    // cue_version 2 = sharp single-correction cues (D+E). Force regen older plans.
    const currentVer = Number(plan?.cue_version ?? 1);
    const needsUpgrade = force === true || currentVer < 2;
    const names = new Set<string>();
    for (const d of days) {
      if (d?.rest) continue;
      for (const ex of d.exercises ?? []) {
        if (needsUpgrade || !ex?.cue || !String(ex.cue).trim()) names.add(ex.name);
      }
    }
    if (names.size === 0) {
      return new Response(JSON.stringify({ ok: true, updated: 0 }), {
        headers: { ...cors, "Content-Type": "application/json" },
      });
    }

    const list = Array.from(names);
    const prompt =
      `For each exercise below, write ONE sharp coaching cue — the single correction an experienced strength coach would shout mid-set to fix that exercise's most common failure point. ` +
      `Not a description of correct form. Not a checklist. A real spoken correction. ` +
      `One sentence, max ~18 words, second person, plain English. Lead with the action, not the body part. ` +
      `Examples of the bar: ` +
      `"Send your hips back first — if your knees lead, you'll lose your chest." ` +
      `"Pull the bar into you, don't reach for it — lats stay tight the whole way." ` +
      `"Squeeze your glutes at the top before you even think about lowering." ` +
      `Respond with ONLY a single JSON object mapping the exact exercise name → cue string. No prose, no fences.\n\n` +
      JSON.stringify(list);

    const aRes = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": anth,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 2000,
        system:
          "You are a veteran strength coach giving real, in-the-room corrections. " +
          "For each exercise, return the ONE cue that fixes its single most common failure point — " +
          "what you'd shout mid-set, not a textbook description of form. " +
          "Respond with ONLY a single JSON object mapping the exact exercise name to a single short cue.",
        messages: [{ role: "user", content: prompt }],
      }),
    });

    if (!aRes.ok) {
      return new Response(JSON.stringify({ error: `Anthropic ${aRes.status}: ${(await aRes.text()).slice(0, 200)}` }), {
        status: 502, headers: { ...cors, "Content-Type": "application/json" },
      });
    }
    const aJson = await aRes.json();
    const text = aJson?.content?.[0]?.text ?? "";
    let cueMap: Record<string, string> = {};
    try { cueMap = JSON.parse(stripFences(text)); } catch {
      return new Response(JSON.stringify({ error: "bad cue JSON", raw: text.slice(0, 200) }), {
        status: 502, headers: { ...cors, "Content-Type": "application/json" },
      });
    }

    let updated = 0;
    for (const d of days) {
      if (d?.rest) continue;
      for (const ex of d.exercises ?? []) {
        const shouldUpdate = needsUpgrade || !ex.cue || !String(ex.cue).trim();
        if (shouldUpdate && typeof cueMap[ex.name] === "string") {
          ex.cue = cueMap[ex.name];
          updated++;
        }
      }
    }
    plan.cue_version = 2;

    const { error: upErr } = await supa
      .from("weekly_plans")
      .update({ plan_data: plan })
      .eq("id", planRow.id);
    if (upErr) throw upErr;

    return new Response(JSON.stringify({ ok: true, updated }), {
      headers: { ...cors, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e instanceof Error ? e.message : e) }), {
      status: 500, headers: { ...cors, "Content-Type": "application/json" },
    });
  }
});
