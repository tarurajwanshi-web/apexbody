import { createFileRoute, Link } from "@tanstack/react-router";
import { ChevronLeft, ChevronRight, Loader2, RefreshCw, Droplet, X, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { AICard } from "@/components/AIOrb";
import { RingChart } from "@/components/RingChart";
import { scoreColor } from "@/lib/score-color";
import { BottomNav } from "@/components/BottomNav";
import { RefreshStamp } from "@/components/RefreshStamp";
import { HydrationLogModal } from "@/components/LogModals";
import { MealDetailModal } from "@/components/MealDetailModal";
import {
  NutritionDateHeader,
  formatNutritionDateLabel,
  formatShortDate,
} from "@/components/NutritionDateHeader";
import { useUserTimezone, getLocalDateISO } from "@/lib/dates";
import { useAutoRefreshOnVisible } from "@/hooks/use-auto-refresh";
import {
  getTodayMacroSummary,
  getWeeklyNutritionInsight,
  getMacroAdjustmentReview,
  type MacroSummary,
  type WeeklyNutritionInsight,
  type WeeklyDay,
  type MacroAdjustmentReview,
} from "@/lib/macros.functions";
import {
  getTodayMeals,
  getTodayHydration,
  getTodayHydrationEvents,
  softDeleteMeal,
  restoreMeal,
  type TodayMeal,
  type HydrationSummary,
  type HydrationEvent,
} from "@/lib/shield.functions";

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
  const userTz = useUserTimezone();
  const [selectedDate, setSelectedDate] = useState<string>(() => getLocalDateISO(userTz));
  const [macros, setMacros] = useState<MacroSummary | null>(null);
  const [meals, setMeals] = useState<TodayMeal[] | null>(null);
  const [hydration, setHydration] = useState<HydrationSummary | null>(null);
  const [hydrationEvents, setHydrationEvents] = useState<HydrationEvent[]>([]);
  const [hydrationOpen, setHydrationOpen] = useState(false);
  const [weeklySheetOpen, setWeeklySheetOpen] = useState(false);
  const [openMeal, setOpenMeal] = useState<TodayMeal | null>(null);
  const [weekly, setWeekly] = useState<WeeklyNutritionInsight | null>(null);
  const [macroReview, setMacroReview] = useState<MacroAdjustmentReview | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [lastUpdatedAt, setLastUpdatedAt] = useState<number | null>(null);
  const [ptrDelta, setPtrDelta] = useState(0);
  // Undo snackbar state — populated when a meal is soft-deleted.
  const [pendingUndo, setPendingUndo] = useState<{ id: string } | null>(null);
  const undoTimerRef = useRef<number | null>(null);
  const ptrRef = useRef<HTMLDivElement>(null);
  const ptrStart = useRef<number | null>(null);
  const fetchMacros = useServerFn(getTodayMacroSummary);
  const fetchMeals = useServerFn(getTodayMeals);
  const fetchHydration = useServerFn(getTodayHydration);
  const fetchHydrationEvents = useServerFn(getTodayHydrationEvents);
  const fetchWeekly = useServerFn(getWeeklyNutritionInsight);
  const fetchMacroReview = useServerFn(getMacroAdjustmentReview);
  const softDelete = useServerFn(softDeleteMeal);
  const restore = useServerFn(restoreMeal);

  const todayISO = getLocalDateISO(userTz);
  const isToday = selectedDate === todayISO;
  const dateLabel = formatNutritionDateLabel(selectedDate, userTz);


  const reload = async () => {
    setRefreshing(true);
    const dateArg = { data: { entryDate: selectedDate } } as any;
    const weeklyArg = { data: { anchorDate: selectedDate } } as any;
    await Promise.allSettled([
      fetchMacros(dateArg).then(setMacros),
      fetchMeals(dateArg).then(setMeals).catch(() => setMeals([])),
      isToday
        ? fetchHydration().then(setHydration).catch(() => {})
        : Promise.resolve(setHydration(null)),
      fetchHydrationEvents(dateArg).then(setHydrationEvents).catch(() => setHydrationEvents([])),
      fetchWeekly(weeklyArg).then(setWeekly).catch(() => setWeekly(null)),
      fetchMacroReview().then(setMacroReview).catch(() => setMacroReview(null)),
    ]);
    setLastUpdatedAt(Date.now());
    setRefreshing(false);
  };

  // Delete a meal: optimistic UI update + show undo snackbar.
  const handleDelete = async (id: string) => {
    if (!confirm("Delete this meal? This removes it from daily macros and weekly adherence.")) return;
    setMeals((prev) => (prev ? prev.filter((m) => m.id !== id) : prev));
    try {
      await softDelete({ data: { id } });
    } catch (e) {
      console.error("[meal] delete failed", e);
      reload();
      return;
    }
    setPendingUndo({ id });
    if (undoTimerRef.current) window.clearTimeout(undoTimerRef.current);
    undoTimerRef.current = window.setTimeout(() => {
      setPendingUndo(null);
      reload(); // recompute downstream macros/weekly after the undo window
    }, 5000);
  };

  const handleUndoDelete = async () => {
    if (!pendingUndo) return;
    const id = pendingUndo.id;
    if (undoTimerRef.current) window.clearTimeout(undoTimerRef.current);
    setPendingUndo(null);
    try { await restore({ data: { id } }); } catch (e) { console.error("[meal] restore failed", e); }
    reload();
  };


  useEffect(() => { reload(); /* eslint-disable-next-line */ }, [selectedDate]);
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

  const hasHydrationTarget = (hydration?.target_ml ?? 0) > 0;
  return (
    <div
      ref={ptrRef}
      className="min-h-screen bg-bg-1 pb-44 relative"
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

      <NutritionDateHeader selectedDate={selectedDate} onChange={setSelectedDate} />

      {/* Goal-based framing line */}
      <p className="mx-5 mt-5 text-[12px] text-text-secondary leading-snug">
        {goalText
          ? <>Based on your <span className="text-text-primary font-semibold">{goalText}</span> goal and your stats, here's your daily target.</>
          : <>Finish onboarding to calculate your personalized daily target.</>}
      </p>

      <section className="mx-5 mt-3 rounded-3xl bg-bg-2 border border-white/5 p-4">
        {macros?.verdict && (
          <VerdictBadge verdict={macros.verdict} />
        )}
        <div className="flex items-end justify-between mt-1.5">
          <div>
            <p className="text-[10px] uppercase tracking-wider text-text-tertiary">{dateLabel}</p>
            <div className="mt-1 flex items-end gap-1">
              {hasTarget ? (
                hasMeals ? (
                  <>
                    <span
                      className={`text-4xl font-extrabold leading-none tabular-nums ${cCal > tCal! ? "" : "gradient-text"}`}
                      style={cCal > tCal! ? { color: "#F59E0B" } : undefined}
                    >
                      {cCal.toLocaleString()}
                    </span>
                    <span className="text-sm text-text-tertiary mb-0.5">/ {tCal!.toLocaleString()} kcal</span>
                  </>
                ) : (
                  <div>
                    <span className="text-4xl font-extrabold leading-none gradient-text tabular-nums">{tCal!.toLocaleString()}</span>
                    <span className="text-sm text-text-tertiary mb-0.5 ml-1">kcal target</span>
                    {isToday && macros?.coaching_line && (
                      <p className="text-[12px] text-text-secondary mt-1.5">{macros.coaching_line}</p>
                    )}
                  </div>
                )
              ) : (
                <span className="text-sm text-text-tertiary">No target yet.</span>
              )}
            </div>
            {hasTarget && hasMeals && (() => {
              const diff = cCal - tCal!;
              if (diff > 0) {
                return (
                  <p className="mt-1.5 text-[12px]" style={{ color: "#F59E0B" }}>
                    {diff.toLocaleString()} kcal over target
                  </p>
                );
              }
              if (diff < 0) {
                return (
                  <p className="mt-1.5 text-[12px] text-text-tertiary">
                    {Math.abs(diff).toLocaleString()} kcal {isToday ? "remaining" : "under target"}
                  </p>
                );
              }
              return null;
            })()}
            {macros?.main_driver && hasMeals && !/^Calories were/.test(macros.main_driver) && (
              <p className="mt-1 text-[12px] text-text-secondary">{macros.main_driver}</p>
            )}
          </div>
        </div>
        {hasTarget && (() => {
          const ratio = tCal! > 0 ? cCal / tCal! : 0;
          const over = ratio > 1;
          const barColor = over ? "#F59E0B" : undefined;
          const widthPct = Math.min(100, Math.round(ratio * 100));
          return (
            <div className="mt-3 h-1 rounded-full bg-white/5 overflow-hidden">
              <div
                className={over ? "h-full" : "h-full gradient-brand"}
                style={{ width: `${widthPct}%`, background: barColor }}
              />
            </div>
          );
        })()}
        <div className="mt-3 grid grid-cols-3 gap-3">
          <Macro label="Protein" v={macros?.consumed_protein_g ?? 0} t={macros?.target_protein_g ?? 0} color="#F59E0B" hasMeals={hasMeals} />
          <Macro label="Carbs"   v={macros?.consumed_carbs_g ?? 0}   t={macros?.target_carbs_g ?? 0}   color="#10B981" hasMeals={hasMeals} />
          <Macro label="Fat"     v={macros?.consumed_fat_g ?? 0}     t={macros?.target_fat_g ?? 0}     color="#3B82F6" hasMeals={hasMeals} />
        </div>
        {macros?.coaching_line && hasMeals && (
          <div className="mt-3 rounded-full bg-white/5 border border-white/10 px-3 py-1 text-[11px] text-text-secondary text-center">
            {macros.coaching_line}
          </div>
        )}
        {(macros?.meal_quality_score != null || macros?.macro_adherence_score != null || macros?.nutrition_day_score != null) && (
          <div className="mt-3 grid grid-cols-3 gap-2 border-t border-white/[0.04] pt-2.5">
            <ScorePill label="Meal quality" value={macros?.meal_quality_score ?? null} />
            <ScorePill label="Macro adherence" value={macros?.macro_adherence_score ?? null} />
            <ScorePill label="Nutrition score" value={macros?.nutrition_day_score ?? null} emphasized />
          </div>
        )}
      </section>

      {/* Hydration card — ACSM-aligned target, with quick-add launcher.
       *  Scoped to today only: target/quick-add and the score it feeds are
       *  current-day concepts. On past dates, the timeline below still shows
       *  hydration events that were logged on that date. */}
      {isToday && hasHydrationTarget && (
        <HydrationCard
          hydration={hydration}
          onLog={() => setHydrationOpen(true)}
        />
      )}

      {isToday && hasTarget && hasMeals && proteinShort >= 20 && (
        <div className="mx-5 mt-4">
          <AICard>
            You're <span className="text-text-primary font-semibold">{proteinShort}g short on protein</span>. Add a high-protein snack before 8pm to hit your{goalText ? ` ${goalText}` : ""} target.
          </AICard>
        </div>
      )}

      {isToday && hasHydrationTarget && <HydrationInsight hydration={hydration} />}

      <WeeklyPreviewCard weekly={weekly} onOpen={() => setWeeklySheetOpen(true)} />

      <MacroReviewCard review={macroReview} />

      <section className="mx-5 mt-5">
        <div className="flex items-center justify-between mb-2">
          <p className="text-xs uppercase tracking-wider text-text-tertiary">
            {isToday
              ? "Today's meals"
              : dateLabel === "Yesterday"
                ? "Yesterday's meals"
                : `Meals on ${formatShortDate(selectedDate)}`}
          </p>
          <p className="text-[11px] text-text-accent">
            {isToday ? "Tap + below to log a meal" : "Viewing this day. New meals log to today only."}
          </p>
        </div>
        <UnifiedTimeline
          meals={meals}
          hydration={hydrationEvents}
          selectedDate={selectedDate}
          onOpenMeal={setOpenMeal}
          onDeleteMeal={handleDelete}
        />
      </section>

      {/* Compact hydration prompt — only when weight is missing so there's no
       *  target. Lives BELOW meals so it doesn't dominate above the meal list. */}
      {isToday && !hasHydrationTarget && (
        <div className="mx-5 mt-4 rounded-2xl bg-bg-2 border border-white/5 px-4 py-3 flex items-center gap-3">
          <Droplet size={16} className="text-sleep shrink-0" />
          <p className="text-[12px] text-text-secondary flex-1 min-w-0">
            Add your weight in Settings to enable a hydration target.
          </p>
          <Link to="/settings" className="text-[12px] font-semibold text-text-accent shrink-0">
            Open →
          </Link>
        </div>
      )}

      {/* Undo snackbar — sits above bottom nav, 5s timeout. */}
      {pendingUndo && (
        <div className="fixed left-1/2 -translate-x-1/2 bottom-28 z-[90] flex items-center gap-3 rounded-full px-4 py-2.5 text-[13px] text-white shadow-lg"
          style={{ background: "rgba(15,21,36,0.95)", border: "1px solid rgba(255,255,255,0.10)" }}>
          <span>Meal deleted</span>
          <button
            type="button"
            onClick={handleUndoDelete}
            className="text-[13px] font-semibold text-text-accent active:scale-95"
          >
            Undo
          </button>
        </div>
      )}

      <BottomNav onLogged={reload} />
      <HydrationLogModal open={hydrationOpen} onClose={() => setHydrationOpen(false)} onSaved={reload} />
      <MealDetailModal meal={openMeal} onClose={() => setOpenMeal(null)} />
      <WeeklyGraphSheet
        open={weeklySheetOpen}
        onClose={() => setWeeklySheetOpen(false)}
        initialAnchor={selectedDate}
        macroReview={macroReview}
      />

    </div>
  );
}

function Macro({ label, v, t, color: _color, hasMeals }: { label: string; v: number; t: number; color: string; hasMeals: boolean }) {
  const rawPct = t > 0 ? Math.round((v / t) * 100) : 0;
  const pct = t > 0 ? Math.min(100, rawPct) : 0;
  // Same color-zone system used by the APEX score ring and pillar dots:
  // pct=100 reads as a confident green, missing the target slides through
  // yellow → amber → red. Meaningful overshoot (>110%) still snaps to amber
  // for the calorie/macro-overage tone consistent with the rest of the app.
  const over = t > 0 && hasMeals && rawPct > 110;
  const ringColor = !hasMeals ? "#4A566A" : over ? "#F59E0B" : scoreColor(pct);
  return (
    <div className="flex flex-col items-center gap-1">
      <RingChart size={56} stroke={5} rings={[{ value: pct, color: ringColor }]} centerLabel={hasMeals ? `${rawPct}%` : "—"} />
      <p className="text-[11px] font-semibold mt-1">{label}</p>
      <p className={`text-[10px] ${over ? "" : "text-text-tertiary"}`} style={{ color: over ? "#F59E0B" : undefined }}>
        {hasMeals ? `${v}/${t || "—"}g${over ? ` · +${v - t}g` : ""}` : `${t || "—"}g target`}
      </p>
    </div>
  );
}

function HydrationCard({
  hydration,
  onLog,
}: {
  hydration: HydrationSummary | null;
  onLog: () => void;
}) {
  const consumed = hydration?.consumed_ml ?? 0;
  const target = hydration?.target_ml ?? null;
  const pct = target ? Math.min(100, Math.round((consumed / target) * 100)) : 0;
  const liters = (ml: number) => (ml / 1000).toFixed(ml >= 1000 ? 1 : 2);

  return (
    <section className="mx-5 mt-4 rounded-3xl bg-bg-2 border border-white/5 p-5">
      <div className="flex items-center gap-4">
        {/* Bottle-shaped fill indicator, sized to match the macro rings above. */}
        <BottleFill pct={pct} disabled={!target} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <Droplet size={14} className="text-sleep" />
            <p className="text-[15px] font-semibold text-white">Hydration</p>
          </div>
          {target ? (
            <>
              <p className="mt-1 text-[20px] font-bold tabular-nums">
                {liters(consumed)}<span className="text-text-tertiary text-sm font-normal"> / {liters(target)}L</span>
              </p>
              <p className="text-[11px] text-text-tertiary">
                {pct}% of today's target
                {hydration?.had_training_today ? " · training day (+10 ml/kg)" : ""}
              </p>
            </>
          ) : (
            // Weight is captured in onboarding and resolved server-side by the
            // same source-of-truth used by BMR/TDEE and calculate-score. If it
            // ever resolves to null here, send the user to Settings to correct
            // it rather than offering a one-off override on the Nutrition tab.
            <>
              <p className="mt-1 text-[12px] text-text-secondary">
                Weight missing — add it once in Settings to see your hydration target.
              </p>
              <Link
                to="/settings"
                className="mt-2 inline-block text-[12px] font-semibold text-text-accent"
              >
                Open Settings →
              </Link>
            </>
          )}
        </div>
        {target ? (
          <button
            onClick={onLog}
            aria-label="Log water"
            className="rounded-full px-3 py-1.5 text-[12px] font-semibold text-white active:scale-95 transition shrink-0"
            style={{ background: "linear-gradient(135deg, rgba(59,130,246,0.85), rgba(6,182,212,0.85))" }}
          >+ Log</button>
        ) : null}
      </div>

      {hydration?.path === "device" && target && (
        <p className="mt-3 text-[10px] text-text-tertiary">
          Tracked for awareness — your device's HRV/RHR already reflects hydration in Recovery.
        </p>
      )}
    </section>
  );
}

/** Glass/bottle silhouette that visually fills based on % of daily target.
 *  Sized to feel like a peer to the macro rings above. */
function BottleFill({ pct, disabled }: { pct: number; disabled?: boolean }) {
  const fillH = Math.max(0, Math.min(100, pct));
  return (
    <div className="relative h-16 w-12 shrink-0">
      <svg viewBox="0 0 48 64" className="absolute inset-0 h-full w-full">
        <defs>
          <clipPath id="bottle-clip">
            <path d="M16 4 H32 V12 Q42 16 42 28 V54 Q42 60 36 60 H12 Q6 60 6 54 V28 Q6 16 16 12 Z" />
          </clipPath>
        </defs>
        <path
          d="M16 4 H32 V12 Q42 16 42 28 V54 Q42 60 36 60 H12 Q6 60 6 54 V28 Q6 16 16 12 Z"
          fill="rgba(59,130,246,0.10)"
          stroke={disabled ? "rgba(255,255,255,0.18)" : "rgba(59,130,246,0.6)"}
          strokeWidth="1.5"
        />
        <g clipPath="url(#bottle-clip)">
          <rect
            x="0" y={64 - (fillH * 0.6)}
            width="48" height={fillH * 0.6}
            fill={disabled ? "rgba(255,255,255,0.06)" : "url(#bottle-grad)"}
          />
        </g>
        <linearGradient id="bottle-grad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#3B82F6" stopOpacity="0.55" />
          <stop offset="100%" stopColor="#06B6D4" stopOpacity="0.85" />
        </linearGradient>
      </svg>
      {!disabled && (
        <p className="absolute inset-0 flex items-center justify-center text-[11px] font-semibold text-white drop-shadow">{pct}%</p>
      )}
    </div>
  );
}

/** Chronological "Today" timeline: meals + hydration interleaved by timestamp. */
/** Deterministic single-tag classifier for a meal's macro shape.
 *  Rules (priority order):
 *    1. estimated/manual_edited with macros present, else null
 *    2. kcal >= 700 → "High calorie"
 *    3. fat kcal share > 45% → "High fat"
 *    4. carb kcal share > 55% → "Carb heavy"
 *    5. protein < 15g AND kcal >= 200 → "Protein light"
 *    6. else → "Balanced" */
function mealImpactTag(m: TodayMeal): { label: string; color: string; bg: string; border: string } | null {
  const status = m.calorie_estimate_status;
  if (status !== "estimated" && status !== "manual_edited") return null;
  const kcal = Number(m.estimated_calories ?? 0);
  const p = Number(m.estimated_protein_g ?? 0);
  const c = Number(m.estimated_carbs_g ?? 0);
  const f = Number(m.estimated_fat_g ?? 0);
  if (kcal <= 0) return null;
  const fatShare = (f * 9) / kcal;
  const carbShare = (c * 4) / kcal;
  let label: string;
  if (kcal >= 700) label = "High calorie";
  else if (fatShare > 0.45) label = "High fat";
  else if (carbShare > 0.55) label = "Carb heavy";
  else if (p < 15 && kcal >= 200) label = "Protein light";
  else label = "Balanced";
  const palette: Record<string, { color: string; bg: string; border: string }> = {
    "High calorie": { color: "#F59E0B", bg: "rgba(245,158,11,0.10)", border: "rgba(245,158,11,0.30)" },
    "High fat":     { color: "#3B82F6", bg: "rgba(59,130,246,0.10)", border: "rgba(59,130,246,0.30)" },
    "Carb heavy":   { color: "#10B981", bg: "rgba(16,185,129,0.10)", border: "rgba(16,185,129,0.30)" },
    "Protein light":{ color: "#EF4444", bg: "rgba(239,68,68,0.10)",  border: "rgba(239,68,68,0.30)" },
    "Balanced":     { color: "#9CA3AF", bg: "rgba(255,255,255,0.04)", border: "rgba(255,255,255,0.10)" },
  };
  return { label, ...palette[label] };
}

function UnifiedTimeline({
  meals, hydration, selectedDate, onOpenMeal, onDeleteMeal,
}: {
  meals: TodayMeal[] | null;
  hydration: HydrationEvent[];
  selectedDate: string;
  onOpenMeal: (m: TodayMeal) => void;
  onDeleteMeal?: (id: string) => void;
}) {
  if (meals == null) {
    return (
      <div className="rounded-2xl bg-bg-2 border border-white/5 p-5 flex justify-center">
        <Loader2 size={16} className="animate-spin text-text-tertiary" />
      </div>
    );
  }
  if (meals.length === 0 && hydration.length === 0) {
    const label = formatNutritionDateLabel(selectedDate);
    const emptyCopy =
      label === "Today"
        ? "Nothing logged yet today."
        : label === "Yesterday"
          ? "Nothing logged yesterday."
          : `Nothing logged on ${formatShortDate(selectedDate)}.`;
    return (
      <div className="rounded-2xl bg-bg-2 border border-white/5 p-5">
        <p className="text-sm text-text-secondary">{emptyCopy}</p>
      </div>
    );
  }
  type Row =
    | { kind: "meal"; ts: number; meal: TodayMeal }
    | { kind: "water"; ts: number; ev: HydrationEvent };
  const rows: Row[] = [
    ...meals.map<Row>((m) => ({ kind: "meal", ts: new Date(m.created_at).getTime(), meal: m })),
    ...hydration.map<Row>((ev) => ({ kind: "water", ts: new Date(ev.created_at).getTime(), ev })),
  ].sort((a, b) => a.ts - b.ts);
  const fmtTime = (ts: number) => new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  return (
    <div className="space-y-2">
      {rows.map((r) =>
        r.kind === "meal" ? (
          // div + role=button so we can render a real inner <button> for delete
          // without nesting interactive controls.
          <div
            key={`m-${r.meal.id}`}
            role="button"
            tabIndex={0}
            onClick={() => onOpenMeal(r.meal)}
            onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onOpenMeal(r.meal); } }}
            className="w-full text-left rounded-2xl bg-bg-2 border border-white/5 p-4 active:scale-[0.99] transition cursor-pointer"
          >
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="text-sm font-semibold truncate">{r.meal.meal_description || "Photo meal"}</p>
                <p className="text-[11px] text-text-tertiary">
                  {fmtTime(r.ts)}
                  {r.meal.estimated_calories != null ? ` · ${Math.round(r.meal.estimated_calories)} kcal` : ""}
                </p>
                {(() => {
                  const tag = mealImpactTag(r.meal);
                  if (!tag) return null;
                  return (
                    <span
                      className="inline-block mt-1 rounded-full px-1.5 py-px text-[10px] font-medium"
                      style={{ background: tag.bg, color: tag.color, border: `1px solid ${tag.border}` }}
                    >
                      {tag.label}
                    </span>
                  );
                })()}
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <p className="font-mono text-sm tabular-nums text-text-secondary">
                  {r.meal.claude_score_status === "scored" && r.meal.claude_quality_score != null
                    ? `${r.meal.claude_quality_score}/100`
                    : "scoring…"}
                </p>
                {onDeleteMeal && (
                  <button
                    type="button"
                    aria-label="Delete meal"
                    onClick={(e) => { e.stopPropagation(); onDeleteMeal(r.meal.id); }}
                    className="h-7 w-7 rounded-full flex items-center justify-center text-text-tertiary active:scale-95 transition hover:bg-white/5"
                  >
                    <Trash2 size={14} />
                  </button>
                )}
              </div>
            </div>
          </div>
        ) : (
          <div
            key={`w-${r.ev.id}`}
            className="rounded-2xl p-3 flex items-center gap-3"
            style={{ background: "rgba(59,130,246,0.06)", border: "1px solid rgba(59,130,246,0.20)" }}
          >
            <div className="h-8 w-8 rounded-full flex items-center justify-center shrink-0" style={{ background: "rgba(59,130,246,0.20)" }}>
              <Droplet size={14} className="text-sleep" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-white">Water — {r.ev.amount_ml} ml</p>
              <p className="text-[11px] text-text-tertiary">{fmtTime(r.ts)}</p>
            </div>
          </div>
        ),
      )}
    </div>
  );
}


function HydrationInsight({ hydration }: { hydration: HydrationSummary | null }) {
  if (!hydration?.target_ml) return null;
  const pct = hydration.target_ml > 0 ? hydration.consumed_ml / hydration.target_ml : 0;
  const hourLocal = new Date().getHours();
  const underTarget = pct < 0.55;

  // Device-path causal insight: only fires when hydration is meaningfully
  // under target AND the user's Recovery pillar today dipped vs. their recent
  // baseline by a real amount. Deterministic comparison — no LLM, no causal
  // claim, framed as "likely contributor".
  if (hydration.path === "device" && underTarget) {
    const today = hydration.recovery_today;
    const base = hydration.recovery_baseline;
    const yest = hydration.recovery_yesterday;
    const ref = today ?? yest;
    if (ref != null && base != null && base - ref >= 8) {
      const drop = Math.round(base - ref);
      return (
        <div className="mx-5 mt-4">
          <AICard>
            Your recovery dipped about <span className="text-text-primary font-semibold">{drop} pts</span> below your recent baseline today — you're also under your water target, which is a likely contributor. Informational guidance, not medical advice.
          </AICard>
        </div>
      );
    }
    // Fall through to the generic late-day callout if no observed correlation.
  }

  if (hourLocal < 13 || !underTarget) return null;
  const shortMl = Math.max(0, hydration.target_ml - hydration.consumed_ml);
  return (
    <div className="mx-5 mt-4">
      <AICard>
        You're <span className="text-text-primary font-semibold">{(shortMl / 1000).toFixed(1)}L behind</span> on water today. Staying ahead now tends to support tomorrow's recovery score — informational guidance, not medical advice.
      </AICard>
    </div>
  );
}


function VerdictBadge({ verdict }: { verdict: string }) {
  const tone =
    verdict === "On track"
      ? { bg: "rgba(16,185,129,0.12)", border: "rgba(16,185,129,0.35)", color: "#10B981" }
      : verdict === "Slightly off"
        ? { bg: "rgba(245,158,11,0.12)", border: "rgba(245,158,11,0.35)", color: "#F59E0B" }
        : verdict === "Off target"
          ? { bg: "rgba(239,68,68,0.10)", border: "rgba(239,68,68,0.30)", color: "#EF4444" }
          : { bg: "rgba(255,255,255,0.05)", border: "rgba(255,255,255,0.10)", color: "#9CA3AF" };
  return (
    <span
      className="inline-flex items-center rounded-full px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider"
      style={{ background: tone.bg, border: `1px solid ${tone.border}`, color: tone.color }}
    >
      {verdict}
    </span>
  );
}

function ScorePill({
  label, value, emphasized,
}: { label: string; value: number | null; emphasized?: boolean }) {
  const color =
    value == null ? "#6B7280" : value >= 80 ? "#10B981" : value >= 60 ? "#F59E0B" : "#EF4444";
  return (
    <div className="flex flex-col items-center">
      <p className="text-[10px] text-text-tertiary uppercase tracking-wider text-center">{label}</p>
      <p
        className={`mt-1 tabular-nums ${emphasized ? "text-lg font-bold" : "text-base font-semibold"}`}
        style={{ color }}
      >
        {value == null ? "—" : value}
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Weekly Preview (compact card on the main scroll)
// ---------------------------------------------------------------------------

function WeeklyPreviewCard({
  weekly,
  onOpen,
}: {
  weekly: WeeklyNutritionInsight | null;
  onOpen: () => void;
}) {
  if (!weekly) return null;
  const { logged_days, days_elapsed, weekly_nutrition_score, confidence_label, early_signal } = weekly;
  const lowConfidence = confidence_label === "low";

  return (
    <section className="mx-5 mt-4 rounded-3xl bg-bg-2 border border-white/5 p-4">
      <div className="flex items-baseline justify-between">
        <p className="text-[15px] font-semibold text-white">This week so far</p>
        {weekly_nutrition_score != null && !lowConfidence && (
          <span
            className="text-[12px] font-semibold tabular-nums"
            style={{ color: scoreColor(weekly_nutrition_score) }}
          >
            {weekly_nutrition_score}
          </span>
        )}
      </div>

      <div className="mt-1 flex items-baseline gap-2">
        <span className="text-2xl font-extrabold tabular-nums text-white leading-none">
          {logged_days}
        </span>
        <span className="text-[12px] text-text-tertiary">
          {logged_days === 1 ? "day logged" : "days logged"}
          <span className="text-text-tertiary/70"> · of {days_elapsed}</span>
        </span>
        {lowConfidence && logged_days > 0 && (
          <span className="ml-auto rounded-full px-2 py-0.5 text-[10px] font-medium border border-white/10 bg-white/5 text-text-tertiary">
            Confidence low
          </span>
        )}
      </div>

      <p className="mt-2 text-[12px] text-text-secondary leading-snug">{early_signal}</p>

      <button
        type="button"
        onClick={onOpen}
        className="mt-3 w-full inline-flex items-center justify-between rounded-2xl bg-white/[0.04] border border-white/10 px-3 py-2 text-[12px] font-semibold text-text-primary active:scale-[0.99] transition"
      >
        <span>View weekly graph</span>
        <ChevronRight size={16} className="text-text-tertiary" />
      </button>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Weekly Graph Bottom Sheet
// ---------------------------------------------------------------------------

function formatRangeLabel(startISO: string, endISO: string): string {
  const fmt = (iso: string) => {
    const [y, m, d] = iso.split("-").map(Number);
    return new Date(y, (m ?? 1) - 1, d ?? 1).toLocaleDateString(undefined, {
      day: "2-digit",
      month: "short",
    });
  };
  return `${fmt(startISO)} – ${fmt(endISO)}`;
}

function shiftAnchor(anchorISO: string, weeks: number): string {
  const [y, m, d] = anchorISO.split("-").map(Number);
  const dt = new Date(y, (m ?? 1) - 1, d ?? 1);
  dt.setDate(dt.getDate() + weeks * 7);
  const yy = dt.getFullYear();
  const mm = String(dt.getMonth() + 1).padStart(2, "0");
  const dd = String(dt.getDate()).padStart(2, "0");
  return `${yy}-${mm}-${dd}`;
}

function WeeklyGraphSheet({
  open,
  onClose,
  initialAnchor,
  macroReview,
}: {
  open: boolean;
  onClose: () => void;
  initialAnchor: string;
  macroReview: MacroAdjustmentReview | null;
}) {
  const [anchor, setAnchor] = useState(initialAnchor);
  const [data, setData] = useState<WeeklyNutritionInsight | null>(null);
  const [loading, setLoading] = useState(false);
  const fetchWeekly = useServerFn(getWeeklyNutritionInsight);

  // Re-sync anchor whenever the sheet opens from a (possibly new) selectedDate.
  useEffect(() => {
    if (open) setAnchor(initialAnchor);
  }, [open, initialAnchor]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    fetchWeekly({ data: { anchorDate: anchor } } as any)
      .then((d) => { if (!cancelled) setData(d); })
      .catch(() => { if (!cancelled) setData(null); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [open, anchor, fetchWeekly]);

  // Close on Escape.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  const todayISO = todayLocalISO();
  // "This week" anchor (today). Next-week disabled when anchor is in current week.
  const currentWeekAnchor = todayISO;
  const isCurrentOrFutureWeek = data ? data.week_end_date >= currentWeekAnchor : true;

  const rangeLabel = data ? formatRangeLabel(data.week_start_date, data.week_end_date) : "";
  const isThisWeek = data ? data.week_start_date <= todayISO && todayISO <= data.week_end_date : false;

  return (
    <div className="fixed inset-0 z-[80] flex items-end" role="dialog" aria-modal="true">
      {/* Backdrop */}
      <button
        aria-label="Close"
        onClick={onClose}
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
      />
      {/* Sheet */}
      <div
        className="relative w-full bg-bg-1 rounded-t-3xl border-t border-white/10 max-h-[88vh] flex flex-col"
        style={{ paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 12px)" }}
      >
        <div className="flex items-center justify-center pt-2.5">
          <span className="h-1 w-10 rounded-full bg-white/20" />
        </div>
        <div className="px-5 pt-3 pb-2 flex items-start justify-between">
          <div className="min-w-0">
            <p className="text-[17px] font-semibold text-white tracking-tight">Weekly adherence</p>
            <p className="mt-0.5 text-[12px] text-text-tertiary">{rangeLabel || "Loading…"}</p>
          </div>
          <button
            onClick={onClose}
            aria-label="Close weekly graph"
            className="h-8 w-8 rounded-full flex items-center justify-center bg-white/5 border border-white/10 text-text-secondary active:scale-95 transition"
          >
            <X size={16} />
          </button>
        </div>

        {/* Week nav */}
        <div className="mx-5 mt-1 flex items-center justify-between rounded-2xl bg-bg-2 border border-white/5 px-1.5 py-1">
          <button
            onClick={() => setAnchor(shiftAnchor(anchor, -1))}
            aria-label="Previous week"
            className="p-2 rounded-full text-text-secondary active:scale-95 transition"
          >
            <ChevronLeft size={18} />
          </button>
          <span className="text-[13px] font-semibold text-white">
            {isThisWeek ? "This week" : rangeLabel}
          </span>
          <button
            onClick={() => setAnchor(shiftAnchor(anchor, 1))}
            disabled={isCurrentOrFutureWeek}
            aria-label="Next week"
            className="p-2 rounded-full text-text-secondary active:scale-95 transition disabled:opacity-30 disabled:active:scale-100"
          >
            <ChevronRight size={18} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 pt-4">
          {/* 🧊 Early-signal banner when fewer than 3 days are logged this week. */}
          {data && data.logged_days < 3 && data.logged_days > 0 && (
            <div className="mb-4 rounded-2xl px-4 py-3 text-[12px] text-text-secondary"
              style={{ background: "rgba(59,130,246,0.08)", border: "1px solid rgba(59,130,246,0.20)" }}>
              <span className="text-[13px]">🧊 Early signal</span>
              <span className="ml-2">Log {Math.max(1, 3 - data.logged_days)} more day{3 - data.logged_days === 1 ? "" : "s"} to unlock a reliable weekly pattern.</span>
            </div>
          )}
          {loading && !data ? (
            <div className="py-12 flex justify-center">
              <Loader2 size={18} className="animate-spin text-text-tertiary" />
            </div>
          ) : data ? (
            <>
              <WeeklyGraphContent data={data} />
              <div className="mt-5">
                <MacroReviewCard review={macroReview} compact />
              </div>
            </>
          ) : (
            <p className="py-8 text-center text-[12px] text-text-tertiary">
              Couldn't load this week.
            </p>
          )}
        </div>

      </div>
    </div>
  );
}

function WeeklyGraphContent({ data }: { data: WeeklyNutritionInsight }) {
  const { days, avg_target_calories, logged_days, calorie_on_target_days, protein_hit_days, avg_calories, confidence_label, decision_insight } = data;

  // Y-scale uses consumed_calories (same source as summary + target line),
  // not the macro Atwater sum, so bars, "Average calories", and the target
  // dashed line all share one scale.
  const maxConsumed = Math.max(...days.map((d) => d.consumed_calories), 0);
  const tgt = avg_target_calories ?? 0;
  const yMax = Math.max(maxConsumed * 1.05, tgt * 1.15, 800);

  // Detect target variance across logged days.
  const uniqTargets = new Set(
    days
      .filter((d) => d.target_calories != null)
      .map((d) => d.target_calories as number),
  );
  const targetsVary = uniqTargets.size > 1;
  const targetLabel = targetsVary ? "Avg target" : "Target";

  const hasAnyLoggedMeals = days.some((d) => d.has_logged_meals && d.consumed_calories > 0);

  return (
    <div className="space-y-5">
      {/* Chart header */}
      <div>
        <p className="text-[13px] font-semibold text-white">Macro calories by day</p>
        <p className="mt-0.5 text-[11px] text-text-tertiary leading-snug">
          Protein, carbs, and fat stacked against your calorie target.
        </p>
      </div>

      {/* Legend */}
      <div className="flex items-center justify-center gap-4 text-[11px] text-text-secondary">
        <LegendDot color="#F59E0B" label="Protein" />
        <LegendDot color="#10B981" label="Carbs" />
        <LegendDot color="#3B82F6" label="Fat" />
      </div>

      {/* Chart */}
      <StackedBarChart
        days={days}
        yMax={yMax}
        target={avg_target_calories}
        targetLabel={targetLabel}
        empty={!hasAnyLoggedMeals}
      />

      {/* Summary metrics */}
      <div className="grid grid-cols-2 gap-2">
        <MetricCard
          label="Average calories"
          value={avg_calories > 0 ? avg_calories.toLocaleString() : "—"}
          sub={avg_target_calories != null ? `of ${avg_target_calories.toLocaleString()} target` : "no target set"}
        />
        <MetricCard
          label="Target days"
          value={logged_days > 0 ? `${calorie_on_target_days} of ${logged_days}` : "—"}
          sub="days within range"
        />
        <MetricCard
          label="Protein"
          value={logged_days > 0 ? `${protein_hit_days} of ${logged_days}` : "—"}
          sub="days hit"
        />
        <MetricCard
          label="Confidence"
          value={confidence_label === "low" ? "Low" : "OK"}
          sub={confidence_label === "low" ? "until 3 logged days" : `${logged_days} days logged`}
        />
      </div>

      {/* Diagnosis */}
      <div className="rounded-2xl bg-white/[0.03] border border-white/5 px-4 py-3">
        <p className="text-[11px] uppercase tracking-wider text-text-tertiary">Insight</p>
        <p className="mt-1 text-[13px] text-text-secondary leading-snug">{decision_insight}</p>
      </div>
    </div>
  );
}

function LegendDot({ color, label }: { color: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="h-2 w-2 rounded-full" style={{ background: color }} />
      <span>{label}</span>
    </span>
  );
}

function StackedBarChart({
  days,
  yMax,
  target,
  targetLabel = "Target",
  empty = false,
}: {
  days: WeeklyDay[];
  yMax: number;
  target: number | null;
  targetLabel?: string;
  empty?: boolean;
}) {
  const W = 320;
  const H = 180;
  const padL = 28;
  const padR = 8;
  const padT = 12;
  const padB = 22;
  const innerW = W - padL - padR;
  const innerH = H - padT - padB;
  const slot = innerW / 7;
  const barW = Math.min(22, slot * 0.55);

  const y = (cal: number) => padT + innerH - (cal / yMax) * innerH;
  const targetY = target != null && target > 0 ? y(target) : null;

  return (
    <div className="relative rounded-2xl bg-bg-2 border border-white/5 p-3">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto">
        {/* baseline */}
        <line x1={padL} x2={W - padR} y1={padT + innerH} y2={padT + innerH} stroke="rgba(255,255,255,0.08)" />
        {/* Target line */}
        {targetY != null && (
          <>
            <line
              x1={padL}
              x2={W - padR}
              y1={targetY}
              y2={targetY}
              stroke="rgba(255,255,255,0.35)"
              strokeDasharray="3 3"
            />
            <text x={W - padR} y={targetY - 4} textAnchor="end" className="fill-text-tertiary" style={{ fontSize: 9 }}>
              {targetLabel} {target?.toLocaleString()}
            </text>
          </>
        )}
        {/* Bars */}
        {days.map((d, i) => {
          const cx = padL + slot * i + slot / 2;
          const bx = cx - barW / 2;
          if (!d.has_logged_meals || d.consumed_calories <= 0) {
            // Empty placeholder
            return (
              <g key={d.entry_date}>
                <rect
                  x={bx}
                  y={padT + innerH - 4}
                  width={barW}
                  height={4}
                  rx={2}
                  fill={d.in_future ? "rgba(255,255,255,0.04)" : "rgba(255,255,255,0.08)"}
                />
                <text x={cx} y={H - 6} textAnchor="middle" className="fill-text-tertiary" style={{ fontSize: 10 }}>
                  {d.weekday_label[0]}
                </text>
              </g>
            );
          }
          // Bar total height comes from consumed_calories (estimated_calories sum).
          // Segment proportions come from macro calorie share so the stack story
          // stays accurate even when the LLM's kcal differs slightly from p*4+c*4+f*9.
          const barTotalH = (d.consumed_calories / yMax) * innerH;
          const macroTotal = d.macro_total_calories;
          const segs =
            macroTotal > 0
              ? [
                  { v: (d.protein_calories / macroTotal) * barTotalH, color: "#F59E0B" },
                  { v: (d.carb_calories / macroTotal) * barTotalH,    color: "#10B981" },
                  { v: (d.fat_calories / macroTotal) * barTotalH,     color: "#3B82F6" },
                ]
              : [
                  // Calories present but no macro breakdown — neutral bar fallback.
                  { v: barTotalH, color: "rgba(255,255,255,0.25)" },
                ];
          let cursor = padT + innerH;
          return (
            <g key={d.entry_date}>
              {segs.map((s, idx) => {
                if (s.v <= 0) return null;
                cursor -= s.v;
                const isTop = idx === segs.length - 1 || segs.slice(idx + 1).every((x) => x.v <= 0);
                const isBottom = idx === 0 || segs.slice(0, idx).every((x) => x.v <= 0);
                const rx = isTop || isBottom ? 3 : 0;
                return (
                  <rect
                    key={idx}
                    x={bx}
                    y={cursor}
                    width={barW}
                    height={s.v}
                    rx={rx}
                    fill={s.color}
                    opacity={0.92}
                  />
                );
              })}
              <text x={cx} y={H - 6} textAnchor="middle" className="fill-text-secondary" style={{ fontSize: 10 }}>
                {d.weekday_label[0]}
              </text>
            </g>
          );
        })}
      </svg>
      {empty && (
        <div className="absolute inset-0 flex flex-col items-center justify-center text-center px-6 pointer-events-none">
          <p className="text-[13px] font-semibold text-white">No meals logged this week yet.</p>
          <p className="mt-1 text-[12px] text-text-tertiary">Log meals to see your weekly pattern.</p>
        </div>
      )}
    </div>
  );
}

function MetricCard({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-2xl bg-white/[0.03] border border-white/5 px-3 py-2.5">
      <p className="text-[11px] text-text-tertiary">{label}</p>
      <p className="mt-0.5 text-[16px] font-semibold tabular-nums text-white leading-tight">{value}</p>
      {sub && <p className="text-[11px] text-text-tertiary leading-tight mt-0.5">{sub}</p>}
    </div>
  );
}


// ---------------------------------------------------------------------------
// Next target review — locked/unlocked card (review-only; no Apply in this patch)
// ---------------------------------------------------------------------------

function MacroReviewCard({ review, compact = false }: { review: MacroAdjustmentReview | null; compact?: boolean }) {
  if (!review) return null;
  const locked = review.decision === "Insufficient data";
  const reqDays = review.required_logged_days;
  const reqWeigh = review.required_weigh_ins;
  const haveDays = Math.min(review.logged_days, reqDays);
  const haveWeigh = Math.min(review.weigh_in_count, reqWeigh);

  return (
    <section className={`${compact ? "" : "mx-5 mt-4"} rounded-3xl bg-bg-2 border border-white/5 p-4`}>
      <div className="flex items-center justify-between">
        <p className="text-[10px] uppercase tracking-wider text-text-tertiary">Next target review</p>
        <span className="text-[11px] text-text-tertiary">
          {formatRangeLabel(review.review_week_start, review.review_week_end)}
        </span>
      </div>

      {locked ? (
        <>
          <p className="mt-2 text-[15px] font-semibold text-white">🔒 Target review locked</p>
          <p className="mt-1 text-[12px] text-text-secondary leading-snug">
            Log {reqDays} nutrition days and {reqWeigh} weigh-ins in last week's review window to unlock a reliable adjustment.
          </p>

          <div className="mt-3 grid grid-cols-2 gap-2">
            <ProgressRow label="Nutrition logs" current={review.logged_days} required={reqDays} />
            <ProgressRow label="Weigh-ins" current={review.weigh_in_count} required={reqWeigh} />
          </div>

          {/* 7-day streak — 🔥 = logged that day. */}
          <div className="mt-4">
            <p className="text-[10px] uppercase tracking-wider text-text-tertiary mb-2">Last 7 days</p>
            <div className="flex items-center justify-between">
              {review.last7_logged_days.map((on, i) => {
                const isToday = i === review.last7_logged_days.length - 1;
                return (
                  <div key={i} className="flex flex-col items-center gap-1 flex-1">
                    <span className="text-[16px] leading-none">{on ? "🔥" : "○"}</span>
                    <span className={`text-[10px] ${isToday ? "text-white font-semibold" : "text-text-tertiary"}`}>
                      {isToday ? "Today" : ""}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>

          <p className="mt-3 text-[11px] text-text-tertiary leading-snug">
            {haveDays}/{reqDays} logged · {haveWeigh}/{reqWeigh} weigh-ins
          </p>
        </>
      ) : (
        <>
          <p className="mt-2 text-[15px] font-semibold text-white">
            🔥 {review.decision === "Ready to adjust" ? "Review unlocked" : "Target review ready"}
          </p>
          <p className="mt-2 text-[13px] text-white">
            {review.decision === "Ready to adjust"
              ? `Recommended: ${review.calorie_delta > 0 ? "+" : ""}${review.calorie_delta} kcal`
              : review.decision}
          </p>
          <p className="mt-1 text-[12px] text-text-secondary leading-snug">{review.reason}</p>
          {review.recommended_target_calories != null && review.calorie_delta !== 0 && (
            <p className="mt-2 text-[11px] text-text-tertiary tabular-nums">
              {review.current_target_calories?.toLocaleString() ?? "—"} kcal → {review.recommended_target_calories.toLocaleString()} kcal
            </p>
          )}
          <p className="mt-3 text-[10px] text-text-tertiary">
            Review only · apply targets manually in Settings for now.
          </p>
        </>
      )}
    </section>
  );
}

function ProgressRow({ label, current, required }: { label: string; current: number; required: number }) {
  const done = current >= required;
  const pct = Math.min(100, Math.round((current / required) * 100));
  return (
    <div className="rounded-2xl bg-white/[0.03] border border-white/5 px-3 py-2">
      <p className="text-[11px] text-text-tertiary">{label}</p>
      <p className="mt-0.5 text-[14px] font-semibold tabular-nums text-white">
        {current} <span className="text-text-tertiary text-[12px]">/ {required}</span>
        {done && <span className="ml-1 text-success">✓</span>}
      </p>
      <div className="mt-1.5 h-1 rounded-full bg-white/5 overflow-hidden">
        <div className="h-full" style={{ width: `${pct}%`, background: done ? "#10B981" : "#3B82F6" }} />
      </div>
    </div>
  );
}
