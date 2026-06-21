import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { ChevronLeft, ChevronRight, RotateCcw, LogOut, Upload, FileText, Trash2, Download, Loader2, FileLock, ShieldCheck, Heart } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useProfile } from "@/lib/store";
import { BottomNav } from "@/components/BottomNav";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export const Route = createFileRoute("/settings")({
  head: () => ({ meta: [{ title: "Settings — APEX" }] }),
  component: Settings,
});

function Settings() {
  const { profile, reset, update } = useProfile();
  const navigate = useNavigate();
  const [confirmReset, setConfirmReset] = useState(false);
  const [recoveryMethod, setRecoveryMethod] = useState<"device" | "manual" | null>(null);
  const [name, setName] = useState(profile.name);
  const [savingName, setSavingName] = useState(false);

  useEffect(() => {
    (async () => {
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) return;
      const { data } = await supabase
        .from("profiles")
        .select("name, input_path_preference")
        .eq("user_id", u.user.id)
        .maybeSingle();
      if (data?.name) { setName(data.name); update({ name: data.name }); }
      if (data?.input_path_preference === "device" || data?.input_path_preference === "manual") {
        setRecoveryMethod(data.input_path_preference);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const setMethod = async (m: "device" | "manual") => {
    setRecoveryMethod(m);
    const { data: u } = await supabase.auth.getUser();
    if (!u.user) return;
    const { error } = await supabase.from("profiles").upsert({ user_id: u.user.id, input_path_preference: m }, { onConflict: "user_id" });
    if (error) toast.error(error.message); else toast.success("Recovery method updated");
  };

  const saveName = async () => {
    const v = name.trim();
    if (!v) return;
    setSavingName(true);
    try {
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) throw new Error("Not signed in");
      const { error } = await supabase.from("profiles").upsert({ user_id: u.user.id, name: v }, { onConflict: "user_id" });
      if (error) throw error;
      update({ name: v });
      toast.success("Name saved");
    } catch (e: any) {
      toast.error(e?.message ?? "Could not save");
    } finally {
      setSavingName(false);
    }
  };

  const handleSignOut = async () => {
    const { error } = await supabase.auth.signOut();
    if (error) { toast.error(`Sign-out failed: ${error.message}`); return; }
    navigate({ to: "/" });
  };

  const handleResetOnboarding = async () => {
    try {
      const { data: u } = await supabase.auth.getUser();
      if (u.user) {
        await supabase.from("profiles").update({ profile_completed_at: null }).eq("user_id", u.user.id);
      }
      reset();
      try { localStorage.removeItem("apex_journey_start"); } catch {}
      navigate({ to: "/onboarding" });
    } catch (e: any) {
      toast.error(e?.message ?? "Could not reset");
    }
  };

  return (
    <div
      className="min-h-screen bg-bg-1"
      style={{
        paddingTop: "calc(env(safe-area-inset-top, 0px) + 0px)",
        paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 128px)",
      }}
    >
      <header className="flex items-center justify-between px-5 pt-6">
        <Link to="/dashboard" className="text-text-secondary"><ChevronLeft size={24} /></Link>
        <span className="text-[11px] uppercase tracking-wider text-text-tertiary">Profile</span>
        <span className="w-6" />
      </header>

      <section className="mx-5 mt-6 rounded-3xl bg-bg-2 border border-white/5 p-5 flex items-center gap-4">
        <div className="h-16 w-16 rounded-full gradient-brand flex items-center justify-center text-2xl font-bold text-white shrink-0">
          {(name || "A").trim().charAt(0).toUpperCase()}
        </div>
        <div className="flex-1 min-w-0">
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onBlur={saveName}
            placeholder="Your name"
            className="w-full bg-transparent text-xl font-bold focus:outline-none"
            style={{ fontSize: 18 }}
          />
          <p className="text-xs text-text-secondary capitalize truncate">
            {profile.goal ?? "—"} {savingName && "· saving…"}
          </p>
        </div>
      </section>

      <Group title="Recovery tracking method">
        <div className="px-4 py-3 flex gap-2">
          {(["device", "manual"] as const).map((m) => {
            const active = recoveryMethod === m;
            return (
              <button
                key={m}
                onClick={() => setMethod(m)}
                className={`flex-1 rounded-xl py-2 text-xs font-semibold transition ${active ? "gradient-brand text-white" : "border border-white/10 bg-bg-1 text-text-secondary"}`}
              >
                {m === "device" ? "Wearable" : "Manual"}
              </button>
            );
          })}
        </div>
        <p className="px-4 pb-3 text-[11px] text-text-tertiary">
          {recoveryMethod === "device"
            ? "We'll parse your wearable screenshots and feed them into your APEX score."
            : "Quick daily 1-5 recovery check-in + sleep hours."}
        </p>
      </Group>

      <Group title="Legal & data">
        <LinkRow to="/terms" label="Terms of Service" Icon={FileText} />
        <LinkRow to="/privacy" label="Privacy Policy" Icon={FileLock} />
        <LinkRow to="/health-data" label="Health Data Policy" Icon={ShieldCheck} />
      </Group>

      <p className="mx-5 mt-3 text-[11px] text-text-tertiary leading-relaxed">
        Exercise reference images provided by the <a href="https://wger.de" target="_blank" rel="noreferrer" className="underline">wger project</a> (wger.de), licensed under <a href="https://creativecommons.org/licenses/by-sa/4.0/" target="_blank" rel="noreferrer" className="underline">CC BY-SA 4.0</a>. Per-image attribution shown alongside each image.
      </p>

      <ResourceLibrary />

      <button
        onClick={handleSignOut}
        className="mx-5 mt-6 w-[calc(100%-2.5rem)] flex items-center justify-center gap-2 rounded-2xl bg-bg-2 border border-white/10 py-3.5 text-sm font-semibold"
      >
        <LogOut size={16} /> Sign out
      </button>

      {!confirmReset ? (
        <button
          onClick={() => setConfirmReset(true)}
          className="mx-5 mt-3 w-[calc(100%-2.5rem)] flex items-center justify-center gap-2 rounded-2xl bg-bg-2 border border-danger/30 text-danger py-3.5 text-sm font-semibold"
        >
          <RotateCcw size={16} /> Reset onboarding
        </button>
      ) : (
        <div className="mx-5 mt-3 rounded-2xl border border-danger/40 bg-danger/5 p-4 space-y-3">
          <p className="text-[13px] text-text-primary">
            Reset onboarding will return you to step 1 of the setup flow. Your account and logged data are not deleted.
          </p>
          <div className="flex gap-2">
            <button
              onClick={handleResetOnboarding}
              className="flex-1 rounded-xl bg-danger text-white py-2.5 text-sm font-semibold"
            >
              Yes, reset
            </button>
            <button
              onClick={() => setConfirmReset(false)}
              className="flex-1 rounded-xl border border-white/10 py-2.5 text-sm text-text-secondary"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      <BottomNav />
    </div>
  );
}

function LinkRow({ to, label, Icon }: { to: string; label: string; Icon: typeof Heart }) {
  return (
    <Link to={to} className="flex items-center gap-3 px-4 py-3.5">
      <Icon size={16} className="text-text-tertiary shrink-0" />
      <span className="flex-1 text-sm">{label}</span>
      <ChevronRight size={14} className="text-text-tertiary" />
    </Link>
  );
}

type ResourceFile = { name: string; id?: string | null; size?: number; updated_at?: string | null };

function ResourceLibrary() {
  const [files, setFiles] = useState<ResourceFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const load = async () => {
    setLoading(true);
    const { data, error } = await supabase.storage.from("resources").list("", {
      limit: 100,
      sortBy: { column: "updated_at", order: "desc" },
    });
    if (error) toast.error(error.message);
    setFiles((data ?? []).filter((f) => f.name && !f.name.endsWith("/")));
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const upload = async (file: File) => {
    setUploading(true);
    try {
      const safeName = file.name.replace(/\s+/g, "-");
      const path = `${Date.now()}-${safeName}`;
      const { error } = await supabase.storage.from("resources").upload(path, file, {
        contentType: file.type || "application/octet-stream",
      });
      if (error) throw error;
      toast.success("Uploaded");
      await load();
    } catch (e: any) {
      toast.error(e?.message ?? "Upload failed");
    } finally {
      setUploading(false);
    }
  };

  const download = async (name: string) => {
    const { data, error } = await supabase.storage.from("resources").createSignedUrl(name, 300);
    if (error || !data?.signedUrl) { toast.error(error?.message ?? "Could not get link"); return; }
    window.open(data.signedUrl, "_blank");
  };

  const remove = async (name: string) => {
    if (!confirm(`Delete "${name}"?`)) return;
    const { error } = await supabase.storage.from("resources").remove([name]);
    if (error) { toast.error(error.message); return; }
    toast.success("Deleted");
    await load();
  };

  return (
    <section className="mx-5 mt-6">
      <div className="flex items-center justify-between mb-2 ml-1">
        <p className="text-[10px] uppercase tracking-wider text-text-tertiary">Resource library</p>
        <button
          onClick={() => inputRef.current?.click()}
          disabled={uploading}
          className="flex items-center gap-1 text-[11px] text-text-accent font-semibold disabled:opacity-50"
        >
          {uploading ? <Loader2 size={12} className="animate-spin" /> : <Upload size={12} />}
          {uploading ? "Uploading…" : "Upload"}
        </button>
        <input
          ref={inputRef}
          type="file"
          accept="application/pdf,.pdf,.epub,.mobi,application/epub+zip"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) upload(f);
            e.target.value = "";
          }}
        />
      </div>
      <div className="rounded-2xl bg-bg-2 border border-white/5 divide-y divide-white/5">
        {loading ? (
          <div className="px-4 py-6 flex justify-center"><Loader2 size={16} className="animate-spin text-text-tertiary" /></div>
        ) : files.length === 0 ? (
          <p className="px-4 py-5 text-[12px] text-text-tertiary">No resources yet. Upload a PDF or ebook to get started.</p>
        ) : (
          files.map((f) => (
            <div key={f.name} className="flex items-center gap-3 px-4 py-3">
              <FileText size={16} className="text-text-tertiary shrink-0" />
              <button onClick={() => download(f.name)} className="flex-1 min-w-0 text-left">
                <p className="text-sm truncate">{f.name.replace(/^\d+-/, "")}</p>
                {f.size != null && (
                  <p className="text-[10px] text-text-tertiary">{(f.size / 1024).toFixed(0)} KB</p>
                )}
              </button>
              <button onClick={() => download(f.name)} className="p-1 text-text-tertiary active:opacity-70" aria-label="Download">
                <Download size={14} />
              </button>
              <button onClick={() => remove(f.name)} className="p-1 text-danger/80 active:opacity-70" aria-label="Delete">
                <Trash2 size={14} />
              </button>
            </div>
          ))
        )}
      </div>
    </section>
  );
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mx-5 mt-6">
      <p className="text-[10px] uppercase tracking-wider text-text-tertiary mb-2 ml-1">{title}</p>
      <div className="rounded-2xl bg-bg-2 border border-white/5 divide-y divide-white/5">{children}</div>
    </section>
  );
}
