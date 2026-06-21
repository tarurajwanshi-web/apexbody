import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState, useCallback, useMemo, useRef, type ReactNode } from "react";
import { ChevronLeft, Lock, Check, Dumbbell, Sparkles, X, ChevronDown, ChevronUp, Zap, Camera, Trash2, Loader2, RefreshCw } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { BottomNav } from "@/components/BottomNav";
import { AICard } from "@/components/AIOrb";
import { RefreshStamp } from "@/components/RefreshStamp";
import { useAutoRefreshOnVisible } from "@/hooks/use-auto-refresh";
import { toast } from "sonner";
import { WorkoutLogModal } from "@/components/LogModals";

export const Route = createFileRoute("/workouts")({
  head: () => ({ meta: [{ title: "Workouts — APEX" }] }),
  component: WorkoutsPage,
});

type Exercise = { name: string; sets: number; reps: string; rest_seconds: number; cue?: string };
type DayPlan = { day: number; day_name: string; session_name: string | null; rest: boolean; exercises: Exercise[] };
type Plan = { days: DayPlan[] };
type WeeklyPlan = { id: string; week_start_date: string; unlock_date: string; is_locked: boolean; plan_data: Plan };
type SetLog = { id?: string; exercise_name: string; set_number: number; reps_completed: number | null; weight_kg: number | null; completed: boolean; entry_date?: string };

const DAY_NAMES = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

function todayISO() { return new Date().toISOString().slice(0, 10); }
function todayMondayIndex(): number {
  const js = new Date().getDay(); // 0 Sun .. 6 Sat
  return (js + 6) % 7;
}

function WorkoutsPage() {
  const [loading, setLoading] = useState(true);
  const [plan, setPlan] = useState<WeeklyPlan | null>(null);
  const [setLogs, setSetLogs] = useState<SetLog[]>([]);
  const [weekLogs, setWeekLogs] = useState<SetLog[]>([]);
  const [cueEx, setCueEx] = useState<Exercise | null>(null);
  const [expanded, setExpanded] = useState<Record<number, boolean>>({});
  const [preCheckOpen, setPreCheckOpen] = useState(false);
  const [sessionStarted, setSessionStarted] = useState(false);
  const [freeformOpen, setFreeformOpen] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [lastUpdatedAt, setLastUpdatedAt] = useState<number | null>(null);
  const [ptrDelta, setPtrDelta] = useState(0);
  const ptrRef = useRef<HTMLDivElement>(null);
  const ptrStart = useRef<number | null>(null);
  const todayIdx = todayMondayIndex();

  const loadAll = useCallback(async () => {
    setLoading((prev) => prev); // no-op to keep prior behavior on first call
    setRefreshing(true);
    try {
      const { data: u } = await supabase.auth.getUser();
      const uid = u.user?.id;
      if (!uid) return;
      const { data: planRow } = await supabase
        .from("weekly_plans")
        .select("*")
        .eq("user_id", uid)
        .order("week_start_date", { ascending: false })
        .limit(1)
        .maybeSingle();
      setPlan(planRow as any);

      // Cue upgrade: backfill if any cue missing OR plan still on cue_version<2
      // (sharp single-correction cues, Prompt D+E). Then fire a one-time wger
      // image sync so the cue card can render a reference image.
      const days = (planRow as any)?.plan_data?.days ?? [];
      const cueVer = Number((planRow as any)?.plan_data?.cue_version ?? 1);
      const missingCues = days.some((d: DayPlan) =>
        !d.rest && (d.exercises ?? []).some((ex) => !ex.cue || !ex.cue.trim()),
      );
      if (missingCues || cueVer < 2) {
        void supabase.functions
          .invoke("backfill-cues", { body: { user_id: uid, force: cueVer < 2 } })
          .then(({ data }) => { if (data?.ok) void reloadPlanOnly(uid); })
          .catch(() => {});
      }
      // Collect unique exercise names and trigger a (no-op if already cached) sync.
      const allNames = new Set<string>();
      for (const d of days) for (const ex of d?.exercises ?? []) if (ex?.name) allNames.add(ex.name);
      if (allNames.size > 0) {
        void supabase.functions
          .invoke("sync-exercise-images", { body: { names: Array.from(allNames) } })
          .catch(() => {});
      }

      const { data: logs } = await supabase
        .from("workout_set_logs")
        .select("*")
        .eq("user_id", uid)
        .eq("entry_date", todayISO());
      setSetLogs((logs as any) ?? []);

      const weekStart = new Date();
      weekStart.setDate(weekStart.getDate() - todayMondayIndex());
      const weekStartISO = weekStart.toISOString().slice(0, 10);
      const { data: wlogs } = await supabase
        .from("workout_set_logs")
        .select("*")
        .eq("user_id", uid)
        .gte("entry_date", weekStartISO)
        .lte("entry_date", todayISO());
      setWeekLogs((wlogs as any) ?? []);
    } finally {
      setLoading(false);
      setLastUpdatedAt(Date.now());
      setRefreshing(false);
    }
  }, []);

  useAutoRefreshOnVisible(loadAll, lastUpdatedAt);

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
      if (ptrDelta >= 60) loadAll();
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
  }, [ptrDelta, loadAll]);

  const reloadPlanOnly = useCallback(async (uid: string) => {
    const { data: planRow } = await supabase
      .from("weekly_plans")
      .select("*")
      .eq("user_id", uid)
      .order("week_start_date", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (planRow) setPlan(planRow as any);
  }, []);

  useEffect(() => { loadAll(); }, [loadAll]);

  // Build display order: today first, then tomorrow..end-of-week, then earlier days of this week.
  const orderedDays = useMemo(() => {
    const days = plan?.plan_data?.days ?? [];
    if (days.length === 0) return [] as { idx: number; day: DayPlan }[];
    const order: number[] = [];
    for (let offset = 0; offset < 7; offset++) {
      const idx = (todayIdx + offset) % 7;
      if (days[idx]) order.push(idx);
    }
    return order.map((idx) => ({ idx, day: days[idx] }));
  }, [plan, todayIdx]);

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
        <span className="text-[11px] uppercase tracking-wider text-text-tertiary">This week</span>
        <span className="w-6" />
      </header>

      <div className="px-5 mt-3 flex items-center justify-between">
        <h1 className="text-3xl font-bold">Your Week</h1>
        <RefreshStamp refreshing={refreshing} lastUpdatedAt={lastUpdatedAt} />
      </div>

      {loading && <p className="px-5 mt-10 text-sm text-text-tertiary">Loading…</p>}

      {!loading && !plan && (
        <div className="mx-5 mt-8 rounded-2xl bg-bg-2 border border-white/5 p-5">
          <p className="text-sm text-text-secondary">No plan yet. Finish onboarding to generate your weekly plan.</p>
        </div>
      )}

      {!loading && plan && (
        <>
          <LockBanner plan={plan} />
          <VolumeNudge plan={plan} weekLogs={weekLogs} todayIdx={todayIdx} />

          {/* Start Today's Workout — opens pre-workout readiness sheet.
              Rest days still expose an opt-in "Train anyway" path so users
              who want to lift on a scheduled off day aren't blocked. The
              freeform path reuses the same pre-check + set-logger flow; sets
              get logged under the generic "Freeform session" name so the
              weekly-plan structure isn't disturbed. */}
          {(() => {
            const todayDay = plan.plan_data?.days?.[todayIdx];
            if (!todayDay) return null;
            if (sessionStarted) return null;
            if (todayDay.rest) {
              return (
                <div className="mx-5 mt-4 rounded-2xl p-4" style={{ background: "rgba(124,58,237,0.06)", border: "1px solid rgba(124,58,237,0.25)" }}>
                  <p className="text-[13px] text-text-primary">Today is a scheduled rest day.</p>
                  <p className="text-[11px] text-text-tertiary mt-1">Listening to your body matters more than the calendar — train anyway if you're feeling it.</p>
                  <button
                    onClick={() => setFreeformOpen(true)}
                    className="mt-3 w-full rounded-2xl py-3 text-[13px] font-semibold text-white active:scale-[0.98] transition"
                    style={{ background: "linear-gradient(90deg, #7C3AED, #3B82F6)" }}
                  >
                    Train anyway →
                  </button>
                </div>
              );
            }
            return (
              <div className="mx-5 mt-4">
                <button
                  onClick={() => setPreCheckOpen(true)}
                  className="w-full rounded-2xl gradient-brand py-3.5 text-[14px] font-semibold text-white active:scale-[0.98] transition"
                >
                  Start workout →
                </button>
              </div>
            );
          })()}

          <div className="mx-5 mt-4 space-y-3">
            {orderedDays.map(({ idx, day }, position) => {
              const isToday = position === 0;
              return (
                <DayCard
                  key={idx}
                  dayIdx={idx}
                  day={day}
                  isToday={isToday}
                  expanded={isToday || !!expanded[idx]}
                  onToggle={isToday ? undefined : () => setExpanded((m) => ({ ...m, [idx]: !m[idx] }))}
                  setLogs={setLogs}
                  onLogged={loadAll}
                  onShowCue={(ex) => setCueEx(ex)}
                />
              );
            })}
          </div>

          <BodyScanSection />
        </>
      )}

      {preCheckOpen && (
        <PreWorkoutCheckSheet
          onClose={() => setPreCheckOpen(false)}
          onSaved={() => { setPreCheckOpen(false); setSessionStarted(true); }}
        />
      )}

      {cueEx && <CueSheet exercise={cueEx} onClose={() => setCueEx(null)} />}

      {/* Rest-day "Train anyway" → reuses the existing strain logger so the
          session still feeds the Training pillar without disturbing the
          weekly plan structure. Chose freeform-logging over borrowing
          another day's plan to keep this a one-tap path. */}
      <WorkoutLogModal open={freeformOpen} onClose={() => setFreeformOpen(false)} onSaved={() => { setFreeformOpen(false); loadAll(); }} />

      <BottomNav />
    </div>
  );
}

function VolumeNudge({ plan, weekLogs, todayIdx }: { plan: WeeklyPlan; weekLogs: SetLog[]; todayIdx: number }) {
  const days = plan.plan_data?.days ?? [];
  let plannedThroughToday = 0;
  for (let i = 0; i <= todayIdx; i++) {
    const d = days[i];
    if (!d || d.rest) continue;
    for (const ex of d.exercises ?? []) plannedThroughToday += ex.sets;
  }
  const completed = weekLogs.filter((l) => l.completed).length;
  if (plannedThroughToday === 0) return null;
  const gap = plannedThroughToday - completed;
  let nextDayLabel = "your next session";
  for (let i = todayIdx + 1; i < days.length; i++) {
    if (!days[i].rest) { nextDayLabel = days[i].day_name || DAY_NAMES[i]; break; }
  }
  let msg: ReactNode;
  if (gap >= 4) {
    msg = <>You're <span className="text-text-primary font-semibold">{gap} sets behind plan</span> this week. Add an extra set or two on {nextDayLabel} to catch up.</>;
  } else if (gap >= 1) {
    msg = <>You're <span className="text-text-primary font-semibold">{gap} {gap === 1 ? "set" : "sets"} short</span> of plan through today. Knock them out before {nextDayLabel}.</>;
  } else {
    msg = <>You're <span className="text-text-primary font-semibold">on track</span> — {completed}/{plannedThroughToday} planned sets logged this week. Keep it up.</>;
  }
  return <div className="mx-5 mt-4"><AICard>{msg}</AICard></div>;
}

function CueSheet({ exercise, onClose }: { exercise: Exercise; onClose: () => void }) {
  // z-[120] sits above BottomNav (z-50) and standard modals (z-[100]).
  return (
    <div className="fixed inset-0 z-[120] bg-black/70 flex items-center justify-center px-4" onClick={onClose}>
      <div
        className="w-full max-w-[420px] mx-auto bg-bg-2 rounded-3xl border border-white/10 p-6 animate-fade-up shadow-2xl max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-1.5">
              <Zap size={12} className="text-ai" fill="currentColor" />
              <p className="text-[10px] uppercase tracking-wider text-ai font-semibold">Exercise cue</p>
            </div>
            <h3 className="mt-1 text-xl font-bold">{exercise.name}</h3>
            <p className="text-[12px] text-text-tertiary mt-0.5">{exercise.sets}×{exercise.reps} · {exercise.rest_seconds}s rest</p>
          </div>
          <button onClick={onClose} className="text-text-tertiary p-1"><X size={18} /></button>
        </div>
        {/* wger reference image, lazily resolved per exercise. Missing image
         *  renders nothing (no broken-icon placeholder). */}
        <ExerciseRefImage exerciseName={exercise.name} />
        <div className="mt-4 rounded-xl p-4" style={{ background: "linear-gradient(135deg, rgba(124,58,237,0.10), rgba(59,130,246,0.08))", border: "1px solid rgba(124,58,237,0.25)" }}>
          <div className="flex items-start gap-2">
            <Sparkles size={14} className="text-ai shrink-0 mt-0.5" />
            <p className="text-[13px] leading-relaxed">
              {exercise.cue && exercise.cue.trim().length > 0
                ? exercise.cue
                : "Guidance is being generated for this plan. Check back in a moment."}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

function ExerciseRefImage({ exerciseName }: { exerciseName: string }) {
  const [state, setState] = useState<{ url: string; author: string | null; license: string | null } | null>(null);
  const [tried, setTried] = useState(false);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const key = exerciseName.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
      const { data: row } = await supabase
        .from("exercise_image_cache")
        .select("storage_path, license, license_author")
        .eq("exercise_name_key", key)
        .maybeSingle();
      if (!row?.storage_path) { if (!cancelled) setTried(true); return; }
      const { data: signed } = await supabase.storage.from("exercise-images").createSignedUrl(row.storage_path, 3600);
      if (cancelled) return;
      if (signed?.signedUrl) {
        setState({ url: signed.signedUrl, author: row.license_author ?? null, license: row.license ?? "CC BY-SA 4.0" });
      }
      setTried(true);
    })();
    return () => { cancelled = true; };
  }, [exerciseName]);
  if (!state) return tried ? null : <div className="mt-4 h-32 rounded-xl bg-white/[0.03] animate-pulse" />;
  return (
    <div className="mt-4">
      <img
        src={state.url}
        alt={`Reference image for ${exerciseName}`}
        className="w-full max-h-56 object-contain rounded-xl bg-white"
        loading="lazy"
      />
      <p className="mt-1 text-[10px] text-text-tertiary text-right">
        Image: wger.de{state.author ? `, ${state.author}` : ""} · {state.license ?? "CC BY-SA 4.0"}
      </p>
    </div>
  );
}

function LockBanner({ plan }: { plan: WeeklyPlan }) {
  const locked = plan.is_locked && new Date() < new Date(plan.unlock_date + "T00:00:00Z");
  if (!locked) return null;
  return (
    <section className="mx-5 mt-4 rounded-2xl p-4 flex items-start gap-3"
      style={{ background: "linear-gradient(135deg, rgba(124,58,237,0.10), rgba(59,130,246,0.08))", border: "1px solid rgba(124,58,237,0.25)" }}>
      <Lock size={16} className="text-ai shrink-0 mt-0.5" />
      <div>
        <p className="text-sm font-semibold">Week 1 — Your baseline program</p>
        <p className="mt-0.5 text-[12px] text-text-secondary">
          Adapts starting {plan.unlock_date} based on your performance.
        </p>
      </div>
    </section>
  );
}

function DayCard({
  dayIdx, day, isToday, expanded, onToggle, setLogs, onLogged, onShowCue,
}: {
  dayIdx: number; day: DayPlan; isToday: boolean;
  expanded: boolean; onToggle?: () => void;
  setLogs: SetLog[]; onLogged: () => void; onShowCue: (ex: Exercise) => void;
}) {
  const label = day.day_name || DAY_NAMES[dayIdx] || `Day ${dayIdx + 1}`;
  const totalSets = day.rest ? 0 : (day.exercises ?? []).reduce((s, ex) => s + ex.sets, 0);
  const titleText = day.rest ? "Rest day" : (day.session_name ?? "Training");
  const collapsedHint = day.rest ? "Rest day" : `${titleText} — ${totalSets} sets`;

  // Collapsed header (tap to expand for non-today days).
  const Header = (
    <div className="flex items-center justify-between gap-3">
      <div className="min-w-0">
        <p className="text-[10px] uppercase tracking-wider text-text-tertiary">
          {label}{isToday && " · Today"}
        </p>
        {expanded ? (
          <p className="mt-1 font-semibold text-[15px] truncate">{titleText}</p>
        ) : (
          <p className="mt-1 text-[13px] text-text-secondary truncate">{collapsedHint}</p>
        )}
      </div>
      {onToggle && (
        <span className="text-text-tertiary shrink-0">
          {expanded ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
        </span>
      )}
    </div>
  );

  return (
    <div className={`rounded-2xl border p-4 ${isToday ? "border-ai/40" : "border-white/5"} bg-bg-2`}>
      {onToggle ? (
        <button type="button" onClick={onToggle} className="w-full text-left active:opacity-80">
          {Header}
        </button>
      ) : Header}

      {expanded && !day.rest && day.exercises?.length > 0 && (
        <ul className="mt-3 space-y-1.5">
          {day.exercises.map((ex, i) => (
            <li key={i}>
              <button
                type="button"
                onClick={() => onShowCue(ex)}
                className="w-full text-[13px] text-text-secondary flex justify-between items-center py-1 active:opacity-70"
              >
                <span className="flex items-center gap-2 text-left">
                  <span
                    className="inline-flex items-center justify-center h-5 w-5 rounded-full shrink-0"
                    style={{
                      background: "linear-gradient(135deg, #7C3AED 0%, #3B82F6 100%)",
                      boxShadow: "0 0 8px rgba(124,58,237,0.35)",
                    }}
                    aria-label="Tap for cue"
                  >
                    <Zap size={11} className="text-white" fill="white" strokeWidth={2.5} />
                  </span>
                  <span>{ex.name}</span>
                </span>
                <span className="text-text-tertiary tabular-nums">{ex.sets}×{ex.reps}</span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {isToday && !day.rest && day.exercises?.length > 0 && (
        <div className="mt-4 pt-4 border-t border-white/5">
          <p className="text-[10px] uppercase tracking-wider text-text-tertiary mb-3">Log your sets</p>
          {day.exercises.map((ex) => (
            <ExerciseLogger key={ex.name} exercise={ex} setLogs={setLogs} onLogged={onLogged} dayPlan={day} />
          ))}
        </div>
      )}
    </div>
  );
}

function ExerciseLogger({
  exercise, setLogs, onLogged, dayPlan,
}: { exercise: Exercise; setLogs: SetLog[]; onLogged: () => void; dayPlan: DayPlan }) {
  const [open, setOpen] = useState(false);
  const mine = setLogs.filter((l) => l.exercise_name === exercise.name);
  const doneCount = mine.filter((l) => l.completed).length;

  return (
    <div className="mb-2">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between rounded-xl bg-bg-3/40 px-3 py-2.5 text-left"
      >
        <div className="flex items-center gap-2">
          <Dumbbell size={14} className="text-text-tertiary" />
          <span className="text-[13px] font-medium">{exercise.name}</span>
        </div>
        <span className={`text-[11px] tabular-nums ${doneCount === exercise.sets ? "text-success" : "text-text-tertiary"}`}>
          {doneCount}/{exercise.sets}
        </span>
      </button>
      {open && (
        <div className="mt-2 space-y-1.5">
          {Array.from({ length: exercise.sets }).map((_, i) => (
            <SetRow
              key={i}
              exercise={exercise}
              setNumber={i + 1}
              existing={mine.find((l) => l.set_number === i + 1) ?? null}
              onLogged={onLogged}
              dayPlan={dayPlan}
              allLogs={setLogs}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function SetRow({
  exercise, setNumber, existing, onLogged, dayPlan, allLogs,
}: {
  exercise: Exercise; setNumber: number; existing: SetLog | null; onLogged: () => void;
  dayPlan: DayPlan; allLogs: SetLog[];
}) {
  const [reps, setReps] = useState<string>(existing?.reps_completed?.toString() ?? "");
  const [weight, setWeight] = useState<string>(existing?.weight_kg?.toString() ?? "");
  const [saving, setSaving] = useState(false);
  const done = existing?.completed ?? false;

  const save = async (completed: boolean) => {
    setSaving(true);
    try {
      const { data: u } = await supabase.auth.getUser();
      const uid = u.user?.id;
      if (!uid) throw new Error("Not signed in");
      const row = {
        user_id: uid,
        entry_date: todayISO(),
        exercise_name: exercise.name,
        set_number: setNumber,
        reps_completed: reps === "" ? null : Number(reps),
        weight_kg: weight === "" ? null : Number(weight),
        completed,
      };
      const { error } = await supabase
        .from("workout_set_logs")
        .upsert(row, { onConflict: "user_id,entry_date,exercise_name,set_number" });
      if (error) throw error;
      onLogged();
      if (completed) await maybeWriteTrainingSummary(dayPlan, allLogs, row);
    } catch (e: any) {
      toast.error(e?.message ?? "Save failed");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className={`flex items-center gap-2 rounded-lg px-2 py-1.5 ${done ? "bg-success/10" : "bg-bg-3/30"}`}>
      <span className="w-6 text-[11px] text-text-tertiary tabular-nums">#{setNumber}</span>
      <input
        type="number" inputMode="decimal" placeholder={exercise.reps.split("-")[0]}
        value={reps} onChange={(e) => setReps(e.target.value)}
        className="w-14 bg-transparent text-sm text-right focus:outline-none"
      />
      <span className="text-[10px] text-text-tertiary">reps</span>
      <input
        type="number" inputMode="decimal" placeholder="kg"
        value={weight} onChange={(e) => setWeight(e.target.value)}
        className="w-16 bg-transparent text-sm text-right focus:outline-none"
      />
      <span className="text-[10px] text-text-tertiary">kg</span>
      <button
        onClick={() => save(!done)}
        disabled={saving}
        className={`ml-auto h-7 w-7 rounded-md flex items-center justify-center ${done ? "bg-success text-white" : "bg-bg-3 text-text-tertiary"}`}
      >
        <Check size={14} />
      </button>
    </div>
  );
}

async function maybeWriteTrainingSummary(
  dayPlan: DayPlan,
  _priorLogs: SetLog[],
  _justSaved: SetLog,
) {
  const { data: u } = await supabase.auth.getUser();
  const uid = u.user?.id;
  if (!uid) return;
  const date = todayISO();

  const { data: logs } = await supabase
    .from("workout_set_logs")
    .select("*")
    .eq("user_id", uid)
    .eq("entry_date", date);
  const list = (logs as SetLog[]) ?? [];

  const totalRequired = dayPlan.exercises.reduce((s, ex) => s + ex.sets, 0);
  const totalCompleted = list.filter((l) => l.completed).length;
  if (totalCompleted < totalRequired) return;

  let volume = 0;
  for (const l of list) {
    if (!l.completed) continue;
    const reps = Number(l.reps_completed ?? 0);
    const w = Number(l.weight_kg ?? 0);
    volume += w * reps;
  }
  const strain = Math.min(21, Math.round((totalCompleted * 0.6 + volume / 1200) * 10) / 10);

  await supabase
    .from("shield_training_logs")
    .upsert({
      user_id: uid,
      entry_date: date,
      strain_value: strain,
      session_notes: dayPlan.session_name ?? "Session",
    }, { onConflict: "user_id,entry_date" });
}

// ----------------- Pre-workout readiness check -----------------
// Single-tap 1-5 scale; saves to pre_session_checks.
const READINESS_OPTIONS: { value: number; emoji: string; label: string }[] = [
  { value: 1, emoji: "😞", label: "Poor" },
  { value: 2, emoji: "😕", label: "Low" },
  { value: 3, emoji: "😐", label: "OK" },
  { value: 4, emoji: "🙂", label: "Good" },
  { value: 5, emoji: "🤩", label: "Great" },
];

function PreWorkoutCheckSheet({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [saving, setSaving] = useState(false);

  const save = async (value: number) => {
    setSaving(true);
    try {
      const { data: u } = await supabase.auth.getUser();
      const uid = u.user?.id;
      if (!uid) throw new Error("Not signed in");
      const { error } = await supabase.from("pre_session_checks").insert({
        user_id: uid,
        entry_date: todayISO(),
        session_readiness: value,
      });
      if (error) throw error;
      toast.success("Logged - let's go.");
      onSaved();
    } catch (e: any) {
      toast.error(e?.message ?? "Could not save");
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[120] bg-black/70 flex items-end" onClick={onClose}>
      <div
        className="w-full max-w-[480px] mx-auto bg-bg-2 rounded-t-3xl border-t border-white/10 p-6 animate-fade-up"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="h-1 w-12 rounded-full bg-white/20 mx-auto mb-4" />
        <p className="text-[10px] uppercase tracking-wider text-text-tertiary text-center">Quick check</p>
        <h3 className="mt-1 text-xl font-bold text-center">How do you feel right now?</h3>
        <p className="mt-1 text-[12px] text-text-tertiary text-center">Helps me read today's session honestly.</p>
        <div className="mt-6 grid grid-cols-5 gap-2">
          {READINESS_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              disabled={saving}
              onClick={() => save(opt.value)}
              className="rounded-2xl bg-bg-3/50 border border-white/5 py-3 flex flex-col items-center gap-1 active:scale-95 disabled:opacity-40 transition"
            >
              <span className="text-2xl">{opt.emoji}</span>
              <span className="text-[10px] text-text-tertiary">{opt.label}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

// ----------------- Body Scan (upload only — analysis unlocks Day 7) -----------------
type BodyScan = { id: string; photo_url: string; captured_at: string };

function BodyScanSection() {
  const [scans, setScans] = useState<BodyScan[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const { data: u } = await supabase.auth.getUser();
    const uid = u.user?.id;
    if (!uid) { setLoading(false); return; }
    const { data } = await supabase
      .from("body_scan_photos")
      .select("id, photo_url, captured_at")
      .eq("user_id", uid)
      .order("captured_at", { ascending: false })
      .limit(12);
    setScans((data as BodyScan[]) ?? []);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const upload = async (file: File) => {
    setUploading(true);
    try {
      const { data: u } = await supabase.auth.getUser();
      const uid = u.user?.id;
      if (!uid) throw new Error("Not signed in");
      const ext = file.name.split(".").pop() || "jpg";
      const path = `${uid}/${Date.now()}.${ext}`;
      const { error: upErr } = await supabase.storage.from("body-scans").upload(path, file, {
        contentType: file.type || "image/jpeg",
      });
      if (upErr) throw upErr;
      const { error: insErr } = await supabase
        .from("body_scan_photos")
        .insert({ user_id: uid, photo_url: path });
      if (insErr) throw insErr;
      toast.success("Photo uploaded");
      await load();
    } catch (e: any) {
      toast.error(e?.message ?? "Upload failed");
    } finally {
      setUploading(false);
    }
  };

  const remove = async (scan: BodyScan) => {
    if (!confirm("Delete this photo?")) return;
    await supabase.storage.from("body-scans").remove([scan.photo_url]);
    await supabase.from("body_scan_photos").delete().eq("id", scan.id);
    await load();
  };

  return (
    <section className="mx-5 mt-6">
      <div className="flex items-center justify-between mb-2 ml-1">
        <p className="text-[10px] uppercase tracking-wider text-text-tertiary">Body scan</p>
        <button
          onClick={() => inputRef.current?.click()}
          disabled={uploading}
          className="flex items-center gap-1 text-[11px] text-text-accent font-semibold disabled:opacity-50"
        >
          {uploading ? <Loader2 size={12} className="animate-spin" /> : <Camera size={12} />}
          {uploading ? "Uploading…" : "Add photo"}
        </button>
        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          capture="environment"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) upload(f);
            e.target.value = "";
          }}
        />
      </div>
      <div className="rounded-2xl bg-bg-2 border border-white/5 p-4">
        <p className="text-[12px] text-text-secondary leading-snug">
          Upload photos anytime. Your AI body composition assessment unlocks with Intelligence on Day 7.
        </p>
        {loading ? (
          <div className="mt-3 flex justify-center"><Loader2 size={14} className="animate-spin text-text-tertiary" /></div>
        ) : scans.length === 0 ? null : (
          <div className="mt-3 grid grid-cols-3 gap-2">
            {scans.map((s) => (
              <BodyScanThumb key={s.id} scan={s} onRemove={() => remove(s)} />
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

function BodyScanThumb({ scan, onRemove }: { scan: BodyScan; onRemove: () => void }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    supabase.storage.from("body-scans").createSignedUrl(scan.photo_url, 600).then(({ data }) => {
      if (!cancelled && data?.signedUrl) setUrl(data.signedUrl);
    });
    return () => { cancelled = true; };
  }, [scan.photo_url]);
  return (
    <div className="relative aspect-square rounded-xl overflow-hidden bg-bg-3/40">
      {url ? (
        <img src={url} alt="Body scan" className="absolute inset-0 h-full w-full object-cover" />
      ) : (
        <div className="absolute inset-0 flex items-center justify-center">
          <Loader2 size={14} className="animate-spin text-text-tertiary" />
        </div>
      )}
      <button
        onClick={onRemove}
        className="absolute top-1 right-1 h-6 w-6 rounded-full bg-black/60 flex items-center justify-center text-white active:opacity-80"
        aria-label="Delete photo"
      >
        <Trash2 size={11} />
      </button>
    </div>
  );
}
