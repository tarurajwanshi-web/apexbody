import { createFileRoute, Link } from "@tanstack/react-router";
import { useState, useRef, useEffect, useMemo } from "react";
import { useServerFn } from "@tanstack/react-start";
import { ChevronLeft, Sparkles, Send, CheckCircle2 } from "lucide-react";
import { BottomNav } from "@/components/BottomNav";
import { useProfile } from "@/lib/store";
import { todayMetrics, todaySession, macroTargets, macroToday } from "@/lib/mock";
import { askCoach } from "@/lib/coach.functions";

export const Route = createFileRoute("/coach")({
  head: () => ({ meta: [{ title: "APEX Coach" }] }),
  component: Coach,
});

type Msg = { role: "user" | "assistant"; content: string };

type Mode = "no-data" | "ramping" | "trained-today" | "rest-day";

function getLoggedDays(): number {
  if (typeof window === "undefined") return 0;
  return Number(localStorage.getItem("apex_logged_days") ?? "0");
}
function getTrainedToday(): boolean {
  if (typeof window === "undefined") return false;
  return localStorage.getItem("apex_trained_today") === "1";
}
function getJourneyDay(): number {
  if (typeof window === "undefined") return 1;
  const start = Number(localStorage.getItem("apex_journey_start") ?? Date.now());
  return Math.max(1, Math.floor((Date.now() - start) / 86400000) + 1);
}

function Coach() {
  const { profile } = useProfile();
  const fn = useServerFn(askCoach);

  const loggedDays = getLoggedDays();
  const trainedToday = getTrainedToday();

  const mode: Mode = useMemo(() => {
    if (loggedDays === 0) return "no-data";
    if (loggedDays < 3) return "ramping";
    return trainedToday ? "trained-today" : "rest-day";
  }, [loggedDays, trainedToday]);

  const callBadge =
    mode === "trained-today"
      ? { label: "RECOVER", color: "bg-sleep/20 text-sleep" }
      : mode === "rest-day"
      ? { label: "PUSH", color: "bg-success/20 text-success" }
      : { label: "MAINTAIN", color: "bg-warning/20 text-warning" };

  const contextText = (() => {
    if (mode === "no-data")
      return "I don't have enough data to coach you yet. Log a workout, meal, or your sleep and I'll start learning.";
    if (mode === "ramping")
      return `Your energy has been steady this week. Based on that + your training, here's what I think:`;
    if (mode === "trained-today")
      return `You did ${todaySession.name} today. Recovery is ${todayMetrics.recovery}. Prioritize sleep and protein tonight.`;
    return `You rested yesterday. Recovery is ${todayMetrics.recovery} and HRV ${todayMetrics.hrv}ms. Push intensity today.`;
  })();

  const whyText = (() => {
    if (mode === "trained-today")
      return `Strain hit ${todayMetrics.strain} and you're ${macroTargets.p - macroToday.p}g short on protein. Eat, hydrate, sleep 8h.`;
    if (mode === "rest-day")
      return `HRV ${todayMetrics.hrv}ms is above your 7-day avg. Heavy compounds are green-lit.`;
    return "";
  })();

  const chipSet: string[] = (() => {
    if (mode === "no-data")
      return [
        "What data do you need from me?",
        "How does APEX coaching work?",
        "Set up my first workout",
      ];
    if (mode === "trained-today")
      return [
        "How should I recover tonight?",
        "Was my volume enough?",
        "What should I eat post-workout?",
        "Am I hitting my macros?",
      ];
    return [
      "What should I train today?",
      "Should I push or recover?",
      "I only have 30 minutes",
      "Something feels tight",
      "What should my next meal be?",
    ];
  })();

  const greeting = (() => {
    if (mode === "no-data") return "Let's get you started.";
    if (mode === "trained-today") return `Nice work today, ${profile.name || "athlete"}.`;
    return `Ready when you are, ${profile.name || "athlete"}.`;
  })();

  const [messages, setMessages] = useState<Msg[]>([
    { role: "assistant", content: greeting },
  ]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  const send = async (text: string) => {
    if (!text.trim() || loading) return;
    setError(null);
    const context =
      mode === "no-data"
        ? `User just finished onboarding. No workouts, meals, or sleep logged yet. Goal: ${profile.goal ?? "recomposition"}, experience: ${profile.experience ?? "intermediate"}.`
        : `User context — goal: ${profile.goal ?? "recomp"}, experience: ${profile.experience ?? "intermediate"}, APEX score: ${todayMetrics.apexScore}/100, recovery: ${todayMetrics.recovery}, HRV: ${todayMetrics.hrv}ms, sleep: ${todayMetrics.sleepHours}h, protein today: ${macroToday.p}g of ${macroTargets.p}g target, trained today: ${trainedToday ? "yes — " + todaySession.name : "no"}, days logged: ${loggedDays}.`;

    const userMsg: Msg = { role: "user", content: text };
    const next = [...messages, userMsg];
    setMessages(next);
    setInput("");
    setLoading(true);
    try {
      const r = await fn({
        data: {
          messages: [
            { role: "user", content: context },
            { role: "assistant", content: "Understood. I'll use that data." },
            ...next,
          ],
        },
      });
      setMessages((m) => [...m, { role: "assistant", content: r.content }]);
    } catch (e: any) {
      setError(e?.message ?? "Something went wrong.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-bg-1 pb-40 flex flex-col">
      <header className="flex items-center justify-between px-5 pt-6">
        <Link to="/home" className="text-text-secondary"><ChevronLeft size={24} /></Link>
        <span className="text-[11px] uppercase tracking-wider text-text-tertiary">Coach</span>
        <Link to="/settings" className="text-[11px] text-text-tertiary">Settings</Link>
      </header>

      {/* SMART CONTEXT CARD */}
      <div
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
              APEX · {profile.coachName} Coach
            </p>
            <p className="mt-1 text-sm leading-relaxed text-text-primary">{contextText}</p>
          </div>
        </div>
      </div>

      {/* TODAY'S CALL CARD */}
      <div
        className="mx-5 mt-3 rounded-2xl bg-bg-2 p-4"
        style={{ borderLeft: "4px solid var(--ai-purple)" }}
      >
        {mode === "no-data" || mode === "ramping" ? (
          <>
            <p className="text-[11px] uppercase tracking-wider text-text-tertiary font-semibold">
              Unlock personalized coaching
            </p>
            <p className="mt-2 text-sm text-text-primary">
              Log {Math.max(0, 3 - loggedDays)} more day{3 - loggedDays === 1 ? "" : "s"} of data to unlock personalized coaching.
            </p>
            <div className="mt-3 flex items-center gap-3">
              <div className="flex-1 h-1.5 rounded-full bg-white/10 overflow-hidden">
                <div
                  className="h-full gradient-brand transition-all"
                  style={{ width: `${Math.min(100, (loggedDays / 5) * 100)}%` }}
                />
              </div>
              <span className="text-[11px] text-text-secondary tabular-nums">
                Day {loggedDays} of 5
              </span>
            </div>
          </>
        ) : (
          <>
            <div className="flex items-center gap-2">
              <span className="text-[11px] uppercase tracking-wider text-text-tertiary font-semibold">
                Today's Call
              </span>
              <span className={`text-[10px] font-bold tracking-wide px-2 py-0.5 rounded-full ${callBadge.color}`}>
                {callBadge.label}
              </span>
            </div>
            <p className="mt-2 text-sm text-text-primary leading-relaxed">
              <span className="text-text-secondary">Why: </span>
              {whyText}
            </p>
          </>
        )}
      </div>

      {/* CONVERSATION */}
      <section className="mx-5 mt-5 flex-1 space-y-3">
        {messages.map((m, i) => (
          <div key={i} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
            <div
              className={`max-w-[85%] rounded-2xl px-4 py-3 text-sm leading-relaxed whitespace-pre-wrap ${
                m.role === "user"
                  ? "gradient-brand text-white"
                  : "bg-bg-2 border border-white/5"
              }`}
            >
              {m.content}
            </div>
          </div>
        ))}
        {loading && (
          <div className="flex justify-start">
            <div className="rounded-2xl bg-bg-2 border border-white/5 px-4 py-3 flex items-center gap-2">
              <span className="h-2 w-2 rounded-full bg-ai animate-pulse" />
              <span className="text-xs text-text-secondary">Thinking…</span>
            </div>
          </div>
        )}
        {error && (
          <div className="rounded-2xl border border-danger/30 bg-danger/10 p-3 text-sm text-danger">
            {error}
          </div>
        )}
        <div ref={endRef} />
      </section>

      <div className="h-4" />

      {/* SMART CHIPS — horizontally scrollable above input */}
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
          <CheckCircle2 size={16} className="text-success shrink-0" />
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && send(input)}
            placeholder="What's on your mind?"
            className="flex-1 bg-transparent text-sm outline-none placeholder:text-text-tertiary"
          />
          <button
            onClick={() => send(input)}
            disabled={loading || !input.trim()}
            className="h-8 w-8 rounded-full gradient-brand flex items-center justify-center text-white disabled:opacity-40"
            style={{ backgroundColor: "#7C3AED" }}
          >
            <Send size={14} />
          </button>
        </div>
      </div>

      <BottomNav />
    </div>
  );
}
