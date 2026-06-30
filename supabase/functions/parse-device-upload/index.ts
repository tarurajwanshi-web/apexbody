// Parse a wearable screenshot (Whoop/Oura/Garmin) into structured recovery
// metrics using Anthropic Claude vision. On success, sets parse_status='parsed'
// on shield_device_uploads, which triggers calculate-score via DB webhook.
//
// v6.3: also writes normalized rows into public.shield_health_signals so the
// readiness engine can be source-agnostic (screenshot today, native health
// later via Capacitor/Health Connect/etc.). Validates every numeric using
// the shared signal-quality helpers — invalid values are NULL'd, suspicious
// values are kept but tagged.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { authorizeCaller, corsAllowHeaders } from "../_shared/authorize.ts";
import {
  classifyHrv,
  classifyRhr,
  classifySleep,
  classifyFreshness,
  confidenceFromDeviceSet,
  confidenceForMetric,
  REASON,
  dedupe,
  type Validity,
  type Freshness,
  type Confidence,
  type ReasonCode,
} from "../_shared/signal-quality.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": corsAllowHeaders,
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function stripFences(text: string): string {
  let t = text.trim();
  if (t.startsWith("```")) t = t.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "");
  return t.trim();
}

function numOrNull(v: unknown): number | null {
  if (v === null || v === undefined || v === "" || v === "null") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

type SignalRow = {
  user_id: string;
  signal_date: string;
  metric_name: string;
  metric_value: number;
  unit: string | null;
  source_method: "screenshot";
  source_provider: string;
  source_table: "shield_device_uploads";
  source_id: string;
  confidence_level: Confidence;
  freshness_status: Freshness;
  validity_status: Exclude<Validity, "missing">;
  reason_codes: ReasonCode[];
  metadata: Record<string, unknown>;
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const anthropicKey = Deno.env.get("ANTHROPIC_API_KEY");
  const supabase = createClient(supabaseUrl, serviceKey);

  const markFailed = async (uid: string, date: string) => {
    await supabase
      .from("shield_device_uploads")
      .update({ parse_status: "failed" })
      .eq("user_id", uid)
      .eq("entry_date", date);
  };

  try {
    const body = await req.json();
    const { user_id, entry_date, upload_id } = body ?? {};

    let row: any = null;
    if (upload_id) {
      const { data } = await supabase
        .from("shield_device_uploads")
        .select("*")
        .eq("id", upload_id)
        .single();
      row = data;
    } else if (user_id && entry_date) {
      const { data } = await supabase
        .from("shield_device_uploads")
        .select("*")
        .eq("user_id", user_id)
        .eq("entry_date", entry_date)
        .single();
      row = data;
    }

    if (!row) {
      return new Response(JSON.stringify({ error: "upload not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const authz = await authorizeCaller(req, supabase, row.user_id);
    if (!authz.ok) {
      return new Response(JSON.stringify({ error: authz.error }), {
        status: authz.status, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!anthropicKey) {
      await markFailed(row.user_id, row.entry_date);
      return new Response(JSON.stringify({ error: "ANTHROPIC_API_KEY missing" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!row.screenshot_url) {
      await markFailed(row.user_id, row.entry_date);
      return new Response(JSON.stringify({ error: "screenshot_url missing" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Fetch image and base64-encode.
    let b64 = "";
    let media_type = "image/jpeg";
    try {
      const src: string = row.screenshot_url;
      const isHttp = /^https?:\/\//i.test(src);
      let buf: Uint8Array;
      if (isHttp) {
        const imgRes = await fetch(src);
        if (!imgRes.ok) throw new Error(`image fetch ${imgRes.status}`);
        buf = new Uint8Array(await imgRes.arrayBuffer());
        media_type = imgRes.headers.get("content-type") || "image/jpeg";
      } else {
        const path = src.replace(/^shield-uploads\//, "");
        const { data: blob, error: dlErr } = await supabase
          .storage.from("shield-uploads").download(path);
        if (dlErr || !blob) throw new Error(`storage download: ${dlErr?.message ?? "no blob"}`);
        buf = new Uint8Array(await blob.arrayBuffer());
        media_type = blob.type || (path.toLowerCase().endsWith(".png") ? "image/png" : "image/jpeg");
      }
      let bin = "";
      for (let i = 0; i < buf.length; i++) bin += String.fromCharCode(buf[i]);
      b64 = btoa(bin);
    } catch (e) {
      await markFailed(row.user_id, row.entry_date);
      return new Response(JSON.stringify({ error: `image fetch failed: ${String(e)}` }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const systemPrompt =
      `You are extracting recovery metrics from a screenshot of a ${row.device_source} wearable app. ` +
      `Respond with ONLY a single JSON object, no prose, no markdown fences: ` +
      `{ "hrv_ms": <number|null>, "rhr_bpm": <number|null>, "sleep_hours": <number|null>, ` +
      `"sleep_deep_hours": <number|null>, "sleep_rem_hours": <number|null>, "sleep_awake_hours": <number|null>, ` +
      `"recovery_score": <number|null>, "body_battery": <number|null>, "data_date": <"YYYY-MM-DD"|null> }. ` +
      `hrv_ms: heart rate variability in milliseconds (RMSSD-style; typical 20-150). ` +
      `rhr_bpm: resting heart rate in beats per minute (typical 40-90). ` +
      `sleep_hours: total sleep time in hours (decimal, e.g. 7.5). ` +
      `sleep_deep_hours/sleep_rem_hours/sleep_awake_hours: stage hours if explicitly visible. ` +
      `recovery_score: 0-100 device "recovery %" or readiness % if shown (Whoop recovery, Oura readiness). ` +
      `body_battery: 0-100 Garmin Body Battery, only for Garmin screenshots. ` +
      `data_date: the calendar date the screenshot reports for, read from the image. ` +
      `Return ISO YYYY-MM-DD. If only a relative label like "Today"/"Yesterday" with no real date, return null. ` +
      `If a metric is not clearly visible, return null. Do not guess. Convert units if needed (e.g. "7h 30m" → 7.5).`;

    const aRes = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": anthropicKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 400,
        system: systemPrompt,
        messages: [{
          role: "user",
          content: [
            { type: "image", source: { type: "base64", media_type, data: b64 } },
            { type: "text", text: `Extract recovery metrics from this ${row.device_source} screenshot. Return only the JSON object.` },
          ],
        }],
      }),
    });

    if (!aRes.ok) {
      await markFailed(row.user_id, row.entry_date);
      const txt = await aRes.text();
      console.error("Anthropic error:", aRes.status, txt);
      return new Response(JSON.stringify({ error: `anthropic ${aRes.status}` }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const aJson = await aRes.json();
    const text = aJson?.content?.[0]?.text ?? "";
    let parsed: any;
    try {
      parsed = JSON.parse(stripFences(text));
    } catch (_e) {
      await markFailed(row.user_id, row.entry_date);
      return new Response(JSON.stringify({ error: "parse failed", raw: text }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Validate every numeric using shared classifiers.
    const hrvC = classifyHrv(numOrNull(parsed.hrv_ms));
    const rhrC = classifyRhr(numOrNull(parsed.rhr_bpm));
    const sleepC = classifySleep(numOrNull(parsed.sleep_hours));
    const deepC = classifySleep(numOrNull(parsed.sleep_deep_hours)); // looser bounds OK for stages
    const remC = classifySleep(numOrNull(parsed.sleep_rem_hours));
    const awakeC = classifySleep(numOrNull(parsed.sleep_awake_hours));
    const recoveryScore = numOrNull(parsed.recovery_score);
    const bodyBattery = numOrNull(parsed.body_battery);

    const parsed_date: string | null =
      typeof parsed.data_date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(parsed.data_date)
        ? parsed.data_date
        : null;
    const freshness = classifyFreshness(parsed_date, row.entry_date);

    // hrv/rhr/sleep usability for the upload-level confidence calc.
    const hrvOk = hrvC.validity === "valid" || hrvC.validity === "suspicious";
    const rhrOk = rhrC.validity === "valid" || rhrC.validity === "suspicious";
    const sleepOk = sleepC.validity === "valid" || sleepC.validity === "suspicious";

    // proxy-only screenshot: no HRV/RHR/sleep numeric, but a device score visible.
    const hasCoreMetric = hrvOk || rhrOk || sleepOk;
    const hasProxy = recoveryScore != null || bodyBattery != null;
    const providerProxyOnly = !hasCoreMetric && hasProxy;

    const uploadConfidence = confidenceFromDeviceSet({
      hrvOk, rhrOk, sleepOk, freshness, providerProxyOnly,
    });

    // Per-upload reason codes.
    const uploadReasons: ReasonCode[] = [];
    if (!hrvOk) uploadReasons.push(REASON.HRV_MISSING);
    if (!rhrOk) uploadReasons.push(REASON.RHR_MISSING);
    if (!sleepOk) uploadReasons.push(REASON.SLEEP_MISSING);
    if (hrvC.validity === "suspicious") uploadReasons.push(REASON.HRV_SUSPICIOUS_RANGE);
    if (hrvC.validity === "invalid") uploadReasons.push(REASON.HRV_INVALID_RANGE);
    if (rhrC.validity === "suspicious") uploadReasons.push(REASON.RHR_SUSPICIOUS_RANGE);
    if (rhrC.validity === "invalid") uploadReasons.push(REASON.RHR_INVALID_RANGE);
    if (sleepC.validity === "suspicious") uploadReasons.push(REASON.SLEEP_SUSPICIOUS_RANGE);
    if (sleepC.validity === "invalid") uploadReasons.push(REASON.SLEEP_INVALID_RANGE);
    if (freshness === "stale") uploadReasons.push(REASON.DEVICE_SIGNAL_STALE);
    if (providerProxyOnly) uploadReasons.push(REASON.DEVICE_PROXY_SCORE_ONLY);
    if (hasCoreMetric && !(hrvOk && rhrOk && sleepOk)) {
      uploadReasons.push(REASON.DEVICE_PARTIAL_PARSE);
    }
    if (hrvOk && uploadConfidence === "HIGH") uploadReasons.push(REASON.HRV_HIGH_CONFIDENCE);

    // Total failure: nothing usable came back.
    const totalFailure = !hasCoreMetric && !hasProxy;
    const nextStatus = totalFailure ? "failed" : "parsed";

    // Persist legacy columns. Invalid values are stored as NULL — never guess.
    const { data: updated, error: upErr } = await supabase
      .from("shield_device_uploads")
      .update({
        parsed_hrv: hrvC.value,
        parsed_rhr: rhrC.value,
        parsed_sleep_hours: sleepC.value,
        parsed_date,
        parse_status: nextStatus,
      })
      .eq("id", row.id)
      .select()
      .single();

    if (upErr) {
      console.error("update failed:", upErr);
      return new Response(JSON.stringify({ error: upErr.message }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Normalize into shield_health_signals. Skip on total failure — never
    // write guessed data; calculate-score will fall back to manual/neutral.
    if (!totalFailure) {
      const provider: string = String(row.device_source ?? "unknown");
      const baseRow = {
        user_id: row.user_id,
        signal_date: row.entry_date,
        source_method: "screenshot" as const,
        source_provider: provider,
        source_table: "shield_device_uploads" as const,
        source_id: row.id,
        freshness_status: freshness,
        metadata: { parsed_date, upload_confidence: uploadConfidence, proxy_only: providerProxyOnly },
      };

      const rows: SignalRow[] = [];
      const pushMetric = (
        metric_name: string,
        c: { validity: Validity; value: number | null; reason_codes: ReasonCode[] },
        unit: string | null,
      ) => {
        if (c.value == null || c.validity === "invalid" || c.validity === "missing") return;
        const validity = c.validity as Exclude<Validity, "missing">;
        const conf = confidenceForMetric(validity, freshness);
        // HRV missing in the SET → cap non-HRV metrics at MEDIUM.
        const cappedConf: Confidence =
          metric_name !== "hrv_ms" && !hrvOk && conf === "HIGH" ? "MEDIUM" : conf;
        rows.push({
          ...baseRow,
          metric_name,
          metric_value: c.value,
          unit,
          confidence_level: cappedConf,
          validity_status: validity,
          reason_codes: dedupe(c.reason_codes),
        });
      };

      pushMetric("hrv_ms", hrvC, "ms");
      pushMetric("resting_heart_rate_bpm", rhrC, "bpm");
      pushMetric("sleep_hours", sleepC, "h");
      pushMetric("sleep_deep_hours", deepC, "h");
      pushMetric("sleep_rem_hours", remC, "h");
      pushMetric("sleep_awake_hours", awakeC, "h");

      if (recoveryScore != null && recoveryScore >= 0 && recoveryScore <= 100) {
        const metric = providerProxyOnly ? "readiness_proxy_score" : "recovery_score";
        const conf: Confidence = providerProxyOnly
          ? (freshness === "stale" ? "LOW" : "MEDIUM")
          : (freshness === "stale" ? "MEDIUM" : "HIGH");
        rows.push({
          ...baseRow,
          metric_name: metric,
          metric_value: recoveryScore,
          unit: "pct",
          confidence_level: conf,
          validity_status: "valid",
          reason_codes: providerProxyOnly ? [REASON.DEVICE_PROXY_SCORE_ONLY] : [],
        });
      }
      if (bodyBattery != null && bodyBattery >= 0 && bodyBattery <= 100 && provider === "garmin") {
        rows.push({
          ...baseRow,
          metric_name: "body_battery",
          metric_value: bodyBattery,
          unit: "pct",
          confidence_level: providerProxyOnly ? "MEDIUM" : "HIGH",
          validity_status: "valid",
          reason_codes: providerProxyOnly ? [REASON.DEVICE_PROXY_SCORE_ONLY] : [],
        });
      }

      // Clear any prior rows from this same upload, then insert fresh.
      await supabase
        .from("shield_health_signals")
        .delete()
        .eq("user_id", row.user_id)
        .eq("signal_date", row.entry_date)
        .eq("source_table", "shield_device_uploads")
        .eq("source_id", row.id);

      if (rows.length > 0) {
        const { error: sigErr } = await supabase.from("shield_health_signals").insert(rows);
        if (sigErr) console.error("shield_health_signals insert failed:", sigErr);
      }
    }

    return new Response(
      JSON.stringify({
        row: updated,
        parsed: {
          parsed_hrv: hrvC.value,
          parsed_rhr: rhrC.value,
          parsed_sleep_hours: sleepC.value,
          parsed_date,
          freshness,
          upload_confidence: uploadConfidence,
          proxy_only: providerProxyOnly,
          reason_codes: dedupe(uploadReasons),
        },
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    console.error("Unhandled:", err);
    return new Response(JSON.stringify({ error: String(err instanceof Error ? err.message : err) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
