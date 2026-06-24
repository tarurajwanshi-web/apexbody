import { createFileRoute, Link } from "@tanstack/react-router";
import { Bell, Flame, ChevronRight, Dumbbell, Apple, Moon, TrendingUp, Sparkles } from "lucide-react";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useProfile } from "@/lib/store";
import { DashboardNav } from "@/components/dashboard/DashboardNav";
import { AIBadge } from "@/components/AIOrb";
import { RingChart } from "@/components/RingChart";
import { todayMetrics, weekDays, aiInsightRotation, macroTargets, macroToday } from "@/lib/mock";
import { generateDailyInsight } from "@/lib/coach.functions";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/home")({
  head: () => ({ meta: [{ title: "Home — APEX" }] }),
  component: Home,
});

function phaseLine(day: number): string {
  if (day <= 6) return `Day ${day} — Calibrating to your patterns`;
  if (day <= 29) return `Day ${day} — Learning your body`;
  return "Coached by APEX";
}

const CARD = "rounded-2xl bg-bg-2 border border-white/10 p-5 card-shadow";

function Home() {
  const { profile } = useProfile();
  const fallback = aiInsightRotation[new Date().getDate() % aiInsightRotation.length];
  const fn = useServerFn(generateDailyInsight);
  const [insight, setInsight] = useState<string>(fallback);
  const [loadingInsight, setLoadingInsight] = useState(true);
  const [day, setDay] = useState(1);

  useEffect(() => {
    (async () => {
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) return;
      const { data: p } = await supabase
        .from("profiles")
        .select("profile_completed_at")
        .eq("id", u.user.id)
        .single();
      if (p?.profile_completed_at) {
        const diff = Math.floor((Date.now() - new Date(p.profile_completed_at).getTime()) / 86400000);
        setDay(Math.max(1, diff + 1));
      }
    })();
  }, []);

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
          <Link to="/settings" className="h-9 w-9 rounded-full gradient-brand flex items-center justify-center text-[14px] font-medium text-white">
            {profile.name[0]}
          </Link>
          <div>
            <p className="text-[12px] text-text-tertiary">{greet}</p>
            <p className="text-[16px] font-medium leading-tight">{profile.name}</p>
            <p className="text-[10px] tracking-wide text-text-tertiary mt-0.5">{phaseLine(day)}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className="flex items-center gap-1 rounded-full bg-bg-2 border border-white/10 px-2.5 py-1.5 text-[12px] font-medium">
            <Flame size={14} className="text-warning" /> {profile.streak}
          </span>
          <button className="h-9 w-9 rounded-full bg-bg-2 border border-white/10 flex items-center justify-center">
            <Bell size={16} className="text-text-secondary" />
          </button>
        </div>
      </header>

      {/* Hero card */}
      <section className={`mx-5 mt-5 relative overflow-hidden ${CARD}`}>
        <div className="absolute -top-px left-6 right-6 h-px gradient-brand opacity-80" />
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-[10px] uppercase tracking-wide text-text-tertiary font-medium">APEX Score</p>
            <div className="mt-2 flex items-end gap-1">
              <span className="text-[20px] font-medium gradient-text leading-none tabular-nums">{todayMetrics.apexScore}</span>
              <span className="text-[14px] text-text-tertiary mb-0.5">/100</span>
            </div>
            <div className="mt-3 inline-flex items-center gap-1.5 text-[12px] text-success">
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
      <Link to="/coach" className="mx-5 mt-4 flex items-center gap-3 rounded-2xl border border-ai/25 bg-gradient-to-r from-ai/10 to-sleep/5 p-5 active:scale-[0.99] transition">
        <Sparkles size={18} className={`text-ai shrink-0 ${loadingInsight ? "animate-pulse" : ""}`} />
        <p className="flex-1 text-[14px] leading-snug">{insight}</p>
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
        <p className="text-[10px] uppercase tracking-wide text-text-tertiary font-medium mb-3">This week</p>
        <div className="flex items-center justify-between gap-1.5">
          {weekDays.map((d) => (
            <div key={d.day} className="flex-1 flex flex-col items-center gap-1.5">
              <span className="text-[10px] text-text-tertiary">{d.day.slice(0, 1)}</span>
              <div className={`h-9 w-9 rounded-xl flex items-center justify-center text-[10px] font-medium ${
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
      <Link to="/workouts" className={`mx-5 mt-6 block ${CARD}`}>
        <div className="flex items-center justify-between mb-3">
          <span className="text-[10px] uppercase tracking-wide text-text-tertiary font-medium">Today's session</span>
          <AIBadge />
        </div>
        <h3 className="text-[16px] font-medium">Upper Body Push</h3>
        <p className="text-[12px] text-text-secondary mt-1">60 min · 6 exercises · High intensity</p>
        <div className="mt-4 rounded-2xl gradient-brand py-3 text-center text-[14px] font-medium text-white">
          Start session →
        </div>
      </Link>

      <DashboardNav />
    </div>
  );
}

function Tile({ icon: Icon, color, accent, label, value, sub }: any) {
  return (
    <div className="rounded-2xl bg-bg-2 border border-white/10 p-5 relative overflow-hidden">
      <Icon size={18} className={color} />
      <p className="mt-3 text-[10px] uppercase tracking-wide text-text-tertiary font-medium">{label}</p>
      <p className="mt-1 text-[16px] font-medium leading-tight">{value}</p>
      <p className="text-[12px] text-text-secondary mt-0.5">{sub}</p>
      <div className="absolute bottom-0 left-0 right-0 h-0.5" style={{ background: accent, opacity: 0.5 }} />
    </div>
  );
}
