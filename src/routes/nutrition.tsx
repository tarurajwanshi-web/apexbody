import { createFileRoute, Link } from "@tanstack/react-router";
import { ChevronLeft, Sparkles, X, Loader2, RefreshCw, Droplet } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { AICard } from "@/components/AIOrb";
import { RingChart } from "@/components/RingChart";
import { BottomNav } from "@/components/BottomNav";
import { RefreshStamp } from "@/components/RefreshStamp";
import { HydrationLogModal } from "@/components/LogModals";
import { MealDetailModal } from "@/components/MealDetailModal";
import { useAutoRefreshOnVisible } from "@/hooks/use-auto-refresh";
import { analyzePhoto } from "@/lib/coach.functions";
import { getTodayMacroSummary, type MacroSummary } from "@/lib/macros.functions";
import { getTodayMeals, getTodayHydration, logMeal, type TodayMeal, type HydrationSummary } from "@/lib/shield.functions";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/nutrition")({
  head: () => ({ meta: [{ title: "Nutrition — APEX" }] }),
  component: Nutrition,
});

const GOAL_LABEL: Record<string, string> = {
  recomposition: "recomposition",
  muscle_gain: "muscle gain",
  fat_loss: "fat loss",
  strength: "strength",
  athletic_performance: "athletic performance",
};

function Nutrition() {
  const [macros, setMacros] = useState<MacroSummary | null>(null);
  const [meals, setMeals] = useState<TodayMeal[] | null>(null);
  const [hydration, setHydration] = useState<HydrationSummary | null>(null);
  const [hydrationOpen, setHydrationOpen] = useState(false);
  const [openMeal, setOpenMeal] = useState<TodayMeal | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [lastUpdatedAt, setLastUpdatedAt] = useState<number | null>(null);
  const [ptrDelta, setPtrDelta] = useState(0);
  const ptrRef = useRef<HTMLDivElement>(null);
  const ptrStart = useRef<number | null>(null);
  const fetchMacros = useServerFn(getTodayMacroSummary);
  const fetchMeals = useServerFn(getTodayMeals);
  const fetchHydration = useServerFn(getTodayHydration);

  const reload = async () => {
    setRefreshing(true);
    await Promise.allSettled([
      fetchMacros().then(setMacros),
      fetchMeals().then(setMeals).catch(() => setMeals([])),
      fetchHydration().then(setHydration).catch(() => {}),
    ]);
    setLastUpdatedAt(Date.now());
    setRefreshing(false);
  };

  useEffect(() => { reload(); /* eslint-disable-next-line */ }, []);
  useAutoRefreshOnVisible(reload, lastUpdatedAt);

  // Pull-to-refresh.
  useEffect(() => {
    const el = ptrRef.current;
    if (!el) return;
    const onStart = (e: TouchEvent) => {
      if (window.scrollY > 0) return;
      ptrStart.current = e.touches[0].clientY;
    };
    const onMove = (e: TouchEvent) => {
      if (ptrStart.current == null) return;
      const d = e.touches[0].clientY - ptrStart.current;
      if (d > 0) setPtrDelta(Math.min(80, d * 0.5));
    };
    const onEnd = () => {
      if (ptrDelta >= 60) reload();
      ptrStart.current = null;
      setPtrDelta(0);
    };
    el.addEventListener("touchstart", onStart, { passive: true });
    el.addEventListener("touchmove", onMove, { passive: true });
    el.addEventListener("touchend", onEnd);
    return () => {
      el.removeEventListener("touchstart", onStart);
      el.removeEventListener("touchmove", onMove);
      el.removeEventListener("touchend", onEnd);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ptrDelta]);

  const pct = (a: number, b: number) => (b > 0 ? Math.min(100, Math.round((a / b) * 100)) : 0);



  const tCal = macros?.target_calories ?? null;
  const cCal = macros?.consumed_calories ?? 0;
  const hasTarget = tCal != null && tCal > 0;
  const hasMeals = (macros?.meals_estimated ?? 0) > 0;
  const goalText = macros?.goal ? (GOAL_LABEL[macros.goal] ?? macros.goal.replace(/_/g, " ")) : null;

  // Live protein nudge.
  const tProtein = macros?.target_protein_g ?? null;
  const cProtein = macros?.consumed_protein_g ?? 0;
  const proteinShort = tProtein != null ? Math.max(0, tProtein - cProtein) : 0;

  return (
    <div
      ref={ptrRef}
      className="min-h-screen bg-bg-1 pb-32 relative"
      style={{
        transform: ptrDelta ? `translateY(${ptrDelta}px)` : undefined,
        transition: ptrDelta ? "none" : "transform 0.2s ease",
      }}
    >
      {(ptrDelta > 0 || refreshing) && (
        <div className="absolute left-1/2 -translate-x-1/2 top-2 z-50 inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[11px] font-medium text-text-secondary"
          style={{ background: "rgba(15,21,36,0.85)", border: "1px solid rgba(255,255,255,0.08)", backdropFilter: "blur(8px)" }}>
          <RefreshCw size={12} className={refreshing ? "animate-spin" : ""} />
          <span>{refreshing ? "Refreshing…" : ptrDelta >= 60 ? "Release to refresh" : "Pull to refresh"}</span>
        </div>
      )}
      <header className="flex items-center justify-between px-5 pt-6">
        <Link to="/dashboard" className="text-text-secondary"><ChevronLeft size={24} /></Link>
        <span className="text-[11px] uppercase tracking-wider text-text-tertiary">Nutrition</span>
        <span className="w-6" />
      </header>
      <div className="px-5 mt-2">
        <RefreshStamp refreshing={refreshing} lastUpdatedAt={lastUpdatedAt} />
      </div>

      {/* Goal-based framing line */}
      <p className="mx-5 mt-5 text-[12px] text-text-secondary leading-snug">
        {goalText
          ? <>Based on your <span className="text-text-primary font-semibold">{goalText}</span> goal and your stats, here's your daily target.</>
          : <>Finish onboarding to calculate your personalized daily target.</>}
      </p>

      <section className="mx-5 mt-3 rounded-3xl bg-bg-2 border border-white/5 p-5">
        <div className="flex items-end justify-between">
          <div>
            <p className="text-[10px] uppercase tracking-wider text-text-tertiary">Today</p>
            <div className="mt-1 flex items-end gap-1">
              {hasTarget ? (
                hasMeals ? (
                  <>
                    <span className="text-5xl font-extrabold leading-none gradient-text tabular-nums">{cCal.toLocaleString()}</span>
                    <span className="text-base text-text-tertiary mb-1">/ {tCal!.toLocaleString()} kcal</span>
                  </>
                ) : (
                  <div>
                    <span className="text-5xl font-extrabold leading-none gradient-text tabular-nums">{tCal!.toLocaleString()}</span>
                    <span className="text-base text-text-tertiary mb-1 ml-1">kcal target</span>
                    <p className="text-[12px] text-text-tertiary mt-2">Log a meal to see your progress</p>
                  </div>
                )
              ) : (
                <span className="text-sm text-text-tertiary">No target yet.</span>
              )}
            </div>
          </div>
        </div>
        {hasTarget && (
          <div className="mt-4 h-1.5 rounded-full bg-white/5 overflow-hidden">
            <div className="h-full gradient-brand" style={{ width: `${pct(cCal, tCal!)}%` }} />
          </div>
        )}
        <div className="mt-5 grid grid-cols-3 gap-3">
          <Macro label="Protein" v={macros?.consumed_protein_g ?? 0} t={macros?.target_protein_g ?? 0} color="#F59E0B" hasMeals={hasMeals} />
          <Macro label="Carbs"   v={macros?.consumed_carbs_g ?? 0}   t={macros?.target_carbs_g ?? 0}   color="#10B981" hasMeals={hasMeals} />
          <Macro label="Fat"     v={macros?.consumed_fat_g ?? 0}     t={macros?.target_fat_g ?? 0}     color="#3B82F6" hasMeals={hasMeals} />
        </div>
      </section>

      {/* Hydration card — ACSM-aligned target, with quick-add launcher.
       *  For manual users this also feeds 30% of their Nutrition pillar score.
       *  Device users still see the same UI but it doesn't move their score
       *  (avoids double-counting with HRV/RHR-driven Recovery). */}
      <HydrationCard hydration={hydration} onLog={() => setHydrationOpen(true)} />

      {hasTarget && hasMeals && proteinShort >= 20 && (
        <div className="mx-5 mt-4">
          <AICard>
            You're <span className="text-text-primary font-semibold">{proteinShort}g short on protein</span>. Add a high-protein snack before 8pm to hit your{goalText ? ` ${goalText}` : ""} target.
          </AICard>
        </div>
      )}

      {/* Hydration-aware insight — fires when meaningfully behind target after midday.
       *  Framed as general guidance, not a clinical claim. */}
      <HydrationInsight hydration={hydration} />



      <section className="mx-5 mt-5">
        <div className="flex items-center justify-between mb-2">
          <p className="text-xs uppercase tracking-wider text-text-tertiary">Meals today</p>
          <p className="text-[11px] text-text-accent">Tap + below to log a meal</p>
        </div>
        {meals == null ? (
          <div className="rounded-2xl bg-bg-2 border border-white/5 p-5 flex justify-center">
            <Loader2 size={16} className="animate-spin text-text-tertiary" />
          </div>
        ) : meals.length === 0 ? (
          <div className="rounded-2xl bg-bg-2 border border-white/5 p-5">
            <p className="text-sm text-text-secondary">No meals logged yet today. Tap the + in the nav below to log your first.</p>
          </div>
        ) : (
          <div className="space-y-2">
            {meals.map((m) => (
              <button
                key={m.id}
                onClick={() => setOpenMeal(m)}
                className="w-full text-left rounded-2xl bg-bg-2 border border-white/5 p-4 active:scale-[0.99] transition"
              >
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold truncate">{m.meal_description || "Photo meal"}</p>
                    <p className="text-[11px] text-text-tertiary">
                      {new Date(m.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                      {m.estimated_calories != null ? ` · ${Math.round(m.estimated_calories)} kcal` : ""}
                    </p>
                  </div>
                  <p className="font-mono text-sm tabular-nums text-text-secondary shrink-0">
                    {m.claude_score_status === "scored" && m.claude_quality_score != null ? `${m.claude_quality_score}/100` : "scoring…"}
                  </p>
                </div>
              </button>
            ))}
          </div>
        )}
      </section>

      <BottomNav onLogged={reload} />
      <HydrationLogModal open={hydrationOpen} onClose={() => setHydrationOpen(false)} onSaved={reload} />
      <MealDetailModal meal={openMeal} onClose={() => setOpenMeal(null)} />
    </div>
  );
}

function Macro({ label, v, t, color, hasMeals }: { label: string; v: number; t: number; color: string; hasMeals: boolean }) {
  const pct = t > 0 ? Math.min(100, Math.round((v / t) * 100)) : 0;
  return (
    <div className="flex flex-col items-center gap-1">
      <RingChart size={56} stroke={5} rings={[{ value: pct, color }]} centerLabel={hasMeals ? `${pct}%` : "—"} />
      <p className="text-[11px] font-semibold mt-1">{label}</p>
      <p className="text-[10px] text-text-tertiary">{hasMeals ? `${v}/${t || "—"}g` : `${t || "—"}g target`}</p>
    </div>
  );
}

function HydrationCard({ hydration, onLog }: { hydration: HydrationSummary | null; onLog: () => void }) {
  const consumed = hydration?.consumed_ml ?? 0;
  const target = hydration?.target_ml ?? null;
  const pct = target ? Math.min(100, Math.round((consumed / target) * 100)) : 0;
  const liters = (ml: number) => (ml / 1000).toFixed(ml >= 1000 ? 1 : 2);
  return (
    <section className="mx-5 mt-4 rounded-3xl bg-bg-2 border border-white/5 p-5">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <div className="h-9 w-9 rounded-xl flex items-center justify-center" style={{ background: "rgba(59,130,246,0.18)", border: "1px solid rgba(59,130,246,0.35)" }}>
            <Droplet size={16} className="text-sleep" />
          </div>
          <div>
            <p className="text-[15px] font-semibold text-white">Hydration</p>
            <p className="text-[11px] text-text-tertiary">
              {target ? `${liters(consumed)}L / ${liters(target)}L today` : "Add your weight in settings to see a target"}
              {hydration?.had_training_today && target ? " · training day (+10 ml/kg)" : ""}
            </p>
          </div>
        </div>
        <button
          onClick={onLog}
          aria-label="Log water"
          className="rounded-full px-3 py-1.5 text-[12px] font-semibold text-white active:scale-95 transition"
          style={{ background: "linear-gradient(135deg, rgba(59,130,246,0.85), rgba(124,58,237,0.85))" }}
        >
          + Log water
        </button>
      </div>
      {target && (
        <div className="mt-4 h-1.5 rounded-full overflow-hidden" style={{ background: "rgba(255,255,255,0.06)" }}>
          <div className="h-full" style={{ width: `${pct}%`, background: "linear-gradient(90deg, #3B82F6, #06B6D4)" }} />
        </div>
      )}
      {hydration?.path === "device" && (
        <p className="mt-3 text-[10px] text-text-tertiary">
          Tracked for your own awareness — your device's HRV/RHR already reflects hydration in Recovery.
        </p>
      )}
    </section>
  );
}

function HydrationInsight({ hydration }: { hydration: HydrationSummary | null }) {
  if (!hydration?.target_ml) return null;
  const pct = hydration.target_ml > 0 ? hydration.consumed_ml / hydration.target_ml : 0;
  const hourLocal = new Date().getHours();
  if (hourLocal < 13 || pct >= 0.55) return null;
  const shortMl = Math.max(0, hydration.target_ml - hydration.consumed_ml);
  return (
    <div className="mx-5 mt-4">
      <AICard>
        You're <span className="text-text-primary font-semibold">{(shortMl / 1000).toFixed(1)}L behind</span> on water today. Staying ahead now tends to support tomorrow's recovery score — informational guidance, not medical advice.
      </AICard>
    </div>
  );
}
