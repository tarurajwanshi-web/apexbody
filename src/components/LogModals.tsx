import { useEffect, useRef, useState } from "react";
import { X, Upload, Loader2, Sparkles, Check, Plus, Trash2 } from "lucide-react";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import {
  getInputPathPreference,
  upsertManualRecovery,
  upsertDeviceRecovery,
  upsertMood,
  logMeal,
  updateMeal,
  detectMealItems,
  upsertTraining,
  logHydration,
  getTodayDeviceUploadStatus,
  supplementDeviceRhr,
  reassignDeviceUploadDate,
  logBodyMeasurement,
  type DeviceUploadStatus,
  type ConfirmedMealItem,
} from "@/lib/shield.functions";


type Props = { open: boolean; onClose: () => void; onSaved?: () => void };

function Sheet({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: string; children: React.ReactNode }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[100] flex items-end justify-center" style={{ background: "rgba(0,0,0,0.55)" }} onClick={onClose}>
      <div
        className="w-full max-w-[480px] rounded-t-[24px] p-5 animate-fade-up overflow-y-auto"
        style={{
          background: "#0F1524",
          border: "1px solid rgba(255,255,255,0.06)",
          maxHeight: "calc(90vh - env(safe-area-inset-bottom, 0px))",
          paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 20px)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-[18px] font-semibold text-white">{title}</h2>
          <button onClick={onClose} className="p-1 text-text-secondary active:scale-95 transition" aria-label="Close">
            <X size={20} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

function SubmitBtn({ busy, label, disabled, onClick }: { busy: boolean; label: string; disabled?: boolean; onClick?: () => void }) {
  return (
    <button
      type={onClick ? "button" : "submit"}
      onClick={onClick}
      disabled={busy || disabled}
      className="w-full rounded-2xl gradient-brand py-3 text-center text-[14px] font-semibold text-white active:scale-[0.98] transition disabled:opacity-50 flex items-center justify-center gap-2"
    >
      {busy && <Loader2 size={16} className="animate-spin" />}
      {busy ? "Saving…" : label}
    </button>
  );
}

export function RecoveryLogModal({ open, onClose, onSaved }: Props) {
  const [pref, setPref] = useState<"device" | "manual" | null>(null);
  const [loading, setLoading] = useState(true);
  const getPref = useServerFn(getInputPathPreference);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    getPref()
      .then((p) => setPref(p ?? "manual"))
      .catch(() => setPref("manual"))
      .finally(() => setLoading(false));
  }, [open, getPref]);

  return (
    <Sheet open={open} onClose={onClose} title="Log today's recovery">
      {loading ? (
        <div className="py-10 flex justify-center"><Loader2 className="animate-spin text-text-secondary" /></div>
      ) : pref === "device" ? (
        <DeviceRecoveryForm onSaved={() => { onSaved?.(); onClose(); }} />
      ) : (
        <ManualRecoveryForm onSaved={() => { onSaved?.(); onClose(); }} />
      )}
    </Sheet>
  );
}

// Plain-language mood labels that read like how a person actually describes
// their state. The emoji stays the primary tap target; the word beneath is
// a supporting clarification so the picker isn't emoji-only.
const MOOD_OPTIONS: Array<{ emoji: string; label: string }> = [
  { emoji: "😞", label: "Drained" },
  { emoji: "🙁", label: "Low" },
  { emoji: "😐", label: "Okay" },
  { emoji: "🙂", label: "Good" },
  { emoji: "😄", label: "Motivated" },
];

function MoodPicker({ value, onChange }: { value: string | null; onChange: (v: string) => void }) {
  return (
    <div>
      <label className="text-[12px] uppercase text-text-tertiary tracking-wider">Mood right now</label>
      <div className="mt-3 grid grid-cols-5 gap-2">
        {MOOD_OPTIONS.map((m) => {
          const active = value === m.emoji;
          return (
            <button
              type="button"
              key={m.emoji}
              onClick={() => onChange(m.emoji)}
              aria-label={m.label}
              className="rounded-2xl py-2 px-1 active:scale-95 transition flex flex-col items-center justify-center gap-1"
              style={{
                background: active ? "linear-gradient(135deg, rgba(139,92,246,0.25), rgba(59,130,246,0.18))" : "#0A0E1A",
                border: `1px solid ${active ? "rgba(139,92,246,0.6)" : "rgba(255,255,255,0.08)"}`,
              }}
            >
              <span className="text-[24px] leading-none">{m.emoji}</span>
              <span
                className="text-[10px] font-medium leading-none"
                style={{ color: active ? "#E5E7EB" : "#9CA3AF" }}
              >
                {m.label}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function ManualRecoveryForm({ onSaved }: { onSaved: () => void }) {
  const [rating, setRating] = useState<number | null>(null);
  const [sleep, setSleep] = useState<number>(7.5);
  const [mood, setMood] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const fn = useServerFn(upsertManualRecovery);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (rating == null) return;
    setBusy(true); setErr(null);
    try {
      const { data: s } = await supabase.auth.getSession();
      if (!s.session) throw new Error("Your session expired. Please sign in again.");
      await fn({ data: { recovery_self_rating: rating, sleep_hours: sleep, mood_emoji: mood, client_timezone: getBrowserTimezone() } });
      onSaved();
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Could not save. Try again.";
      setErr(/unauthor/i.test(msg) ? "Your session expired. Please sign in again." : msg);
    } finally { setBusy(false); }
  };

  return (
    <form onSubmit={submit} className="space-y-5">
      <div>
        <label className="text-[12px] uppercase text-text-tertiary tracking-wider">How recovered do you feel?</label>
        <div className="mt-3 grid grid-cols-5 gap-2">
          {[1, 2, 3, 4, 5].map((n) => {
            const active = rating === n;
            return (
              <button
                type="button"
                key={n}
                onClick={() => setRating(n)}
                className="h-14 rounded-2xl text-[18px] font-semibold text-white active:scale-95 transition"
                style={{
                  background: active ? "linear-gradient(135deg, rgba(124,58,237,0.25), rgba(59,130,246,0.25))" : "#0A0E1A",
                  border: `1px solid ${active ? "rgba(124,58,237,0.6)" : "rgba(255,255,255,0.08)"}`,
                }}
              >
                {n}
              </button>
            );
          })}
        </div>
        <div className="mt-2 flex justify-between text-[10px] text-text-tertiary"><span>Drained</span><span>Peak</span></div>
      </div>

      <MoodPicker value={mood} onChange={setMood} />

      <div>
        <label className="text-[12px] uppercase text-text-tertiary tracking-wider">Sleep last night</label>
        <div className="mt-3 flex items-center gap-3">
          <button type="button" onClick={() => setSleep((s) => Math.max(0, +(s - 0.5).toFixed(1)))}
            className="h-11 w-11 rounded-full text-white text-xl active:scale-95 transition"
            style={{ background: "#0A0E1A", border: "1px solid rgba(255,255,255,0.08)" }}>−</button>
          <div className="flex-1 text-center">
            <div className="text-[28px] font-light text-white tabular-nums">{sleep.toFixed(1)}<span className="text-text-tertiary text-[14px] ml-1">hrs</span></div>
          </div>
          <button type="button" onClick={() => setSleep((s) => Math.min(24, +(s + 0.5).toFixed(1)))}
            className="h-11 w-11 rounded-full text-white text-xl active:scale-95 transition"
            style={{ background: "#0A0E1A", border: "1px solid rgba(255,255,255,0.08)" }}>+</button>
        </div>
      </div>

      {err && <p className="text-[12px] text-red-400">{err}</p>}
      <SubmitBtn busy={busy} label="Save recovery" disabled={rating == null} />
    </form>
  );
}

import { getBrowserTimezone, getLocalDateISO } from "@/lib/dates";
function todayISO() { return getLocalDateISO(getBrowserTimezone()); }

function DeviceRecoveryForm({ onSaved }: { onSaved: () => void }) {
  const [source, setSource] = useState<"whoop" | "oura" | "garmin">("whoop");
  const [file, setFile] = useState<File | null>(null);
  const [mood, setMood] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [alreadyUploaded, setAlreadyUploaded] = useState(false);
  const [alreadyMood, setAlreadyMood] = useState<string | null>(null);
  // Post-upload parse state: null = haven't uploaded yet this session.
  const [parseState, setParseState] = useState<DeviceUploadStatus>(null);
  const [polling, setPolling] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const fn = useServerFn(upsertDeviceRecovery);
  const moodFn = useServerFn(upsertMood);
  const statusFn = useServerFn(getTodayDeviceUploadStatus);

  // Detect what's already saved today so the form can accept partial submits.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data: u } = await supabase.auth.getUser();
      const uid = u.user?.id;
      if (!uid) return;
      const today = todayISO();
      const [up, mi] = await Promise.all([
        supabase.from("shield_device_uploads").select("id").eq("user_id", uid).eq("entry_date", today).maybeSingle(),
        supabase.from("shield_manual_inputs").select("mood_emoji").eq("user_id", uid).eq("entry_date", today).maybeSingle(),
      ]);
      if (cancelled) return;
      setAlreadyUploaded(!!up.data);
      const m = (mi.data as any)?.mood_emoji ?? null;
      setAlreadyMood(m);
      if (m) setMood(m);
    })();
    return () => { cancelled = true; };
  }, []);

  // Poll for parse result after an upload. Stop on terminal status or timeout.
  const startPolling = async () => {
    setPolling(true);
    const started = Date.now();
    while (Date.now() - started < 30_000) {
      try {
        const s = await statusFn();
        if (s && (s.parse_status === "parsed" || s.parse_status === "failed")) {
          setParseState(s);
          setPolling(false);
          return;
        }
      } catch { /* retry */ }
      await new Promise((r) => setTimeout(r, 1500));
    }
    setPolling(false);
    // Timeout: leave parseState null so the user sees the timeout message below.
    setErr("Still processing your screenshot — check back in a minute.");
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    // Independent inputs: allow file alone, mood alone, or both. Submission is
    // valid as long as at least one new value (or change) exists, OR the user
    // is updating their mood while a device upload from earlier still stands.
    const hasNewFile = !!file;
    const hasMood = !!mood;
    if (!hasNewFile && !hasMood && !alreadyUploaded) {
      setErr("Add a screenshot or pick a mood — either works.");
      return;
    }
    setBusy(true); setErr(null);
    try {
      if (hasMood && mood !== alreadyMood) {
        try { await moodFn({ data: { mood_emoji: mood!, client_timezone: getBrowserTimezone() } }); } catch { /* best-effort */ }
      }
      if (hasNewFile) {
        const { data: u } = await supabase.auth.getUser();
        const uid = u.user?.id;
        if (!uid) throw new Error("Not signed in.");
        const ext = file!.name.split(".").pop() || "png";
        const path = `${uid}/recovery/${Date.now()}.${ext}`;
        const { error: upErr } = await supabase.storage.from("shield-uploads").upload(path, file!, { upsert: true });
        if (upErr) throw new Error(upErr.message);
        await fn({ data: { device_source: source, screenshot_url: path } });
        setBusy(false);
        await startPolling(); // surface Journey A/B/C inline
        return;
      }
      onSaved();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Save failed. Try again.");
    } finally { setBusy(false); }
  };

  const canSubmit = !!file || !!mood || alreadyUploaded;

  // If we have a parse result this session, show the per-Journey panel
  // instead of the upload form.
  if (parseState && (parseState.parse_status === "parsed" || parseState.parse_status === "failed")) {
    return (
      <ParseOutcomePanel
        status={parseState}
        onDone={onSaved}
      />
    );
  }

  if (polling) {
    return (
      <div className="py-10 flex flex-col items-center gap-3">
        <Loader2 className="animate-spin text-text-secondary" size={28} />
        <p className="text-[13px] text-text-secondary">Reading your screenshot…</p>
        <p className="text-[11px] text-text-tertiary">This usually takes 5–15 seconds.</p>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="space-y-5">
      <div>
        <label className="text-[12px] uppercase text-text-tertiary tracking-wider">Device</label>
        <div className="mt-3 grid grid-cols-3 gap-2">
          {(["whoop", "oura", "garmin"] as const).map((s) => {
            const active = source === s;
            return (
              <button key={s} type="button" onClick={() => setSource(s)}
                className="h-11 rounded-xl text-[13px] font-medium capitalize text-white active:scale-95 transition"
                style={{
                  background: active ? "linear-gradient(135deg, rgba(124,58,237,0.25), rgba(59,130,246,0.25))" : "#0A0E1A",
                  border: `1px solid ${active ? "rgba(124,58,237,0.6)" : "rgba(255,255,255,0.08)"}`,
                }}>{s}</button>
            );
          })}
        </div>
      </div>

      <div>
        <label className="text-[12px] uppercase text-text-tertiary tracking-wider flex items-center justify-between">
          <span>Screenshot</span>
          {alreadyUploaded && !file && (
            <span className="text-[10px] text-success normal-case tracking-normal">✓ already uploaded today</span>
          )}
        </label>
        <button type="button" onClick={() => inputRef.current?.click()}
          className="mt-3 w-full rounded-2xl py-6 flex flex-col items-center gap-2 text-text-secondary active:scale-[0.99] transition"
          style={{ background: "#0A0E1A", border: "1px dashed rgba(124,58,237,0.4)" }}>
          <Upload size={20} />
          <span className="text-[13px]">{file ? "Screenshot ready" : alreadyUploaded ? "Replace screenshot (optional)" : "Tap to upload"}</span>
        </button>
        <input ref={inputRef} type="file" accept="image/*" className="hidden"
          onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
      </div>

      <MoodPicker value={mood} onChange={setMood} />
      <p className="text-[11px] text-text-tertiary -mt-2">
        Mood and screenshot are independent — save just one if that's all you have right now.
      </p>

      {err && <p className="text-[12px] text-red-400">{err}</p>}
      <SubmitBtn busy={busy} label="Save recovery" disabled={!canSubmit} />
    </form>
  );
}

/** Renders the Journey A / B / C outcome of a parse attempt.
 *  A — clean parse: confirm + done.
 *  B — partial: show what was read + invite an RHR top-up (or skip).
 *  C — failure: show the failure message + route into a per-day manual
 *      fallback flow that flags the entry as `device_parse_failed_fallback`
 *      (does NOT change input_path_preference). */
function ParseOutcomePanel({
  status,
  onDone,
}: {
  status: NonNullable<DeviceUploadStatus>;
  onDone: () => void;
}) {
  const reassignFn = useServerFn(reassignDeviceUploadDate);
  const [dateConfirmed, setDateConfirmed] = useState(false);
  const [dateBusy, setDateBusy] = useState(false);

  // Date alignment: if the screenshot has a confidently-detected date that
  // doesn't match today, ask the user to confirm before we treat this as
  // today's reading. No detected date → default to today silently (fast path).
  const showDateConfirm =
    !dateConfirmed &&
    status.parsed_date != null &&
    status.parsed_date !== status.entry_date;

  const reassignToScreenshotDate = async () => {
    if (!status.parsed_date) return;
    setDateBusy(true);
    try {
      await reassignFn({ data: { upload_id: status.id, new_entry_date: status.parsed_date } });
      setDateConfirmed(true);
    } finally { setDateBusy(false); }
  };

  if (showDateConfirm) {
    return (
      <div className="space-y-4">
        <div className="rounded-2xl p-4" style={{ background: "#0A0E1A", border: "1px solid rgba(245,158,11,0.35)" }}>
          <p className="text-[13px] text-white font-medium">Quick check</p>
          <p className="text-[12px] text-text-secondary mt-1">
            This screenshot looks like data for <span className="text-white">{status.parsed_date}</span>, but
            you're logging it for <span className="text-white">{status.entry_date}</span> (today).
          </p>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setDateConfirmed(true)}
            className="flex-1 rounded-xl py-3 text-[13px] font-semibold text-white active:scale-95"
            style={{ background: "linear-gradient(135deg, rgba(124,58,237,0.85), rgba(59,130,246,0.85))" }}
          >
            It's for today
          </button>
          <button
            type="button"
            onClick={reassignToScreenshotDate}
            disabled={dateBusy}
            className="flex-1 rounded-xl py-3 text-[13px] font-semibold text-white active:scale-95 disabled:opacity-50"
            style={{ background: "#0A0E1A", border: "1px solid rgba(255,255,255,0.15)" }}
          >
            {dateBusy ? "…" : `Use ${status.parsed_date}`}
          </button>
        </div>
      </div>
    );
  }

  if (status.parse_status === "failed") {
    return <JourneyCFallback onDone={onDone} deviceSource={status.device_source ?? "device"} />;
  }

  // parsed: Journey A (HRV+RHR) or Journey B (HRV only / RHR missing).
  const hasHRV = status.parsed_hrv != null;
  const hasRHR = status.parsed_rhr != null;

  if (hasHRV && hasRHR) {
    return <JourneyACleanParse status={status} onDone={onDone} />;
  }
  if (hasHRV && !hasRHR) {
    return <JourneyBPartialParse status={status} onDone={onDone} />;
  }
  // parsed but no HRV — treat like total failure for Recovery purposes;
  // sleep alone is logged via the device row and still contributes to Sleep pillar.
  return <JourneyCFallback onDone={onDone} deviceSource={status.device_source ?? "device"} />;
}

function ReadingsList({ status }: { status: NonNullable<DeviceUploadStatus> }) {
  const rows: Array<[string, string]> = [];
  if (status.parsed_hrv != null) rows.push(["HRV", `${Math.round(status.parsed_hrv)} ms`]);
  if (status.parsed_rhr != null) rows.push(["RHR", `${Math.round(status.parsed_rhr)} bpm`]);
  if (status.parsed_sleep_hours != null) rows.push(["Sleep", `${Number(status.parsed_sleep_hours).toFixed(1)} hrs`]);
  if (rows.length === 0) return null;
  return (
    <div className="rounded-2xl p-4 grid grid-cols-3 gap-3" style={{ background: "#0A0E1A", border: "1px solid rgba(255,255,255,0.06)" }}>
      {rows.map(([k, v]) => (
        <div key={k}>
          <p className="text-[10px] uppercase tracking-wider text-text-tertiary">{k}</p>
          <p className="text-[16px] text-white font-semibold tabular-nums mt-1">{v}</p>
        </div>
      ))}
    </div>
  );
}

function JourneyACleanParse({ status, onDone }: { status: NonNullable<DeviceUploadStatus>; onDone: () => void }) {
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 text-success">
        <Check size={18} />
        <p className="text-[14px] font-semibold">Got your reading</p>
      </div>
      <ReadingsList status={status} />
      <p className="text-[11px] text-text-tertiary">Your score will update in a moment.</p>
      <button
        type="button"
        onClick={onDone}
        className="w-full rounded-2xl gradient-brand py-3 text-[14px] font-semibold text-white active:scale-95"
      >
        Done
      </button>
    </div>
  );
}

function JourneyBPartialParse({ status, onDone }: { status: NonNullable<DeviceUploadStatus>; onDone: () => void }) {
  const [rhr, setRhr] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const fn = useServerFn(supplementDeviceRhr);
  const hrv = status.parsed_hrv != null ? Math.round(status.parsed_hrv) : null;

  const addRhr = async () => {
    const n = Number(rhr);
    if (!Number.isFinite(n) || n < 25 || n > 140) {
      setErr("Enter a resting heart rate between 25 and 140 bpm.");
      return;
    }
    setBusy(true); setErr(null);
    try {
      await fn({ data: { rhr_bpm: n } });
      onDone();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Couldn't save RHR. Try again.");
    } finally { setBusy(false); }
  };

  return (
    <div className="space-y-4">
      <div>
        <p className="text-[14px] font-semibold text-white">Got most of it</p>
        <p className="text-[13px] text-text-secondary mt-1">
          We caught your HRV{hrv != null ? ` (${hrv} ms)` : ""} but couldn't read your RHR.
          Add it for a more complete reading, or skip — your score will still update.
        </p>
      </div>
      <ReadingsList status={status} />
      <div>
        <label className="text-[12px] uppercase text-text-tertiary tracking-wider">Resting heart rate</label>
        <div className="mt-2 flex items-center gap-2">
          <input
            type="number"
            inputMode="numeric"
            value={rhr}
            onChange={(e) => setRhr(e.target.value)}
            placeholder="e.g. 58"
            className="flex-1 rounded-xl px-3 py-3 text-[15px] text-white tabular-nums focus:outline-none"
            style={{ background: "#0A0E1A", border: "1px solid rgba(255,255,255,0.1)" }}
          />
          <span className="text-[12px] text-text-tertiary">bpm</span>
        </div>
      </div>
      {err && <p className="text-[12px] text-red-400">{err}</p>}
      <div className="flex gap-2">
        <button
          type="button"
          onClick={onDone}
          disabled={busy}
          className="flex-1 rounded-2xl py-3 text-[13px] font-semibold text-white active:scale-95 disabled:opacity-50"
          style={{ background: "#0A0E1A", border: "1px solid rgba(255,255,255,0.15)" }}
        >
          Skip
        </button>
        <button
          type="button"
          onClick={addRhr}
          disabled={busy || !rhr}
          className="flex-1 rounded-2xl gradient-brand py-3 text-[13px] font-semibold text-white active:scale-95 disabled:opacity-50 flex items-center justify-center gap-2"
        >
          {busy && <Loader2 size={14} className="animate-spin" />}
          Add RHR
        </button>
      </div>
    </div>
  );
}

/** Per-day manual fallback when the screenshot couldn't be parsed.
 *  IMPORTANT: writes recovery_source='device_parse_failed_fallback' on
 *  shield_manual_inputs but does NOT touch profiles.input_path_preference.
 *  The user remains a device-path user; only today's reading is manual. */
function JourneyCFallback({ onDone, deviceSource }: { onDone: () => void; deviceSource: string }) {
  const [rating, setRating] = useState<number | null>(null);
  const [sleep, setSleep] = useState<number>(7.5);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const fn = useServerFn(upsertManualRecovery);

  const submit = async () => {
    if (rating == null) return;
    setBusy(true); setErr(null);
    try {
      await fn({
        data: {
          recovery_self_rating: rating,
          sleep_hours: sleep,
          // Per-day fallback marker. Does NOT change input_path_preference.
          recovery_source: "device_parse_failed_fallback",
          client_timezone: getBrowserTimezone(),
        },
      });
      onDone();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Couldn't save. Try again.");
    } finally { setBusy(false); }
  };

  const deviceLabel =
    deviceSource === "whoop" ? "WHOOP" :
    deviceSource === "oura" ? "Oura" :
    deviceSource === "garmin" ? "Garmin" :
    "device";

  return (
    <div className="space-y-4">
      <div>
        <p className="text-[14px] font-semibold text-white">Couldn't read that one</p>
        <p className="text-[13px] text-text-secondary mt-1">
          We couldn't pull recovery numbers out of your {deviceLabel} screenshot today.
          Want to log how recovered you feel manually instead, just for today?
        </p>
      </div>
      <div>
        <label className="text-[12px] uppercase text-text-tertiary tracking-wider">How recovered do you feel?</label>
        <div className="mt-3 grid grid-cols-5 gap-2">
          {[1, 2, 3, 4, 5].map((n) => {
            const active = rating === n;
            return (
              <button
                type="button"
                key={n}
                onClick={() => setRating(n)}
                className="h-14 rounded-2xl text-[18px] font-semibold text-white active:scale-95 transition"
                style={{
                  background: active ? "linear-gradient(135deg, rgba(124,58,237,0.25), rgba(59,130,246,0.25))" : "#0A0E1A",
                  border: `1px solid ${active ? "rgba(124,58,237,0.6)" : "rgba(255,255,255,0.08)"}`,
                }}
              >
                {n}
              </button>
            );
          })}
        </div>
        <div className="mt-2 flex justify-between text-[10px] text-text-tertiary"><span>Drained</span><span>Peak</span></div>
      </div>
      <div>
        <label className="text-[12px] uppercase text-text-tertiary tracking-wider">Sleep last night</label>
        <div className="mt-3 flex items-center gap-3">
          <button type="button" onClick={() => setSleep((s) => Math.max(0, +(s - 0.5).toFixed(1)))}
            className="h-11 w-11 rounded-full text-white text-xl active:scale-95"
            style={{ background: "#0A0E1A", border: "1px solid rgba(255,255,255,0.08)" }}>−</button>
          <div className="flex-1 text-center">
            <div className="text-[28px] font-light text-white tabular-nums">{sleep.toFixed(1)}<span className="text-text-tertiary text-[14px] ml-1">hrs</span></div>
          </div>
          <button type="button" onClick={() => setSleep((s) => Math.min(24, +(s + 0.5).toFixed(1)))}
            className="h-11 w-11 rounded-full text-white text-xl active:scale-95"
            style={{ background: "#0A0E1A", border: "1px solid rgba(255,255,255,0.08)" }}>+</button>
        </div>
      </div>
      <p className="text-[11px] text-text-tertiary">
        You're still set up on the {deviceSource} path — this is just for today.
      </p>
      {err && <p className="text-[12px] text-red-400">{err}</p>}
      <div className="flex gap-2">
        <button
          type="button"
          onClick={onDone}
          disabled={busy}
          className="flex-1 rounded-2xl py-3 text-[13px] font-semibold text-white active:scale-95 disabled:opacity-50"
          style={{ background: "#0A0E1A", border: "1px solid rgba(255,255,255,0.15)" }}
        >
          Skip
        </button>
        <button
          type="button"
          onClick={submit}
          disabled={busy || rating == null}
          className="flex-1 rounded-2xl gradient-brand py-3 text-[13px] font-semibold text-white active:scale-95 disabled:opacity-50 flex items-center justify-center gap-2"
        >
          {busy && <Loader2 size={14} className="animate-spin" />}
          Save manual entry
        </button>
      </div>
    </div>
  );
}



/** Quick water-logging modal — icon-paired presets + custom stepper.
 *  One-tap on a preset logs immediately; custom field is a secondary
 *  always-available "+/-" stepper for off-preset amounts. */
export function HydrationLogModal({ open, onClose, onSaved }: Props) {
  const [busy, setBusy] = useState<number | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [custom, setCustom] = useState<number>(300);
  const log = useServerFn(logHydration);

  const add = async (ml: number) => {
    if (ml <= 0) return;
    setBusy(ml); setErr(null);
    try {
      await log({ data: { amount_ml: ml } });
      onSaved?.();
      onClose();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not log water.");
    } finally { setBusy(null); }
  };

  const presets: Array<{ ml: number; label: string; icon: "small" | "glass" | "bottle" | "large" }> = [
    { ml: 250, label: "Small glass", icon: "small" },
    { ml: 500, label: "Bottle", icon: "glass" },
    { ml: 750, label: "Large bottle", icon: "bottle" },
    { ml: 1000, label: "1 Liter", icon: "large" },
  ];

  return (
    <Sheet open={open} onClose={onClose} title="Log water">
      <div className="space-y-4">
        <p className="text-[13px] text-text-secondary">Tap to log — no confirm needed.</p>
        <div className="grid grid-cols-2 gap-3">
          {presets.map((opt) => (
            <button
              key={opt.ml}
              type="button"
              onClick={() => add(opt.ml)}
              disabled={busy != null}
              className="rounded-2xl p-4 text-left text-white active:scale-95 transition disabled:opacity-50 flex items-center gap-3"
              style={{ background: "#0A0E1A", border: "1px solid rgba(59,130,246,0.35)" }}
            >
              <WaterIcon kind={opt.icon} />
              <div className="min-w-0 flex-1">
                <div className="text-[15px] font-semibold flex items-center gap-2">
                  {busy === opt.ml && <Loader2 size={14} className="animate-spin" />}
                  {opt.ml} ml
                </div>
                <div className="text-[11px] text-text-tertiary mt-0.5 truncate">{opt.label}</div>
              </div>
            </button>
          ))}
        </div>

        <div className="rounded-2xl p-4" style={{ background: "#0A0E1A", border: "1px solid rgba(255,255,255,0.06)" }}>
          <p className="text-[11px] uppercase tracking-wider text-text-tertiary">Custom amount</p>
          <div className="mt-2 flex items-center gap-3">
            <button
              type="button"
              onClick={() => setCustom((c) => Math.max(50, c - 50))}
              className="h-9 w-9 rounded-full border border-white/15 text-white text-lg leading-none active:scale-95"
              aria-label="Decrease"
            >−</button>
            <div className="flex-1 text-center">
              <p className="text-2xl font-bold tabular-nums">{custom} <span className="text-sm text-text-tertiary font-normal">ml</span></p>
            </div>
            <button
              type="button"
              onClick={() => setCustom((c) => Math.min(3000, c + 50))}
              className="h-9 w-9 rounded-full border border-white/15 text-white text-lg leading-none active:scale-95"
              aria-label="Increase"
            >+</button>
          </div>
          <button
            type="button"
            onClick={() => add(custom)}
            disabled={busy != null}
            className="mt-3 w-full rounded-xl py-2.5 text-[13px] font-semibold text-white active:scale-95 disabled:opacity-50"
            style={{ background: "linear-gradient(135deg, rgba(59,130,246,0.85), rgba(6,182,212,0.85))" }}
          >
            {busy === custom ? "Logging…" : `Log ${custom} ml`}
          </button>
        </div>

        {err && <p className="text-[12px] text-red-400">{err}</p>}
      </div>
    </Sheet>
  );
}

function WaterIcon({ kind }: { kind: "small" | "glass" | "bottle" | "large" }) {
  // Size scales with volume so options are visually scannable.
  const h = kind === "small" ? 22 : kind === "glass" ? 28 : kind === "bottle" ? 34 : 38;
  const w = kind === "small" ? 16 : kind === "glass" ? 18 : kind === "bottle" ? 18 : 20;
  const isBottle = kind === "bottle" || kind === "large";
  return (
    <svg width={w} height={h} viewBox="0 0 24 36" className="shrink-0">
      {isBottle ? (
        <>
          <rect x="9" y="1" width="6" height="4" rx="1" fill="rgba(255,255,255,0.3)" />
          <path d="M9 5 L9 8 Q5 10 5 14 L5 32 Q5 35 8 35 L16 35 Q19 35 19 32 L19 14 Q19 10 15 8 L15 5 Z"
            fill="rgba(59,130,246,0.18)" stroke="rgba(59,130,246,0.7)" strokeWidth="1" />
          <path d="M6.5 20 L6.5 31 Q6.5 33.5 9 33.5 L15 33.5 Q17.5 33.5 17.5 31 L17.5 20 Z" fill="rgba(59,130,246,0.55)" />
        </>
      ) : (
        <>
          <path d="M5 4 L19 4 L17 33 Q17 35 15 35 L9 35 Q7 35 7 33 Z"
            fill="rgba(59,130,246,0.18)" stroke="rgba(59,130,246,0.7)" strokeWidth="1" />
          <path d="M6 18 L18 18 L16.6 32.5 Q16.6 34 15 34 L9 34 Q7.4 34 7.4 32.5 Z" fill="rgba(59,130,246,0.55)" />
        </>
      )}
    </svg>
  );
}



type MealEditing = { id: string; meal_description: string | null; meal_photo_url: string | null } | null;
type MealProps = Props & { editing?: MealEditing };

type _VisionGuess = { description: string };
void ({} as _VisionGuess);

/**
 * Meal log modal — 3 steps for new meals:
 *   1) capture: photo (recommended) + optional note ("Anything not visible?")
 *   2) review: editable AI-detected items with running macro totals
 *   3) save: persists confirmed_items + computed macros; score-nutrition still
 *      runs for quality scoring (manual_edited keeps macros locked).
 * Editing an existing meal keeps the single-step description editor.
 */
type ReviewItem = ConfirmedMealItem & { _per_g?: { cal: number; p: number; c: number; f: number } };

function buildPerGram(it: ConfirmedMealItem): { cal: number; p: number; c: number; f: number } {
  const g = it.estimated_grams > 0 ? it.estimated_grams : 1;
  return {
    cal: it.calories / g,
    p: it.protein_g / g,
    c: it.carbs_g / g,
    f: it.fat_g / g,
  };
}

export function MealLogModal({ open, onClose, onSaved, editing = null }: MealProps) {
  const [step, setStep] = useState<"capture" | "review" | "editDesc">("capture");
  const [note, setNote] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [items, setItems] = useState<ReviewItem[]>([]);
  const [vision, setVision] = useState<{ raw: ConfirmedMealItem[]; provider: string; confidence: number | null } | null>(null);
  const [editDesc, setEditDesc] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const create = useServerFn(logMeal);
  const update = useServerFn(updateMeal);
  const detect = useServerFn(detectMealItems);

  useEffect(() => {
    if (!open) {
      setStep("capture"); setNote(""); setFile(null); setPhotoUrl(null);
      setErr(null); setItems([]); setVision(null); setEditDesc("");
      return;
    }
    if (editing) {
      setStep("editDesc");
      setEditDesc(editing.meal_description ?? "");
      setPhotoUrl(editing.meal_photo_url ?? null);
    } else {
      setStep("capture");
    }
  }, [open, editing]);

  /** Upload photo (if any), call detection, advance to review. */
  const handleDetect = async () => {
    if (!file && !note.trim()) return;
    setErr(null);
    setBusy(true);
    try {
      let url: string | null = photoUrl;
      let base64: string | undefined;
      let mediaType: string | undefined;
      if (file) {
        // Read base64 for the AI pass.
        base64 = await new Promise<string>((resolve, reject) => {
          const r = new FileReader();
          r.onload = () => resolve(r.result as string);
          r.onerror = () => reject(r.error);
          r.readAsDataURL(file);
        });
        mediaType = file.type || "image/jpeg";
        // Upload for storage/score-nutrition.
        const { data: u } = await supabase.auth.getUser();
        const uid = u.user?.id;
        if (!uid) throw new Error("Not signed in.");
        const ext = (file.type.split("/")[1] || "jpg").replace("jpeg", "jpg");
        const path = `${uid}/meals/${Date.now()}.${ext}`;
        const up = await supabase.storage.from("shield-uploads").upload(path, file, { contentType: file.type });
        if (up.error) throw new Error(up.error.message);
        const { data: signed } = await supabase.storage.from("shield-uploads").createSignedUrl(path, 60 * 60 * 24 * 30);
        url = signed?.signedUrl ?? null;
        setPhotoUrl(url);
      }
      const det = await detect({ data: { base64Image: base64, mediaType, note: note.trim() || undefined } });
      const raw = det.items ?? [];
      setVision({ raw, provider: det.provider, confidence: det.confidence });
      // If the AI returned nothing, seed a single blank item the user can fill in.
      const seeded: ReviewItem[] = raw.length > 0
        ? raw.map((it) => ({ ...it, _per_g: buildPerGram(it) }))
        : [{
            name: note.trim() || "Item",
            quantity_description: null,
            estimated_grams: 100,
            gram_range_min: null,
            gram_range_max: null,
            calories: 0, protein_g: 0, carbs_g: 0, fat_g: 0,
            confidence: "low",
            source: file && note.trim() ? "photo + note" : file ? "photo" : "your note",
            uncertainty_note: "Estimate — please edit grams and macros.",
          }];
      setItems(seeded);
      setStep("review");
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not detect items.");
    } finally {
      setBusy(false);
    }
  };

  /** Update grams: scale calories/protein/carbs/fat proportionally from the original per-gram density. */
  const updateGrams = (idx: number, grams: number) => {
    setItems((prev) => prev.map((it, i) => {
      if (i !== idx) return it;
      const pg = it._per_g ?? buildPerGram(it);
      const g = Math.max(0, grams);
      return {
        ...it,
        estimated_grams: g,
        calories: Math.round(pg.cal * g),
        protein_g: Math.round(pg.p * g * 10) / 10,
        carbs_g: Math.round(pg.c * g * 10) / 10,
        fat_g: Math.round(pg.f * g * 10) / 10,
        _per_g: pg,
      };
    }));
  };

  const updateField = (idx: number, key: "name" | "quantity_description", value: string) => {
    setItems((prev) => prev.map((it, i) => (i === idx ? { ...it, [key]: value } : it)));
  };

  const removeItem = (idx: number) => setItems((prev) => prev.filter((_, i) => i !== idx));

  const addItem = () => {
    setItems((prev) => [...prev, {
      name: "New item",
      quantity_description: null,
      estimated_grams: 100,
      gram_range_min: null, gram_range_max: null,
      calories: 0, protein_g: 0, carbs_g: 0, fat_g: 0,
      confidence: "low",
      source: "your note",
      uncertainty_note: null,
      _per_g: { cal: 0, p: 0, c: 0, f: 0 },
    }]);
  };

  const totals = items.reduce(
    (a, it) => ({
      cal: a.cal + (it.calories || 0),
      p: a.p + (it.protein_g || 0),
      c: a.c + (it.carbs_g || 0),
      f: a.f + (it.fat_g || 0),
    }),
    { cal: 0, p: 0, c: 0, f: 0 },
  );

  /** Final save — persists confirmed_items + macros via logMeal, then runs scoring for quality. */
  const saveMeal = async () => {
    if (items.length === 0) { setErr("Add at least one item."); return; }
    setBusy(true); setErr(null);
    try {
      const cleanItems: ConfirmedMealItem[] = items.map(({ _per_g, ...rest }) => rest);
      const summary = cleanItems.map((it) => `${it.name}${it.quantity_description ? ` (${it.quantity_description})` : ""}`).join(", ");
      const r = await create({
        data: {
          meal_description: note.trim() ? `${summary} · ${note.trim()}` : summary,
          meal_photo_url: photoUrl,
          confirmed_items: cleanItems,
          vision_detected_items: vision?.raw,
          vision_provider: vision?.provider,
          vision_confidence: vision?.confidence ?? null,
          client_timezone: getBrowserTimezone(),
        },
      });
      // Quality scoring (protein_tier/carb_quality/timing). score-nutrition
      // respects calorie_estimate_status='manual_edited' and won't overwrite macros.
      try {
        await supabase.functions.invoke("score-nutrition", { body: { nutrition_log_id: r.id } });
      } catch (invokeErr) {
        console.error("[meal] score-nutrition invoke failed", invokeErr);
      }
      onSaved?.();
      onClose();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not save meal.");
    } finally { setBusy(false); }
  };

  /** Editing-existing-meal flow keeps the simple description editor. */
  const submitEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editDesc.trim() && !photoUrl) return;
    setBusy(true); setErr(null);
    try {
      if (!editing) return;
      await update({ data: { id: editing.id, meal_description: editDesc.trim(), meal_photo_url: photoUrl } });
      try { await supabase.functions.invoke("score-nutrition", { body: { nutrition_log_id: editing.id } }); }
      catch (invokeErr) { console.error("[meal] score-nutrition invoke failed", invokeErr); }
      onSaved?.();
      onClose();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not save meal.");
    } finally { setBusy(false); }
  };

  const title =
    editing ? "Edit meal" :
    step === "capture" ? "Log a meal" :
    step === "review" ? "Review meal" :
    "Edit meal";

  return (
    <Sheet open={open} onClose={onClose} title={title}>
      {step === "editDesc" ? (
        <form onSubmit={submitEdit} className="space-y-5">
          {photoUrl && (<img src={photoUrl} alt="Meal" className="w-full max-h-44 object-cover rounded-xl" />)}
          <div>
            <label className="text-[12px] uppercase text-text-tertiary tracking-wider">Description</label>
            <textarea
              value={editDesc}
              onChange={(e) => setEditDesc(e.target.value)}
              rows={3}
              className="mt-3 w-full rounded-2xl p-4 text-white placeholder:text-text-tertiary resize-none focus:outline-none"
              style={{ background: "#0A0E1A", border: "1px solid rgba(124,58,237,0.4)", fontSize: 16 }}
              autoFocus
            />
          </div>
          {err && <p className="text-[12px] text-red-400">{err}</p>}
          <SubmitBtn busy={busy} label="Save changes" disabled={!editDesc.trim() && !photoUrl} />
        </form>
      ) : step === "capture" ? (
        <div className="space-y-5">
          <div>
            <label className="text-[12px] uppercase text-text-tertiary tracking-wider">Photo recommended</label>
            <button type="button" onClick={() => inputRef.current?.click()}
              className="mt-3 w-full rounded-2xl py-7 flex flex-col items-center gap-2 text-white active:scale-[0.99] transition"
              style={{ background: "linear-gradient(135deg, rgba(16,185,129,0.18), rgba(59,130,246,0.12))", border: "1px solid rgba(16,185,129,0.5)" }}>
              <Upload size={22} />
              <span className="text-[14px] font-semibold">{file ? "Photo ready" : "Tap to add a photo"}</span>
              <span className="text-[11px] text-text-tertiary">You review the items before saving</span>
            </button>
            <input ref={inputRef} type="file" accept="image/*" capture="environment" className="hidden"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
          </div>
          <div>
            <label className="text-[12px] uppercase text-text-tertiary tracking-wider">Anything not visible?</label>
            <textarea
              value={note} onChange={(e) => setNote(e.target.value)}
              placeholder="e.g. oil, sauce, drink, extra rice"
              rows={2}
              className="mt-3 w-full rounded-2xl p-4 text-white placeholder:text-text-tertiary resize-none focus:outline-none"
              style={{ background: "#0A0E1A", border: "1px solid rgba(255,255,255,0.08)", fontSize: 16 }}
            />
          </div>
          {err && <p className="text-[12px] text-red-400">{err}</p>}
          <button
            type="button"
            disabled={busy || (!file && !note.trim())}
            onClick={handleDetect}
            className="w-full rounded-2xl gradient-brand py-3 text-[14px] font-semibold text-white active:scale-[0.98] transition disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {busy ? <><Loader2 size={16} className="animate-spin" /> Detecting…</> : <><Sparkles size={14} /> Detect food</>}
          </button>
        </div>
      ) : (
        <div className="space-y-4">
          <p className="text-[12px] text-text-tertiary">Adjust servings before saving.</p>
          {photoUrl && (<img src={photoUrl} alt="Meal" className="w-full max-h-36 object-cover rounded-xl" />)}

          {/* Top macro summary — live total */}
          <div className="rounded-2xl p-3 grid grid-cols-4 gap-2"
            style={{ background: "rgba(16,185,129,0.06)", border: "1px solid rgba(16,185,129,0.25)" }}>
            <SummaryStat label="kcal" value={Math.round(totals.cal).toString()} />
            <SummaryStat label="protein" value={`${Math.round(totals.p)}g`} color="#F59E0B" />
            <SummaryStat label="carbs" value={`${Math.round(totals.c)}g`} color="#10B981" />
            <SummaryStat label="fat" value={`${Math.round(totals.f)}g`} color="#3B82F6" />
          </div>

          {/* Items */}
          <ul className="space-y-2">
            {items.map((it, i) => (
              <li key={i} className="rounded-2xl p-3 space-y-2" style={{ background: "#0A0E1A", border: "1px solid rgba(255,255,255,0.08)" }}>
                <div className="flex items-start gap-2">
                  <input
                    value={it.name}
                    onChange={(e) => updateField(i, "name", e.target.value)}
                    className="flex-1 min-w-0 bg-transparent text-[14px] font-semibold text-white focus:outline-none"
                    placeholder="Item name"
                  />
                  {it.confidence && (
                    <span className="shrink-0 rounded-full px-1.5 py-px text-[10px] font-medium"
                      style={{
                        color: it.confidence === "high" ? "#10B981" : it.confidence === "low" ? "#EF4444" : "#F59E0B",
                        background: "rgba(255,255,255,0.04)",
                        border: "1px solid rgba(255,255,255,0.10)",
                      }}>
                      {it.confidence}
                    </span>
                  )}
                  <button type="button" onClick={() => removeItem(i)} aria-label="Remove" className="shrink-0 text-text-tertiary p-1 active:scale-95">
                    <Trash2 size={14} />
                  </button>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <label className="text-[11px] text-text-tertiary">
                    Serving
                    <input
                      value={it.quantity_description ?? ""}
                      onChange={(e) => updateField(i, "quantity_description", e.target.value)}
                      placeholder="e.g. 1 cup"
                      className="mt-1 w-full rounded-lg px-2 py-1.5 text-[13px] text-white bg-bg-1 border border-white/10 focus:outline-none"
                    />
                  </label>
                  <label className="text-[11px] text-text-tertiary">
                    Grams
                    <input
                      inputMode="decimal"
                      value={it.estimated_grams}
                      onChange={(e) => updateGrams(i, Number(e.target.value) || 0)}
                      className="mt-1 w-full rounded-lg px-2 py-1.5 text-[13px] text-white tabular-nums bg-bg-1 border border-white/10 focus:outline-none"
                    />
                  </label>
                </div>
                <p className="text-[11px] text-text-tertiary tabular-nums">
                  {Math.round(it.calories)} kcal · {Math.round(it.protein_g)}g P · {Math.round(it.carbs_g)}g C · {Math.round(it.fat_g)}g F
                </p>
                {(it.source || it.uncertainty_note) && (
                  <p className="text-[10px] text-text-tertiary leading-snug">
                    {it.source ? `Source: ${it.source}` : ""}
                    {it.source && it.uncertainty_note ? " · " : ""}
                    {it.uncertainty_note ?? ""}
                  </p>
                )}
              </li>
            ))}
          </ul>

          <button type="button" onClick={addItem}
            className="w-full rounded-2xl px-4 py-2.5 text-[13px] text-text-secondary border border-dashed border-white/15 active:scale-[0.99] transition flex items-center justify-center gap-1.5">
            <Plus size={14} /> Add item
          </button>

          {err && <p className="text-[12px] text-red-400">{err}</p>}
          <div className="flex gap-2">
            <button type="button" onClick={() => setStep("capture")}
              className="rounded-2xl px-4 py-3 text-[14px] text-text-secondary border border-white/10">
              Back
            </button>
            <SubmitBtn busy={busy} label="Save meal" disabled={items.length === 0} onClick={saveMeal} />
          </div>
        </div>
      )}
    </Sheet>
  );
}

function SummaryStat({ label, value, color = "#FFFFFF" }: { label: string; value: string; color?: string }) {
  return (
    <div className="text-center">
      <p className="text-[10px] uppercase tracking-wider text-text-tertiary">{label}</p>
      <p className="mt-0.5 text-[14px] font-semibold tabular-nums" style={{ color }}>{value}</p>
    </div>
  );
}

export function WorkoutLogModal({ open, onClose, onSaved }: Props) {
  const [strain, setStrain] = useState<string>("");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const fn = useServerFn(upsertTraining);

  useEffect(() => { if (!open) { setStrain(""); setNotes(""); setErr(null); } }, [open]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); setErr(null);
    try {
      const strainNum = strain.trim() === "" ? null : Number(strain);
      if (strainNum != null && (Number.isNaN(strainNum) || strainNum < 0)) {
        setErr("Strain must be a positive number."); setBusy(false); return;
      }
      await fn({ data: { strain_value: strainNum, session_notes: notes.trim() || null } });
      onSaved?.();
      onClose();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not save workout.");
    } finally { setBusy(false); }
  };

  return (
    <Sheet open={open} onClose={onClose} title="Log workout">
      <form onSubmit={submit} className="space-y-5">
        <div>
          <label className="text-[12px] uppercase text-text-tertiary tracking-wider">Strain (optional)</label>
          <input
            inputMode="decimal" value={strain} onChange={(e) => setStrain(e.target.value)}
            placeholder="e.g. 14.5"
            className="mt-3 w-full rounded-2xl p-4 text-white placeholder:text-text-tertiary focus:outline-none"
            style={{ background: "#0A0E1A", border: "1px solid rgba(255,255,255,0.08)", fontSize: 16 }}
          />
        </div>
        <div>
          <label className="text-[12px] uppercase text-text-tertiary tracking-wider">Notes (optional)</label>
          <textarea
            value={notes} onChange={(e) => setNotes(e.target.value)} rows={3}
            placeholder="How did the session feel?"
            className="mt-3 w-full rounded-2xl p-4 text-white placeholder:text-text-tertiary resize-none focus:outline-none"
            style={{ background: "#0A0E1A", border: "1px solid rgba(255,255,255,0.08)", fontSize: 16 }}
          />
        </div>
        {err && <p className="text-[12px] text-red-400">{err}</p>}
        <SubmitBtn busy={busy} label="Save workout" />
      </form>
    </Sheet>
  );
}

// ---------- Body measurement (Step A / Step B) ----------

type WeightUnit = "kg" | "lb";
type LengthUnit = "cm" | "in";

const kgToLb = (kg: number) => kg * 2.20462262;
const lbToKg = (lb: number) => lb / 2.20462262;
const cmToIn = (cm: number) => cm / 2.54;
const inToCm = (i: number) => i * 2.54;

/** Numeric input that parses raw digits literally — typing "36" stores 36,
 *  never 3.6. Decimals only when the user explicitly types one. fontSize 16
 *  to suppress iOS auto-zoom. */
function NumField({
  value, onChange, suffix, placeholder, ariaLabel,
}: { value: string; onChange: (v: string) => void; suffix?: string; placeholder?: string; ariaLabel?: string }) {
  const handle = (raw: string) => {
    if (raw === "") return onChange("");
    if (!/^\d*\.?\d*$/.test(raw)) return;
    onChange(raw);
  };
  return (
    <span className="flex items-center gap-1">
      <input
        type="text"
        inputMode="decimal"
        value={value}
        onChange={(e) => handle(e.target.value)}
        placeholder={placeholder ?? "—"}
        aria-label={ariaLabel}
        className="w-24 bg-bg-1 border border-white/10 rounded-xl px-3 py-2 text-right text-[14px] font-semibold focus:outline-none text-white"
        style={{ fontSize: 16 }}
      />
      {suffix && <span className="text-xs text-text-tertiary w-6 text-left">{suffix}</span>}
    </span>
  );
}

function UnitToggle<T extends string>({ value, onChange, options }: { value: T; onChange: (v: T) => void; options: readonly T[] }) {
  return (
    <div className="inline-flex rounded-full bg-bg-1 border border-white/10 p-0.5">
      {options.map((o) => (
        <button
          key={o}
          type="button"
          onClick={() => onChange(o)}
          className={`px-3 py-1 text-[11px] font-semibold rounded-full transition ${value === o ? "bg-white/10 text-white" : "text-text-tertiary"}`}
        >
          {o}
        </button>
      ))}
    </div>
  );
}

export function BodyMeasurementModal({ open, onClose, onSaved }: Props) {
  const log = useServerFn(logBodyMeasurement);
  const [step, setStep] = useState<"A" | "B">("A");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Step A
  const [path, setPath] = useState<"device" | "manual">("manual");
  const [wUnit, setWUnit] = useState<WeightUnit>("kg");
  const [bfPct, setBfPct] = useState("");
  const [leanDisp, setLeanDisp] = useState(""); // in current wUnit
  const [weightDisp, setWeightDisp] = useState(""); // in current wUnit

  // Step B
  const [lUnit, setLUnit] = useState<LengthUnit>("cm");
  const [waistDisp, setWaistDisp] = useState("");
  const [hipDisp, setHipDisp] = useState("");
  const [armDisp, setArmDisp] = useState("");
  const [thighDisp, setThighDisp] = useState("");

  useEffect(() => {
    if (!open) {
      setStep("A"); setBusy(false); setErr(null);
      setPath("manual"); setBfPct(""); setLeanDisp(""); setWeightDisp("");
      setWaistDisp(""); setHipDisp(""); setArmDisp(""); setThighDisp("");
    }
  }, [open]);

  const convertWeightOnToggle = (next: WeightUnit) => {
    if (wUnit === next) return;
    const convert = (s: string) => {
      if (!s) return "";
      const n = Number(s);
      if (!Number.isFinite(n)) return "";
      const kg = wUnit === "kg" ? n : lbToKg(n);
      const out = next === "kg" ? kg : kgToLb(kg);
      return String(Number(out.toFixed(1)));
    };
    setWeightDisp(convert(weightDisp));
    setLeanDisp(convert(leanDisp));
    setWUnit(next);
  };

  const convertLengthOnToggle = (next: LengthUnit) => {
    if (lUnit === next) return;
    const convert = (s: string) => {
      if (!s) return "";
      const n = Number(s);
      if (!Number.isFinite(n)) return "";
      const cm = lUnit === "cm" ? n : inToCm(n);
      const out = next === "cm" ? cm : cmToIn(cm);
      return String(Number(out.toFixed(1)));
    };
    setWaistDisp(convert(waistDisp));
    setHipDisp(convert(hipDisp));
    setArmDisp(convert(armDisp));
    setThighDisp(convert(thighDisp));
    setLUnit(next);
  };

  const toKg = (s: string) => s ? (wUnit === "kg" ? Number(s) : lbToKg(Number(s))) : null;
  const toCm = (s: string) => s ? (lUnit === "cm" ? Number(s) : inToCm(Number(s))) : null;
  const num = (v: number | null) => v == null || !Number.isFinite(v) ? null : Number(v.toFixed(2));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); setErr(null);
    try {
      await log({
        data: {
          source: path === "device" ? "dexa" : "manual",
          weight_kg: num(toKg(weightDisp)),
          body_fat_pct: bfPct ? Number(bfPct) : null,
          lean_mass_kg: num(toKg(leanDisp)),
          waist_cm: num(toCm(waistDisp)),
          hip_cm: num(toCm(hipDisp)),
          arm_cm: num(toCm(armDisp)),
          thigh_cm: num(toCm(thighDisp)),
          client_timezone: getBrowserTimezone(),
        },
      });
      onSaved?.();
      onClose();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not save measurement.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet open={open} onClose={onClose} title={step === "A" ? "Body composition" : "Circumference measurements"}>
      {step === "A" ? (
        <div className="space-y-5">
          <div className="flex gap-2">
            {(["device", "manual"] as const).map((p) => (
              <button
                key={p}
                onClick={() => setPath(p)}
                className={`flex-1 rounded-xl py-2.5 text-[12px] font-semibold transition ${path === p ? "gradient-brand text-white" : "border border-white/10 bg-bg-1 text-text-secondary"}`}
              >
                {p === "device" ? "I have DEXA / InBody" : "Estimate manually"}
              </button>
            ))}
          </div>

          <div className="flex items-center justify-between">
            <span className="text-[11px] uppercase tracking-wider text-text-tertiary">Weight unit</span>
            <UnitToggle value={wUnit} onChange={convertWeightOnToggle} options={["kg", "lb"] as const} />
          </div>

          <Row label="Weight">
            <NumField value={weightDisp} onChange={setWeightDisp} suffix={wUnit} ariaLabel="Weight" />
          </Row>
          <Row label="Body fat %">
            <NumField value={bfPct} onChange={setBfPct} suffix="%" ariaLabel="Body fat percent" />
          </Row>
          {path === "device" && (
            <Row label="Lean mass (optional)">
              <NumField value={leanDisp} onChange={setLeanDisp} suffix={wUnit} ariaLabel="Lean mass" />
            </Row>
          )}

          {err && <p className="text-[12px] text-red-400">{err}</p>}

          <div className="flex gap-2">
            <button type="button" onClick={() => setStep("B")} className="flex-1 rounded-2xl border border-white/10 py-3 text-[14px] text-text-secondary">
              Skip to measurements
            </button>
            <button type="button" onClick={() => setStep("B")} className="flex-1 rounded-2xl gradient-brand py-3 text-[14px] font-semibold text-white">
              Next: measurements
            </button>
          </div>
        </div>
      ) : (
        <form onSubmit={submit} className="space-y-5">
          <div className="flex items-center justify-between">
            <span className="text-[11px] uppercase tracking-wider text-text-tertiary">Length unit</span>
            <UnitToggle value={lUnit} onChange={convertLengthOnToggle} options={["cm", "in"] as const} />
          </div>

          <Row label="Waist">
            <NumField value={waistDisp} onChange={setWaistDisp} suffix={lUnit} ariaLabel="Waist" />
          </Row>
          <Row label="Hip">
            <NumField value={hipDisp} onChange={setHipDisp} suffix={lUnit} ariaLabel="Hip" />
          </Row>
          <Row label="Arm">
            <NumField value={armDisp} onChange={setArmDisp} suffix={lUnit} ariaLabel="Arm" />
          </Row>
          <Row label="Thigh">
            <NumField value={thighDisp} onChange={setThighDisp} suffix={lUnit} ariaLabel="Thigh" />
          </Row>

          {err && <p className="text-[12px] text-red-400">{err}</p>}

          <div className="flex gap-2">
            <button type="button" onClick={() => setStep("A")} className="rounded-2xl px-4 py-3 text-[14px] text-text-secondary border border-white/10">
              Back
            </button>
            <SubmitBtn busy={busy} label="Save measurement" />
          </div>
        </form>
      )}
    </Sheet>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex items-center justify-between rounded-2xl bg-bg-1 border border-white/5 px-4 py-3">
      <span className="text-sm text-text-secondary">{label}</span>
      {children}
    </label>
  );
}

