import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useProfile } from "@/lib/store";
import { supabase } from "@/integrations/supabase/client";
import { useUserTimezone, getLocalDateISO } from "@/lib/dates";
import { BottomNav } from "@/components/BottomNav";
import { RecoveryLogModal, MealLogModal } from "@/components/LogModals";
import { useAutoRefreshOnVisible } from "@/hooks/use-auto-refresh";

import { T } from "@/components/dashboard/tokens";
import { TopBar } from "@/components/dashboard/TopBar";
import { MomentumBar } from "@/components/dashboard/MomentumBar";
import { ApexScoreCard } from "@/components/dashboard/ApexScoreCard";
import { StreakNotification } from "@/components/dashboard/StreakNotification";
import { ContextCard } from "@/components/dashboard/ContextCard";
import { WhatApexKnows } from "@/components/dashboard/WhatApexKnows";
import { ThisWeek } from "@/components/dashboard/ThisWeek";
import { QuickActions } from "@/components/dashboard/QuickActions";
import { BottomSheet } from "@/components/dashboard/BottomSheet";
import { cleanCardText } from "@/components/dashboard/text";

import { loadDashboardData, type DashboardData } from "@/lib/dashboard-data";
import {
  computeMomentum,
  detectContext,
  detectStreak,
} from "@/lib/dashboard-state";

export const Route = createFileRoute("/_authenticated/dashboard")({
  head: () => ({ meta: [{ title: "Dashboard — APEX" }] }),
  component: Dashboard,
});

function Dashboard() {
  const { profile } = useProfile();
  const tz = useUserTimezone();
  const navigate = useNavigate();
  const [data, setData] = useState<DashboardData | null>(null);
  const [lastUpdatedAt, setLastUpdatedAt] = useState<number | null>(null);
  const [recoveryOpen, setRecoveryOpen] = useState(false);
  const [mealOpen, setMealOpen] = useState(false);
  const [breakdownOpen, setBreakdownOpen] = useState(false);
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
  const subline = `Day ${day} — ${phaseFor(day)}`;

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 2400);
  };

  const onLogged = () => {
    showToast("Logged");
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
          <Skeleton h={120} />
          <Skeleton h={180} />
        </div>
        <BottomNav onLogged={onLogged} />
      </div>
    );
  }

  const streak = detectStreak(data, tz);
  const priority = detectContext(data, tz);
  const momentum = computeMomentum(data);
  const today = getLocalDateISO(tz);
  const ghostDays = data.lastLogDate
    ? Math.max(0, daysBetween(today, data.lastLogDate))
    : 0;

  return (
    <div
      className="min-h-screen"
      style={{
        background: T.bg,
        paddingTop: "max(env(safe-area-inset-top, 0px), 0px)",
        paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 128px)",
        color: T.text1,
      }}
    >
      <div className="relative px-5 pt-6 max-w-[480px] mx-auto space-y-4">
        <TopBar greeting={greeting} name={name} subline={subline} streak={streak} />
        <MomentumBar m={momentum} />
        <ApexScoreCard readiness={data.readiness} />
        <StreakNotification streak={streak} ghostDays={ghostDays} />
        <ContextCard
          priority={priority}
          d={data}
          onLogMeal={() => setMealOpen(true)}
          onViewBreakdown={() => setBreakdownOpen(true)}
        />
        <WhatApexKnows d={data} streak={streak} />
        <ThisWeek cards={data.cards} />
        <QuickActions
          onMeal={() => setMealOpen(true)}
          onRecovery={() => setRecoveryOpen(true)}
          onSets={() => navigate({ to: "/workouts" })}
          onWeigh={() => navigate({ to: "/nutrition" })}
        />
      </div>

      <BottomNav onLogged={onLogged} />

      <RecoveryLogModal
        open={recoveryOpen}
        onClose={() => setRecoveryOpen(false)}
        onSaved={onLogged}
      />
      <MealLogModal
        open={mealOpen}
        onClose={() => setMealOpen(false)}
        onSaved={onLogged}
      />

      <BottomSheet open={breakdownOpen} onClose={() => setBreakdownOpen(false)}>
        <div style={{ fontSize: 14, fontWeight: 500, color: T.text1, marginBottom: 12 }}>
          Today's coaching notes
        </div>
        {data.cards.filter((c) => c.card_date === today).length === 0 && (
          <p style={{ fontSize: 13, color: T.text2 }}>No notes for today yet.</p>
        )}
        {data.cards
          .filter((c) => c.card_date === today)
          .map((c) => (
            <div key={c.id} style={{ marginBottom: 16 }}>
              <div
                style={{
                  fontSize: 10,
                  letterSpacing: "1.2px",
                  textTransform: "uppercase",
                  color: T.text3,
                  marginBottom: 6,
                }}
              >
                {c.card_type.replace(/_/g, " ")}
              </div>
              <p
                style={{
                  fontSize: 14,
                  lineHeight: 1.6,
                  color: T.text1,
                  whiteSpace: "pre-wrap",
                }}
              >
                {cleanCardText(c.content)}
              </p>
            </div>
          ))}
      </BottomSheet>

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

function phaseFor(day: number): string {
  if (day <= 7) return "Learning phase";
  if (day <= 28) return "Building phase";
  return "Custom plan active";
}

function daysBetween(today: string, prev: string): number {
  const [ay, am, ad] = today.split("-").map(Number);
  const [by, bm, bd] = prev.split("-").map(Number);
  return Math.round(
    (Date.UTC(ay, (am ?? 1) - 1, ad ?? 1) - Date.UTC(by, (bm ?? 1) - 1, bd ?? 1)) /
      86400000,
  );
}

function Skeleton({ h }: { h: number }) {
  return (
    <div
      style={{
        height: h,
        background: T.surface,
        border: `0.5px solid ${T.border}`,
        borderRadius: 16,
        animation: "apex-pulse 1.6s ease-in-out infinite",
      }}
    />
  );
}
