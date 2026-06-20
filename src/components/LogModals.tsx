import { useEffect, useRef, useState } from "react";
import { X, Upload, Loader2 } from "lucide-react";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import {
  getInputPathPreference,
  upsertManualRecovery,
  upsertDeviceRecovery,
  logMeal,
  updateMeal,
  upsertTraining,
} from "@/lib/shield.functions";

type Props = { open: boolean; onClose: () => void; onSaved?: () => void };

function Sheet({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: string; children: React.ReactNode }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[100] flex items-end justify-center" style={{ background: "rgba(0,0,0,0.55)" }} onClick={onClose}>
      <div
        className="w-full max-w-[480px] rounded-t-[24px] p-5 animate-fade-up max-h-[90vh] overflow-y-auto"
        style={{ background: "#0F1524", border: "1px solid rgba(255,255,255,0.06)" }}
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

function ManualRecoveryForm({ onSaved }: { onSaved: () => void }) {
  const [rating, setRating] = useState<number | null>(null);
  const [sleep, setSleep] = useState<number>(7.5);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const fn = useServerFn(upsertManualRecovery);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (rating == null) return;
    setBusy(true); setErr(null);
    try {
      await fn({ data: { recovery_self_rating: rating, sleep_hours: sleep } });
      onSaved();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not save. Try again.");
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
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const fn = useServerFn(upsertDeviceRecovery);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!file) { setErr("Please select a screenshot."); return; }
    setBusy(true); setErr(null);
    try {
      const { data: u } = await supabase.auth.getUser();
      const uid = u.user?.id;
      if (!uid) throw new Error("Not signed in.");
      const ext = file.name.split(".").pop() || "png";
      const path = `${uid}/recovery/${Date.now()}.${ext}`;
      const { error: upErr } = await supabase.storage.from("shield-uploads").upload(path, file, { upsert: true });
      if (upErr) throw new Error(upErr.message);
      await fn({ data: { device_source: source, screenshot_url: path } });
      onSaved();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Upload failed. Try again.");
    } finally { setBusy(false); }
  };

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
        <label className="text-[12px] uppercase text-text-tertiary tracking-wider">Screenshot</label>
        <button type="button" onClick={() => inputRef.current?.click()}
          className="mt-3 w-full rounded-2xl py-6 flex flex-col items-center gap-2 text-text-secondary active:scale-[0.99] transition"
          style={{ background: "#0A0E1A", border: "1px dashed rgba(124,58,237,0.4)" }}>
          <Upload size={20} />
          <span className="text-[13px]">{file ? file.name : "Tap to upload"}</span>
        </button>
        <input ref={inputRef} type="file" accept="image/*" className="hidden"
          onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
      </div>

      {err && <p className="text-[12px] text-red-400">{err}</p>}
      <SubmitBtn busy={busy} label="Upload screenshot" disabled={!file} />
    </form>
  );
}

type MealEditing = { id: string; meal_description: string | null; meal_photo_url: string | null } | null;
type MealProps = Props & { editing?: MealEditing };

export function MealLogModal({ open, onClose, onSaved, editing = null }: MealProps) {
  const [desc, setDesc] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const create = useServerFn(logMeal);
  const update = useServerFn(updateMeal);

  useEffect(() => {
    if (!open) { setDesc(""); setFile(null); setErr(null); return; }
    setDesc(editing?.meal_description ?? "");
    setFile(null);
    setErr(null);
  }, [open, editing]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!desc.trim()) return;
    setBusy(true); setErr(null);
    try {
      let photoPath: string | null = editing?.meal_photo_url ?? null;
      if (file) {
        const { data: u } = await supabase.auth.getUser();
        const uid = u.user?.id;
        if (!uid) throw new Error("Not signed in.");
        const ext = file.name.split(".").pop() || "jpg";
        photoPath = `${uid}/meals/${Date.now()}.${ext}`;
        const { error: upErr } = await supabase.storage.from("shield-uploads").upload(photoPath, file);
        if (upErr) throw new Error(upErr.message);
      }
      let id: string;
      if (editing) {
        const r = await update({ data: { id: editing.id, meal_description: desc.trim(), meal_photo_url: photoPath } });
        id = r.id;
      } else {
        const r = await create({ data: { meal_description: desc.trim(), meal_photo_url: photoPath } });
        id = r.id;
      }
      // Fire-and-forget rescore; calculate-score is triggered via DB webhook.
      void supabase.functions.invoke("score-nutrition", { body: { nutrition_log_id: id } }).catch(() => {});
      onSaved?.();
      onClose();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not save meal.");
    } finally { setBusy(false); }
  };

  return (
    <Sheet open={open} onClose={onClose} title={editing ? "Edit meal" : "Log a meal"}>
      <form onSubmit={submit} className="space-y-5">
        <div>
          <label className="text-[12px] uppercase text-text-tertiary tracking-wider">What did you eat?</label>
          <textarea
            value={desc} onChange={(e) => setDesc(e.target.value)}
            placeholder="e.g. Grilled chicken, rice, broccoli"
            rows={3}
            className="mt-3 w-full rounded-2xl p-4 text-[14px] text-white placeholder:text-text-tertiary resize-none focus:outline-none"
            style={{ background: "#0A0E1A", border: "1px solid rgba(255,255,255,0.08)" }}
          />
        </div>
        <div>
          <label className="text-[12px] uppercase text-text-tertiary tracking-wider">
            Photo {editing?.meal_photo_url ? "(replace optional)" : "(optional)"}
          </label>
          <button type="button" onClick={() => inputRef.current?.click()}
            className="mt-3 w-full rounded-2xl py-5 flex flex-col items-center gap-2 text-text-secondary active:scale-[0.99] transition"
            style={{ background: "#0A0E1A", border: "1px dashed rgba(16,185,129,0.4)" }}>
            <Upload size={18} />
            <span className="text-[13px]">{file ? file.name : editing?.meal_photo_url ? "Photo on file — tap to replace" : "Tap to add photo"}</span>
          </button>
          <input ref={inputRef} type="file" accept="image/*" capture="environment" className="hidden"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
        </div>
        {err && <p className="text-[12px] text-red-400">{err}</p>}
        <SubmitBtn busy={busy} label={editing ? "Save changes" : "Log meal"} disabled={!desc.trim()} />
      </form>
    </Sheet>
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
            className="mt-3 w-full rounded-2xl p-4 text-[14px] text-white placeholder:text-text-tertiary focus:outline-none"
            style={{ background: "#0A0E1A", border: "1px solid rgba(255,255,255,0.08)" }}
          />
        </div>
        <div>
          <label className="text-[12px] uppercase text-text-tertiary tracking-wider">Notes (optional)</label>
          <textarea
            value={notes} onChange={(e) => setNotes(e.target.value)} rows={3}
            placeholder="How did the session feel?"
            className="mt-3 w-full rounded-2xl p-4 text-[14px] text-white placeholder:text-text-tertiary resize-none focus:outline-none"
            style={{ background: "#0A0E1A", border: "1px solid rgba(255,255,255,0.08)" }}
          />
        </div>
        {err && <p className="text-[12px] text-red-400">{err}</p>}
        <SubmitBtn busy={busy} label="Save workout" />
      </form>
    </Sheet>
  );
}
