import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

// All three coach AI calls go DIRECTLY to api.anthropic.com using
// ANTHROPIC_API_KEY — same pattern as score-nutrition and coach-general-qa
// edge functions. No Lovable AI Gateway in the path.
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

const COACH_SYSTEM = `You are APEX, an adaptive fitness coach built for body recomposition athletes. You are NOT a generic chatbot.

RULES:
- Always reference the user's ACTUAL data when available (workout logs, nutrition, mood, recovery scores)
- If you don't have data, say exactly what data you need and why
- Never give generic advice like 'eat more protein' without referencing their specific intake
- Be direct. First person. 2-3 sentences max.
- Format: [What to do] + [Why, using their data] + [One specific action]`;

// 1. askCoach — conversation (Haiku: fast, low-cost chat)
const AskInput = z.object({
  messages: z
    .array(z.object({ role: z.enum(["user", "assistant"]), content: z.string() }))
    .min(1),
  systemPrompt: z.string().optional(),
});

export const askCoach = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => AskInput.parse(d))
  .handler(async ({ data }) => {
    const content = await callAnthropic({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 400,
      system: data.systemPrompt ?? COACH_SYSTEM,
      messages: data.messages,
    });
    return { content };
  });

// 2. generateDailyInsight — morning insight (Haiku)
const InsightInput = z.object({
  userData: z.record(z.string(), z.any()),
});

export const generateDailyInsight = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => InsightInput.parse(d))
  .handler(async ({ data }) => {
    const content = await callAnthropic({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 600,
      system:
        "You are APEX coach. Write ONE complete morning insight (2-3 full sentences) based on user data. Reference their actual numbers when present. Be specific, actionable, first person. Always finish your sentences — never trail off.",
      messages: [{ role: "user", content: JSON.stringify(data.userData) }],
    });
    return { content };
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
