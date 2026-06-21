import { useEffect, useRef, useState } from "react";
import { X, Upload, Loader2, Sparkles, Check } from "lucide-react";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import {
  getInputPathPreference,
  upsertManualRecovery,
  upsertDeviceRecovery,
  upsertMood,
  logMeal,
  updateMeal,
  upsertTraining,
  logHydration,
} from "@/lib/shield.functions";
import { analyzePhoto } from "@/lib/coach.functions";

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

function SubmitBtn({ busy, label, disabled }: { busy: boolean; label: string; disabled?: boolean }) {
  return (
    <button
      type="submit"
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
      await fn({ data: { recovery_self_rating: rating, sleep_hours: sleep, mood_emoji: mood } });
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

function DeviceRecoveryForm({ onSaved }: { onSaved: () => void }) {
  const [source, setSource] = useState<"whoop" | "oura" | "garmin">("whoop");
  const [file, setFile] = useState<File | null>(null);
  const [mood, setMood] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [alreadyUploaded, setAlreadyUploaded] = useState(false);
  const [alreadyMood, setAlreadyMood] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const fn = useServerFn(upsertDeviceRecovery);
  const moodFn = useServerFn(upsertMood);

  // Detect what's already saved today so the form can accept partial submits.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data: u } = await supabase.auth.getUser();
      const uid = u.user?.id;
      if (!uid) return;
      const today = new Date().toISOString().slice(0, 10);
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
      if (hasNewFile) {
        const { data: u } = await supabase.auth.getUser();
        const uid = u.user?.id;
        if (!uid) throw new Error("Not signed in.");
        const ext = file!.name.split(".").pop() || "png";
        const path = `${uid}/recovery/${Date.now()}.${ext}`;
        const { error: upErr } = await supabase.storage.from("shield-uploads").upload(path, file!, { upsert: true });
        if (upErr) throw new Error(upErr.message);
        await fn({ data: { device_source: source, screenshot_url: path } });
      }
      if (hasMood && mood !== alreadyMood) {
        try { await moodFn({ data: { mood_emoji: mood! } }); } catch { /* best-effort */ }
      }
      onSaved();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Save failed. Try again.");
    } finally { setBusy(false); }
  };

  const canSubmit = !!file || !!mood || alreadyUploaded;

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
 * Meal log modal — two-step:
 *  1) Upload photo (and/or type description). If a photo is present, run a quick
 *     vision pass to draft a description for the user to edit.
 *  2) User confirms / edits the description, then we persist + kick off scoring.
 *  After success, the parent reloads and the per-meal nutrient callout appears
 *  in MealHistoryList once estimated_* values arrive.
 */
export function MealLogModal({ open, onClose, onSaved, editing = null }: MealProps) {
  const [step, setStep] = useState<"capture" | "confirm">("capture");
  const [desc, setDesc] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [visionBusy, setVisionBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const create = useServerFn(logMeal);
  const update = useServerFn(updateMeal);

  useEffect(() => {
    if (!open) { setStep("capture"); setDesc(""); setFile(null); setPhotoUrl(null); setErr(null); return; }
    setStep(editing ? "confirm" : "capture");
    setDesc(editing?.meal_description ?? "");
    setPhotoUrl(editing?.meal_photo_url ?? null);
    setFile(null);
    setErr(null);
  }, [open, editing]);

  /** Upload photo, generate vision draft, advance to confirm step. */
  const handleNext = async () => {
    if (!file && !desc.trim()) return;
    setErr(null);
    setBusy(true);
    try {
      let url: string | null = photoUrl;
      if (file) {
        const { data: u } = await supabase.auth.getUser();
        const uid = u.user?.id;
        if (!uid) throw new Error("Not signed in.");
        const ext = (file.type.split("/")[1] || "jpg").replace("jpeg", "jpg");
        const path = `${uid}/meals/${Date.now()}.${ext}`;
        const up = await supabase.storage.from("shield-uploads").upload(path, file, { contentType: file.type });
        if (up.error) throw new Error(up.error.message);
        // Use a long-lived signed URL so score-nutrition can fetch the photo
        // server-side. (Previously we stored the raw storage path here, which
        // caused score-nutrition to fail silently → meal stuck on "scoring…".)
        const { data: signed } = await supabase.storage.from("shield-uploads").createSignedUrl(path, 60 * 60 * 24 * 30);
        url = signed?.signedUrl ?? null;
        setPhotoUrl(url);

        // Quick vision pass to seed the description (optional, fail-soft).
        if (url) {
          setVisionBusy(true);
          try {
            const guess = await runVisionDraft(file);
            if (!desc.trim() && guess) setDesc(guess);
          } catch {/* ignore — user can type their own */}
          finally { setVisionBusy(false); }
        }
      }
      setStep("confirm");
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not prepare meal.");
    } finally {
      setBusy(false);
    }
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!desc.trim() && !photoUrl) return;
    setBusy(true); setErr(null);
    try {
      let id: string;
      if (editing) {
        const r = await update({ data: { id: editing.id, meal_description: desc.trim(), meal_photo_url: photoUrl } });
        id = r.id;
      } else {
        const r = await create({ data: { meal_description: desc.trim(), meal_photo_url: photoUrl } });
        id = r.id;
      }
      // Kick off scoring + macro estimation. We AWAIT this so the request is not
      // aborted when the modal unmounts (root cause of past "stuck on scoring…"
      // bugs). MealHistoryList polls + auto-retries any row that still ends up
      // pending past ~60s, so a transient failure here is still recoverable.
      try {
        await supabase.functions.invoke("score-nutrition", { body: { nutrition_log_id: id } });
      } catch (invokeErr) {
        console.error("[meal] score-nutrition invoke failed", invokeErr);
        // Mark the row as failed so the UI can surface "tap to retry" instead
        // of an indefinite spinner. Best-effort; RLS scopes to current user.
        try { await supabase.from("shield_nutrition_logs").update({ claude_score_status: "failed" }).eq("id", id); } catch {}
      }
      onSaved?.();
      onClose();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not save meal.");
    } finally { setBusy(false); }
  };

  return (
    <Sheet open={open} onClose={onClose} title={editing ? "Edit meal" : step === "capture" ? "Log a meal" : "Confirm what's in this meal"}>
      {step === "capture" ? (
        <div className="space-y-5">
          <div>
            <label className="text-[12px] uppercase text-text-tertiary tracking-wider">
              Photo (recommended)
            </label>
            <button type="button" onClick={() => inputRef.current?.click()}
              className="mt-3 w-full rounded-2xl py-7 flex flex-col items-center gap-2 text-white active:scale-[0.99] transition"
              style={{ background: "linear-gradient(135deg, rgba(16,185,129,0.18), rgba(59,130,246,0.12))", border: "1px solid rgba(16,185,129,0.5)" }}>
              <Upload size={22} />
              <span className="text-[14px] font-semibold">{file ? "Photo ready" : "Tap to add a photo"}</span>
              <span className="text-[11px] text-text-tertiary">We'll identify the food, then you confirm</span>
            </button>
            <input ref={inputRef} type="file" accept="image/*" capture="environment" className="hidden"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
          </div>
          <div>
            <label className="text-[12px] uppercase text-text-tertiary tracking-wider">Or type it</label>
            <textarea
              value={desc} onChange={(e) => setDesc(e.target.value)}
              placeholder="e.g. Grilled chicken, rice, broccoli"
              rows={2}
              className="mt-3 w-full rounded-2xl p-4 text-white placeholder:text-text-tertiary resize-none focus:outline-none"
              style={{ background: "#0A0E1A", border: "1px solid rgba(255,255,255,0.08)", fontSize: 16 }}
            />
          </div>
          {err && <p className="text-[12px] text-red-400">{err}</p>}
          <button
            type="button"
            disabled={busy || (!file && !desc.trim())}
            onClick={handleNext}
            className="w-full rounded-2xl gradient-brand py-3 text-[14px] font-semibold text-white active:scale-[0.98] transition disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {busy ? <><Loader2 size={16} className="animate-spin" /> Reading photo…</> : "Next: confirm"}
          </button>
        </div>
      ) : (
        <form onSubmit={submit} className="space-y-5">
          {photoUrl && (
            <img src={photoUrl} alt="Meal" className="w-full max-h-44 object-cover rounded-xl" />
          )}
          <div>
            <label className="text-[12px] uppercase text-text-tertiary tracking-wider flex items-center gap-2">
              {visionBusy ? <><Sparkles size={12} className="text-ai animate-pulse" /> AI is reading…</> : <><Check size={12} className="text-success" /> Edit if needed</>}
            </label>
            <textarea
              value={desc}
              onChange={(e) => setDesc(e.target.value)}
              placeholder="e.g. 2 puri, sambar, coconut chutney"
              rows={3}
              className="mt-3 w-full rounded-2xl p-4 text-white placeholder:text-text-tertiary resize-none focus:outline-none"
              style={{ background: "#0A0E1A", border: "1px solid rgba(124,58,237,0.4)", fontSize: 16 }}
              autoFocus
            />
            <p className="mt-2 text-[11px] text-text-tertiary">
              If quantity looks off, correct it here (e.g. "1 puri" instead of "2"). Macros are calculated from this description.
            </p>
          </div>
          {/* Parsed-interpretation recap — re-presents what the system will log
              (text or photo, doesn't matter) so the user actively confirms the
              specific input rather than handing off a silent guess. Macros are
              estimated server-side after save and surface in the meal card. */}
          {desc.trim() && (
            <div className="rounded-2xl p-3" style={{ background: "rgba(16,185,129,0.06)", border: "1px solid rgba(16,185,129,0.25)" }}>
              <p className="text-[10px] uppercase tracking-wider text-success font-semibold flex items-center gap-1">
                <Check size={11} /> Here's what we'll log
              </p>
              <p className="mt-1.5 text-[13px] text-white leading-snug">"{desc.trim()}"</p>
              <p className="mt-1.5 text-[10px] text-text-tertiary">
                Macros (kcal / protein / carbs / fat) are calculated from this exact text right after you confirm.
              </p>
            </div>
          )}
          {err && <p className="text-[12px] text-red-400">{err}</p>}
          <div className="flex gap-2">
            {!editing && (
              <button type="button" onClick={() => setStep("capture")} className="rounded-2xl px-4 py-3 text-[14px] text-text-secondary border border-white/10">
                Back
              </button>
            )}
            <SubmitBtn busy={busy} label={editing ? "Save changes" : "Confirm & log"} disabled={!desc.trim() && !photoUrl} />
          </div>
        </form>
      )}
    </Sheet>
  );
}

/** Fast Claude Sonnet vision pass to seed the description; user edits before logging. */
async function runVisionDraft(file: File): Promise<string> {
  const reader = new FileReader();
  const dataUrl: string = await new Promise((resolve, reject) => {
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
  try {
    const r = await analyzePhoto({
      data: {
        base64Image: dataUrl,
        mediaType: file.type || "image/jpeg",
        prompt:
          "Identify the food in this image in one short phrase suitable as a meal-log description. Include visible quantity (e.g. '2 puri') when obvious. Reply with just the description text, no preamble.",
      },
    });
    return (r.content || "").trim();
  } catch {
    return "";
  }
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
