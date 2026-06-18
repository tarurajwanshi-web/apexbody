import { createFileRoute, Link } from "@tanstack/react-router";
import { ChevronLeft, Plus, Camera, Barcode, Search, Mic } from "lucide-react";
import { useState } from "react";
import { todayMeals, macroTargets, macroToday } from "@/lib/mock";
import { AICard } from "@/components/AIOrb";
import { RingChart } from "@/components/RingChart";
import { BottomNav } from "@/components/BottomNav";

export const Route = createFileRoute("/nutrition")({
  head: () => ({ meta: [{ title: "Nutrition — APEX" }] }),
  component: Nutrition,
});

function Nutrition() {
  const [sheet, setSheet] = useState(false);
  const pct = (a: number, b: number) => Math.round((a / b) * 100);

  return (
    <div className="min-h-screen bg-bg-1 pb-32">
      <header className="flex items-center justify-between px-5 pt-6">
        <Link to="/home" className="text-text-secondary"><ChevronLeft size={24} /></Link>
        <span className="text-[11px] uppercase tracking-wider text-text-tertiary">Nutrition</span>
        <span className="w-6" />
      </header>

      <section className="mx-5 mt-4 rounded-3xl bg-bg-2 border border-white/5 p-5">
        <div className="flex items-end justify-between">
          <div>
            <p className="text-[10px] uppercase tracking-wider text-text-tertiary">Today</p>
            <div className="mt-1 flex items-end gap-1">
              <span className="text-5xl font-extrabold leading-none gradient-text tabular-nums">{macroToday.kcal.toLocaleString()}</span>
              <span className="text-base text-text-tertiary mb-1">/ {macroTargets.kcal.toLocaleString()} kcal</span>
            </div>
          </div>
        </div>
        <div className="mt-4 h-1.5 rounded-full bg-white/5 overflow-hidden">
          <div className="h-full gradient-brand" style={{ width: `${pct(macroToday.kcal, macroTargets.kcal)}%` }} />
        </div>
        <div className="mt-5 grid grid-cols-3 gap-3">
          <Macro label="Protein" v={macroToday.p} t={macroTargets.p} color="#F59E0B" />
          <Macro label="Carbs" v={macroToday.c} t={macroTargets.c} color="#10B981" />
          <Macro label="Fat" v={macroToday.f} t={macroTargets.f} color="#3B82F6" />
        </div>
      </section>

      <div className="mx-5 mt-4">
        <AICard>
          You're <span className="text-text-primary font-semibold">42g short on protein</span>. Add a high-protein snack before 8pm to hit your recomposition target.
        </AICard>
      </div>

      <section className="mx-5 mt-5 space-y-2">
        <p className="text-xs uppercase tracking-wider text-text-tertiary mb-1">Meals today</p>
        {todayMeals.map((m, i) => (
          <div key={i} className="rounded-2xl bg-bg-2 border border-white/5 p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-semibold">{m.type}</p>
                <p className="text-[11px] text-text-tertiary">{m.time}</p>
              </div>
              <p className="font-mono text-sm tabular-nums">{m.kcal} kcal</p>
            </div>
            <p className="mt-1.5 text-xs text-text-secondary">{m.items}</p>
            <div className="mt-3 flex gap-3 text-[10px] text-text-tertiary">
              <span>P {m.p}g</span><span>C {m.c}g</span><span>F {m.f}g</span>
            </div>
          </div>
        ))}
      </section>

      <button
        onClick={() => setSheet(true)}
        className="fixed bottom-28 right-6 z-40 h-14 w-14 rounded-full gradient-brand ai-glow flex items-center justify-center text-white"
      >
        <Plus size={26} />
      </button>

      {sheet && (
        <div className="fixed inset-0 z-50 bg-black/70 flex items-end" onClick={() => setSheet(false)}>
          <div className="w-full max-w-[430px] mx-auto bg-bg-2 rounded-t-3xl border-t border-white/10 p-6 animate-fade-up" onClick={(e) => e.stopPropagation()}>
            <div className="h-1 w-12 rounded-full bg-white/20 mx-auto mb-4" />
            <h3 className="text-xl font-bold">Log your meal</h3>
            <div className="mt-4 grid grid-cols-2 gap-3">
              <LogOpt icon={Camera} title="Take a photo" sub="Fastest, AI identifies" />
              <LogOpt icon={Barcode} title="Scan barcode" sub="Product database" />
              <LogOpt icon={Search} title="Search foods" sub="Manual entry" />
              <LogOpt icon={Mic} title="Describe it" sub="Voice input" />
            </div>
            <p className="mt-4 text-[11px] text-text-accent text-center">AI identifies food, portion, and macros from photos</p>
          </div>
        </div>
      )}

      <BottomNav />
    </div>
  );
}

function Macro({ label, v, t, color }: { label: string; v: number; t: number; color: string }) {
  const pct = Math.round((v / t) * 100);
  return (
    <div className="flex flex-col items-center gap-1">
      <RingChart size={56} stroke={5} rings={[{ value: pct, color }]} centerLabel={`${pct}%`} />
      <p className="text-[11px] font-semibold mt-1">{label}</p>
      <p className="text-[10px] text-text-tertiary">{v}/{t}g</p>
    </div>
  );
}

function LogOpt({ icon: Icon, title, sub }: any) {
  return (
    <button className="rounded-2xl bg-bg-3 p-4 text-left">
      <Icon size={28} className="text-text-accent" />
      <p className="mt-3 text-sm font-semibold">{title}</p>
      <p className="text-[11px] text-text-tertiary mt-0.5">{sub}</p>
    </button>
  );
}
