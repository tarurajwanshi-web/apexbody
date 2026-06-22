import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { resolveUserTimezone, getLocalDateISO } from "@/lib/dates";

// All coach AI calls go DIRECTLY to api.anthropic.com using ANTHROPIC_API_KEY.
const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";

type AnthropicMessage = { role: "user" | "assistant"; content: unknown };

async function callAnthropic(opts: {
  model: string;
  max_tokens: number;
  system?: string;
  messages: AnthropicMessage[];
}): Promise<string> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("Missing ANTHROPIC_API_KEY");

  const res = await fetch(ANTHROPIC_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify(opts),
  });

  if (!res.ok) {
    const text = await res.text();
    if (res.status === 429) throw new Error("Rate limited. Please wait a moment and try again.");
    if (res.status === 402) throw new Error("AI credits exhausted. Please add credits to continue.");
    throw new Error(`AI error ${res.status}: ${text.slice(0, 200)}`);
  }

  const json = await res.json();
  return (json?.content?.[0]?.text as string) ?? "";
}

// Strip residual markdown the model might still emit despite the prompt.
function sanitize(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, "")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/^\s*[-*]\s+/gm, "")
    .replace(/—/g, "-")
    .replace(/–/g, "-")
    .trim();
}

const COACH_SYSTEM = `You are APEX, an adaptive coach for body recomposition athletes. Brand voice: confident, direct, a little assertive — like a knowledgeable friend texting back. "Confidence isn't given. It's calculated."

Formatting rules (strict):
- NO markdown at all. No #, no **bold**, no bullet dashes, no em-dashes (—). Plain hyphens only.
- 2 to 4 short sentences. No headers, no lists, no "Tips:" blocks.

Content rules:
- Always reference the user's ACTUAL data when available (logs, nutrition, recovery, mood).
- If you don't have the data you need, say which one piece is missing and why.
- Never generic platitudes ("eat more protein"). Always tie it to a number or behavior they did.
- Pattern: what to do, why (their data), one concrete next step.`;

// 1. askCoach — conversation (Haiku)
const AskInput = z.object({
  messages: z
    .array(z.object({ role: z.enum(["user", "assistant"]), content: z.string() }))
    .min(1),
  systemPrompt: z.string().optional(),
});

export const askCoach = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => AskInput.parse(d))
  .handler(async ({ data }) => {
    const raw = await callAnthropic({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 400,
      system: data.systemPrompt ?? COACH_SYSTEM,
      messages: data.messages,
    });
    return { content: sanitize(raw) };
  });

const INSIGHT_SYSTEM = `You are APEX coach. Write ONE morning insight as 2 to 3 short sentences.

Formatting rules (strict):
- NO markdown. No #, no **bold**, no bullets, no em-dashes (—). Plain hyphens only.
- Sound like a friend texting, not a corporate report. Confident, direct, a touch assertive.
- Reference the user's actual numbers when present. Always finish your sentences.`;

// 2. generateDailyInsight — raw generator (kept for backward compatibility)
const InsightInput = z.object({
  userData: z.record(z.string(), z.any()),
});

export const generateDailyInsight = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => InsightInput.parse(d))
  .handler(async ({ data }) => {
    const raw = await callAnthropic({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 300,
      system: INSIGHT_SYSTEM,
      messages: [{ role: "user", content: JSON.stringify(data.userData) }],
    });
    return { content: sanitize(raw) };
  });

// 2b. getOrCreateDailyInsight — cached: one insight per user per day.
// Reads from daily_ai_insights; only calls Claude when no row exists for today.
const CachedInsightInput = z.object({
  userData: z.record(z.string(), z.any()),
});

export const getOrCreateDailyInsight = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => CachedInsightInput.parse(d))
  .handler(async ({ data, context }) => {
    const tz = await resolveUserTimezone(context.supabase, context.userId);
    const today = getLocalDateISO(tz);
    const { data: existing } = await context.supabase
      .from("daily_ai_insights")
      .select("content")
      .eq("user_id", context.userId)
      .eq("insight_date", today)
      .maybeSingle();
    if (existing?.content) return { content: existing.content, cached: true };

    const raw = await callAnthropic({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 300,
      system: INSIGHT_SYSTEM,
      messages: [{ role: "user", content: JSON.stringify(data.userData) }],
    });
    const content = sanitize(raw);
    if (content) {
      await context.supabase
        .from("daily_ai_insights")
        .upsert(
          { user_id: context.userId, insight_date: today, content },
          { onConflict: "user_id,insight_date" },
        );
    }
    return { content, cached: false };
  });


// 3. analyzePhoto — vision (Sonnet for better visual reasoning)
const PhotoInput = z.object({
  base64Image: z.string().min(10), // raw base64 (no data: prefix) or data URL
  mediaType: z.string().default("image/jpeg"),
  prompt: z.string().min(1),
});

export const analyzePhoto = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => PhotoInput.parse(d))
  .handler(async ({ data }) => {
    // Strip data: prefix if present — Anthropic expects raw base64 + media_type.
    let b64 = data.base64Image;
    let mediaType = data.mediaType;
    if (b64.startsWith("data:")) {
      const m = b64.match(/^data:([^;]+);base64,(.+)$/);
      if (m) {
        mediaType = m[1];
        b64 = m[2];
      }
    }

    const content = await callAnthropic({
      model: "claude-sonnet-4-6",
      max_tokens: 500,
      messages: [
        {
          role: "user",
          content: [
            { type: "image", source: { type: "base64", media_type: mediaType, data: b64 } },
            { type: "text", text: data.prompt },
          ],
        },
      ],
    });
    return { content };
  });
