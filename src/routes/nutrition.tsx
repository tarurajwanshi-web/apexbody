import { createFileRoute, Link } from "@tanstack/react-router";
import { ChevronLeft, Plus, Camera, Barcode, Search, Mic, Sparkles, X } from "lucide-react";
import { useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { todayMeals, macroTargets, macroToday } from "@/lib/mock";
import { AICard } from "@/components/AIOrb";
import { RingChart } from "@/components/RingChart";
import { BottomNav } from "@/components/BottomNav";
import { analyzePhoto } from "@/lib/coach.functions";

export const Route = createFileRoute("/nutrition")({
  head: () => ({ meta: [{ title: "Nutrition — APEX" }] }),
  component: Nutrition,
});

function Nutrition() {
  const [sheet, setSheet] = useState(false);
  const [analysis, setAnalysis] = useState<string | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const fn = useServerFn(analyzePhoto);

  const pct = (a: number, b: number) => Math.round((a / b) * 100);

  const onPhoto = async (file: File) => {
    setSheet(false);
    setError(null);
    setAnalysis(null);
    setAnalyzing(true);
    try {
      const reader = new FileReader();
      const dataUrl: string = await new Promise((res, rej) => {
        reader.onload = () => res(reader.result as string);
        reader.onerror = () => rej(reader.error);
        reader.readAsDataURL(file);
      });
      setPreview(dataUrl);
      const r = await fn({
        data: {
          base64Image: dataUrl,
          mediaType: file.type || "image/jpeg",
          prompt:
            "Identify the food in this image. Estimate portion size and macros (calories, protein, carbs, fat). Format: short food name, then 'Est: XXX kcal · Pg / Cg / Fg', then a 1-sentence note. Be concise.",
        },
      });
      setAnalysis(r.content);
    } catch (e: any) {
      setError(e?.message ?? "Could not analyze photo.");
    } finally {
      setAnalyzing(false);
    }
  };

  return (
    <div className="min-h-screen bg-bg-1 pb-32">
      <header className="flex items-center justify-between px-5 pt-6">
        <Link to="/dashboard" className="text-text-secondary"><ChevronLeft size={24} /></Link>
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

      {(analyzing || analysis || error) && (
        <section className="mx-5 mt-4 rounded-2xl border border-ai/30 bg-gradient-to-br from-ai/10 to-sleep/5 p-4 animate-fade-up">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-2">
              <Sparkles size={14} className={`text-ai ${analyzing ? "animate-pulse" : ""}`} />
              <p className="text-[10px] uppercase tracking-wider text-text-accent font-semibold">
                {analyzing ? "Analyzing photo…" : "Photo analysis"}
              </p>
            </div>
            <button onClick={() => { setAnalysis(null); setPreview(null); setError(null); }} className="text-text-tertiary">
              <X size={14} />
            </button>
          </div>
          {preview && <img src={preview} alt="meal" className="mt-3 max-h-44 w-full object-cover rounded-xl" />}
          {error && <p className="mt-3 text-sm text-danger">{error}</p>}
          {analysis && <p className="mt-3 text-sm leading-relaxed whitespace-pre-wrap">{analysis}</p>}
        </section>
      )}

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

      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onPhoto(f);
          e.target.value = "";
        }}
      />

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
              <LogOpt icon={Camera} title="Take a photo" sub="AI identifies macros" onClick={() => fileRef.current?.click()} />
              <LogOpt icon={Barcode} title="Scan barcode" sub="Product database" />
              <LogOpt icon={Search} title="Search foods" sub="Manual entry" />
              <LogOpt icon={Mic} title="Describe it" sub="Voice input" />
            </div>
            <p className="mt-4 text-[11px] text-text-accent text-center">Powered by Claude vision</p>
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

function LogOpt({ icon: Icon, title, sub, onClick }: any) {
  return (
    <button onClick={onClick} className="rounded-2xl bg-bg-3 p-4 text-left active:scale-[0.98] transition">
      <Icon size={28} className="text-text-accent" />
      <p className="mt-3 text-sm font-semibold">{title}</p>
      <p className="text-[11px] text-text-tertiary mt-0.5">{sub}</p>
    </button>
  );
}
