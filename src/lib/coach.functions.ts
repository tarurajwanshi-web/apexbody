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

// =============== Coach dashboard data fns ===============
import { addDaysISO, getLocalWeekRange } from "@/lib/dates";

type SetRow = {
  exercise_name: string | null;
  entry_date: string;
  weight_kg: number | null;
  reps_completed: number | null;
  rir: number | null;
  muscle_group: string | null;
};

function isoWeekKey(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(Date.UTC(y, (m ?? 1) - 1, d ?? 1));
  const dayNum = dt.getUTCDay() || 7;
  dt.setUTCDate(dt.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(dt.getUTCFullYear(), 0, 1));
  const week = Math.ceil((((dt.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
  return `${dt.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

export const getExerciseHistory = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const tz = await resolveUserTimezone(context.supabase, context.userId);
    const today = getLocalDateISO(tz);
    const start = addDaysISO(today, -30);

    const { data: rows } = await context.supabase
      .from("workout_set_logs")
      .select("exercise_name, entry_date, weight_kg, reps_completed, rir, muscle_group")
      .eq("user_id", context.userId)
      .eq("completed", true)
      .gte("entry_date", start)
      .lte("entry_date", today);

    const all: SetRow[] = (rows as SetRow[] | null) ?? [];

    // Top 5 by set count
    const counts = new Map<string, number>();
    for (const r of all) {
      if (!r.exercise_name) continue;
      counts.set(r.exercise_name, (counts.get(r.exercise_name) ?? 0) + 1);
    }
    const topNames = [...counts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([n]) => n);

    // 4 ISO weeks ending this week
    const weekKeys: string[] = [];
    for (let i = 3; i >= 0; i--) weekKeys.push(isoWeekKey(addDaysISO(today, -7 * i)));

    const exercises = topNames.map((name) => {
      const sets = all.filter((r) => r.exercise_name === name);

      // Group by date — pick top set per date
      const byDate = new Map<string, SetRow>();
      for (const s of sets) {
        const score = (s.weight_kg ?? 0) * (s.reps_completed ?? 0);
        const cur = byDate.get(s.entry_date);
        const curScore = cur ? (cur.weight_kg ?? 0) * (cur.reps_completed ?? 0) : -1;
        if (!cur || score > curScore) byDate.set(s.entry_date, s);
      }
      const lastFiveSessions = [...byDate.entries()]
        .sort((a, b) => (a[0] < b[0] ? 1 : -1))
        .slice(0, 5)
        .map(([date, s]) => ({
          date,
          weight: Number(s.weight_kg ?? 0),
          reps: Number(s.reps_completed ?? 0),
          rir: s.rir == null ? null : Number(s.rir),
        }));

      // Best set this month
      let bestSet: { weight: number; reps: number; date: string } | null = null;
      let bestScore = -1;
      for (const s of sets) {
        const score = (s.weight_kg ?? 0) * (s.reps_completed ?? 0);
        if (score > bestScore) {
          bestScore = score;
          bestSet = {
            weight: Number(s.weight_kg ?? 0),
            reps: Number(s.reps_completed ?? 0),
            date: s.entry_date,
          };
        }
      }

      // 4-week volume + RIR series
      const volBuckets = new Map<string, number>();
      const rirBuckets = new Map<string, { sum: number; n: number }>();
      for (const s of sets) {
        const wk = isoWeekKey(s.entry_date);
        volBuckets.set(wk, (volBuckets.get(wk) ?? 0) + (s.weight_kg ?? 0) * (s.reps_completed ?? 0));
        if (s.rir != null) {
          const cur = rirBuckets.get(wk) ?? { sum: 0, n: 0 };
          cur.sum += Number(s.rir);
          cur.n += 1;
          rirBuckets.set(wk, cur);
        }
      }
      const volumeSeries = weekKeys.map((k) => Math.round(volBuckets.get(k) ?? 0));
      const rirSeries = weekKeys.map((k) => {
        const b = rirBuckets.get(k);
        return b && b.n ? Number((b.sum / b.n).toFixed(2)) : 0;
      });

      // RIR trend: last non-zero week vs first non-zero week
      const nonZero = rirSeries.filter((v) => v > 0);
      const rirTrend =
        nonZero.length >= 2 ? Number((nonZero[nonZero.length - 1] - nonZero[0]).toFixed(2)) : 0;
      const deloadSuggested = rirTrend < -1.0;

      return { name, lastFiveSessions, bestSet, volumeSeries, rirSeries, rirTrend, deloadSuggested };
    });

    return { exercises };
  });

export const getMuscleGroupWeeklyVolume = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const tz = await resolveUserTimezone(context.supabase, context.userId);
    const today = getLocalDateISO(tz);
    const { start, end } = getLocalWeekRange(today);

    const [{ data: rows }, { data: profileRow }] = await Promise.all([
      context.supabase
        .from("workout_set_logs")
        .select("muscle_group")
        .eq("user_id", context.userId)
        .eq("completed", true)
        .gte("entry_date", start)
        .lte("entry_date", end),
      context.supabase
        .from("profiles")
        .select("goal, experience_level")
        .eq("user_id", context.userId)
        .maybeSingle(),
    ]);

    // Import canonical helpers lazily to keep server-fn module lean.
    const { MUSCLE_GROUP_DISPLAY_ORDER, normaliseMuscleGroup } = await import(
      "@/lib/volume-landmarks"
    );

    const groups: Record<string, number> = {};
    for (const key of MUSCLE_GROUP_DISPLAY_ORDER) groups[key] = 0;
    let unclassified = 0;
    const unknownSeen = new Set<string>();

    for (const r of (rows as { muscle_group: string | null }[] | null) ?? []) {
      const raw = (r.muscle_group ?? "").toLowerCase().trim();
      if (!raw) {
        unclassified++;
        continue;
      }
      const canonical = normaliseMuscleGroup(raw);
      if (canonical) {
        groups[canonical] = (groups[canonical] ?? 0) + 1;
      } else {
        unclassified++;
        if (!unknownSeen.has(raw)) {
          unknownSeen.add(raw);
          // Surface unmapped muscle_group values so we can add them to the
          // alias list before they distort chronic-volume math.
          console.warn(`[getMuscleGroupWeeklyVolume] unmapped muscle_group="${raw}"`);
        }
      }
    }

    return {
      groups,
      unclassified,
      profile: {
        goal: (profileRow as any)?.goal ?? null,
        experience_level: (profileRow as any)?.experience_level ?? null,
      },
    };
  });

export const getWeightTrend = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const tz = await resolveUserTimezone(context.supabase, context.userId);
    const today = getLocalDateISO(tz);
    const start = addDaysISO(today, -30);

    const { data: rows } = await context.supabase
      .from("body_measurement_events")
      .select("entry_date, weight_kg")
      .eq("user_id", context.userId)
      .not("weight_kg", "is", null)
      .gte("entry_date", start)
      .lte("entry_date", today)
      .order("entry_date", { ascending: true });

    const raw = ((rows as { entry_date: string; weight_kg: number }[] | null) ?? []).map((r) => ({
      date: r.entry_date,
      weight: Number(r.weight_kg),
    }));

    // 7-day rolling avg over series
    const smoothed = raw.map((_, i) => {
      const window = raw.slice(Math.max(0, i - 6), i + 1);
      const avg = window.reduce((s, p) => s + p.weight, 0) / window.length;
      return { date: raw[i].date, weight: Number(avg.toFixed(2)) };
    });

    let weightDelta = 0;
    let trendArrow = "→ Stable";
    if (smoothed.length >= 2) {
      const latest = smoothed[smoothed.length - 1].weight;
      const oldest = smoothed[0].weight;
      weightDelta = Number((latest - oldest).toFixed(1));
      const abs = Math.abs(weightDelta);
      if (abs < 0.2) trendArrow = "→ Stable";
      else if (weightDelta < 0) trendArrow = `↓ ${abs.toFixed(1)} kg in ${smoothed.length} days`;
      else trendArrow = `↑ ${abs.toFixed(1)} kg in ${smoothed.length} days`;
    }

    return { rawWeight: raw, smoothedTrend: smoothed, weightDelta, trendArrow };
  });

export const getTDEETrend = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const tz = await resolveUserTimezone(context.supabase, context.userId);
    const today = getLocalDateISO(tz);
    const start = addDaysISO(today, -7 * 12);

    const { data: rows } = await context.supabase
      .from("nutrition_weekly_reviews")
      .select("week_start_date, blended_tdee")
      .eq("user_id", context.userId)
      .gte("week_start_date", start)
      .not("blended_tdee", "is", null)
      .order("week_start_date", { ascending: true });

    const weeks = ((rows as { week_start_date: string; blended_tdee: number }[] | null) ?? []).map((r) => ({
      weekStartDate: r.week_start_date,
      blendedTDEE: Math.round(Number(r.blended_tdee)),
    }));

    let trendDirection: "positive" | "flat" | "negative" = "flat";
    let annotation = "TDEE stable. Training load balanced.";
    if (weeks.length >= 8) {
      const first4 = weeks.slice(0, 4).reduce((s, w) => s + w.blendedTDEE, 0) / 4;
      const last4 = weeks.slice(-4).reduce((s, w) => s + w.blendedTDEE, 0) / 4;
      const delta = last4 - first4;
      if (delta > 100) {
        trendDirection = "positive";
        annotation = `Your metabolism adapted — burning ~${Math.round(delta)} more kcal/day on average.`;
      } else if (delta < -100) {
        trendDirection = "negative";
        annotation = "TDEE declining. Training load increasing or deficit deepening.";
      }
    } else if (weeks.length === 0) {
      annotation = "Not enough weekly data yet.";
    }

    return { weeks, trendDirection, annotation };
  });

import { detectContradictions } from "@/lib/contradictions";

export const getContradictions = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const tz = await resolveUserTimezone(context.supabase, context.userId);
    const today = getLocalDateISO(tz);
    const sevenAgo = addDaysISO(today, -7);

    const [profileRes, reviewRes, readinessRes, strainRes, setsRes] = await Promise.all([
      context.supabase
        .from("profiles").select("goal")
        .eq("user_id", context.userId).maybeSingle(),
      context.supabase
        .from("nutrition_weekly_reviews")
        .select("adjustment_kcal, adherence_pct, week_start_date")
        .eq("user_id", context.userId)
        .order("week_start_date", { ascending: false }).limit(1).maybeSingle(),
      context.supabase
        .from("readiness_scores").select("final_score")
        .eq("user_id", context.userId).eq("score_date", today).maybeSingle(),
      context.supabase
        .from("shield_training_logs").select("strain_value")
        .eq("user_id", context.userId)
        .gte("entry_date", sevenAgo).lte("entry_date", today),
      context.supabase
        .from("workout_set_logs").select("rir")
        .eq("user_id", context.userId).eq("completed", true)
        .gte("entry_date", sevenAgo).lte("entry_date", today),
    ]);

    const strains = ((strainRes.data as { strain_value: number | null }[] | null) ?? [])
      .map((r) => r.strain_value).filter((v): v is number => typeof v === "number");
    const avgStrain7d = strains.length ? strains.reduce((s, v) => s + v, 0) / strains.length : null;

    const setRows = (setsRes.data as { rir: number | null }[] | null) ?? [];
    const sets7d = setRows.length;
    const rirs = setRows.map((r) => r.rir).filter((v): v is number => typeof v === "number");
    const avgRir7d = rirs.length ? rirs.reduce((s, v) => s + v, 0) / rirs.length : null;

    return detectContradictions({
      goal: (profileRes.data?.goal as string | null) ?? null,
      adjustmentKcal: reviewRes.data?.adjustment_kcal == null ? null : Number(reviewRes.data.adjustment_kcal),
      adherencePct: reviewRes.data?.adherence_pct == null ? null : Number(reviewRes.data.adherence_pct),
      avgStrain7d,
      avgRir7d,
      sets7d,
      readinessToday: readinessRes.data?.final_score == null ? null : Number(readinessRes.data.final_score),
    });
  });
