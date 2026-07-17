import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { ChevronLeft, ChevronRight, RotateCcw, LogOut, FileText, FileLock, ShieldCheck, Heart, Plug, Activity, Watch } from "lucide-react";
import { useEffect, useState } from "react";
import { useProfile } from "@/lib/store";
import { DashboardNav } from "@/components/dashboard/DashboardNav";
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
      if (!u.user) return;
      await supabase.from("profiles")
        .update({ soft_reset_at: new Date().toISOString() })
        .eq("user_id", u.user.id);
      reset();
      navigate({ to: "/onboarding", search: { reset: "true" } });
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

      <Group title="Integrations">
        <LinkRow to="/connect" label="Connect to ChatGPT & Claude" Icon={Plug} />
      </Group>

      <Group title="Legal & data">
        <LinkRow to="/terms" label="Terms of Service" Icon={FileText} />
        <LinkRow to="/privacy" label="Privacy Policy" Icon={FileLock} />
        <LinkRow to="/health-data" label="Health Data Policy" Icon={ShieldCheck} />
      </Group>

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
          <RotateCcw size={16} /> Reset training & nutrition
        </button>
      ) : (
        <div className="mx-5 mt-3 rounded-2xl border border-danger/40 bg-danger/5 p-4 space-y-3">
          <p className="text-[13px] font-semibold text-text-primary">Reset training & nutrition</p>
          <p className="text-[13px] text-text-primary">
            This recalculates your macro targets and training plan. Your meal logs, body measurements, and history are kept.
          </p>
          <div className="flex gap-2">
            <button
              onClick={handleResetOnboarding}
              className="flex-1 rounded-xl bg-danger text-white py-2.5 text-sm font-semibold"
            >
              Yes, reset plan
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

      <footer className="mx-5 mt-10 text-center select-none">
        <p className="text-[10px] text-text-tertiary leading-relaxed">
          APEX Shield and APEX Intelligence are proprietary algorithms.<br />
          Unauthorized use, reproduction, or distribution is prohibited.<br />
          © 2026 APEX. All rights reserved.
        </p>
      </footer>

      <DashboardNav />
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


function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mx-5 mt-6">
      <p className="text-[10px] uppercase tracking-wider text-text-tertiary mb-2 ml-1">{title}</p>
      <div className="rounded-2xl bg-bg-2 border border-white/5 divide-y divide-white/5">{children}</div>
    </section>
  );
}
