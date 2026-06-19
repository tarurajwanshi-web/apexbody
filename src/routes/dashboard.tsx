import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState, useRef } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Sparkles, Dumbbell, Camera, Apple, Brain, Home as HomeIcon, Flame } from "lucide-react";
import { useProfile } from "@/lib/store";
import { generateDailyInsight } from "@/lib/coach.functions";

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

function Dashboard() {
  const { profile } = useProfile();
  const navigate = useNavigate();
  const fileRef = useRef<HTMLInputElement>(null);
  const [day, setDay] = useState(1);
  const [insight, setInsight] = useState("Your recovery is strong. Ready to push intensity today.");
  const [insightTime] = useState("Just now");
  const [expanded, setExpanded] = useState(false);
  const fn = useServerFn(generateDailyInsight);

  useEffect(() => { setDay(getDayOfJourney()); }, []);

  useEffect(() => {
    let cancelled = false;
    fn({
      data: {
        userData: {
          name: profile.name,
          goal: profile.goal,
          day,
          recovery: 68,
          hrv: 81,
          sleepHours: 7.2,
          strain: 55,
          score: 74,
        },
      },
    })
      .then((r) => { if (!cancelled && r.content) setInsight(r.content); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [fn, day, profile.name, profile.goal]);

  const hour = new Date().getHours();
  const greet = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
  const inLearning = day <= LEARNING_DAYS;
  const week = Math.max(1, Math.ceil((day - LEARNING_DAYS) / 7));
  const subline = inLearning ? `Day ${day} of ${LEARNING_DAYS} — Learning phase` : `Week ${week} — Custom plan active`;

  // Ring math
  const size = 120;
  const stroke = 9;
  const cx = size / 2;
  const cy = size / 2;
  const recovery = 68;
  const hrvPct = 81; // treat 81ms as 81% for visual
  const ringData = [
    { r: cx - stroke / 2, val: recovery, color: "#10B981" },
    { r: cx - stroke / 2 - (stroke + 4), val: hrvPct, color: "#8B5CF6" },
  ];

  return (
    <div className="min-h-screen pb-32" style={{ backgroundColor: "#0A0E1A" }}>
      <div className="px-5 pt-6 max-w-[480px] mx-auto space-y-4">
        {/* Header */}
        <header className="flex items-start justify-between">
          <div>
            <h1 className="text-[20px] font-bold text-white leading-tight">
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
            className="rounded-2xl p-4"
            style={{
              background: "linear-gradient(135deg, rgba(124,58,237,0.10), rgba(59,130,246,0.08))",
              border: "1px solid rgba(124,58,237,0.30)",
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
          className="rounded-2xl p-5"
          style={{
            background: "linear-gradient(135deg, rgba(124,58,237,0.08), rgba(59,130,246,0.08))",
            border: "1px solid rgba(124,58,237,0.25)",
          }}
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Sparkles size={20} className="text-ai" />
              <span className="text-[10px] font-semibold text-ai uppercase" style={{ letterSpacing: "1.5px" }}>
                AI Insight
              </span>
            </div>
            <span className="text-[11px] text-text-tertiary">{insightTime}</span>
          </div>
          <p className="mt-3 text-[14px] text-text-primary leading-relaxed">{insight}</p>
          <div className="mt-4 flex gap-2">
            <button
              onClick={() => navigate({ to: "/coach" })}
              className="rounded-full px-3 py-1.5 text-[12px] font-medium text-sleep"
              style={{ border: "1px solid rgba(59,130,246,0.4)" }}
            >
              Tell me why
            </button>
            <button
              className="rounded-full px-3 py-1.5 text-[12px] font-medium text-text-secondary"
              style={{ border: "1px solid rgba(255,255,255,0.12)" }}
            >
              Got it
            </button>
          </div>
        </div>

        {/* Score Ring */}
        <button
          onClick={() => setExpanded((v) => !v)}
          className="w-full rounded-[20px] p-6 text-left"
          style={{ background: "#0F1524", border: "1px solid rgba(255,255,255,0.06)" }}
        >
          <p className="text-[10px] font-semibold text-text-tertiary uppercase text-center" style={{ letterSpacing: "1.5px" }}>
            Today's Score
          </p>
          <div className="mt-4 flex justify-center">
            <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
              {ringData.map((ring, i) => {
                const c = 2 * Math.PI * ring.r;
                const dash = (ring.val / 100) * c;
                return (
                  <g key={i} transform={`rotate(-90 ${cx} ${cy})`}>
                    <circle cx={cx} cy={cy} r={ring.r} fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth={stroke} />
                    <circle
                      cx={cx} cy={cy} r={ring.r} fill="none"
                      stroke={ring.color} strokeWidth={stroke}
                      strokeDasharray={`${dash} ${c}`} strokeLinecap="round"
                    />
                  </g>
                );
              })}
              <text x="50%" y="48%" textAnchor="middle" dominantBaseline="central"
                className="fill-white" style={{ fontSize: 36, fontWeight: 800, fontFamily: "var(--font-display)" }}>
                74
              </text>
              <text x="50%" y="68%" textAnchor="middle" dominantBaseline="central"
                className="fill-text-tertiary" style={{ fontSize: 11 }}>
                /100
              </text>
            </svg>
          </div>
          <p className="mt-3 text-[12px] text-text-tertiary text-center">
            {expanded ? "Tap to collapse" : "Tap to see breakdown"}
          </p>
          {expanded && (
            <div className="mt-4 space-y-2.5 animate-fade-up">
              <BreakdownRow color="#10B981" text="Recovery: 68% — Trending up. Ready to push." />
              <BreakdownRow color="#3B82F6" text="Sleep: 7.2h — Consistent." />
              <BreakdownRow color="#F59E0B" text="Strain: 55% — Room to push." />
              <BreakdownRow color="#8B5CF6" text="HRV: 81ms — Best in 14 days." />
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

function BreakdownRow({ color, text }: { color: string; text: string }) {
  return (
    <div className="flex items-center gap-3">
      <span className="h-2 w-2 rounded-full shrink-0" style={{ background: color }} />
      <p className="text-[13px] text-text-secondary">{text}</p>
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
        className="flex items-center justify-center rounded-full -mt-6 shrink-0"
        style={{
          width: 44, height: 44,
          background: "linear-gradient(135deg, #7C3AED 0%, #3B82F6 100%)",
          boxShadow: "0 8px 24px rgba(124,58,237,0.45)",
        }}
        aria-label="Camera"
      >
        <Camera size={20} color="#fff" />
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
