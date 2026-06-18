import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { ChevronLeft, Clock, Dumbbell, Flame, Check, Sparkles } from "lucide-react";
import { todaySession, chips } from "@/lib/mock";
import { AIBadge } from "@/components/AIOrb";
import { BottomNav } from "@/components/BottomNav";

export const Route = createFileRoute("/workouts")({
  head: () => ({ meta: [{ title: "Workouts — APEX" }] }),
  component: Workouts,
});

function Workouts() {
  const [active, setActive] = useState(false);
  const [completed, setCompleted] = useState<number[]>([]);

  if (active) return <ActiveSession completed={completed} setCompleted={setCompleted} onExit={() => setActive(false)} />;

  return (
    <div className="min-h-screen bg-bg-1 pb-32">
      <header className="flex items-center justify-between px-5 pt-6">
        <Link to="/home" className="text-text-secondary"><ChevronLeft size={24} /></Link>
        <span className="text-[11px] uppercase tracking-wider text-text-tertiary">Today's session</span>
        <span className="w-6" />
      </header>

      <div className="px-5 mt-4">
        <div className="flex items-center gap-2">
          <h1 className="text-3xl font-bold">{todaySession.name}</h1>
        </div>
        <div className="mt-2 flex items-center gap-2">
          <AIBadge />
          <span className="text-xs text-text-secondary">Built for today's recovery score</span>
        </div>
      </div>

      <div className="mx-5 mt-5 grid grid-cols-3 gap-2">
        <Stat icon={Clock} label={`${todaySession.duration} min`} />
        <Stat icon={Dumbbell} label={`${todaySession.exercises.length} exercises`} />
        <Stat icon={Flame} label={todaySession.intensity} />
      </div>

      {/* AI buddy bar */}
      <section className="mx-5 mt-6 rounded-2xl bg-bg-2 border border-ai/20 p-4">
        <div className="flex items-start gap-3">
          <Sparkles size={18} className="text-ai mt-0.5" />
          <div className="flex-1">
            <p className="text-sm font-semibold">What's changed today?</p>
            <p className="text-xs text-text-secondary mt-0.5">Tell me and I'll adapt your session.</p>
          </div>
        </div>
        <div className="mt-3 -mx-1 flex gap-2 overflow-x-auto pb-1 px-1">
          {chips.map((c) => (
            <button key={c} className="shrink-0 rounded-full bg-bg-3 border border-white/5 px-3 py-1.5 text-xs text-text-secondary hover:text-text-primary hover:border-ai/40 transition whitespace-nowrap">
              {c}
            </button>
          ))}
        </div>
      </section>

      {/* Exercise list preview */}
      <section className="mx-5 mt-6 space-y-2">
        <p className="text-xs uppercase tracking-wider text-text-tertiary mb-2">Plan</p>
        {todaySession.exercises.map((ex, i) => (
          <div key={i} className="rounded-2xl bg-bg-2 border border-white/5 p-4 flex items-center gap-3">
            <div className="h-9 w-9 rounded-full bg-bg-3 flex items-center justify-center text-xs font-bold text-text-secondary">{i + 1}</div>
            <div className="flex-1">
              <p className="font-semibold text-sm">{ex.name}</p>
              <p className="text-[11px] text-text-secondary mt-0.5">{ex.sets} × {ex.reps} · {ex.weight}</p>
            </div>
          </div>
        ))}
      </section>

      <button onClick={() => setActive(true)} className="mx-5 mt-6 block w-[calc(100%-2.5rem)] rounded-2xl gradient-brand py-4 font-semibold text-white">
        Start Session →
      </button>

      <BottomNav />
    </div>
  );
}

function Stat({ icon: Icon, label }: any) {
  return (
    <div className="rounded-xl bg-bg-2 border border-white/5 p-3 flex flex-col items-center gap-1">
      <Icon size={16} className="text-text-secondary" />
      <span className="text-xs font-medium">{label}</span>
    </div>
  );
}

function ActiveSession({ completed, setCompleted, onExit }: any) {
  const [currentIdx, setCurrentIdx] = useState(0);
  const ex = todaySession.exercises[currentIdx];
  const [setNum, setSetNum] = useState(1);

  const completeSet = () => {
    if (setNum >= ex.sets) {
      setCompleted([...completed, currentIdx]);
      if (currentIdx < todaySession.exercises.length - 1) {
        setCurrentIdx(currentIdx + 1);
        setSetNum(1);
      }
    } else setSetNum(setNum + 1);
  };

  return (
    <div className="min-h-screen bg-bg-1 pb-20">
      <header className="px-5 pt-6 flex items-center justify-between">
        <button onClick={onExit} className="text-text-secondary text-sm">End</button>
        <span className="font-mono text-lg tabular-nums">00:24:18</span>
        <span className="w-8" />
      </header>

      <div className="px-5 mt-3">
        <div className="h-1 rounded-full bg-white/5 overflow-hidden">
          <div className="h-full gradient-brand transition-all" style={{ width: `${(completed.length / todaySession.exercises.length) * 100}%` }} />
        </div>
        <p className="mt-2 text-[11px] text-text-tertiary uppercase tracking-wider">{currentIdx + 1} of {todaySession.exercises.length}</p>
      </div>

      <section className="mx-5 mt-5 rounded-3xl bg-bg-2 border border-white/5 p-5">
        <h2 className="text-2xl font-bold">{ex.name}</h2>
        <p className="text-sm text-text-secondary mt-1">{ex.sets} sets · {ex.reps} reps · {ex.weight}</p>
        {ex.aiNote && (
          <div className="mt-3 flex gap-2 text-[13px] text-text-accent italic">
            <Sparkles size={14} className="mt-0.5 shrink-0" />
            <span>{ex.aiNote}</span>
          </div>
        )}

        <div className="mt-5 space-y-2">
          {Array.from({ length: ex.sets }).map((_, i) => {
            const done = i + 1 < setNum;
            const current = i + 1 === setNum;
            return (
              <div key={i} className={`rounded-xl p-3 flex items-center gap-3 ${current ? "bg-ai/10 ring-1 ring-ai/40" : done ? "bg-bg-3/40" : "bg-bg-3/20"}`}>
                <div className={`h-7 w-7 rounded-lg flex items-center justify-center text-[11px] font-bold ${done ? "bg-success text-white" : current ? "gradient-brand text-white" : "bg-bg-3 text-text-tertiary"}`}>
                  {done ? <Check size={14} /> : i + 1}
                </div>
                <div className="flex-1 grid grid-cols-3 gap-2 text-sm">
                  <span className="text-text-secondary">{ex.weight.split("-")[0]}</span>
                  <span className="text-text-secondary">{ex.reps.split("-")[0]} reps</span>
                  <span className="text-text-secondary">RPE {done ? 8 : "—"}</span>
                </div>
              </div>
            );
          })}
        </div>

        <button onClick={completeSet} className="mt-5 w-full rounded-2xl gradient-brand py-3.5 font-semibold text-white">
          Complete set {setNum} ✓
        </button>
      </section>

      <section className="mx-5 mt-5 rounded-2xl bg-bg-2 border border-white/5 p-4">
        <p className="text-xs text-text-tertiary uppercase tracking-wider">How's that set feeling?</p>
        <div className="mt-3 flex justify-between text-2xl">
          {["😩", "😔", "😐", "😊", "🔥"].map((e) => (
            <button key={e} className="h-12 w-12 rounded-full bg-bg-3 hover:scale-110 transition">{e}</button>
          ))}
        </div>
      </section>
    </div>
  );
}
