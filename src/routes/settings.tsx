import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { ChevronLeft, ChevronRight, RotateCcw, LogOut } from "lucide-react";
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

      <section className="mx-5 mt-4 grid grid-cols-3 gap-2">
        <Stat n="47" l="Workouts" />
        <Stat n="312" l="Meals" />
        <Stat n="15" l="Coach" />
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

function Stat({ n, l }: { n: string; l: string }) {
  return (
    <div className="rounded-2xl bg-bg-2 border border-white/5 p-4 text-center">
      <p className="text-2xl font-bold gradient-text">{n}</p>
      <p className="text-[10px] uppercase tracking-wider text-text-tertiary mt-1">{l}</p>
    </div>
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
