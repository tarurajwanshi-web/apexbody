// Parse a wearable screenshot (Whoop/Oura/Garmin) into structured recovery
// metrics using Anthropic Claude vision. On success, sets parse_status='parsed'
// on shield_device_uploads, which triggers calculate-score via DB webhook.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
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

    // Fetch image and base64-encode. `screenshot_url` may be either a fully-qualified
    // URL (legacy) or a storage path within the `shield-uploads` bucket (current).
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
        // Treat as a storage path. Strip a leading bucket prefix if present.
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
      `{ "hrv_ms": <number|null>, "rhr_bpm": <number|null>, "sleep_hours": <number|null>, "data_date": <"YYYY-MM-DD"|null> }. ` +
      `hrv_ms: heart rate variability in milliseconds (RMSSD-style; typical 20-150). ` +
      `rhr_bpm: resting heart rate in beats per minute (typical 40-90). ` +
      `sleep_hours: total sleep time in hours (decimal, e.g. 7.5). ` +
      `data_date: the calendar date the screenshot is reporting recovery for, ` +
      `read from the image (header, date selector, "Mar 14", etc.). ` +
      `Return ISO YYYY-MM-DD. If only a relative label like "Today"/"Yesterday" is visible ` +
      `with no real date, return null — do not guess. ` +
      `If any other metric is not clearly visible, return null for that field. ` +
      `Do not guess. Convert units if needed (e.g. "7h 30m" → 7.5).`;

    const aRes = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": anthropicKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 300,
        system: systemPrompt,
        messages: [{
          role: "user",
          content: [
            { type: "image", source: { type: "base64", media_type, data: b64 } },
            { type: "text", text: `Extract HRV, RHR, sleep hours, and the data date from this ${row.device_source} screenshot.` },
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
    } catch (e) {
      await markFailed(row.user_id, row.entry_date);
      return new Response(JSON.stringify({ error: "parse failed", raw: text }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const parsed_hrv = numOrNull(parsed.hrv_ms);
    const parsed_rhr = numOrNull(parsed.rhr_bpm);
    const parsed_sleep_hours = numOrNull(parsed.sleep_hours);
    // data_date: only accept a strict YYYY-MM-DD; otherwise null (caller defaults to today).
    const parsed_date: string | null =
      typeof parsed.data_date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(parsed.data_date)
        ? parsed.data_date
        : null;

    // Journey C: total parse failure. If NOTHING usable came back (HRV, RHR,
    // sleep all null), don't pretend we have data — mark failed so the UI
    // can route the user into the per-day manual fallback path.
    const totalFailure = parsed_hrv == null && parsed_rhr == null && parsed_sleep_hours == null;
    const nextStatus = totalFailure ? "failed" : "parsed";

    const { data: updated, error: upErr } = await supabase
      .from("shield_device_uploads")
      .update({
        parsed_hrv,
        parsed_rhr,
        parsed_sleep_hours,
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

    return new Response(
      JSON.stringify({ row: updated, parsed: { parsed_hrv, parsed_rhr, parsed_sleep_hours } }),
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
