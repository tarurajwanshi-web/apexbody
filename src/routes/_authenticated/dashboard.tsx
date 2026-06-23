import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useProfile } from "@/lib/store";
import { supabase } from "@/integrations/supabase/client";
import { useUserTimezone, getLocalDateISO, addDaysISO } from "@/lib/dates";
import { useAutoRefreshOnVisible } from "@/hooks/use-auto-refresh";

import { T } from "@/components/dashboard/tokens";
import { Header } from "@/components/dashboard/Header";
import { TodayCard } from "@/components/dashboard/TodayCard";
import { StateCard } from "@/components/dashboard/StateCard";
import { MetricCards } from "@/components/dashboard/MetricCards";
import { Insights } from "@/components/dashboard/Insights";
import { DashboardNav } from "@/components/dashboard/DashboardNav";

import { loadDashboardData, type DashboardData } from "@/lib/dashboard-data";
import { detectStreak } from "@/lib/dashboard-state";

export const Route = createFileRoute("/_authenticated/dashboard")({
  head: () => ({ meta: [{ title: "Dashboard — APEX" }] }),
  component: Dashboard,
});

function pillarScore(d: DashboardData, key: string): number | null {
  const pb = d.readiness?.pillar_breakdown;
  if (!pb) return null;
  // try common variants
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

function deterministicSentence(
  recovery: number | null,
  fuel: number | null,
  effort: number | null,
  trainingPlanned: boolean,
): string {
  if (recovery != null && fuel != null && effort != null && recovery > 70 && fuel > 70 && effort > 70) {
    return "Strong across the board today. Stay consistent.";
  }
  if (recovery != null && recovery < 50) {
    return "Recovery needs attention. Consider lighter effort today.";
  }
  if (fuel != null && fuel < 50) {
    return "Fuel score is low — log your meals to close the gap.";
  }
  if (effort != null && effort < 50 && trainingPlanned) {
    return "Training ahead today. You're ready.";
  }
  return "Log meals and recovery to build your full picture.";
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

  useEffect(() => {
    reload();
  }, [reload]);

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
        <div className="px-5 pt-6 max-w-[480px] mx-auto space-y-4">
          <div style={{ height: 56 }} />
          <Skeleton h={76} />
          <Skeleton h={180} />
          <Skeleton h={120} />
          <Skeleton h={90} />
          <Skeleton h={240} />
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

  // Daily note for today
  const dailyNoteToday = data.cards.find(
    (c) => c.card_type === "daily_note" && c.card_date === today,
  );

  const sentence = dailyNoteToday
    ? // first sentence already lives in text.ts but TodayCard takes plain string
      truncateSentence(stripFirstSentence(dailyNoteToday.content))
    : deterministicSentence(recovery, fuel, effort, trainingPlanned);

  // 7-day consistency from recentMeals
  const sevenDaysAgo = addDaysISO(today, -6);
  const recentDays = new Set(
    data.recentMeals
      .map((m) => m.entry_date)
      .filter((d) => d >= sevenDaysAgo && d <= today),
  );
  const daysLogged = recentDays.size;

  // Streak
  const streakState = detectStreak(data, tz);
  const streakDays =
    streakState.kind === "reset" ? 0 : (streakState as any).days ?? 0;
  const streakProtected = streakState.kind === "protected";

  // Fuel macros for Insights
  const protein = {
    actual: data.macros?.total_protein ?? 0,
    target: data.targets?.target_protein_g ?? 0,
  };
  const carbs = {
    actual: data.macros?.total_carbs ?? 0,
    target: data.targets?.target_carbs_g ?? 0,
  };
  const fat = {
    actual: data.macros?.total_fat ?? 0,
    target: data.targets?.target_fat_g ?? 0,
  };
  const carbsPctOfTarget = carbs.target > 0 ? carbs.actual / carbs.target : null;

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
      <div className="relative px-5 pt-6 max-w-[480px] mx-auto" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <Header greeting={greeting} name={name} day={day} />
        <TodayCard
          recovery={recovery}
          fuel={fuel}
          effort={effort}
          readiness={readiness}
          sentence={sentence}
        />
        <StateCard readiness={readiness} />
        <MetricCards
          weight={{ deltaKg: data.weight.delta_kg, goal: data.profile.goal }}
          consistency={{ daysLogged }}
          streak={{ days: streakDays, protected: streakProtected }}
        />
        <Insights
          day={{
            compliancePct: data.macros?.compliance_pct ?? null,
            noteContent: dailyNoteToday?.content ?? null,
          }}
          fuel={{
            score: fuel,
            mealCount: data.todayMeals.length,
            protein,
            carbs,
            fat,
          }}
          earned={{
            trainingLogged: data.todaySetsCount > 0,
            readiness,
            setsCount: data.todaySetsCount,
            carbsPctOfTarget,
            goal: data.profile.goal,
            proteinTarget: protein.target,
          }}
        />
      </div>

      <DashboardNav onLogged={onLogged} />

      {toast && (
        <div
          className="fixed left-1/2 -translate-x-1/2 bottom-28 z-[101] px-4 py-2 rounded-full"
          style={{
            background: T.surface,
            border: `0.5px solid ${T.border}`,
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

// Pull first sentence inline — avoids importing firstSentence/cleanCardText
// from text.ts twice; the Insights card already imports them itself.
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

function truncateSentence(s: string): string {
  if (s.length <= 140) return s;
  return s.slice(0, 137).trim() + "…";
}

function Skeleton({ h }: { h: number }) {
  return (
    <div
      style={{
        height: h,
        background: T.surface,
        border: `0.5px solid ${T.border}`,
        borderRadius: 22,
        animation: "apex-pulse 1.6s ease-in-out infinite",
      }}
    />
  );
}
