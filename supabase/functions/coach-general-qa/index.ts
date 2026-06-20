// supabase/functions/coach-general-qa/index.ts
// General fitness/nutrition Q&A for the locked period (pre plan_unlock_date).
// IMPORTANT: receives NO personal user data, profile, or plan context.
// Routes directly to Anthropic Claude Haiku.

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SYSTEM_PROMPT = `You are APEX's general fitness assistant. You provide evidence-based, general guidance on training, nutrition, recovery, and sleep.

You do NOT have access to this user's profile, training plan, logs, or personal metrics — personalized coaching is locked until their plan unlocks.

Rules:
- Answer general fitness/nutrition/recovery questions in a friendly, knowledgeable tone.
- Keep answers concise (2-4 sentences) unless the user explicitly asks for detail.
- Cite well-established principles (e.g. progressive overload, protein 1.6–2.2 g/kg, RPE, sleep hygiene).
- If a question requires personal context (e.g. "what weight should I bench today?"), say it needs personalized data and will be available once their plan unlocks — then offer general guidance on the topic.
- Do not give medical advice. For injuries, pain, or medical conditions, recommend seeing a qualified professional.
- Never pretend to know the user's stats, plan, or history.`;

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
