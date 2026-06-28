import { createFileRoute } from "@tanstack/react-router";
import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { ExerciseHistoryPanel } from "@/components/dashboard/ExerciseHistoryPanel";
import { MuscleGroupVolumeGrid } from "@/components/dashboard/MuscleGroupVolumeGrid";
import { WeightTrendChart } from "@/components/dashboard/WeightTrendChart";
import { TDEETrendChart } from "@/components/dashboard/TDEETrendChart";
import { ContradictionCard } from "@/components/dashboard/ContradictionCard";
import { BodyCompCard } from "@/components/dashboard/BodyCompCard";
import { PatternMemoryCard } from "@/components/dashboard/PatternMemoryCard";

function SkeletonBlock() {
  return (
    <div
      style={{
        height: 120,
        borderRadius: 12,
        background: T.surface,
        opacity: 0.5,
        animation: "apex-pulse 1.6s ease-in-out infinite",
      }}
    />
  );
}
import { useProfile } from "@/lib/store";
import { supabase } from "@/integrations/supabase/client";
import { useUserTimezone, getLocalDateISO, addDaysISO } from "@/lib/dates";
import { useAutoRefreshOnVisible } from "@/hooks/use-auto-refresh";

import { T } from "@/components/dashboard/tokens";
import { Header } from "@/components/dashboard/Header";
import { HeroRing } from "@/components/dashboard/HeroRing";
import { ClosedLoopSentence } from "@/components/dashboard/ClosedLoopSentence";
import { QuietRow, SectionLabel } from "@/components/dashboard/QuietRow";
import { DashboardNav } from "@/components/dashboard/DashboardNav";
import { Sparkline } from "@/components/Sparkline";
import { CoachingFeed } from "@/components/CoachingFeed";

import { loadDashboardData, type DashboardData } from "@/lib/dashboard-data";

export const Route = createFileRoute("/_authenticated/dashboard")({
  head: () => ({ meta: [{ title: "Dashboard — APEX" }] }),
  component: Dashboard,
});

function pillarScore(d: DashboardData, key: string): number | null {
  const pb = d.readiness?.pillar_breakdown;
  if (!pb) return null;
  const candidates = [key, `${key}_score`, key.toLowerCase()];
  for (const k of candidates) {
    const v = (pb as any)[k];
    if (typeof v === "number") return v;
    if (typeof v === "string" && !isNaN(Number(v))) return Number(v);
    if (v && typeof v === "object" && typeof (v as any).score === "number") {
      return (v as any).score;
    }
  }
  return null;
}

function stripFirstSentence(content: string): string {
  const cleaned = content
    .replace(/\r\n/g, "\n")
    .replace(/^[ \t]*#{1,6}[ \t]*/gm, "")
    .replace(/\*\*/g, "")
    .replace(/__/g, "")
    .replace(/`+/g, "")
    .replace(/[\u2600-\u27BF]|[\uE000-\uF8FF]|\uD83C[\uDC00-\uDFFF]|\uD83D[\uDC00-\uDFFF]|\uD83E[\uDD00-\uDDFF]|\uFE0F|\u200D/g, "")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
  const m = cleaned.match(/^[\s\S]*?[.!?\n]/);
  return (m ? m[0].replace(/[.!?\s]+$/g, "") : cleaned).trim();
}

function truncate(s: string, n = 160): string {
  if (s.length <= n) return s;
  return s.slice(0, n - 3).trim() + "…";
}

/** Closed-loop sentence — one line that names which engine influenced which. */
function buildClosedLoop(
  recovery: number | null,
  fuel: number | null,
  effort: number | null,
  readiness: number | null,
  trainingPlanned: boolean,
): { sentence: string; engines: { readiness?: boolean; load?: boolean; nutrition?: boolean; recovery?: boolean } } {
  if (readiness != null && readiness >= 75 && trainingPlanned) {
    return {
      sentence: "Readiness is high — training load is pulling calories up today.",
      engines: { readiness: true, load: true, nutrition: true },
    };
  }
  if (recovery != null && recovery < 50) {
    return {
      sentence: "Recovery is low — APEX is easing training volume and holding fuel steady.",
      engines: { recovery: true, load: true },
    };
  }
  if (fuel != null && fuel < 50) {
    return {
      sentence: "Fuel score is low — log meals to keep training load on plan.",
      engines: { nutrition: true, load: true },
    };
  }
  if (effort != null && effort < 50 && trainingPlanned) {
    return {
      sentence: "Training planned today — readiness and recovery both clear.",
      engines: { readiness: true, recovery: true, load: true },
    };
  }
  if (recovery != null && fuel != null && effort != null) {
    return {
      sentence: "All four engines are steady. Keep the pattern.",
      engines: { readiness: true, load: true, nutrition: true, recovery: true },
    };
  }
  return {
    sentence: "Log meals and recovery so APEX can close the loop on today.",
    engines: { nutrition: true, recovery: true },
  };
}

function trendWord(values: (number | null)[]): string {
  const nums = values.filter((v): v is number => typeof v === "number");
  if (nums.length < 2) return "—";
  const first = nums[0];
  const last = nums[nums.length - 1];
  const delta = last - first;
  if (Math.abs(delta) < 0.2) return "steady";
  return delta > 0 ? "rising" : "easing";
}

function Dashboard() {
  const { profile } = useProfile();
  const tz = useUserTimezone();
  const [data, setData] = useState<DashboardData | null>(null);
  const [lastUpdatedAt, setLastUpdatedAt] = useState<number | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const reload = useCallback(async () => {
    const { data: u } = await supabase.auth.getUser();
    if (!u.user) return;
    try {
      const d = await loadDashboardData(u.user.id, tz);
      setData(d);
      setLastUpdatedAt(Date.now());
    } catch (e) {
      console.error("[Dashboard] load failed", e);
    }
  }, [tz]);

  useEffect(() => { reload(); }, [reload]);
  useAutoRefreshOnVisible(reload, lastUpdatedAt);

  const greeting = useMemo(() => {
    const h = new Date().getHours();
    return h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
  }, []);

  const day = useMemo(() => {
    const completed = data?.profile.profile_completed_at;
    if (!completed) return 1;
    const diff = Math.floor((Date.now() - new Date(completed).getTime()) / 86400000);
    return Math.max(1, diff + 1);
  }, [data?.profile.profile_completed_at]);

  const name = data?.profile.name || profile.name || "Athlete";

  const onLogged = () => {
    setToast("Logged");
    setTimeout(() => setToast(null), 2400);
    reload();
  };

  if (!data) {
    return (
      <div
        className="min-h-screen"
        style={{
          background: T.bg,
          paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 128px)",
        }}
      >
        <div className="px-5 pt-6 max-w-[480px] mx-auto space-y-5">
          <div style={{ height: 56 }} />
          <div style={{ height: 240, borderRadius: 16, background: T.surface, opacity: 0.5, animation: "apex-pulse 1.6s ease-in-out infinite" }} />
          <div style={{ height: 64, borderRadius: 12, background: T.surface, opacity: 0.4 }} />
          <div style={{ height: 200, borderRadius: 16, background: T.surface, opacity: 0.4 }} />
        </div>
        <DashboardNav onLogged={onLogged} />
      </div>
    );
  }

  const today = getLocalDateISO(tz);
  const recovery = pillarScore(data, "recovery");
  const fuel = pillarScore(data, "nutrition");
  const effort = pillarScore(data, "training");
  const readiness = data.readiness?.final_score ?? null;
  const trainingPlanned = !!data.todayPlannedSession && !data.todayPlannedSession.rest;

  const loop = buildClosedLoop(recovery, fuel, effort, readiness, trainingPlanned);

  // Today rows
  const planned = data.todayPlannedSession;
  const trainText = planned?.rest
    ? "Rest day"
    : planned?.session_name
      ? `${planned.session_name}${planned.exercises?.length ? ` · ${planned.exercises.length} ex` : ""}`
      : "Open session";

  const tCal = data.targets?.target_calories ?? null;
  const cKcal = data.macros
    ? Math.round(
        (data.macros.total_protein ?? 0) * 4 +
        (data.macros.total_carbs ?? 0) * 4 +
        (data.macros.total_fat ?? 0) * 9,
      )
    : null;
  const compliance = data.macros?.compliance_pct ?? null;
  const fuelText = tCal && cKcal != null
    ? `${cKcal} / ${tCal} kcal`
    : cKcal != null
      ? `${cKcal} kcal`
      : "—";
  const fuelMeta = compliance != null ? `${Math.round(compliance)}%` : undefined;

  const recoveryText = recovery != null ? `Score ${Math.round(recovery)}` : "—";

  // Week rows
  const sevenDaysAgo = addDaysISO(today, -6);
  const recentDays = new Set(
    data.recentMeals.map((m) => m.entry_date).filter((d) => d >= sevenDaysAgo && d <= today),
  );
  const daysLogged = recentDays.size;
  const weightDelta = data.weight.delta_kg;
  const setsDelta = data.weekSetsCount - data.lastWeekSetsCount;

  const dailyNoteToday = data.cards.find(
    (c) => c.card_type === "daily_note" && c.card_date === today,
  );

  return (
    <div
      className="min-h-screen"
      style={{
        background: T.bg,
        paddingTop: "max(env(safe-area-inset-top, 0px), 0px)",
        paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 96px)",
        color: T.text1,
      }}
    >
      <div
        className="px-5 pt-6 max-w-[480px] mx-auto"
        style={{ display: "flex", flexDirection: "column", gap: 4 }}
      >
        <Header greeting={greeting} name={name} day={day} />

        {/* Hero — single readiness number */}
        <div style={{ padding: "28px 0 8px", display: "flex", justifyContent: "center" }}>
          <HeroRing value={readiness} label="Readiness" />
        </div>

        {/* Closed-loop sentence — the product's differentiator, ambient */}
        <div style={{ padding: "8px 0 4px" }}>
          <ClosedLoopSentence sentence={loop.sentence} engines={loop.engines} />
        </div>

        {/* Today */}
        <SectionLabel>Today</SectionLabel>
        <div>
          <QuietRow label="Train" value={trainText} to="/workouts" />
          <QuietRow label="Fuel" value={fuelText} meta={fuelMeta} to="/nutrition" />
          <QuietRow label="Recovery" value={recoveryText} />
        </div>

        {/* This week */}
        <SectionLabel>This week</SectionLabel>
        <div>
          <QuietRow
            label="Load"
            value={data.weekSetsCount === 0 ? "—" : `${data.weekSetsCount} sets`}
            meta={
              data.weekSetsCount === 0 && data.lastWeekSetsCount === 0
                ? undefined
                : setsDelta === 0
                  ? "vs last wk"
                  : `${setsDelta > 0 ? "+" : ""}${setsDelta} vs last wk`
            }
          />
          <QuietRow
            label="Adherence"
            value={
              data.complianceAvg7d != null ? `${data.complianceAvg7d}%` : "—"
            }
            meta={
              <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                <Sparkline
                  points={data.compliance7d}
                  width={56}
                  height={18}
                  color={T.primary}
                  fill={false}
                  strokeWidth={1}
                />
                {daysLogged}/7
              </span>
            }
          />
          <QuietRow
            label="Weight"
            value={
              weightDelta == null
                ? "—"
                : `${weightDelta > 0 ? "+" : ""}${weightDelta.toFixed(1)} kg`
            }
            meta={
              <Sparkline
                points={data.weight.series7d}
                width={56}
                height={18}
                color={T.green}
                fill={false}
                strokeWidth={1}
              />
            }
          />
          <QuietRow label="Recovery" value={trendWord(data.compliance7d)} />
        </div>

        {/* Coach feed */}
        <SectionLabel>Coach</SectionLabel>
        {dailyNoteToday && (
          <div
            style={{
              background: T.surface,
              border: `1px solid ${T.border}`,
              borderLeft: `2px solid ${T.primary}`,
              borderRadius: 12,
              padding: 16,
              marginBottom: 12,
              boxShadow: "inset 0 1px 0 rgba(255,255,255,0.04)",
            }}
          >
            <div
              style={{
                fontSize: 10,
                letterSpacing: "0.22em",
                textTransform: "uppercase",
                color: T.label,
                marginBottom: 8,
              }}
            >
              Today's note
            </div>
            <div
              style={{
                fontFamily: "var(--font-display)",
                fontSize: 15,
                lineHeight: 1.5,
                color: T.text1,
                letterSpacing: "-0.005em",
              }}
            >
              {truncate(stripFirstSentence(dailyNoteToday.content))}
            </div>
          </div>
        )}
        <Suspense fallback={null}>
          <ContradictionCard />
        </Suspense>
        <CoachingFeed />

        <SectionLabel>Training history</SectionLabel>
        <Suspense fallback={<SkeletonBlock />}><ExerciseHistoryPanel /></Suspense>

        <SectionLabel>Body composition</SectionLabel>
        <Suspense fallback={<SkeletonBlock />}><BodyCompCard /></Suspense>

        <SectionLabel>Your Recovery Signature</SectionLabel>
        <Suspense fallback={<SkeletonBlock />}><PatternMemoryCard /></Suspense>


        <SectionLabel>This week's volume</SectionLabel>
        <Suspense fallback={<SkeletonBlock />}><MuscleGroupVolumeGrid /></Suspense>

        <SectionLabel>Weight trend</SectionLabel>
        <Suspense fallback={<SkeletonBlock />}><WeightTrendChart /></Suspense>

        <SectionLabel>TDEE trend</SectionLabel>
        <Suspense fallback={<SkeletonBlock />}><TDEETrendChart /></Suspense>

        <div style={{ marginTop: 24, display: "flex", justifyContent: "center" }}>
          <button
            onClick={async () => {
              const r = await fetch(
                `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/test-seed-10-users`,
                { method: "POST" }
              );
              const d = await r.json();
              alert(`${d.status}: ${d.message}`);
            }}
            className="px-4 py-2 bg-blue-600 text-white rounded"
          >
            Seed 10 Edge Cases (90 days)
          </button>
        </div>
      </div>

      <DashboardNav onLogged={onLogged} />

      {toast && (
        <div
          className="fixed left-1/2 -translate-x-1/2 bottom-28 z-[101] px-4 py-2 rounded-full"
          style={{
            background: T.surface,
            border: `1px solid ${T.border}`,
            color: T.text1,
            fontSize: 13,
            backdropFilter: "blur(20px)",
          }}
        >
          ✓ {toast}
        </div>
      )}
    </div>
  );
}
