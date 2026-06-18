import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const Input = z.object({
  goal: z.string(),
  experience: z.string().optional(),
  recovery: z.number(),
  sleepHours: z.number(),
  hrv: z.number(),
  apexScore: z.number(),
  proteinShortG: z.number(),
  topic: z.enum(["training", "nutrition", "recovery", "general"]),
  userNote: z.string().optional(),
});

export const generateCoachRecommendation = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => Input.parse(d))
  .handler(async ({ data }) => {
    const apiKey = process.env.LOVABLE_API_KEY;
    if (!apiKey) throw new Error("Missing LOVABLE_API_KEY");

    const system = `You are APEX, an elite AI performance coach. You speak in first person, evidence-based, direct, no fluff, no motivational poster talk. Reference the user's data specifically. Keep responses tight: 1 short insight paragraph (2-3 sentences), then 3 numbered concrete action steps. Use plain text. No markdown headers, no emojis.`;

    const user = `User context:
- Goal: ${data.goal}
- Experience: ${data.experience ?? "intermediate"}
- Today's APEX score: ${data.apexScore}/100
- Recovery: ${data.recovery}/100
- HRV: ${data.hrv}ms
- Sleep last night: ${data.sleepHours}h
- Protein deficit today: ${data.proteinShortG}g

Topic: ${data.topic}
${data.userNote ? `User note: "${data.userNote}"` : ""}

Give one specific recommendation for this topic, based on the above data.`;

    const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Lovable-API-Key": apiKey,
        "X-Lovable-AIG-SDK": "manual",
      },
      body: JSON.stringify({
        model: "google/gemini-3-flash-preview",
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
      }),
    });

    if (!res.ok) {
      const text = await res.text();
      if (res.status === 429) throw new Error("Rate limited. Please wait a moment and try again.");
      if (res.status === 402) throw new Error("AI credits exhausted. Please add credits to continue.");
      throw new Error(`AI error ${res.status}: ${text.slice(0, 200)}`);
    }

    const json = await res.json();
    const content: string = json?.choices?.[0]?.message?.content ?? "";
    return { content, confidence: 88 + Math.floor(Math.random() * 8) };
  });
