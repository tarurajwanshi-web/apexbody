// supabase/functions/coach-general-qa/index.ts
// General fitness/nutrition Q&A for the locked period (pre plan_unlock_date).
// IMPORTANT: receives NO personal user data, profile, or plan context.
// Routes directly to Anthropic Claude Haiku.

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

import { buildApexSystemPrompt } from "../_shared/apex-voice.ts";

const APEX_BASE = buildApexSystemPrompt({});

const SYSTEM_PROMPT = `${APEX_BASE}

LOCKED-PERIOD OVERRIDE (this Edge Function only):
- You do NOT have access to this user's profile, plan, or logs. Personalized coaching is locked until their plan unlocks.
- You do not know their name, numbers, training history, or readiness — do not invent or pretend to.
- Skip the first-name acknowledgement; open directly. If a question needs personal data, say so briefly in one line, then give the general principle.
- Stick to well-established principles (progressive overload, 1.6 to 2.2 g/kg protein, RPE/RIR, sleep hygiene).
- Keep it tight: 2 to 4 short sentences, plain text, no markdown, no emoji, no em-dashes.
- Never give medical advice. For pain or injury, point them to a qualified professional.`;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });

  try {
    const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
    if (!apiKey) {
      return new Response(JSON.stringify({ error: "Missing ANTHROPIC_API_KEY" }), {
        status: 500, headers: { ...CORS, "Content-Type": "application/json" },
      });
    }

    const body = await req.json();
    const messages = Array.isArray(body?.messages) ? body.messages : [];
    if (messages.length === 0) {
      return new Response(JSON.stringify({ error: "messages required" }), {
        status: 400, headers: { ...CORS, "Content-Type": "application/json" },
      });
    }

    // Strip anything that isn't role+content to prevent personal data leakage.
    const safeMessages = messages
      .filter((m: any) => m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string")
      .map((m: any) => ({ role: m.role, content: m.content }));

    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 500,
        system: SYSTEM_PROMPT,
        messages: safeMessages,
      }),
    });

    if (!res.ok) {
      const text = await res.text();
      const status = res.status;
      const msg =
        status === 429 ? "Rate limited. Please wait a moment and try again." :
        status === 402 ? "AI credits exhausted. Please add credits." :
        `AI error ${status}: ${text.slice(0, 200)}`;
      return new Response(JSON.stringify({ error: msg }), {
        status, headers: { ...CORS, "Content-Type": "application/json" },
      });
    }

    const json = await res.json();
    const content = json?.content?.[0]?.text ?? "";
    return new Response(JSON.stringify({ content }), {
      headers: { ...CORS, "Content-Type": "application/json" },
    });
  } catch (e: any) {
    return new Response(JSON.stringify({ error: e?.message ?? "Unknown error" }), {
      status: 500, headers: { ...CORS, "Content-Type": "application/json" },
    });
  }
});
