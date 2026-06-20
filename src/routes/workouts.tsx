import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState, useCallback } from "react";
import { ChevronLeft, Lock, Check, Dumbbell, Sparkles, X, Info } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { BottomNav } from "@/components/BottomNav";
import { AICard } from "@/components/AIOrb";
import { toast } from "sonner";

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
  // Monday=0..Sunday=6
  const js = new Date().getDay(); // 0 Sun .. 6 Sat
  return (js + 6) % 7;
}

function WorkoutsPage() {
  const [loading, setLoading] = useState(true);
  const [plan, setPlan] = useState<WeeklyPlan | null>(null);
  const [setLogs, setSetLogs] = useState<SetLog[]>([]);
  const [weekLogs, setWeekLogs] = useState<SetLog[]>([]);
  const [cueEx, setCueEx] = useState<Exercise | null>(null);
  const todayIdx = todayMondayIndex();

  const loadAll = useCallback(async () => {
    setLoading(true);
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
      const { data: logs } = await supabase
        .from("workout_set_logs")
        .select("*")
        .eq("user_id", uid)
        .eq("entry_date", todayISO());
      setSetLogs((logs as any) ?? []);

      // Pull this week's logs (Monday → today) for the volume nudge.
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
    }
  }, []);

  useEffect(() => { loadAll(); }, [loadAll]);

  const todaysDay: DayPlan | null = plan?.plan_data?.days?.[todayIdx] ?? null;

  return (
    <div className="min-h-screen bg-bg-1 pb-32">
      <header className="flex items-center justify-between px-5 pt-6">
        <Link to="/dashboard" className="text-text-secondary"><ChevronLeft size={24} /></Link>
        <span className="text-[11px] uppercase tracking-wider text-text-tertiary">This week</span>
        <span className="w-6" />
      </header>

      <div className="px-5 mt-3">
        <h1 className="text-3xl font-bold">Your Week</h1>
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
          <div className="mx-5 mt-4 space-y-3">
            {plan.plan_data?.days?.map((d, i) => (
              <DayCard
                key={i}
                dayIdx={i}
                day={d}
                isToday={i === todayIdx}
                setLogs={setLogs}
                onLogged={loadAll}
              />
            ))}
          </div>
        </>
      )}

      <BottomNav />
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
  dayIdx, day, isToday, setLogs, onLogged,
}: { dayIdx: number; day: DayPlan; isToday: boolean; setLogs: SetLog[]; onLogged: () => void }) {
  const label = day.day_name || DAY_NAMES[dayIdx] || `Day ${dayIdx + 1}`;
  return (
    <div className={`rounded-2xl border p-4 ${isToday ? "border-ai/40" : "border-white/5"} bg-bg-2`}>
      <div className="flex items-center justify-between">
        <div>
          <p className="text-[10px] uppercase tracking-wider text-text-tertiary">{label}{isToday && " · Today"}</p>
          <p className="mt-1 font-semibold text-[15px]">
            {day.rest ? "Rest day" : (day.session_name ?? "Training")}
          </p>
        </div>
        {day.rest && <span className="text-xs text-text-tertiary">—</span>}
      </div>

      {!day.rest && day.exercises?.length > 0 && (
        <ul className="mt-3 space-y-1.5">
          {day.exercises.map((ex, i) => (
            <li key={i} className="text-[13px] text-text-secondary flex justify-between">
              <span>{ex.name}</span>
              <span className="text-text-tertiary tabular-nums">{ex.sets}×{ex.reps}</span>
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
      // After save, check if today's session is fully complete → write summary strain.
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

// When all sets of today's session are marked completed, derive a simple strain value
// from completed volume and upsert into shield_training_logs for today. The existing
// Shield webhook on that table handles re-scoring.
async function maybeWriteTrainingSummary(
  dayPlan: DayPlan,
  priorLogs: SetLog[],
  justSaved: SetLog,
) {
  const { data: u } = await supabase.auth.getUser();
  const uid = u.user?.id;
  if (!uid) return;
  const date = todayISO();

  // Re-fetch fresh logs for today to be accurate.
  const { data: logs } = await supabase
    .from("workout_set_logs")
    .select("*")
    .eq("user_id", uid)
    .eq("entry_date", date);
  const list = (logs as SetLog[]) ?? [];

  const totalRequired = dayPlan.exercises.reduce((s, ex) => s + ex.sets, 0);
  const totalCompleted = list.filter((l) => l.completed).length;
  if (totalCompleted < totalRequired) return;

  // Strain estimate: 0.5 per completed set + small bonus for weighted volume.
  // Clamped to 0..21 (Whoop-ish scale) — purely additive, separate from Shield scoring math.
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
