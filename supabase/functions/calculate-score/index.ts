// APEX Shield deterministic readiness engine (v6.3).
// NO LLM CALLS. Pure formulas per spec.
//
// v6.3 changes vs v6.2:
// - Source-agnostic input layer: reads public.shield_health_signals first
//   (screenshot / native_health / manual / derived). Falls back to legacy
//   tables when no normalized rows exist. Pillar weights and formulas are
//   unchanged so scores stay deterministic and backward-comparable.
// - Writes per-signal quality audit rows into shield_signal_quality_events.
// - Populates readiness_scores.{signal_quality, top_drivers, load_carryover,
//   fuelling_status, training_permission, nutrition_modifier, reason_codes}.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { authorizeCaller, corsAllowHeaders } from "../_shared/authorize.ts";
import {
  classifyHrv, classifyRhr, classifySleep,
  REASON, dedupe,
  type Confidence as SigConfidence,
  type Freshness, type Validity, type ReasonCode,
} from "../_shared/signal-quality.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": corsAllowHeaders,
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const W = { recovery: 30, sleep: 22, nutrition: 20, training: 15, mood: 13 } as const;
type PillarKey = keyof typeof W;
const PILLAR_KEYS: PillarKey[] = ["recovery", "sleep", "nutrition", "training", "mood"];
const NEUTRAL = 50;
const ENGINE_VERSION = "v6.3";
const HYDRATION_ML_PER_KG_REST = 30;
const HYDRATION_ML_PER_KG_TRAIN = 40;
const NUTRITION_MEAL_WEIGHT = 0.7;
const NUTRITION_HYDRATION_WEIGHT = 0.3;

// ---------------- core formulas (verbatim from v6.2) ----------------
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

const MOOD_MAP: Record<string, number> = {
  "😞": 20, "😢": 20, "😔": 20, sad: 20, awful: 20, terrible: 20, worst: 20,
  "😕": 40, "🙁": 40, bad: 40, low: 40,
  "😐": 60, "😑": 60, neutral: 60, ok: 60, okay: 60, meh: 60,
  "🙂": 80, "😊": 80, good: 80, happy: 80,
  "😄": 100, "😁": 100, "🤩": 100, great: 100, best: 100, peak: 100,
};

function dateOffset(iso: string, daysBack: number): string {
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() - daysBack);
  return d.toISOString().slice(0, 10);
}

type DayInputs = {
  manual?: { recovery_self_rating: number | null; sleep_hours: number | null; mood_emoji: string | null; hydration_ml: number | null; recovery_source?: string | null };
  device?: { parsed_hrv: number | null; parsed_rhr: number | null; parsed_sleep_hours: number | null };
  meals: Array<{ claude_quality_score: number | null }>;
  training?: { strain_value: number | null };
  pathPref?: "device" | "manual";
  forceRecovery?: "device" | "manual" | null;
  forceSleep?: "device" | "manual" | null;
};

type RecoveryBaseline = { hrv: number | null; rhr: number | null };

const HRV_POP_BASELINE = 50;
const RHR_POP_BASELINE = 60;
function deviceRecoveryScore(
  hrv: number | null,
  rhr: number | null,
  baseline: RecoveryBaseline,
): number | null {
  if (hrv == null && rhr == null) return null;
  const hb = baseline.hrv && baseline.hrv > 0 ? baseline.hrv : HRV_POP_BASELINE;
  const rb = baseline.rhr && baseline.rhr > 0 ? baseline.rhr : RHR_POP_BASELINE;
  const hrvSub = hrv != null
    ? Math.max(10, Math.min(95, NEUTRAL + ((hrv - hb) / hb) * (50 / 0.3)))
    : null;
  const rhrSub = rhr != null
    ? Math.max(10, Math.min(95, NEUTRAL + ((rb - rhr) / rb) * (50 / 0.15)))
    : null;
  const raw = hrvSub != null && rhrSub != null
    ? 0.7 * hrvSub + 0.3 * rhrSub
    : (hrvSub ?? rhrSub) as number;
  const damped = NEUTRAL + 0.75 * (raw - NEUTRAL);
  return Math.min(100, Math.max(5, damped));
}

function resolveEffectiveWeight(p: any): number | null {
  let w: number | null = p?.measurement_weight_kg != null ? Number(p.measurement_weight_kg) : null;
  if ((!w || w <= 0) && p?.dexa_lean_mass_kg != null && p?.dexa_body_fat_pct != null) {
    const lean = Number(p.dexa_lean_mass_kg);
    const bf = Number(p.dexa_body_fat_pct);
    if (lean > 0 && bf >= 0 && bf < 95) w = Math.round((lean / (1 - bf / 100)) * 10) / 10;
  }
  return w && w > 0 ? w : null;
}

type PillarScores = Partial<Record<PillarKey, number>>;

function scoreDay(d: DayInputs, recoveryBaseline: RecoveryBaseline): {
  scores: PillarScores;
  present: Record<PillarKey, boolean>;
  sleepHours: number | null;
  strainNorm: number | null;
  usedDevice: boolean;
  usedManual: boolean;
  mealQuality: number | null;
  hydrationMl: number | null;
  hadTraining: boolean;
} {
  const scores: PillarScores = {};
  let usedDevice = false;
  let usedManual = false;

    const deviceUsable = d.device && d.device.parsed_hrv != null;
    const recoveryForce = d.forceRecovery ?? null;
    const useDeviceFirst = recoveryForce === "device"
      ? !!(d.device && (d.device.parsed_hrv != null || d.device.parsed_rhr != null))
      : recoveryForce === "manual"
        ? false
        : (d.pathPref === "device" && deviceUsable);
    if (useDeviceFirst) {
      const r = deviceRecoveryScore(d.device!.parsed_hrv, d.device!.parsed_rhr, recoveryBaseline);
      if (r != null) { scores.recovery = r; usedDevice = true; }
    } else if (d.manual?.recovery_self_rating != null) {
      scores.recovery = manualRecoveryScore(d.manual.recovery_self_rating);
      usedManual = true;
    } else if (recoveryForce !== "manual" && d.device && (d.device.parsed_hrv != null || d.device.parsed_rhr != null)) {
      const r = deviceRecoveryScore(d.device.parsed_hrv, d.device.parsed_rhr, recoveryBaseline);
      if (r != null) { scores.recovery = r; usedDevice = true; }
    }

    let sleepHours: number | null = null;
    const deviceSleep = d.device?.parsed_sleep_hours;
    const sleepForce = d.forceSleep ?? null;
    const useDeviceSleep = sleepForce === "device"
      ? deviceSleep != null
      : sleepForce === "manual"
        ? false
        : (d.pathPref === "device" && deviceSleep != null);
    if (useDeviceSleep && deviceSleep != null) {
      sleepHours = Number(deviceSleep);
      scores.sleep = manualSleepScore(sleepHours);
      usedDevice = true;
    } else if (d.manual?.sleep_hours != null) {
      sleepHours = Number(d.manual.sleep_hours);
      scores.sleep = manualSleepScore(sleepHours);
      usedManual = true;
    } else if (sleepForce !== "manual" && deviceSleep != null) {
      sleepHours = Number(deviceSleep);
      scores.sleep = manualSleepScore(sleepHours);
      usedDevice = true;
    }

  const scored = d.meals.map((m) => m.claude_quality_score).filter((v): v is number => v != null);
  const mealQuality = scored.length > 0
    ? scored.reduce((a, b) => a + b, 0) / scored.length
    : null;
  const hydrationMl = d.manual?.hydration_ml != null && d.manual.hydration_ml > 0
    ? Number(d.manual.hydration_ml)
    : null;

  let strainNorm: number | null = null;
  let hadTraining = false;
  if (d.training?.strain_value != null) {
    const s = Number(d.training.strain_value);
    scores.training = Math.max(0, 100 - s * 2);
    strainNorm = Math.min(100, Math.max(0, s * 5));
    hadTraining = true;
  }

  if (d.manual?.mood_emoji) {
    const m = MOOD_MAP[d.manual.mood_emoji.trim()];
    if (m != null) { scores.mood = m; usedManual = true; }
  }

  const present: Record<PillarKey, boolean> = {
    recovery: scores.recovery != null,
    sleep: scores.sleep != null,
    nutrition: false,
    training: scores.training != null,
    mood: scores.mood != null,
  };

  return { scores, present, sleepHours, strainNorm, usedDevice, usedManual, mealQuality, hydrationMl, hadTraining };
}

function composeNutrition(
  mealQuality: number | null,
  hydrationMl: number | null,
  weightKg: number | null,
  hadTraining: boolean,
  path: "device" | "manual",
): { score: number | null; hydrationPct: number | null; hydrationTargetMl: number | null } {
  const targetMlPerKg = hadTraining ? HYDRATION_ML_PER_KG_TRAIN : HYDRATION_ML_PER_KG_REST;
  const targetMl = weightKg && weightKg > 0 ? Math.round(weightKg * targetMlPerKg) : null;
  const hydrationPct = targetMl && hydrationMl != null
    ? Math.min(100, Math.round((hydrationMl / targetMl) * 100))
    : null;

  if (path === "device") {
    return { score: mealQuality, hydrationPct, hydrationTargetMl: targetMl };
  }
  const mealOk = mealQuality != null;
  const hydOk = hydrationPct != null;
  if (!mealOk && !hydOk) return { score: null, hydrationPct, hydrationTargetMl: targetMl };
  if (mealOk && hydOk) {
    const score = NUTRITION_MEAL_WEIGHT * mealQuality + NUTRITION_HYDRATION_WEIGHT * hydrationPct;
    return { score, hydrationPct, hydrationTargetMl: targetMl };
  }
  return { score: mealOk ? mealQuality : hydrationPct, hydrationPct, hydrationTargetMl: targetMl };
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

// ---------------- v6.3 source-agnostic signal reader ----------------
// Per (date, metric) pick the best row from shield_health_signals.
// Priority: validity (valid > suspicious), then confidence (HIGH>MED>LOW),
// then source_method (native_health > screenshot > manual > derived > system).
const METHOD_RANK: Record<string, number> = {
  native_health: 5, screenshot: 4, manual: 3, derived: 2, system: 1,
};
const CONF_RANK: Record<string, number> = { HIGH: 3, MEDIUM: 2, LOW: 1 };
const VALID_RANK: Record<string, number> = { valid: 2, suspicious: 1 };

type HealthSignalRow = {
  signal_date: string;
  metric_name: string;
  metric_value: number | null;
  unit: string | null;
  source_method: string;
  source_provider: string;
  source_table: string | null;
  source_id: string | null;
  confidence_level: string | null;
  freshness_status: string | null;
  validity_status: string | null;
  reason_codes: string[] | null;
  is_user_corrected: boolean | null;
  correction_reason: string | null;
};

// A signal row is "device-usable" when it has a usable value, isn't stale or
// future-dated, and isn't an explicit manual user correction.
function isDeviceUsable(r: HealthSignalRow | undefined): boolean {
  if (!r || r.metric_value == null) return false;
  const v = r.validity_status;
  if (v !== "valid" && v !== "suspicious") return false;
  const f = r.freshness_status ?? "unknown";
  if (f === "stale" || f === "future_date") return false;
  return r.source_method === "native_health" || r.source_method === "screenshot";
}

function isManualCorrection(r: HealthSignalRow | undefined): boolean {
  if (!r) return false;
  return r.source_method === "manual" &&
    (r.is_user_corrected === true || (r.correction_reason ?? "").length > 0);
}

type PerMetricMeta = {
  value: number | null;
  confidence: SigConfidence;
  freshness: Freshness;
  validity: Validity;
  source_method: string;
  source_provider: string;
  reason_codes: ReasonCode[];
};

function rankRow(r: HealthSignalRow): number {
  const v = VALID_RANK[r.validity_status ?? "valid"] ?? 0;
  const c = CONF_RANK[r.confidence_level ?? "LOW"] ?? 0;
  const m = METHOD_RANK[r.source_method] ?? 0;
  return v * 100 + c * 10 + m;
}

function groupSignals(rows: HealthSignalRow[]): Map<string, Map<string, HealthSignalRow>> {
  // date -> metric -> best row
  const out = new Map<string, Map<string, HealthSignalRow>>();
  for (const r of rows) {
    if (r.metric_value == null) continue;
    if (r.validity_status === "invalid" || r.validity_status === "missing") continue;
    let day = out.get(r.signal_date);
    if (!day) { day = new Map(); out.set(r.signal_date, day); }
    const existing = day.get(r.metric_name);
    if (!existing || rankRow(r) > rankRow(existing)) day.set(r.metric_name, r);
  }
  return out;
}

function toMeta(r: HealthSignalRow | undefined): PerMetricMeta | null {
  if (!r) return null;
  return {
    value: r.metric_value,
    confidence: (r.confidence_level as SigConfidence) ?? "LOW",
    freshness: (r.freshness_status as Freshness) ?? "unknown",
    validity: (r.validity_status as Validity) ?? "valid",
    source_method: r.source_method,
    source_provider: r.source_provider,
    reason_codes: (r.reason_codes ?? []) as ReasonCode[],
  };
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
    const authz = await authorizeCaller(req, supabase, user_id);
    if (!authz.ok) {
      return new Response(JSON.stringify({ error: authz.error }), {
        status: authz.status, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const today = entry_date as string;
    const yesterday = dateOffset(today, 1);
    const dayBefore = dateOffset(today, 2);
    const dateList = [dayBefore, yesterday, today];

    // load_carryover window (today + 3 prior days).
    const loadDates = [today, dateOffset(today, 1), dateOffset(today, 2), dateOffset(today, 3)];

    const { data: prev } = await supabase
      .from("readiness_scores")
      .select("final_score")
      .eq("user_id", user_id)
      .eq("score_date", today)
      .maybeSingle();
    const previous_score: number | null = prev?.final_score != null ? Number(prev.final_score) : null;

    const { data: profile } = await supabase
      .from("profiles")
      .select("input_path_preference, measurement_weight_kg, dexa_lean_mass_kg, dexa_body_fat_pct")
      .eq("user_id", user_id)
      .maybeSingle();
    const pathPref: "device" | "manual" = profile?.input_path_preference === "device" ? "device" : "manual";
    const weightKg: number | null = resolveEffectiveWeight(profile);

    const baselineFrom = dateOffset(today, 14);
    const [
      manualRes, deviceRes, mealsRes, trainingRes, baselineRes,
      signalsRes, loadStrainRes, targetsRes,
    ] = await Promise.all([
      supabase.from("shield_manual_inputs").select("entry_date, recovery_self_rating, sleep_hours, mood_emoji, hydration_ml, recovery_source")
        .eq("user_id", user_id).in("entry_date", dateList),
      supabase.from("shield_device_uploads").select("entry_date, parsed_hrv, parsed_rhr, parsed_sleep_hours, parse_status")
        .eq("user_id", user_id).in("entry_date", dateList).eq("parse_status", "parsed"),
      supabase.from("shield_nutrition_logs").select("entry_date, claude_quality_score, total_protein_g, total_calories, deleted")
        .eq("user_id", user_id).in("entry_date", dateList).eq("deleted", false),
      supabase.from("shield_training_logs").select("entry_date, strain_value")
        .eq("user_id", user_id).in("entry_date", dateList),
      supabase.from("shield_device_uploads").select("parsed_hrv, parsed_rhr")
        .eq("user_id", user_id).eq("parse_status", "parsed")
        .gte("entry_date", baselineFrom).lte("entry_date", today),
      supabase.from("shield_health_signals")
        .select("signal_date, metric_name, metric_value, unit, source_method, source_provider, source_table, source_id, confidence_level, freshness_status, validity_status, reason_codes")
        .eq("user_id", user_id).in("signal_date", dateList),
      supabase.from("shield_training_logs").select("entry_date, strain_value")
        .eq("user_id", user_id).in("entry_date", loadDates),
      supabase.from("daily_macro_targets")
        .select("target_calories, target_protein_g, effective_start_date, effective_end_date")
        .eq("user_id", user_id)
        .lte("effective_start_date", today)
        .or(`effective_end_date.is.null,effective_end_date.gte.${today}`)
        .order("effective_start_date", { ascending: false })
        .limit(1),
    ]);

    const baselineRows = (baselineRes.data ?? []) as Array<{ parsed_hrv: number | null; parsed_rhr: number | null }>;
    const mean = (vals: number[]) => vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
    const recoveryBaseline: RecoveryBaseline = {
      hrv: mean(baselineRows.map((r) => r.parsed_hrv).filter((v): v is number => v != null && v > 0)),
      rhr: mean(baselineRows.map((r) => r.parsed_rhr).filter((v): v is number => v != null && v > 0)),
    };

    // Group normalized signals by date+metric.
    const signalRows = (signalsRes.data ?? []) as HealthSignalRow[];
    const signalsByDate = groupSignals(signalRows);

    // Build per-day inputs. Prefer normalized signals; fall back to legacy.
    const byDate: Record<string, DayInputs & { meta: { hrv?: PerMetricMeta; rhr?: PerMetricMeta; sleep?: PerMetricMeta; recovery_proxy?: PerMetricMeta } }> = {};
    for (const d of dateList) byDate[d] = { meals: [], pathPref, meta: {} };

    for (const r of manualRes.data ?? []) byDate[r.entry_date].manual = r as any;
    for (const r of deviceRes.data ?? []) byDate[r.entry_date].device = r as any;
    for (const r of mealsRes.data ?? []) byDate[r.entry_date].meals.push({ claude_quality_score: r.claude_quality_score });
    for (const r of trainingRes.data ?? []) byDate[r.entry_date].training = r as any;

    // Overlay normalized signals where present.
    for (const d of dateList) {
      const day = signalsByDate.get(d);
      if (!day) continue;
      const hrv = day.get("hrv_ms");
      const rhr = day.get("resting_heart_rate_bpm");
      const slp = day.get("sleep_hours");
      const rec = day.get("recovery_score") ?? day.get("readiness_proxy_score") ?? day.get("body_battery");

      if (hrv || rhr || slp) {
        byDate[d].device = {
          parsed_hrv: hrv?.metric_value ?? byDate[d].device?.parsed_hrv ?? null,
          parsed_rhr: rhr?.metric_value ?? byDate[d].device?.parsed_rhr ?? null,
          parsed_sleep_hours: slp?.metric_value ?? byDate[d].device?.parsed_sleep_hours ?? null,
        };
      }
      byDate[d].meta.hrv = toMeta(hrv) ?? undefined;
      byDate[d].meta.rhr = toMeta(rhr) ?? undefined;
      byDate[d].meta.sleep = toMeta(slp) ?? undefined;
      byDate[d].meta.recovery_proxy = toMeta(rec) ?? undefined;
    }

    const perDay = dateList.map((d) => {
      const s = scoreDay(byDate[d], recoveryBaseline);
      const comp = composeNutrition(s.mealQuality, s.hydrationMl, weightKg, s.hadTraining, pathPref);
      if (comp.score != null) {
        s.scores.nutrition = comp.score;
        s.present.nutrition = true;
      }
      return { date: d, ...s, hydrationPct: comp.hydrationPct, hydrationTargetMl: comp.hydrationTargetMl };
    });
    const today_ = perDay[2];

    const weights = [1, 2, 3];
    const weightedAvgPerPillar: PillarScores = {};
    for (const p of PILLAR_KEYS) {
      let num = 0; let den = 0;
      perDay.forEach((day, i) => {
        const v = day.scores[p];
        if (v != null) { num += v * weights[i]; den += weights[i]; }
      });
      if (den > 0) weightedAvgPerPillar[p] = num / den;
    }

    const presentToday = today_.present;
    let rawNum = 0; let rawDen = 0;
    for (const p of PILLAR_KEYS) {
      if (presentToday[p] && weightedAvgPerPillar[p] != null) {
        rawNum += W[p] * weightedAvgPerPillar[p]!;
        rawDen += W[p];
      }
    }
    const raw_score = rawDen > 0 ? rawNum / rawDen : NEUTRAL;
    const coverage = PILLAR_KEYS.reduce((s, p) => s + (presentToday[p] ? W[p] : 0), 0) / 100;

    let sleepDebt = 0;
    for (const day of perDay) {
      sleepDebt = sleepDebt * 0.7;
      if (day.sleepHours != null) sleepDebt += Math.max(0, Math.min(2, 8 - day.sleepHours));
    }
    const strainHistory = perDay.map((d) => d.strainNorm).filter((v): v is number => v != null);
    const penalty = fatiguePenalty(sleepDebt, strainHistory);

    const { data: psc } = await supabase
      .from("pre_session_checks")
      .select("session_readiness")
      .eq("user_id", user_id)
      .eq("entry_date", today)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    const lowReadiness = psc != null && Number(psc.session_readiness) <= 2;
    const rawExtra = lowReadiness ? 5 : 0;
    const combinedPenalty = Math.min(15, penalty + rawExtra);
    const preSessionDelta = combinedPenalty - penalty;
    const final_pre_cap = raw_score - combinedPenalty;

    const confidence = deriveConfidence(presentToday.recovery, presentToday.sleep, coverage);
    const backbone_present = presentToday.recovery && presentToday.sleep;
    const final_score = applyCap(final_pre_cap, confidence, backbone_present);

    const nudge_pillar = nextBestInput(presentToday);
    const nudge_message = nudgeMessageFor(nudge_pillar);

    const pillar_breakdown: Record<PillarKey, number | null> = {
      recovery: presentToday.recovery ? Math.round(today_.scores.recovery!) : null,
      sleep: presentToday.sleep ? Math.round(today_.scores.sleep!) : null,
      nutrition: presentToday.nutrition ? Math.round(today_.scores.nutrition!) : null,
      training: presentToday.training ? Math.round(today_.scores.training!) : null,
      mood: presentToday.mood ? Math.round(today_.scores.mood!) : null,
    };

    const input_path: "device" | "manual" | "mixed" =
      today_.usedDevice && today_.usedManual ? "mixed" : today_.usedDevice ? "device" : "manual";

    // ---------------- v6.3 outputs ----------------
    const reasonCodesAll: ReasonCode[] = [];

    // load_carryover from today + 3 prior days.
    const strainByDate = new Map<string, number>();
    for (const r of (loadStrainRes.data ?? []) as Array<{ entry_date: string; strain_value: number | null }>) {
      if (r.strain_value != null) strainByDate.set(r.entry_date, Number(r.strain_value));
    }
    const decayMap: Record<number, number> = { 0: 1.0, 1: 0.7, 2: 0.4, 3: 0.2 };
    const loadDays = loadDates.map((d, i) => {
      const strain = strainByDate.get(d) ?? 0;
      const decay = decayMap[i];
      return { date: d, strain, decay, contribution: Math.round(strain * decay * 10) / 10 };
    });
    const systemic_load = Math.round(loadDays.reduce((a, b) => a + b.contribution, 0) * 10) / 10;
    const loadReasons: ReasonCode[] = [];
    if (systemic_load >= 25) loadReasons.push(REASON.HIGH_LOAD_CARRYOVER);
    else if (systemic_load >= 5) loadReasons.push(REASON.TRAINING_LOAD_CARRYOVER);
    if (loadReasons.length) reasonCodesAll.push(...loadReasons);

    const load_carryover = {
      systemic_load,
      days: loadDays,
      reason_codes: loadReasons,
    };

    // signal_quality block — per-signal confidence/validity/freshness summary.
    const todayMeta = byDate[today].meta;

    // Re-classify legacy fallback values so suspicious/invalid is tagged even
    // when there are no normalized rows yet.
    const legacyDev = byDate[today].device;
    const legacyMan = byDate[today].manual;
    const fallbackHrvC = legacyDev?.parsed_hrv != null && !todayMeta.hrv
      ? classifyHrv(legacyDev.parsed_hrv) : null;
    const fallbackRhrC = legacyDev?.parsed_rhr != null && !todayMeta.rhr
      ? classifyRhr(legacyDev.parsed_rhr) : null;
    const fallbackSleepC =
      todayMeta.sleep ? null :
      legacyDev?.parsed_sleep_hours != null ? classifySleep(legacyDev.parsed_sleep_hours)
      : legacyMan?.sleep_hours != null ? classifySleep(legacyMan.sleep_hours)
      : null;

    type SignalSummary = {
      present: boolean;
      confidence: SigConfidence;
      validity: Validity;
      freshness: Freshness;
      source_method: string | null;
      source_provider: string | null;
      reason_codes: ReasonCode[];
      value: number | null;
    };
    const blankSig: SignalSummary = {
      present: false, confidence: "LOW", validity: "missing", freshness: "missing",
      source_method: null, source_provider: null, reason_codes: [], value: null,
    };

    const hrvSig: SignalSummary = todayMeta.hrv ? {
      present: true, confidence: todayMeta.hrv.confidence, validity: todayMeta.hrv.validity,
      freshness: todayMeta.hrv.freshness, source_method: todayMeta.hrv.source_method,
      source_provider: todayMeta.hrv.source_provider, reason_codes: todayMeta.hrv.reason_codes,
      value: todayMeta.hrv.value,
    } : fallbackHrvC ? {
      present: fallbackHrvC.value != null,
      confidence: fallbackHrvC.validity === "valid" ? "MEDIUM" : fallbackHrvC.validity === "suspicious" ? "LOW" : "LOW",
      validity: fallbackHrvC.validity, freshness: "unknown",
      source_method: "screenshot", source_provider: "unknown",
      reason_codes: fallbackHrvC.reason_codes, value: fallbackHrvC.value,
    } : { ...blankSig, reason_codes: [REASON.HRV_MISSING] };

    const rhrSig: SignalSummary = todayMeta.rhr ? {
      present: true, confidence: todayMeta.rhr.confidence, validity: todayMeta.rhr.validity,
      freshness: todayMeta.rhr.freshness, source_method: todayMeta.rhr.source_method,
      source_provider: todayMeta.rhr.source_provider, reason_codes: todayMeta.rhr.reason_codes,
      value: todayMeta.rhr.value,
    } : fallbackRhrC ? {
      present: fallbackRhrC.value != null,
      confidence: fallbackRhrC.validity === "valid" ? "MEDIUM" : "LOW",
      validity: fallbackRhrC.validity, freshness: "unknown",
      source_method: "screenshot", source_provider: "unknown",
      reason_codes: fallbackRhrC.reason_codes, value: fallbackRhrC.value,
    } : { ...blankSig, reason_codes: [REASON.RHR_MISSING] };

    const sleepSig: SignalSummary = todayMeta.sleep ? {
      present: true, confidence: todayMeta.sleep.confidence, validity: todayMeta.sleep.validity,
      freshness: todayMeta.sleep.freshness, source_method: todayMeta.sleep.source_method,
      source_provider: todayMeta.sleep.source_provider, reason_codes: todayMeta.sleep.reason_codes,
      value: todayMeta.sleep.value,
    } : fallbackSleepC ? {
      present: fallbackSleepC.value != null,
      confidence: fallbackSleepC.validity === "valid" ? "MEDIUM" : "LOW",
      validity: fallbackSleepC.validity, freshness: "unknown",
      source_method: legacyDev?.parsed_sleep_hours != null ? "screenshot" : "manual",
      source_provider: legacyDev?.parsed_sleep_hours != null ? "unknown" : "user",
      reason_codes: fallbackSleepC.reason_codes, value: fallbackSleepC.value,
    } : { ...blankSig, reason_codes: [REASON.SLEEP_MISSING] };

    if (sleepSig.confidence === "LOW" && sleepSig.present) {
      sleepSig.reason_codes = dedupe([...sleepSig.reason_codes, REASON.LOW_SLEEP_CONFIDENCE]);
    }
    if (hrvSig.confidence === "HIGH") {
      hrvSig.reason_codes = dedupe([...hrvSig.reason_codes, REASON.HRV_HIGH_CONFIDENCE]);
    }

    const nutritionSig: SignalSummary = {
      present: today_.mealQuality != null,
      confidence: today_.mealQuality != null
        ? (today_.meals.length >= 2 ? "HIGH" : "MEDIUM")
        : "LOW",
      validity: today_.mealQuality != null ? "valid" : "missing",
      freshness: today_.mealQuality != null ? "fresh" : "missing",
      source_method: "nutrition_log", source_provider: "user",
      reason_codes: [], value: today_.mealQuality,
    };
    const hydrationTarget = (perDay[2] as any).hydrationTargetMl as number | null;
    const hydrationPct = (perDay[2] as any).hydrationPct as number | null;
    const hydrationSig: SignalSummary = {
      present: today_.hydrationMl != null,
      confidence: today_.hydrationMl != null ? "HIGH" : "LOW",
      validity: today_.hydrationMl != null ? "valid" : "missing",
      freshness: today_.hydrationMl != null ? "fresh" : "missing",
      source_method: "manual", source_provider: "user",
      reason_codes: hydrationPct != null && hydrationPct < 70 ? [REASON.HYDRATION_BELOW_TARGET] : [],
      value: today_.hydrationMl,
    };
    const priorStrainPresent = loadDays.some((d) => d.date !== today && d.strain > 0);
    const trainingPresent = today_.hadTraining || priorStrainPresent;
    const trainingSig: SignalSummary = {
      present: trainingPresent,
      confidence: today_.hadTraining ? "HIGH" : priorStrainPresent ? "MEDIUM" : "LOW",
      validity: trainingPresent ? "valid" : "missing",
      freshness: today_.hadTraining ? "fresh" : priorStrainPresent ? "stale" : "missing",
      source_method: "workout_log", source_provider: "user",
      reason_codes: [...loadReasons],
      value: today_.hadTraining ? today_.strainNorm : (systemic_load > 0 ? systemic_load : null),
    };
    const moodSig: SignalSummary = {
      present: presentToday.mood,
      confidence: presentToday.mood ? "HIGH" : "LOW",
      validity: presentToday.mood ? "valid" : "missing",
      freshness: presentToday.mood ? "fresh" : "missing",
      source_method: "mood_log", source_provider: "user",
      reason_codes: [], value: presentToday.mood ? today_.scores.mood ?? null : null,
    };

    // Overall sig quality.
    const backboneHigh = hrvSig.confidence === "HIGH" && sleepSig.confidence === "HIGH";
    const anyMedium = [hrvSig, sleepSig, nutritionSig].some((s) => s.confidence === "MEDIUM");
    const overall_sq: SigConfidence = backboneHigh
      ? "HIGH"
      : (coverage >= 0.45 || anyMedium ? "MEDIUM" : "LOW");

    const signal_quality = {
      overall: overall_sq,
      signals: {
        hrv: hrvSig, rhr: rhrSig, sleep: sleepSig,
        nutrition: nutritionSig, hydration: hydrationSig,
        training: trainingSig, mood: moodSig,
      },
    };

    // Aggregate top-level reason_codes.
    for (const s of [hrvSig, rhrSig, sleepSig, nutritionSig, hydrationSig, trainingSig, moodSig]) {
      reasonCodesAll.push(...s.reason_codes);
    }
    if (lowReadiness) reasonCodesAll.push(REASON.PRE_SESSION_LOW_READINESS);
    if (today_.usedManual && presentToday.recovery && !hrvSig.present) {
      reasonCodesAll.push(REASON.MANUAL_RECOVERY_DISCOUNTED);
    }
    if (!hrvSig.present && !rhrSig.present) {
      reasonCodesAll.push(REASON.MANUAL_FALLBACK_REQUIRED);
    }

    // Fuelling status — pull today's nutrition totals from legacy meals query.
    const todayMeals = (mealsRes.data ?? []).filter((m: any) => m.entry_date === today && !m.deleted);
    const loggedMealsToday = todayMeals.length > 0;
    const todayCalories = todayMeals.reduce((a: number, m: any) => a + Number(m.total_calories ?? 0), 0);
    const todayProtein = todayMeals.reduce((a: number, m: any) => a + Number(m.total_protein_g ?? 0), 0);
    const target = (targetsRes.data ?? [])[0];
    const proteinPct = loggedMealsToday && target?.target_protein_g
      ? Math.round((todayProtein / Number(target.target_protein_g)) * 100)
      : null;
    const caloriesPct = loggedMealsToday && target?.target_calories
      ? Math.round((todayCalories / Number(target.target_calories)) * 100)
      : null;
    const fuelReasons: ReasonCode[] = [];
    if (!loggedMealsToday) {
      fuelReasons.push(REASON.NUTRITION_NOT_LOGGED);
    } else {
      if (proteinPct != null && proteinPct < 80) fuelReasons.push(REASON.PROTEIN_LOW_FOR_GOAL);
      if (caloriesPct != null && caloriesPct < 75 && systemic_load >= 25) {
        fuelReasons.push(REASON.DEFICIT_CAUTION_LOW_RECOVERY);
      }
    }
    if (fuelReasons.length) reasonCodesAll.push(...fuelReasons);

    const fuelling_status = {
      hydration_pct: hydrationPct,
      hydration_target_ml: hydrationTarget,
      protein_pct: proteinPct,
      calories_pct: caloriesPct,
      reason_codes: fuelReasons,
    };

    // top_drivers — pillar deltas + carryover.
    type Driver = { type: "positive" | "negative"; label: string; impact: string };
    const PILLAR_LABEL: Record<PillarKey, { pos: string; neg: string }> = {
      recovery: { pos: "Strong recovery signal", neg: "Recovery running low" },
      sleep: { pos: "Solid sleep last night", neg: "Sleep debt building" },
      nutrition: { pos: "Nutrition on target", neg: "Nutrition off target" },
      training: { pos: "Training load balanced", neg: "Training load heavy" },
      mood: { pos: "Mood trending up", neg: "Mood trending down" },
    };
    const drivers: Array<Driver & { _abs: number }> = [];
    const backbonePresentForDrivers = hrvSig.present || rhrSig.present;
    for (const p of PILLAR_KEYS) {
      const v = today_.scores[p];
      if (v == null) continue;
      let impact = Math.round(((v - NEUTRAL) * W[p]) / 100);
      if (impact === 0) continue;
      let label = impact > 0 ? PILLAR_LABEL[p].pos : PILLAR_LABEL[p].neg;
      // Recovery: when device backbone is absent, manual recovery can't claim a strong positive.
      if (p === "recovery" && impact > 0 && !backbonePresentForDrivers) {
        label = "Manual recovery check-in";
        impact = Math.min(impact, 3);
      }
      // Nutrition: only emit positive when meals were actually logged today.
      if (p === "nutrition" && impact > 0 && today_.mealQuality == null) continue;
      drivers.push({
        type: impact > 0 ? "positive" : "negative",
        label,
        impact: (impact > 0 ? "+" : "") + impact,
        _abs: Math.abs(impact),
      });
    }
    // Hydration negative driver — independent of nutrition pillar.
    if (hydrationPct != null && hydrationPct < 80) {
      const hImpact = -Math.min(5, Math.max(1, Math.round((80 - hydrationPct) / 8)));
      drivers.push({
        type: "negative",
        label: "Hydration below target",
        impact: String(hImpact),
        _abs: Math.abs(hImpact),
      });
    }
    // training_permission (rule-based) — computed before drivers so we know
    // whether load carryover is the decisive factor.
    let training_permission: "green_train" | "yellow_modify" | "orange_reduce" | "red_recover";
    if (final_score < 45 || systemic_load > 50) training_permission = "red_recover";
    else if (final_score < 60 || systemic_load > 35 || lowReadiness) training_permission = "orange_reduce";
    else if (final_score < 75 || systemic_load >= 25) training_permission = "yellow_modify";
    else training_permission = "green_train";

    const loadIsDecisive =
      systemic_load > 50 ||
      (training_permission === "orange_reduce" && systemic_load > 35) ||
      (training_permission === "yellow_modify" && systemic_load >= 25) ||
      (training_permission === "red_recover" && systemic_load >= 25);

    // Carryover driver: only emit for >=5 systemic_load, OR when it's decisive.
    if (systemic_load >= 25 || loadIsDecisive) {
      const carryImpact = -Math.min(10, Math.max(5, Math.round(systemic_load / 5)));
      drivers.push({
        type: "negative",
        label: "Training load carrying over",
        impact: String(carryImpact),
        _abs: Math.abs(carryImpact),
      });
    } else if (systemic_load >= 5) {
      const carryImpact = -Math.min(3, Math.max(1, Math.round(systemic_load / 5)));
      drivers.push({
        type: "negative",
        label: "Training load carrying over",
        impact: String(carryImpact),
        _abs: Math.abs(carryImpact),
      });
    }
    // Deterministic tie-break: negatives win ties so decisive load shows.
    drivers.sort((a, b) =>
      (b._abs - a._abs) ||
      (a.type === b.type ? 0 : a.type === "negative" ? -1 : 1)
    );
    // Force-bump carryover when it's decisive but its raw |impact| would lose.
    if (loadIsDecisive) {
      const carryIdx = drivers.findIndex((d) => d.label === "Training load carrying over");
      if (carryIdx > 3) {
        const maxAbs = Math.max(0, ...drivers.slice(0, 4).map((d) => d._abs));
        drivers[carryIdx]._abs = maxAbs + 1;
        drivers.sort((a, b) =>
          (b._abs - a._abs) ||
          (a.type === b.type ? 0 : a.type === "negative" ? -1 : 1)
        );
      }
    }
    const top_drivers = drivers.slice(0, 4).map(({ _abs: _omit, ...d }) => d);

    // Ensure decisive carryover surfaces in reason channels even if it
    // would have been demoted below the HIGH threshold.
    if (loadIsDecisive && !reasonCodesAll.includes(REASON.HIGH_LOAD_CARRYOVER)) {
      reasonCodesAll.push(REASON.HIGH_LOAD_CARRYOVER);
      loadReasons.push(REASON.HIGH_LOAD_CARRYOVER);
      load_carryover.reason_codes = loadReasons;
      trainingSig.reason_codes = dedupe([...trainingSig.reason_codes, REASON.HIGH_LOAD_CARRYOVER]);
    }

    // nutrition_modifier (rule-based). recovery_day_refeed requires a visible
    // material cause — otherwise downgrade to deficit_caution / normal.
    let nutrition_modifier:
      | "normal" | "fuel_more" | "protein_priority" | "hydration_priority"
      | "deficit_caution" | "recovery_day_refeed";
    const nutritionPillar = today_.scores.nutrition ?? NEUTRAL;
    const recoveryLowDriver = top_drivers.some((d) => d.label === "Recovery running low");
    const loadDriverVisible = top_drivers.some((d) => d.label === "Training load carrying over");
    const hasRefeedCause =
      reasonCodesAll.includes(REASON.HIGH_LOAD_CARRYOVER) ||
      (reasonCodesAll.includes(REASON.TRAINING_LOAD_CARRYOVER) && systemic_load >= 5) ||
      recoveryLowDriver ||
      loadDriverVisible ||
      (reasonCodesAll.includes(REASON.MANUAL_RECOVERY_DISCOUNTED) && lowReadiness);

    if (training_permission === "red_recover" && hasRefeedCause) {
      nutrition_modifier = "recovery_day_refeed";
    } else if (hydrationPct != null && hydrationPct < 70) nutrition_modifier = "hydration_priority";
    else if (proteinPct != null && proteinPct < 80) nutrition_modifier = "protein_priority";
    else if (nutritionPillar < 50 && systemic_load >= 25) nutrition_modifier = "deficit_caution";
    else if (training_permission === "red_recover") nutrition_modifier = "deficit_caution";
    else if (final_score >= 70 && systemic_load >= 25 && nutritionPillar < 60) nutrition_modifier = "fuel_more";
    else nutrition_modifier = "normal";

    const reason_codes = dedupe(reasonCodesAll);

    // Align stored confidence_level with signal quality (never higher).
    const CONF_ORDER: Record<string, number> = { LOW: 1, MEDIUM: 2, HIGH: 3 };
    const minConf = (a: SigConfidence, b: SigConfidence): SigConfidence =>
      CONF_ORDER[a] <= CONF_ORDER[b] ? a : b;
    let effectiveConfidence: SigConfidence = confidence.toUpperCase() as SigConfidence;
    const manualOnlyBackbone = !hrvSig.present && !rhrSig.present;
    if (manualOnlyBackbone) effectiveConfidence = minConf(effectiveConfidence, "MEDIUM");
    if (!backboneHigh && effectiveConfidence === "HIGH") effectiveConfidence = "MEDIUM";
    effectiveConfidence = minConf(effectiveConfidence, overall_sq);

    // ---------------- write readiness_scores ----------------
    const row = {
      user_id,
      score_date: today,
      final_score,
      confidence_level: effectiveConfidence,
      pillar_breakdown,
      fatigue_adjustment: -penalty,
      pre_session_adjustment: -preSessionDelta,
      nudge_message,
      input_path,
      engine_version: ENGINE_VERSION,
      signal_quality,
      top_drivers,
      load_carryover,
      fuelling_status,
      training_permission,
      nutrition_modifier,
      reason_codes,
    };
    const { error: upErr } = await supabase
      .from("readiness_scores")
      .upsert(row, { onConflict: "user_id,score_date" });
    if (upErr) throw upErr;

    // ---------------- write shield_signal_quality_events (idempotent) ----------------
    await supabase
      .from("shield_signal_quality_events")
      .delete()
      .eq("user_id", user_id)
      .eq("signal_date", today)
      .eq("source_type", "system")
      .eq("source_table", "readiness_scores");

    type QualityEvent = {
      user_id: string; signal_date: string;
      source_table: string; source_id: string | null;
      metric_name: string; raw_value: number | null; normalized_value: number | null; unit: string | null;
      source_type: "system"; device_source: string | null;
      freshness_status: string | null; validity_status: string | null;
      confidence_level: string | null; reason_codes: string[];
    };
    const events: QualityEvent[] = [];
    const pushEv = (metric: string, s: SignalSummary, normalized: number | null, unit: string | null) => {
      events.push({
        user_id, signal_date: today,
        source_table: "readiness_scores", source_id: null,
        metric_name: metric, raw_value: s.value, normalized_value: normalized, unit,
        source_type: "system",
        device_source: s.source_provider && ["whoop","oura","garmin","apple_health","health_connect","samsung_health","user","apex","unknown"].includes(s.source_provider) ? s.source_provider : null,
        freshness_status: s.freshness, validity_status: s.validity,
        confidence_level: s.confidence,
        reason_codes: s.reason_codes,
      });
    };
    pushEv("hrv", hrvSig, hrvSig.value, "ms");
    pushEv("rhr", rhrSig, rhrSig.value, "bpm");
    pushEv("sleep", sleepSig, today_.scores.sleep ?? null, "h");
    pushEv("recovery", {
      present: presentToday.recovery,
      confidence: presentToday.recovery ? (today_.usedDevice ? "HIGH" : "MEDIUM") : "LOW",
      validity: presentToday.recovery ? "valid" : "missing",
      freshness: presentToday.recovery ? "fresh" : "missing",
      source_method: today_.usedDevice ? "screenshot" : "manual",
      source_provider: today_.usedDevice ? (hrvSig.source_provider ?? "unknown") : "user",
      reason_codes: [], value: today_.scores.recovery ?? null,
    }, today_.scores.recovery ?? null, "score");
    pushEv("nutrition", nutritionSig, today_.scores.nutrition ?? null, "score");
    pushEv("hydration", hydrationSig, hydrationPct, "pct");
    pushEv("training", trainingSig, today_.scores.training ?? null, "score");
    pushEv("mood", moodSig, today_.scores.mood ?? null, "score");
    pushEv("pre_session", {
      present: psc != null,
      confidence: psc != null ? "HIGH" : "LOW",
      validity: psc != null ? "valid" : "missing",
      freshness: psc != null ? "fresh" : "missing",
      source_method: "manual", source_provider: "user",
      reason_codes: lowReadiness ? [REASON.PRE_SESSION_LOW_READINESS] : [],
      value: psc != null ? Number(psc.session_readiness) : null,
    }, psc != null ? Number(psc.session_readiness) : null, "rating");

    if (events.length > 0) {
      const { error: evErr } = await supabase.from("shield_signal_quality_events").insert(events);
      if (evErr) console.error("shield_signal_quality_events insert failed:", evErr);
    }

    return new Response(
      JSON.stringify({
        previous_score,
        new_score: final_score,
        confidence_level: row.confidence_level,
        coverage,
        fatigue_adjustment: row.fatigue_adjustment,
        pre_session_adjustment: row.pre_session_adjustment,
        pillar_breakdown,
        nudge_pillar,
        nudge_message,
        input_path,
        engine_version: ENGINE_VERSION,
        signal_quality_overall: overall_sq,
        training_permission,
        nutrition_modifier,
        systemic_load,
        reason_codes,
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
