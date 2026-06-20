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

const COACH_SYSTEM = `You are APEX, an adaptive fitness coach built for body recomposition athletes. You are NOT a generic chatbot.

RULES:
- Always reference the user's ACTUAL data when available (workout logs, nutrition, mood, recovery scores)
- If you don't have data, say exactly what data you need and why
- Never give generic advice like 'eat more protein' without referencing their specific intake
- Be direct. First person. 2-3 sentences max.
- Format: [What to do] + [Why, using their data] + [One specific action]

EXAMPLES OF GOOD RESPONSES:
'Your bench went up 2kg last session and recovery is 72%. Push to 84kg today, 4x6. Your body can handle it.'
'You logged 140g protein yesterday but your target is 170g. Add a shake post-workout and Greek yogurt before bed. That closes the gap.'
'No workout data from the last 2 days. I can not coach without data. Log today's session and I will adjust your plan tonight.'

EXAMPLES OF BAD RESPONSES:
'Great question! Here are some tips for building muscle...' (generic)
'You should focus on progressive overload.' (obvious, not personalized)
'Consider eating more protein and sleeping better.' (vague)

If user asks something you don't have data for, say: 'I need [specific data] to answer that properly. Log it and ask me again.'`;

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
      model: "google/gemini-2.5-pro",
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
      model: "google/gemini-2.5-pro",
      max_tokens: 600,
      messages: [
        {
          role: "system",
          content:
            "You are APEX coach. Write ONE complete morning insight (2-3 full sentences) based on user data. Reference their actual numbers when present. Be specific, actionable, first person. Always finish your sentences — never trail off.",
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
      model: "google/gemini-2.5-flash-image",
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
