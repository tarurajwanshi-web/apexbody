// APEX Shield deterministic readiness engine (v6.1).
// NO LLM CALLS. Pure formulas per spec.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const W = { recovery: 30, sleep: 22, nutrition: 20, training: 15, mood: 13 } as const;
type PillarKey = keyof typeof W;
const PILLAR_KEYS: PillarKey[] = ["recovery", "sleep", "nutrition", "training", "mood"];
const NEUTRAL = 50;
const ENGINE_VERSION = "v6.1";

// ---------------- core formulas (verbatim from spec) ----------------
function manualSleepScore(hours: number): number {
  let raw = 100 / (1 + Math.exp(-1.6 * (hours - 6.3)));
  if (hours > 8.5) raw -= (hours - 8.5) * 9;
  raw = Math.min(95, Math.max(8, raw));
  const discounted = NEUTRAL + 0.75 * (raw - NEUTRAL);
  return Math.min(100, Math.max(5, discounted));
}

const RECOVERY_MAP = [0, 20, 40, 58, 74, 88];
function manualRecoveryScore(rating: number): number {
  const base = RECOVERY_MAP[rating];
  return NEUTRAL + 0.65 * (base - NEUTRAL);
}

type Confidence = "high" | "medium" | "low";
function deriveConfidence(recoveryPresent: boolean, sleepPresent: boolean, coverage: number): Confidence {
  if (recoveryPresent && sleepPresent) return "high";
  if (coverage >= 0.45) return "medium";
  return "low";
}

function applyCap(norm: number, confidence: Confidence, backbonePresent: boolean): number {
  const dev = norm - NEUTRAL;
  const posCap = { high: 100, medium: 30, low: 10 }[confidence];
  const negCap = backbonePresent ? 100 : posCap;
  const cappedDev = dev >= 0 ? Math.min(posCap, dev) : Math.max(-negCap, dev);
  return Math.round(Math.min(100, Math.max(0, NEUTRAL + cappedDev)));
}

function fatiguePenalty(sleepDebt: number, strainHistory: number[]): number {
  const debtPenalty = sleepDebt * 3;
  const strainAvg = strainHistory.length === 0
    ? 0
    : strainHistory.reduce((a, b) => a + b, 0) / strainHistory.length;
  const strainPenalty = Math.max(0, strainAvg - 50) * 0.5;
  return Math.min(15, debtPenalty + strainPenalty);
}

function nextBestInput(present: Record<PillarKey, boolean>): PillarKey | null {
  if (!present.recovery) return "recovery";
  if (!present.sleep) return "sleep";
  const missing: [PillarKey, number][] = [];
  if (!present.nutrition) missing.push(["nutrition", 20]);
  if (!present.training) missing.push(["training", 15]);
  if (!present.mood) missing.push(["mood", 13]);
  missing.sort((a, b) => b[1] - a[1]);
  return missing.length ? missing[0][0] : null;
}

// mood_emoji → 5-point scale (worst 20 → best 100).
// No prior values existed in shield_manual_inputs; mapping covers the
// emoji set the manual recovery UI is expected to send, plus a few text
// synonyms for robustness. Unknown values → null (treated as absent).
const MOOD_MAP: Record<string, number> = {
  "😞": 20, "😢": 20, "😔": 20, sad: 20, awful: 20, terrible: 20, worst: 20,
  "😕": 40, "🙁": 40, bad: 40, low: 40,
  "😐": 60, "😑": 60, neutral: 60, ok: 60, okay: 60, meh: 60,
  "🙂": 80, "😊": 80, good: 80, happy: 80,
  "😄": 100, "😁": 100, "🤩": 100, great: 100, best: 100, peak: 100,
};

// ---------------- helpers ----------------
function dateOffset(iso: string, daysBack: number): string {
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() - daysBack);
  return d.toISOString().slice(0, 10);
}

type DayInputs = {
  manual?: { recovery_self_rating: number | null; sleep_hours: number | null; mood_emoji: string | null };
  device?: { parsed_hrv: number | null; parsed_rhr: number | null; parsed_sleep_hours: number | null };
  meals: Array<{ claude_quality_score: number | null }>;
  training?: { strain_value: number | null };
};

type PillarScores = Partial<Record<PillarKey, number>>;

function scoreDay(d: DayInputs): { scores: PillarScores; present: Record<PillarKey, boolean>; sleepHours: number | null; strainNorm: number | null; usedDevice: boolean; usedManual: boolean } {
  const scores: PillarScores = {};
  let usedDevice = false;
  let usedManual = false;

  // recovery
  if (d.manual?.recovery_self_rating != null) {
    scores.recovery = manualRecoveryScore(d.manual.recovery_self_rating);
    usedManual = true;
  } else if (d.device && (d.device.parsed_hrv != null || d.device.parsed_rhr != null)) {
    // PLACEHOLDER — see open-items in calculate-score response.
    scores.recovery = 55;
    usedDevice = true;
  }

  // sleep
  let sleepHours: number | null = null;
  if (d.manual?.sleep_hours != null) {
    sleepHours = Number(d.manual.sleep_hours);
    scores.sleep = manualSleepScore(sleepHours);
    usedManual = true;
  } else if (d.device?.parsed_sleep_hours != null) {
    // PLACEHOLDER — runs parsed_sleep_hours through manualSleepScore.
    sleepHours = Number(d.device.parsed_sleep_hours);
    scores.sleep = manualSleepScore(sleepHours);
    usedDevice = true;
  }

  // nutrition — average non-null claude_quality_score across today's meals
  const scored = d.meals.map((m) => m.claude_quality_score).filter((v): v is number => v != null);
  if (scored.length > 0) {
    scores.nutrition = scored.reduce((a, b) => a + b, 0) / scored.length;
  }

  // training — PLACEHOLDER simple inverse-strain map
  let strainNorm: number | null = null;
  if (d.training?.strain_value != null) {
    const s = Number(d.training.strain_value);
    scores.training = Math.max(0, 100 - s * 2);
    strainNorm = Math.min(100, Math.max(0, s * 5)); // 0-21 strain → 0-100 normalized
  }

  // mood
  if (d.manual?.mood_emoji) {
    const m = MOOD_MAP[d.manual.mood_emoji.trim()];
    if (m != null) {
      scores.mood = m;
      usedManual = true;
    }
  }

  const present: Record<PillarKey, boolean> = {
    recovery: scores.recovery != null,
    sleep: scores.sleep != null,
    nutrition: scores.nutrition != null,
    training: scores.training != null,
    mood: scores.mood != null,
  };

  return { scores, present, sleepHours, strainNorm, usedDevice, usedManual };
}

function nudgeMessageFor(pillar: PillarKey | null): string | null {
  if (!pillar) return null;
  const map: Record<PillarKey, string> = {
    recovery: "Log how recovered you feel — it's the biggest lever on today's score.",
    sleep: "Add last night's sleep so your readiness reflects rest.",
    nutrition: "Log a meal so I can factor nutrition into your score.",
    training: "Log today's workout strain so I can read your load.",
    mood: "A quick mood check sharpens today's readiness picture.",
  };
  return map[pillar];
}

// ---------------- main ----------------
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceKey);

    const { user_id, entry_date } = await req.json();
    if (!user_id || !entry_date) {
      return new Response(JSON.stringify({ error: "user_id and entry_date required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const today = entry_date as string;
    const yesterday = dateOffset(today, 1);
    const dayBefore = dateOffset(today, 2);
    const dateList = [dayBefore, yesterday, today];

    // Read previous score for today (for change toast)
    const { data: prev } = await supabase
      .from("readiness_scores")
      .select("final_score")
      .eq("user_id", user_id)
      .eq("score_date", today)
      .maybeSingle();
    const previous_score: number | null = prev?.final_score != null ? Number(prev.final_score) : null;

    // Fetch the last 3 days of inputs in parallel
    const [manualRes, deviceRes, mealsRes, trainingRes] = await Promise.all([
      supabase.from("shield_manual_inputs").select("entry_date, recovery_self_rating, sleep_hours, mood_emoji")
        .eq("user_id", user_id).in("entry_date", dateList),
      supabase.from("shield_device_uploads").select("entry_date, parsed_hrv, parsed_rhr, parsed_sleep_hours, parse_status")
        .eq("user_id", user_id).in("entry_date", dateList).eq("parse_status", "parsed"),
      supabase.from("shield_nutrition_logs").select("entry_date, claude_quality_score, deleted")
        .eq("user_id", user_id).in("entry_date", dateList).eq("deleted", false),
      supabase.from("shield_training_logs").select("entry_date, strain_value")
        .eq("user_id", user_id).in("entry_date", dateList),
    ]);

    const byDate: Record<string, DayInputs> = {};
    for (const d of dateList) byDate[d] = { meals: [] };
    for (const r of manualRes.data ?? []) byDate[r.entry_date].manual = r as any;
    for (const r of deviceRes.data ?? []) byDate[r.entry_date].device = r as any;
    for (const r of mealsRes.data ?? []) byDate[r.entry_date].meals.push({ claude_quality_score: r.claude_quality_score });
    for (const r of trainingRes.data ?? []) byDate[r.entry_date].training = r as any;

    const perDay = dateList.map((d) => ({ date: d, ...scoreDay(byDate[d]) }));
    const today_ = perDay[2];

    // Weighted 3-day average per pillar (today*3 + yesterday*2 + day_before*1)/6
    // Only count days where that pillar is present; reweight remaining days.
    const weights = [1, 2, 3]; // dayBefore, yesterday, today
    const weightedAvgPerPillar: PillarScores = {};
    for (const p of PILLAR_KEYS) {
      let num = 0; let den = 0;
      perDay.forEach((day, i) => {
        const v = day.scores[p];
        if (v != null) { num += v * weights[i]; den += weights[i]; }
      });
      if (den > 0) weightedAvgPerPillar[p] = num / den;
    }

    // raw_score across pillars present TODAY (per spec, weighted avg per present pillar)
    const presentToday = today_.present;
    let rawNum = 0; let rawDen = 0;
    for (const p of PILLAR_KEYS) {
      if (presentToday[p] && weightedAvgPerPillar[p] != null) {
        rawNum += W[p] * weightedAvgPerPillar[p]!;
        rawDen += W[p];
      }
    }
    const raw_score = rawDen > 0 ? rawNum / rawDen : NEUTRAL;

    // coverage = sum(weights of pillars present TODAY) / 100
    const coverage = PILLAR_KEYS.reduce((s, p) => s + (presentToday[p] ? W[p] : 0), 0) / 100;

    // Fatigue state across 3-day window
    // sleep debt: optimal=8h, per-day max 2h, decay 30%/day (0.7 retention).
    let sleepDebt = 0;
    for (const day of perDay) {
      sleepDebt = sleepDebt * 0.7;
      if (day.sleepHours != null) {
        sleepDebt += Math.max(0, Math.min(2, 8 - day.sleepHours));
      }
    }
    const strainHistory = perDay.map((d) => d.strainNorm).filter((v): v is number => v != null);
    const penalty = fatiguePenalty(sleepDebt, strainHistory);
    const final_pre_cap = raw_score - penalty;

    const confidence = deriveConfidence(presentToday.recovery, presentToday.sleep, coverage);
    const backbone_present = presentToday.recovery && presentToday.sleep;
    const final_score = applyCap(final_pre_cap, confidence, backbone_present);

    const nudge_pillar = nextBestInput(presentToday);
    const nudge_message = nudgeMessageFor(nudge_pillar);

    // pillar_breakdown for TODAY (null for absent)
    const pillar_breakdown: Record<PillarKey, number | null> = {
      recovery: presentToday.recovery ? Math.round(today_.scores.recovery!) : null,
      sleep: presentToday.sleep ? Math.round(today_.scores.sleep!) : null,
      nutrition: presentToday.nutrition ? Math.round(today_.scores.nutrition!) : null,
      training: presentToday.training ? Math.round(today_.scores.training!) : null,
      mood: presentToday.mood ? Math.round(today_.scores.mood!) : null,
    };

    const input_path: "device" | "manual" | "mixed" =
      today_.usedDevice && today_.usedManual ? "mixed" : today_.usedDevice ? "device" : "manual";

    const row = {
      user_id,
      score_date: today,
      final_score,
      confidence_level: confidence.toUpperCase(),
      pillar_breakdown,
      fatigue_adjustment: -penalty,
      nudge_message,
      input_path,
      engine_version: ENGINE_VERSION,
    };

    const { error: upErr } = await supabase
      .from("readiness_scores")
      .upsert(row, { onConflict: "user_id,score_date" });
    if (upErr) throw upErr;

    return new Response(
      JSON.stringify({
        previous_score,
        new_score: final_score,
        confidence_level: row.confidence_level,
        coverage,
        fatigue_adjustment: row.fatigue_adjustment,
        pillar_breakdown,
        nudge_pillar,
        nudge_message,
        input_path,
        engine_version: ENGINE_VERSION,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    console.error("calculate-score failed:", err);
    return new Response(
      JSON.stringify({ error: String(err instanceof Error ? err.message : err) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
