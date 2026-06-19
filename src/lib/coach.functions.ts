import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const GATEWAY_URL = "https://ai.gateway.lovable.dev/v1/chat/completions";

async function callGateway(body: Record<string, unknown>) {
  const apiKey = process.env.LOVABLE_API_KEY;
  if (!apiKey) throw new Error("Missing LOVABLE_API_KEY");

  const res = await fetch(GATEWAY_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Lovable-API-Key": apiKey,
      "X-Lovable-AIG-SDK": "manual",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text();
    if (res.status === 429) throw new Error("Rate limited. Please wait a moment and try again.");
    if (res.status === 402) throw new Error("AI credits exhausted. Please add credits to continue.");
    throw new Error(`AI error ${res.status}: ${text.slice(0, 200)}`);
  }

  const json = await res.json();
  return (json?.choices?.[0]?.message?.content as string) ?? "";
}

const COACH_SYSTEM =
  "You are APEX, an adaptive fitness coach. Analyze user data and provide personalized coaching. Be direct, data-driven, first person. No fluff. 1-3 sentences max.";

// 1. askCoach — conversation
const AskInput = z.object({
  messages: z
    .array(z.object({ role: z.enum(["user", "assistant"]), content: z.string() }))
    .min(1),
  systemPrompt: z.string().optional(),
});

export const askCoach = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => AskInput.parse(d))
  .handler(async ({ data }) => {
    const content = await callGateway({
      model: "anthropic/claude-haiku-4-5",
      max_tokens: 300,
      messages: [
        { role: "system", content: data.systemPrompt ?? COACH_SYSTEM },
        ...data.messages,
      ],
    });
    return { content };
  });

// 2. generateDailyInsight — morning insight
const InsightInput = z.object({
  userData: z.record(z.string(), z.any()),
});

export const generateDailyInsight = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => InsightInput.parse(d))
  .handler(async ({ data }) => {
    const content = await callGateway({
      model: "anthropic/claude-haiku-4-5",
      max_tokens: 200,
      messages: [
        {
          role: "system",
          content:
            "You are APEX coach. Generate ONE morning insight based on user data. Reference their actual numbers. Be specific, actionable, first person. 2 sentences max.",
        },
        { role: "user", content: JSON.stringify(data.userData) },
      ],
    });
    return { content };
  });

// 3. analyzePhoto — vision
const PhotoInput = z.object({
  base64Image: z.string().min(10), // raw base64 (no data: prefix) or full data URL
  mediaType: z.string().default("image/jpeg"),
  prompt: z.string().min(1),
});

export const analyzePhoto = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => PhotoInput.parse(d))
  .handler(async ({ data }) => {
    const url = data.base64Image.startsWith("data:")
      ? data.base64Image
      : `data:${data.mediaType};base64,${data.base64Image}`;

    const content = await callGateway({
      model: "anthropic/claude-sonnet-4-5",
      max_tokens: 500,
      messages: [
        {
          role: "user",
          content: [
            { type: "image_url", image_url: { url } },
            { type: "text", text: data.prompt },
          ],
        },
      ],
    });
    return { content };
  });
