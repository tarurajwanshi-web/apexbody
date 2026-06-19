import { createFileRoute, Link } from "@tanstack/react-router";
import { Bell, Flame, ChevronRight, Dumbbell, Apple, Moon, TrendingUp, Sparkles } from "lucide-react";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useProfile } from "@/lib/store";
import { BottomNav } from "@/components/BottomNav";
import { AIBadge } from "@/components/AIOrb";
import { RingChart } from "@/components/RingChart";
import { todayMetrics, weekDays, aiInsightRotation, macroTargets, macroToday } from "@/lib/mock";
import { generateDailyInsight } from "@/lib/coach.functions";

export const Route = createFileRoute("/home")({
  head: () => ({ meta: [{ title: "Home — APEX" }] }),
  component: Home,
});

function Home() {
  const { profile } = useProfile();
  const fallback = aiInsightRotation[new Date().getDate() % aiInsightRotation.length];
  const fn = useServerFn(generateDailyInsight);
  const [insight, setInsight] = useState<string>(fallback);
  const [loadingInsight, setLoadingInsight] = useState(true);

  useEffect(() => {
    let cancelled = false;
    fn({
      data: {
        userData: {
          goal: profile.goal,
          apexScore: todayMetrics.apexScore,
          recovery: todayMetrics.recovery,
          hrv: todayMetrics.hrv,
          sleepHours: todayMetrics.sleepHours,
          proteinShortG: macroTargets.p - macroToday.p,
          streak: profile.streak,
        },
      },
    })
      .then((r) => { if (!cancelled && r.content) setInsight(r.content); })
      .catch(() => {})
      .finally(() => { if (!cancelled) setLoadingInsight(false); });
    return () => { cancelled = true; };
  }, [fn, profile.goal, profile.streak]);

  const hour = new Date().getHours();
  const greet = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";

  return (
    <div className="min-h-screen bg-bg-1 pb-32">
      <header className="flex items-center justify-between px-5 pt-6">
        <div className="flex items-center gap-3">
          <div className="h-9 w-9 rounded-full gradient-brand flex items-center justify-center text-sm font-bold text-white">
            {profile.name[0]}
          </div>
          <div>
            <p className="text-[11px] text-text-tertiary">{greet}</p>
            <p className="text-base font-semibold leading-tight">{profile.name}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className="flex items-center gap-1 rounded-full bg-bg-2 border border-white/5 px-2.5 py-1.5 text-xs font-semibold">
            <Flame size={14} className="text-warning" /> {profile.streak}
          </span>
          <button className="h-9 w-9 rounded-full bg-bg-2 border border-white/5 flex items-center justify-center">
            <Bell size={16} className="text-text-secondary" />
          </button>
        </div>
      </header>

      {/* Hero card */}
      <section className="mx-5 mt-5 rounded-3xl bg-bg-2 border border-white/5 p-5 card-shadow relative overflow-hidden">
        <div className="absolute -top-px left-6 right-6 h-px gradient-brand opacity-80" />
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-[10px] uppercase tracking-[0.18em] text-text-tertiary">APEX Score</p>
            <div className="mt-2 flex items-end gap-1">
              <span className="text-6xl font-extrabold gradient-text leading-none tabular-nums">{todayMetrics.apexScore}</span>
              <span className="text-lg text-text-tertiary mb-1">/100</span>
            </div>
            <div className="mt-3 inline-flex items-center gap-1.5 text-xs text-success">
              <span className="h-1.5 w-1.5 rounded-full bg-success animate-pulse" />
              On track for {profile.goal === "fatloss" ? "fat loss" : "recomposition"}
            </div>
          </div>
          <RingChart
            size={100}
            stroke={6}
            centerLabel={String(todayMetrics.apexScore)}
            rings={[
              { value: todayMetrics.recovery, color: "#10B981" },
              { value: todayMetrics.sleep, color: "#3B82F6" },
              { value: todayMetrics.strain, color: "#F59E0B" },
              { value: todayMetrics.hrv, color: "#A78BFA" },
            ]}
          />
        </div>
      </section>

      {/* AI insight */}
      <Link to="/coach" className="mx-5 mt-4 flex items-center gap-3 rounded-2xl border border-ai/25 bg-gradient-to-r from-ai/10 to-sleep/5 p-4 active:scale-[0.99] transition">
        <Sparkles size={18} className={`text-ai shrink-0 ${loadingInsight ? "animate-pulse" : ""}`} />
        <p className="flex-1 text-sm leading-snug">{insight}</p>
        <ChevronRight size={18} className="text-text-tertiary shrink-0" />
      </Link>

      {/* Metric tiles */}
      <section className="mx-5 mt-4 grid grid-cols-2 gap-3">
        <Tile icon={Dumbbell} color="text-sleep" accent="#3B82F6" label="Last workout" value="Push" sub="Yesterday · 62m" />
        <Tile icon={Apple} color="text-success" accent="#10B981" label="Macros" value="1,840" sub="of 2,400 kcal" />
        <Tile icon={Moon} color="text-text-accent" accent="#A78BFA" label="Sleep" value="7.2h" sub="HRV 68ms" />
        <Tile icon={TrendingUp} color="text-warning" accent="#F59E0B" label="Body fat" value="17.4%" sub="↓ 0.6% / 4w" />
      </section>

      {/* Week */}
      <section className="mx-5 mt-6">
        <p className="text-xs uppercase tracking-wider text-text-tertiary mb-3">This week</p>
        <div className="flex items-center justify-between gap-1.5">
          {weekDays.map((d) => (
            <div key={d.day} className="flex-1 flex flex-col items-center gap-1.5">
              <span className="text-[10px] text-text-tertiary">{d.day.slice(0, 1)}</span>
              <div className={`h-9 w-9 rounded-xl flex items-center justify-center text-[10px] font-bold ${
                d.state === "done" ? "gradient-brand text-white" :
                d.state === "today" ? "ring-2 ring-ai bg-bg-2 text-text-accent animate-pulse-glow" :
                d.state === "rest" ? "bg-bg-2 text-text-tertiary" :
                "bg-bg-2/40 text-text-tertiary"
              }`}>
                {d.state === "done" ? "✓" : d.state === "today" ? "•" : d.state === "rest" ? "R" : ""}
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Today CTA */}
      <Link to="/workouts" className="mx-5 mt-6 block rounded-3xl bg-bg-2 border border-white/5 p-5">
        <div className="flex items-center justify-between mb-3">
          <span className="text-[10px] uppercase tracking-wider text-text-tertiary">Today's session</span>
          <AIBadge />
        </div>
        <h3 className="text-xl font-bold">Upper Body Push</h3>
        <p className="text-xs text-text-secondary mt-1">60 min · 6 exercises · High intensity</p>
        <div className="mt-4 rounded-2xl gradient-brand py-3 text-center text-sm font-semibold text-white">
          Start session →
        </div>
      </Link>

      <BottomNav />
    </div>
  );
}

function Tile({ icon: Icon, color, accent, label, value, sub }: any) {
  return (
    <div className="rounded-2xl bg-bg-2 border border-white/5 p-4 relative overflow-hidden">
      <Icon size={18} className={color} />
      <p className="mt-3 text-[10px] uppercase tracking-wider text-text-tertiary">{label}</p>
      <p className="mt-1 text-lg font-bold leading-tight">{value}</p>
      <p className="text-[11px] text-text-secondary mt-0.5">{sub}</p>
      <div className="absolute bottom-0 left-0 right-0 h-0.5" style={{ background: accent, opacity: 0.5 }} />
    </div>
  );
}
