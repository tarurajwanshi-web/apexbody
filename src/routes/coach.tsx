import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { ChevronLeft, Sparkles, Dumbbell, Apple, Heart, Brain, CheckCircle2 } from "lucide-react";
import { AIOrb } from "@/components/AIOrb";
import { BottomNav } from "@/components/BottomNav";
import { useProfile } from "@/lib/store";
import { todayMetrics, macroTargets, macroToday } from "@/lib/mock";
import { generateCoachRecommendation } from "@/lib/coach.functions";

export const Route = createFileRoute("/coach")({
  head: () => ({ meta: [{ title: "APEX Coach" }] }),
  component: Coach,
});

const topics = [
  { id: "training" as const, icon: Dumbbell, label: "Training", sub: "Adjust today's plan", badge: "RECOMMENDED" },
  { id: "nutrition" as const, icon: Apple, label: "Nutrition", sub: "Hit your macros", badge: "" },
  { id: "recovery" as const, icon: Heart, label: "Recovery", sub: "Sleep & HRV strategy", badge: "" },
  { id: "general" as const, icon: Brain, label: "Mindset", sub: "Coaching insight", badge: "" },
];

function Coach() {
  const { profile } = useProfile();
  const fn = useServerFn(generateCoachRecommendation);
  const [topic, setTopic] = useState<typeof topics[number]["id"]>("training");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{ content: string; confidence: number } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const generate = async () => {
    setLoading(true); setError(null); setResult(null);
    try {
      const r = await fn({
        data: {
          goal: profile.goal ?? "body recomposition",
          experience: profile.experience ?? "intermediate",
          recovery: todayMetrics.recovery,
          sleepHours: todayMetrics.sleepHours,
          hrv: todayMetrics.hrv,
          apexScore: todayMetrics.apexScore,
          proteinShortG: macroTargets.p - macroToday.p,
          topic,
        },
      });
      setResult(r);
    } catch (e: any) {
      setError(e?.message ?? "Something went wrong.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-bg-1 pb-32">
      <header className="flex items-center justify-between px-5 pt-6">
        <Link to="/home" className="text-text-secondary"><ChevronLeft size={24} /></Link>
        <span className="text-[11px] uppercase tracking-wider text-text-tertiary">Coach</span>
        <Link to="/settings" className="text-[11px] text-text-tertiary">Settings</Link>
      </header>

      <div className="mx-5 mt-6 flex items-center gap-3">
        <AIOrb size={48} />
        <div>
          <h1 className="text-xl font-bold">{profile.coachName} Coach</h1>
          <p className="text-[11px] text-text-secondary">Adaptive intelligence · 94% match rate</p>
        </div>
      </div>

      {/* Daily context */}
      <section className="mx-5 mt-5 rounded-2xl border border-ai/20 bg-gradient-to-br from-ai/8 to-sleep/5 p-4">
        <p className="text-[10px] uppercase tracking-wider text-text-accent font-semibold flex items-center gap-1">
          <Sparkles size={11} /> Based on today's data
        </p>
        <p className="mt-2 text-sm leading-snug">
          Recovery is <span className="text-success font-semibold">strong</span> and HRV is trending up. This is the right time to <span className="font-semibold text-text-primary">increase training load</span>.
        </p>
      </section>

      {/* Topic picker */}
      <section className="mx-5 mt-5 grid grid-cols-2 gap-3">
        {topics.map((t) => {
          const active = topic === t.id;
          const Icon = t.icon;
          return (
            <button
              key={t.id}
              onClick={() => setTopic(t.id)}
              className={`rounded-2xl border p-4 text-left transition ${active ? "border-ai/60 bg-bg-2 ring-1 ring-ai/40 scale-[1.02]" : "border-white/8 bg-bg-2"}`}
            >
              <Icon size={22} className={active ? "text-text-accent" : "text-text-secondary"} />
              <p className="mt-3 font-semibold text-sm">{t.label}</p>
              <p className="text-[11px] text-text-secondary mt-0.5">{t.sub}</p>
              {t.badge && <span className="mt-2 inline-block rounded-full bg-success/15 text-success px-2 py-0.5 text-[9px] font-bold tracking-wider">{t.badge}</span>}
            </button>
          );
        })}
      </section>

      <button
        onClick={generate}
        disabled={loading}
        className="mx-5 mt-5 w-[calc(100%-2.5rem)] flex items-center justify-center gap-2 rounded-2xl gradient-brand py-4 font-semibold text-white disabled:opacity-50"
      >
        <Sparkles size={18} /> {loading ? "Generating…" : "Generate my recommendation"}
      </button>

      {loading && (
        <div className="mx-5 mt-6 rounded-3xl bg-bg-2 border border-white/5 p-6 flex flex-col items-center gap-4">
          <AIOrb size={48} />
          <p className="font-bold text-lg">Generating</p>
          <div className="w-full space-y-2 text-xs">
            <Step done text="Analyzing your data" />
            <Step active text="Processing patterns" />
            <Step text="Generating insights" />
          </div>
        </div>
      )}

      {error && (
        <div className="mx-5 mt-6 rounded-2xl border border-danger/30 bg-danger/10 p-4 text-sm text-danger">
          {error}
        </div>
      )}

      {result && (
        <section className="mx-5 mt-6 rounded-3xl bg-bg-2 border border-white/5 p-5 animate-fade-up">
          <div className="flex items-center justify-between">
            <h3 className="text-lg font-bold capitalize">{topic} Recommendation</h3>
            <span className="flex items-center gap-1 rounded-full bg-success/15 px-2 py-0.5 text-[10px] font-bold text-success">
              <CheckCircle2 size={11} /> {result.confidence}%
            </span>
          </div>
          <p className="mt-1 text-[11px] text-text-tertiary">Generated just now</p>

          <div className="mt-4 h-1 rounded-full bg-white/5 overflow-hidden">
            <div className="h-full bg-gradient-to-r from-success to-text-accent" style={{ width: `${result.confidence}%` }} />
          </div>
          <p className="mt-1.5 text-[11px] text-text-tertiary italic">Based on {profile.frequency} sessions/week, recovery {todayMetrics.recovery}, HRV {todayMetrics.hrv}ms</p>

          <div className="mt-5 rounded-2xl bg-bg-3/50 border-l-2 border-ai p-4">
            <p className="text-[10px] uppercase tracking-wider text-text-accent font-semibold">Here's what I recommend</p>
            <p className="mt-2 text-[15px] leading-relaxed whitespace-pre-wrap">{result.content}</p>
          </div>

          <div className="mt-4 flex items-center gap-2 text-[10px] text-text-tertiary">
            <CheckCircle2 size={12} className="text-success" />
            <span>Safety verified · AI reasoning by Gemini</span>
          </div>
        </section>
      )}

      <BottomNav />
    </div>
  );
}

function Step({ text, done, active }: { text: string; done?: boolean; active?: boolean }) {
  return (
    <div className="flex items-center gap-2">
      <span className={`h-2 w-2 rounded-full ${done ? "bg-success" : active ? "bg-ai animate-pulse" : "bg-white/10"}`} />
      <span className={`${done ? "text-text-secondary" : active ? "text-text-primary" : "text-text-tertiary"}`}>{text}</span>
    </div>
  );
}
