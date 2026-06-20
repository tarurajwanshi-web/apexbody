import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState, useRef } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Sparkles, Dumbbell, Camera, Apple, Brain, Home as HomeIcon, Flame } from "lucide-react";
import { useProfile } from "@/lib/store";
import { generateDailyInsight } from "@/lib/coach.functions";
import { getTodayReadiness, type TodayReadiness } from "@/lib/shield.functions";

export const Route = createFileRoute("/dashboard")({
  head: () => ({ meta: [{ title: "Dashboard — APEX" }] }),
  component: Dashboard,
});

const LEARNING_DAYS = 5;

function getDayOfJourney(): number {
  if (typeof window === "undefined") return 1;
  const key = "apex_journey_start";
  let start = localStorage.getItem(key);
  if (!start) {
    start = String(Date.now());
    localStorage.setItem(key, start);
  }
  const days = Math.floor((Date.now() - Number(start)) / 86400000) + 1;
  return Math.max(1, days);
}

const PILLAR_META: { key: "recovery" | "sleep" | "nutrition" | "training" | "mood"; label: string; color: string }[] = [
  { key: "recovery", label: "Recovery", color: "#10B981" },
  { key: "sleep", label: "Sleep", color: "#3B82F6" },
  { key: "nutrition", label: "Nutrition", color: "#22C55E" },
  { key: "training", label: "Training", color: "#F59E0B" },
  { key: "mood", label: "Mood", color: "#8B5CF6" },
];

function Dashboard() {
  const { profile } = useProfile();
  const navigate = useNavigate();
  const fileRef = useRef<HTMLInputElement>(null);
  const [day, setDay] = useState(1);
  const [greet, setGreet] = useState("Hello");
  const [insight, setInsight] = useState("Your recovery is strong. Ready to push intensity today.");
  const [insightTime] = useState("Just now");
  const [expanded, setExpanded] = useState(false);
  const [readiness, setReadiness] = useState<TodayReadiness>(null);
  const fn = useServerFn(generateDailyInsight);
  const fetchReadiness = useServerFn(getTodayReadiness);

  useEffect(() => {
    setDay(getDayOfJourney());
    const h = new Date().getHours();
    setGreet(h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening");
    fetchReadiness().then(setReadiness).catch(() => setReadiness(null));
  }, [fetchReadiness]);

  useEffect(() => {
    let cancelled = false;
    fn({
      data: {
        userData: {
          name: profile.name,
          goal: profile.goal,
          day,
          score: readiness?.final_score ?? null,
        },
      },
    })
      .then((r) => { if (!cancelled && r.content) setInsight(r.content); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [fn, day, profile.name, profile.goal, readiness?.final_score]);

  const today = new Date().toISOString().slice(0, 10);
  const hasToday = !!readiness && readiness.score_date === today;
  const inLearning = day <= LEARNING_DAYS;
  const week = Math.max(1, Math.ceil((day - LEARNING_DAYS) / 7));
  const subline = inLearning ? `Day ${day} of ${LEARNING_DAYS} — Learning phase` : `Week ${week} — Custom plan active`;

  // Ring math
  const ringSize = 90;
  const ringStroke = 8;
  const ringR = ringSize / 2 - ringStroke / 2;
  const ringC = 2 * Math.PI * ringR;
  const score = hasToday ? readiness!.final_score : null;
  const fillPct = score != null ? score / 100 : 0;

  return (
    <div className="min-h-screen pb-32 relative" style={{ backgroundColor: "#0A0E1A" }}>
      {/* Subtle radial backdrop */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0"
        style={{
          height: "40vh",
          background: "radial-gradient(ellipse at 50% 0%, rgba(124,58,237,0.07), transparent 70%)",
        }}
      />
      <div className="relative px-5 pt-6 max-w-[480px] mx-auto space-y-4">
        {/* Header */}
        <header className="flex items-start justify-between animate-fade-up" style={{ animationDelay: "0ms" }}>
          <div>
            <h1 className="text-[20px] font-semibold text-white leading-tight">
              {greet}, {profile.name || "Athlete"}
            </h1>
            <p className="text-[13px] text-text-secondary mt-1">{subline}</p>
          </div>
          <span
            className="inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[12px] font-semibold text-white"
            style={{ background: "rgba(124,58,237,0.10)", border: "1px solid rgba(124,58,237,0.20)" }}
          >
            <Flame size={12} className="text-warning" /> {profile.streak}
          </span>
        </header>

        {/* Data collection banner (days 1-5) */}
        {inLearning && (
          <div
            className="rounded-2xl p-4 animate-fade-up"
            style={{
              background: "linear-gradient(135deg, rgba(124,58,237,0.10), rgba(59,130,246,0.08))",
              border: "1px solid rgba(124,58,237,0.30)",
              animationDelay: "100ms",
            }}
          >
            <div className="flex items-start gap-3">
              <Sparkles size={18} className="text-ai shrink-0 mt-0.5" />
              <p className="text-[13px] text-text-primary leading-snug">
                I'm learning about you. Log workouts, meals, and mood daily. Day {day} of {LEARNING_DAYS}.
              </p>
            </div>
            <div className="mt-3 h-1.5 w-full rounded-full overflow-hidden" style={{ background: "rgba(255,255,255,0.06)" }}>
              <div
                className="h-full gradient-brand transition-all"
                style={{ width: `${(Math.min(day, LEARNING_DAYS) / LEARNING_DAYS) * 100}%` }}
              />
            </div>
          </div>
        )}

        {/* AI Insight */}
        <div
          className="rounded-2xl p-5 animate-fade-up"
          style={{
            background: "linear-gradient(135deg, rgba(124,58,237,0.08), rgba(59,130,246,0.08))",
            border: "1px solid rgba(124,58,237,0.25)",
            animationDelay: "200ms",
          }}
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Sparkles size={20} className="text-ai" />
              <span className="text-[10px] font-medium text-ai uppercase" style={{ letterSpacing: "1.5px" }}>
                AI Insight
              </span>
            </div>
            <span className="text-[11px] text-text-tertiary">{insightTime}</span>
          </div>
          <p className="mt-3 text-[14px] text-text-primary leading-relaxed">{insight}</p>
          <div className="mt-4 flex gap-2">
            <button
              onClick={() => navigate({ to: "/coach" })}
              className="rounded-full px-3 py-1.5 text-[12px] font-medium text-sleep active:scale-[0.98] transition"
              style={{ border: "1px solid rgba(59,130,246,0.4)" }}
            >
              Tell me why
            </button>
            <button
              className="rounded-full px-3 py-1.5 text-[12px] font-medium text-text-secondary active:scale-[0.98] transition"
              style={{ border: "1px solid rgba(255,255,255,0.12)" }}
            >
              Got it
            </button>
          </div>
        </div>

        {/* APEX Score Card */}
        <button
          onClick={() => setExpanded((v) => !v)}
          className="w-full text-left rounded-[20px] p-6 animate-fade-up active:scale-[0.995] transition"
          style={{
            background: "#0F1524",
            border: "1px solid rgba(255,255,255,0.06)",
            animationDelay: "300ms",
          }}
        >
          <div className="flex items-center justify-between gap-6">
            {/* LEFT */}
            <div className="flex-1 min-w-0">
              <p className="text-[10px] font-medium text-text-tertiary uppercase" style={{ letterSpacing: "2px" }}>
                APEX Score
              </p>
              <div className="mt-2 flex items-baseline gap-1">
                <span
                  className="text-white tabular-nums"
                  style={{ fontSize: 56, fontWeight: 300, lineHeight: 1, textShadow: "0 0 20px rgba(124,58,237,0.3)" }}
                >
                  {score}
                </span>
                <span className="text-text-tertiary" style={{ fontSize: 18 }}>/100</span>
              </div>
              <div className="mt-3 inline-flex items-center gap-1.5">
                <span className="h-1.5 w-1.5 rounded-full bg-success" />
                <span className="text-[13px] text-success">On track for recomposition</span>
              </div>
            </div>

            {/* RIGHT — single animated gradient ring */}
            <div className="shrink-0 relative">
              <svg width={ringSize} height={ringSize} viewBox={`0 0 ${ringSize} ${ringSize}`} className="animate-pulse-ring">
                <defs>
                  <linearGradient id="scoreRingGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                    <stop offset="0%" stopColor="#7C3AED" />
                    <stop offset="55%" stopColor="#3B82F6" />
                    <stop offset="100%" stopColor="#10B981" />
                  </linearGradient>
                </defs>
                <circle
                  cx={ringSize / 2} cy={ringSize / 2} r={ringR}
                  fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth={ringStroke}
                />
                <circle
                  cx={ringSize / 2} cy={ringSize / 2} r={ringR}
                  fill="none" stroke="url(#scoreRingGrad)" strokeWidth={ringStroke}
                  strokeLinecap="round"
                  strokeDasharray={ringC}
                  strokeDashoffset={ringC * (1 - fillPct)}
                  transform={`rotate(-90 ${ringSize / 2} ${ringSize / 2})`}
                  style={{ animation: "ring-draw 1.5s ease-out both" }}
                />
                <text
                  x="50%" y="50%" textAnchor="middle" dominantBaseline="central"
                  className="fill-white" style={{ fontSize: 16, fontWeight: 500 }}
                >
                  {score}
                </text>
                <style>{`@keyframes ring-draw { from { stroke-dashoffset: ${ringC}; } to { stroke-dashoffset: ${ringC * (1 - fillPct)}; } }`}</style>
              </svg>
            </div>
          </div>

          {expanded && (
            <div
              className="mt-5 overflow-hidden"
              style={{ animation: "fade-up 0.3s ease both" }}
            >
              <MetricRow color="#10B981" name="Recovery" value="68%" trend="up" note="Trending up. Ready to push." />
              <MetricRow color="#3B82F6" name="Sleep" value="7.2h" trend="stable" note="Consistent." />
              <MetricRow color="#F59E0B" name="Strain" value="55%" trend="stable" note="Room to push." />
              <MetricRow color="#8B5CF6" name="HRV" value="81ms" trend="up" note="Best in 14 days." last />
            </div>
          )}
        </button>

        {/* Quick Actions */}
        <div className="grid grid-cols-2 gap-3">
          <Link
            to="/workouts"
            className="flex items-center justify-center gap-2 rounded-[14px] h-14 text-[14px] font-semibold text-sleep"
            style={{ background: "#0F1524", border: "1px solid rgba(59,130,246,0.35)" }}
          >
            <Dumbbell size={18} /> Log Workout
          </Link>
          <button
            onClick={() => fileRef.current?.click()}
            className="flex items-center justify-center gap-2 rounded-[14px] h-14 text-[14px] font-semibold text-success"
            style={{ background: "#0F1524", border: "1px solid rgba(16,185,129,0.35)" }}
          >
            <Camera size={18} /> Log Meal
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            capture="environment"
            className="hidden"
            onChange={() => navigate({ to: "/nutrition" })}
          />
        </div>

        {/* Today's Plan */}
        <div className="rounded-2xl p-5" style={{ background: "#0F1524", border: "1px solid rgba(255,255,255,0.06)" }}>
          <div className="flex items-center justify-between">
            <h3 className="text-[16px] font-bold text-white">Today's Workout</h3>
            <span
              className="rounded-full px-2.5 py-1 text-[11px] font-semibold"
              style={{ background: "rgba(124,58,237,0.15)", color: "#A78BFA", border: "1px solid rgba(124,58,237,0.30)" }}
            >
              Day 2: Upper Push
            </span>
          </div>
          <ul className="mt-4 space-y-2">
            {[
              "Bench Press — 4x8 @ 80kg",
              "Incline DB Press — 3x10 @ 30kg",
              "Cable Flyes — 3x12",
            ].map((ex) => (
              <li key={ex} className="text-[13px] text-text-secondary flex gap-2">
                <span className="text-text-tertiary">•</span> {ex}
              </li>
            ))}
          </ul>
          <Link
            to="/workouts"
            className="mt-4 block rounded-2xl gradient-brand py-3 text-center text-[14px] font-semibold text-white"
          >
            Start Workout →
          </Link>
        </div>
      </div>

      <DashboardNav onCamera={() => fileRef.current?.click()} />
    </div>
  );
}

function MetricRow({
  color, name, value, trend, note, last,
}: {
  color: string;
  name: string;
  value: string;
  trend: "up" | "stable" | "down";
  note: string;
  last?: boolean;
}) {
  const trendChar = trend === "up" ? "↑" : trend === "down" ? "↓" : "→";
  const trendColor = trend === "up" ? "#10B981" : trend === "down" ? "#EF4444" : "#F59E0B";
  return (
    <div
      className="py-3"
      style={!last ? { borderBottom: "1px solid rgba(255,255,255,0.05)" } : undefined}
    >
      <div className="flex items-center gap-2.5">
        <span className="h-2 w-2 rounded-full shrink-0" style={{ background: color }} />
        <span className="text-[13px] text-white flex-1">{name}</span>
        <span className="text-[13px] font-semibold text-white tabular-nums">{value}</span>
        <span className="text-[13px] font-semibold tabular-nums" style={{ color: trendColor }}>
          {trendChar}
        </span>
      </div>
      <p className="ml-[18px] mt-1 text-[11px] text-text-tertiary">{note}</p>
    </div>
  );
}

function DashboardNav({ onCamera }: { onCamera: () => void }) {
  const navigate = useNavigate();
  return (
    <nav
      className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 flex items-center justify-around"
      style={{
        width: 260,
        height: 56,
        borderRadius: 28,
        background: "rgba(15,21,36,0.9)",
        backdropFilter: "blur(20px)",
        border: "1px solid rgba(255,255,255,0.1)",
      }}
    >
      <NavIcon icon={HomeIcon} label="Home" active onClick={() => navigate({ to: "/dashboard" })} />
      <NavIcon icon={Dumbbell} onClick={() => navigate({ to: "/workouts" })} />
      <button
        onClick={onCamera}
        className="flex items-center justify-center rounded-full -mt-6 shrink-0 active:scale-95 transition"
        style={{
          width: 48, height: 48,
          background: "linear-gradient(135deg, #7C3AED 0%, #3B82F6 100%)",
          boxShadow: "0 0 12px rgba(124,58,237,0.4), 0 8px 24px rgba(124,58,237,0.45)",
        }}
        aria-label="Camera"
      >
        <Camera size={22} color="#fff" />
      </button>
      <NavIcon icon={Apple} onClick={() => navigate({ to: "/nutrition" })} />
      <NavIcon icon={Brain} onClick={() => navigate({ to: "/coach" })} />
    </nav>
  );
}

function NavIcon({
  icon: Icon, label, active, onClick,
}: { icon: any; label?: string; active?: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick} className="flex flex-col items-center justify-center gap-0.5 w-11">
      <Icon size={20} color={active ? "#A78BFA" : "#8892A4"} fill={active ? "#A78BFA" : "none"} strokeWidth={active ? 2.5 : 2} />
      {active && label && <span className="text-[9px] font-semibold text-text-accent">{label}</span>}
    </button>
  );
}
