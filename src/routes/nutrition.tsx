import { createFileRoute, Link } from "@tanstack/react-router";
import { ChevronLeft, Loader2, RefreshCw, Droplet } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { AICard } from "@/components/AIOrb";
import { RingChart } from "@/components/RingChart";
import { BottomNav } from "@/components/BottomNav";
import { RefreshStamp } from "@/components/RefreshStamp";
import { HydrationLogModal } from "@/components/LogModals";
import { MealDetailModal } from "@/components/MealDetailModal";
import { useAutoRefreshOnVisible } from "@/hooks/use-auto-refresh";
import { getTodayMacroSummary, type MacroSummary } from "@/lib/macros.functions";
import {
  getTodayMeals,
  getTodayHydration,
  getTodayHydrationEvents,
  setBodyweightKg,
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
  const [macros, setMacros] = useState<MacroSummary | null>(null);
  const [meals, setMeals] = useState<TodayMeal[] | null>(null);
  const [hydration, setHydration] = useState<HydrationSummary | null>(null);
  const [hydrationEvents, setHydrationEvents] = useState<HydrationEvent[]>([]);
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
  const fetchHydrationEvents = useServerFn(getTodayHydrationEvents);
  const saveWeight = useServerFn(setBodyweightKg);

  const reload = async () => {
    setRefreshing(true);
    await Promise.allSettled([
      fetchMacros().then(setMacros),
      fetchMeals().then(setMeals).catch(() => setMeals([])),
      fetchHydration().then(setHydration).catch(() => {}),
      fetchHydrationEvents().then(setHydrationEvents).catch(() => setHydrationEvents([])),
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
                    <span
                      className={`text-5xl font-extrabold leading-none tabular-nums ${cCal > tCal! ? "" : "gradient-text"}`}
                      style={cCal > tCal! ? { color: "#F59E0B" } : undefined}
                    >
                      {cCal.toLocaleString()}
                    </span>
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
            {/* Informational over-target line — keep tone calm and factual,
                consistent with other nutrition copy in the app. */}
            {hasTarget && hasMeals && cCal > tCal! && (
              <p className="mt-2 text-[12px]" style={{ color: "#F59E0B" }}>
                {(cCal - tCal!).toLocaleString()} kcal over today's target
              </p>
            )}
          </div>
        </div>
        {hasTarget && (() => {
          const ratio = tCal! > 0 ? cCal / tCal! : 0;
          const over = ratio > 1;
          // Bar fills to 100% at target, then shifts to amber to flag the overage
          // without becoming alarming. No red — copy elsewhere stays informational.
          const barColor = over ? "#F59E0B" : undefined;
          const widthPct = Math.min(100, Math.round(ratio * 100));
          return (
            <div className="mt-4 h-1.5 rounded-full bg-white/5 overflow-hidden">
              <div
                className={over ? "h-full" : "h-full gradient-brand"}
                style={{ width: `${widthPct}%`, background: barColor }}
              />
            </div>
          );
        })()}
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
      <HydrationCard
        hydration={hydration}
        onLog={() => setHydrationOpen(true)}
        onSetWeight={async (kg) => {
          try {
            await saveWeight({ data: { weight_kg: kg } });
            toast.success("Weight saved");
            await reload();
          } catch (e) { toast.error(e instanceof Error ? e.message : "Could not save"); }
        }}
      />

      {hasTarget && hasMeals && proteinShort >= 20 && (
        <div className="mx-5 mt-4">
          <AICard>
            You're <span className="text-text-primary font-semibold">{proteinShort}g short on protein</span>. Add a high-protein snack before 8pm to hit your{goalText ? ` ${goalText}` : ""} target.
          </AICard>
        </div>
      )}

      <HydrationInsight hydration={hydration} />

      <section className="mx-5 mt-5">
        <div className="flex items-center justify-between mb-2">
          <p className="text-xs uppercase tracking-wider text-text-tertiary">Today</p>
          <p className="text-[11px] text-text-accent">Tap + below to log a meal</p>
        </div>
        <UnifiedTimeline meals={meals} hydration={hydrationEvents} onOpenMeal={setOpenMeal} />
      </section>


      <BottomNav onLogged={reload} />
      <HydrationLogModal open={hydrationOpen} onClose={() => setHydrationOpen(false)} onSaved={reload} />
      <MealDetailModal meal={openMeal} onClose={() => setOpenMeal(null)} />
    </div>
  );
}

function Macro({ label, v, t, color, hasMeals }: { label: string; v: number; t: number; color: string; hasMeals: boolean }) {
  const rawPct = t > 0 ? Math.round((v / t) * 100) : 0;
  const pct = t > 0 ? Math.min(100, rawPct) : 0;
  // Flag a meaningful per-macro overage (>10%) with amber, matching the
  // calorie bar treatment. Same calm, informational tone.
  const over = t > 0 && hasMeals && rawPct > 110;
  const ringColor = over ? "#F59E0B" : color;
  return (
    <div className="flex flex-col items-center gap-1">
      <RingChart size={56} stroke={5} rings={[{ value: pct, color: ringColor }]} centerLabel={hasMeals ? `${rawPct}%` : "—"} />
      <p className="text-[11px] font-semibold mt-1">{label}</p>
      <p className="text-[10px]" style={{ color: over ? "#F59E0B" : undefined }}>
        {hasMeals ? `${v}/${t || "—"}g${over ? ` · +${v - t}g` : ""}` : `${t || "—"}g target`}
      </p>
    </div>
  );
}

function HydrationCard({
  hydration,
  onLog,
  onSetWeight,
}: {
  hydration: HydrationSummary | null;
  onLog: () => void;
  onSetWeight: (kg: number) => void | Promise<void>;
}) {
  const consumed = hydration?.consumed_ml ?? 0;
  const target = hydration?.target_ml ?? null;
  const pct = target ? Math.min(100, Math.round((consumed / target) * 100)) : 0;
  const liters = (ml: number) => (ml / 1000).toFixed(ml >= 1000 ? 1 : 2);
  const [editingWeight, setEditingWeight] = useState(false);
  const [w, setW] = useState("");
  const [unit, setUnit] = useState<"kg" | "lb">("kg");

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
            <p className="mt-1 text-[12px] text-text-secondary">Add your weight to see a target.</p>
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

      {!target && !editingWeight && (
        <button
          onClick={() => setEditingWeight(true)}
          className="mt-4 w-full rounded-xl py-2.5 text-[13px] font-semibold text-white active:scale-95"
          style={{ background: "linear-gradient(135deg, rgba(59,130,246,0.85), rgba(6,182,212,0.85))" }}
        >Add weight</button>
      )}
      {!target && editingWeight && (
        <div className="mt-4 rounded-xl p-3 flex items-center gap-2" style={{ background: "#0A0E1A", border: "1px solid rgba(255,255,255,0.06)" }}>
          <input
            type="number" inputMode="decimal"
            value={w} onChange={(e) => setW(e.target.value)}
            placeholder="Weight" autoFocus
            className="flex-1 bg-transparent text-base text-white focus:outline-none px-2"
          />
          <div className="inline-flex rounded-full bg-bg-1 border border-white/10 p-0.5">
            {(["kg", "lb"] as const).map((u) => (
              <button key={u} onClick={() => setUnit(u)} className={`px-2.5 py-1 text-[11px] rounded-full ${unit === u ? "gradient-brand text-white" : "text-text-tertiary"}`}>{u}</button>
            ))}
          </div>
          <button
            onClick={() => {
              const n = Number(w);
              if (!isFinite(n) || n <= 0) return;
              const kg = unit === "kg" ? n : n * 0.45359237;
              setEditingWeight(false);
              setW("");
              void onSetWeight(Math.round(kg * 10) / 10);
            }}
            className="rounded-full px-3 py-1.5 text-[12px] font-semibold text-white gradient-brand active:scale-95"
          >Save</button>
        </div>
      )}

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
function UnifiedTimeline({
  meals, hydration, onOpenMeal,
}: {
  meals: TodayMeal[] | null;
  hydration: HydrationEvent[];
  onOpenMeal: (m: TodayMeal) => void;
}) {
  if (meals == null) {
    return (
      <div className="rounded-2xl bg-bg-2 border border-white/5 p-5 flex justify-center">
        <Loader2 size={16} className="animate-spin text-text-tertiary" />
      </div>
    );
  }
  if (meals.length === 0 && hydration.length === 0) {
    return (
      <div className="rounded-2xl bg-bg-2 border border-white/5 p-5">
        <p className="text-sm text-text-secondary">Nothing logged yet today. Tap the + in the nav below to log a meal, or use Log water above.</p>
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
          <button
            key={`m-${r.meal.id}`}
            onClick={() => onOpenMeal(r.meal)}
            className="w-full text-left rounded-2xl bg-bg-2 border border-white/5 p-4 active:scale-[0.99] transition"
          >
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="text-sm font-semibold truncate">{r.meal.meal_description || "Photo meal"}</p>
                <p className="text-[11px] text-text-tertiary">
                  {fmtTime(r.ts)}
                  {r.meal.estimated_calories != null ? ` · ${Math.round(r.meal.estimated_calories)} kcal` : ""}
                </p>
              </div>
              <p className="font-mono text-sm tabular-nums text-text-secondary shrink-0">
                {r.meal.claude_score_status === "scored" && r.meal.claude_quality_score != null
                  ? `${r.meal.claude_quality_score}/100`
                  : "scoring…"}
              </p>
            </div>
          </button>
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

