import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { ChevronLeft, ChevronRight, RotateCcw, LogOut, Upload, FileText, Trash2, Download, Loader2 } from "lucide-react";
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
  const { profile, reset } = useProfile();
  const navigate = useNavigate();

  const handleSignOut = async () => {
    const { error } = await supabase.auth.signOut();
    if (error) {
      toast.error(`Sign-out failed: ${error.message}`);
      return;
    }
    navigate({ to: "/" });
  };

  return (
    <div className="min-h-screen bg-bg-1 pb-32">
      <header className="flex items-center justify-between px-5 pt-6">
        <Link to="/dashboard" className="text-text-secondary"><ChevronLeft size={24} /></Link>
        <span className="text-[11px] uppercase tracking-wider text-text-tertiary">Profile</span>
        <span className="w-6" />
      </header>

      <section className="mx-5 mt-6 rounded-3xl bg-bg-2 border border-white/5 p-5 flex items-center gap-4">
        <div className="h-16 w-16 rounded-full gradient-brand flex items-center justify-center text-2xl font-bold text-white">{profile.name[0]}</div>
        <div className="flex-1">
          <h2 className="text-xl font-bold">{profile.name}</h2>
          <p className="text-xs text-text-secondary capitalize">{profile.goal ?? "recomp"} · 8 weeks in</p>
        </div>
      </section>

      <Group title="Profile">
        <Row label="Age" value={`${profile.age}`} />
        <Row label="Weight" value={`${profile.weightKg} kg`} />
        <Row label="Height" value={`${profile.heightCm} cm`} />
        <Row label="Body fat" value={`${profile.bodyFat}% → ${profile.targetBodyFat}%`} />
      </Group>

      <Group title="Training">
        <Row label="Goal" value={profile.goal ?? "—"} />
        <Row label="Experience" value={profile.experience ?? "—"} />
        <Row label="Frequency" value={`${profile.frequency}× / week`} />
      </Group>

      <Group title="Connected devices">
        <Row label="WHOOP" value="Coming v1.1" muted />
        <Row label="Apple Health" value="Coming v1.1" muted />
        <Row label="Manual entry" value="Active" success />
      </Group>

      <Group title="AI Coach">
        <Row label="Coach name" value={profile.coachName} />
      </Group>

      <ResourceLibrary />

      <button
        onClick={handleSignOut}
        className="mx-5 mt-6 w-[calc(100%-2.5rem)] flex items-center justify-center gap-2 rounded-2xl bg-bg-2 border border-white/10 py-3.5 text-sm font-semibold"
      >
        <LogOut size={16} /> Sign out
      </button>

      <button
        onClick={() => { reset(); navigate({ to: "/" }); }}
        className="mx-5 mt-3 w-[calc(100%-2.5rem)] flex items-center justify-center gap-2 rounded-2xl bg-bg-2 border border-danger/30 text-danger py-3.5 text-sm font-semibold"
      >
        <RotateCcw size={16} /> Reset onboarding
      </button>

      <BottomNav />
    </div>
  );
}

type ResourceFile = { name: string; id?: string | null; size?: number; updated_at?: string };

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

function Group({ title, children }: any) {
  return (
    <section className="mx-5 mt-6">
      <p className="text-[10px] uppercase tracking-wider text-text-tertiary mb-2 ml-1">{title}</p>
      <div className="rounded-2xl bg-bg-2 border border-white/5 divide-y divide-white/5">{children}</div>
    </section>
  );
}

function Row({ label, value, muted, success }: { label: string; value: string; muted?: boolean; success?: boolean }) {
  return (
    <div className="flex items-center justify-between px-4 py-3.5">
      <span className="text-sm">{label}</span>
      <span className="flex items-center gap-1.5">
        <span className={`text-sm capitalize ${muted ? "text-text-tertiary" : success ? "text-success" : "text-text-secondary"}`}>{value}</span>
        <ChevronRight size={14} className="text-text-tertiary" />
      </span>
    </div>
  );
}
