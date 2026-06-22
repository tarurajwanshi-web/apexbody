import { createFileRoute, Link } from "@tanstack/react-router";
import { useState, useRef, useEffect } from "react";
import { useServerFn } from "@tanstack/react-start";
import { ChevronLeft, Sparkles, Send, Lock, Flame } from "lucide-react";
import { BottomNav } from "@/components/BottomNav";
import { useProfile } from "@/lib/store";
import { askCoach } from "@/lib/coach.functions";
import { getActivityWeek, type ActivityWeek } from "@/lib/shield.functions";
import { supabase } from "@/integrations/supabase/client";
import { useUserTimezone, getLocalDateISO, addDaysISO } from "@/lib/dates";
import { ApexStreakStrip, type ApexStreakDay } from "@/components/ApexStreakStrip";

export const Route = createFileRoute("/coach")({
  head: () => ({ meta: [{ title: "APEX Coach" }] }),
  component: Coach,
});

type Msg = { role: "user" | "assistant"; content: string };

// Generic, NOT personalized — these only appear in the locked state.
const GENERIC_CHIPS = [
  "How much protein do I need daily?",
  "What's a good sleep routine?",
  "How long should I rest between sets?",
  "Best foods for recovery?",
];

const UNLOCKED_CHIPS = [
  "Should I push or recover today?",
  "What should I eat?",
  "Modify today's workout",
  "Weekly assessment",
];

const DAY_LETTERS = ["M", "T", "W", "T", "F", "S", "S"]; // visual labels in locked streak strip

function Coach() {
  const { profile } = useProfile();
  const userTz = useUserTimezone();
  const askFn = useServerFn(askCoach);
  const fetchActivity = useServerFn(getActivityWeek);

  const [unlockDate, setUnlockDate] = useState<string | null>(null);
  const [unlockLoaded, setUnlockLoaded] = useState(false);
  const [activity, setActivity] = useState<ActivityWeek | null>(null);

  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);

  // Load profile (unlock date) + activity in parallel.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) { if (!cancelled) setUnlockLoaded(true); return; }
      const { data } = await supabase
        .from("profiles")
        .select("plan_unlock_date")
        .eq("user_id", u.user.id)
        .maybeSingle();
      if (!cancelled) {
        setUnlockDate(data?.plan_unlock_date ?? null);
        setUnlockLoaded(true);
      }
    })();
    fetchActivity().then((a) => { if (!cancelled) setActivity(a); }).catch(() => {});
    return () => { cancelled = true; };
  }, [fetchActivity]);

  const isLocked = (() => {
    if (!unlockLoaded) return true;
    if (!unlockDate) return true;
    return new Date(unlockDate).getTime() > Date.now();
  })();

  const daysUntilUnlock = (() => {
    if (!unlockDate) return null;
    const ms = new Date(unlockDate).getTime() - Date.now();
    return Math.max(0, Math.ceil(ms / 86400000));
  })();

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  const send = async (text: string) => {
    if (!text.trim() || loading) return;
    setError(null);

    const userMsg: Msg = { role: "user", content: text };
    const next = [...messages, userMsg];
    setMessages(next);
    setInput("");
    setLoading(true);

    try {
      if (isLocked) {
        // LOCKED → general Q&A edge function. NO personal data sent.
        const { data, error: invokeErr } = await supabase.functions.invoke("coach-general-qa", {
          body: { messages: next.map((m) => ({ role: m.role, content: m.content })) },
        });
        if (invokeErr) throw new Error(invokeErr.message ?? "Coach unavailable");
        if (data?.error) throw new Error(String(data.error));
        const content = (data?.content as string) || "I couldn't generate a response. Try again in a moment.";
        setMessages((m) => [...m, { role: "assistant", content }]);
      } else {
        // UNLOCKED → personalized coach (direct Anthropic via server fn).
        const r = await askFn({ data: { messages: next } });
        setMessages((m) => [...m, { role: "assistant", content: r.content }]);
      }
    } catch (e: any) {
      setError(e?.message ?? "Something went wrong.");
    } finally {
      setLoading(false);
    }
  };

  const chipSet = isLocked ? GENERIC_CHIPS : UNLOCKED_CHIPS;

  return (
    <div
      className="min-h-screen pb-40 flex flex-col"
      style={{ background: "linear-gradient(180deg, #0F1524 0%, #0A0E1A 60%)" }}
    >
      <header className="flex items-center justify-between px-5 pt-6">
        <Link to="/dashboard" className="text-text-secondary"><ChevronLeft size={24} /></Link>
        <span className="text-[11px] uppercase tracking-wider text-text-tertiary">Coach</span>
        <Link to="/settings" className="text-[11px] text-text-tertiary">Settings</Link>
      </header>

      {isLocked ? (
        <LockedHero
          name={profile.name || "athlete"}
          daysUntilUnlock={daysUntilUnlock}
          activity={activity}
        />
      ) : (
        <UnlockedHero name={profile.name || "athlete"} />
      )}

      {/* CONVERSATION */}
      <section className="mx-5 mt-5 flex-1 space-y-3">
        {messages.length === 0 && (
          <p className="text-[12px] text-text-tertiary text-center mt-2">
            {isLocked ? "Ask a general fitness, nutrition, or sleep question below." : "What's on your mind?"}
          </p>
        )}
        {messages.map((m, i) => (
          <div key={i} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
            <div
              className={`max-w-[85%] rounded-2xl px-4 py-3 text-sm leading-relaxed whitespace-pre-wrap ${
                m.role === "user" ? "gradient-brand text-white" : "bg-bg-2 border border-white/5"
              }`}
            >
              {m.content}
            </div>
          </div>
        ))}
        {loading && (
          <div className="flex justify-start">
            <div className="rounded-2xl bg-bg-2 border border-white/5 px-4 py-3 flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full bg-ai" style={{ animation: "typing-dot 1.2s ease-in-out infinite" }} />
              <span className="h-2 w-2 rounded-full bg-ai" style={{ animation: "typing-dot 1.2s ease-in-out infinite", animationDelay: "150ms" }} />
              <span className="h-2 w-2 rounded-full bg-ai" style={{ animation: "typing-dot 1.2s ease-in-out infinite", animationDelay: "300ms" }} />
            </div>
          </div>
        )}
        <style>{`@keyframes typing-dot { 0%,60%,100% { opacity: 0.3; transform: scale(0.85); } 30% { opacity: 1; transform: scale(1); } }`}</style>
        {error && (
          <div className="rounded-2xl border border-danger/30 bg-danger/10 p-3 text-sm text-danger">
            {error}
          </div>
        )}
        <div ref={endRef} />
      </section>

      <div className="h-4" />

      {/* SMART CHIPS */}
      <div className="fixed bottom-32 left-0 right-0 z-30 pointer-events-none">
        <div className="mx-auto max-w-[430px] px-5 pointer-events-auto">
          <div className="flex gap-2 overflow-x-auto pb-2 -mx-1 px-1 scrollbar-hide">
            {chipSet.map((s) => (
              <button
                key={s}
                onClick={() => send(s)}
                disabled={loading}
                className="shrink-0 rounded-full border border-white/10 bg-bg-2/90 backdrop-blur px-3.5 py-1.5 text-xs text-text-secondary hover:text-text-primary hover:border-ai/40 transition disabled:opacity-50"
              >
                {s}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* INPUT BAR */}
      <div className="fixed bottom-20 left-0 right-0 px-5 z-30">
        <div className="mx-auto max-w-[430px] flex items-center gap-2 rounded-full bg-bg-2 border border-white/10 px-4 py-2 backdrop-blur">
          <Sparkles size={16} className="text-ai shrink-0" />
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && send(input)}
            placeholder={isLocked ? "Ask a general fitness question…" : "What's on your mind?"}
            className="flex-1 bg-transparent text-sm outline-none placeholder:text-text-tertiary"
          />
          <button
            onClick={() => send(input)}
            disabled={loading || !input.trim()}
            className="h-8 w-8 rounded-full gradient-brand flex items-center justify-center text-white disabled:opacity-40"
          >
            <Send size={14} />
          </button>
        </div>
      </div>

      <BottomNav />
    </div>
  );
}

function LockedHero({
  name, daysUntilUnlock, activity,
}: { name: string; daysUntilUnlock: number | null; activity: ActivityWeek | null }) {
  const last7 = activity?.last7 ?? Array.from({ length: 7 }, () => false);
  const streak = activity?.streak ?? 0;
  const totalDays = 7;
  const dayOfJourney = daysUntilUnlock != null ? Math.max(1, totalDays - daysUntilUnlock) : 1;
  const progressPct = Math.min(100, Math.round((dayOfJourney / totalDays) * 100));
  const today = new Date();

  return (
    <>
      <div className="mx-5 mt-4 flex items-center gap-2 rounded-full border border-white/10 bg-bg-2 px-3 py-1.5 w-fit">
        <Lock size={12} className="text-text-tertiary" />
        <span className="text-[11px] font-semibold text-text-secondary">
          Day {dayOfJourney} of {totalDays} — personalized coaching unlocking
        </span>
      </div>

      <section
        className="mx-5 mt-4 rounded-2xl p-5 border"
        style={{
          background: "linear-gradient(135deg, rgba(124,58,237,0.10), rgba(59,130,246,0.08))",
          borderColor: "rgba(124,58,237,0.25)",
        }}
      >
        <div className="flex items-start gap-3">
          <div className="h-10 w-10 rounded-full gradient-brand flex items-center justify-center shrink-0">
            <Sparkles size={18} className="text-white" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-[11px] uppercase tracking-wider text-text-accent font-semibold">APEX Coach</p>
            <p className="mt-1 text-sm leading-relaxed text-text-primary">
              Hey {name}, I'm learning your patterns from your first {totalDays} days of logs so coaching is genuinely personalized — not generic advice. Until then I can answer general fitness, nutrition, and sleep questions below.
            </p>
          </div>
        </div>

        {/* Unlock progress */}
        <div className="mt-5">
          <div className="flex items-center justify-between mb-2">
            <p className="text-[10px] uppercase tracking-wider text-text-tertiary">Unlock progress</p>
            <span className="text-[11px] text-text-secondary tabular-nums">{progressPct}%</span>
          </div>
          <div className="h-1.5 w-full rounded-full overflow-hidden" style={{ background: "rgba(255,255,255,0.06)" }}>
            <div className="h-full gradient-brand transition-all" style={{ width: `${progressPct}%` }} />
          </div>
        </div>

        {/* What unlocks preview */}
        <div className="mt-5 rounded-xl p-3 space-y-1.5" style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)" }}>
          <p className="text-[10px] uppercase tracking-wider text-text-tertiary">What unlocks on day {totalDays}</p>
          <p className="text-[12px] text-text-secondary">• "Should I push or recover today?" — based on your real HRV & sleep</p>
          <p className="text-[12px] text-text-secondary">• Workout modifications tailored to your readiness</p>
          <p className="text-[12px] text-text-secondary">• Weekly assessments using your actual logged data</p>
        </div>

        {/* Streak strip — last 7 days */}
        <div className="mt-5">
          <div className="flex items-center justify-between mb-2">
            <p className="text-[10px] uppercase tracking-wider text-text-tertiary">Last 7 days</p>
            <span className="inline-flex items-center gap-1 text-[11px] text-text-secondary">
              <Flame size={11} className="text-warning" />
              <span className="tabular-nums">{streak}</span> day streak
            </span>
          </div>
          <div className="grid grid-cols-7 gap-2">
            {last7.map((logged, i) => {
              const d = new Date(today);
              d.setDate(d.getDate() - (6 - i));
              const dow = (d.getDay() + 6) % 7;
              const letter = DAY_LETTERS[dow];
              const isTodayCell = i === 6;
              return (
                <div key={i} className="flex flex-col items-center gap-1">
                  <div
                    className="h-9 w-9 rounded-xl flex items-center justify-center text-[11px] font-bold transition"
                    style={
                      logged
                        ? { background: "linear-gradient(135deg, #7C3AED 0%, #3B82F6 100%)", color: "white", boxShadow: "0 0 10px rgba(124,58,237,0.4)" }
                        : { background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)", color: "#6B7280" }
                    }
                  >
                    {letter}
                  </div>
                  {isTodayCell && (
                    <span className="text-[9px] text-text-accent uppercase tracking-wider font-semibold">Today</span>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </section>
    </>
  );
}

function UnlockedHero({ name }: { name: string }) {
  return (
    <section
      className="mx-5 mt-5 rounded-2xl p-4 border"
      style={{
        background: "linear-gradient(135deg, rgba(124,58,237,0.06), rgba(59,130,246,0.06))",
        borderColor: "rgba(124,58,237,0.25)",
      }}
    >
      <div className="flex items-start gap-3">
        <div className="h-8 w-8 rounded-full gradient-brand flex items-center justify-center shrink-0">
          <Sparkles size={16} className="text-white" />
        </div>
        <div className="flex-1">
          <p className="text-[11px] uppercase tracking-wider text-text-accent font-semibold">
            APEX Coach
          </p>
          <p className="mt-1 text-sm leading-relaxed text-text-primary">
            Ready when you are, {name}. Ask me anything about your training, recovery, or nutrition.
          </p>
        </div>
      </div>
    </section>
  );
}
