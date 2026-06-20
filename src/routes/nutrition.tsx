import { createFileRoute, Link } from "@tanstack/react-router";
import { ChevronLeft, Plus, Camera, Sparkles, X, Loader2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { AICard } from "@/components/AIOrb";
import { RingChart } from "@/components/RingChart";
import { BottomNav } from "@/components/BottomNav";
import { analyzePhoto } from "@/lib/coach.functions";
import { getTodayMacroSummary, type MacroSummary } from "@/lib/macros.functions";
import { getTodayMeals, logMeal, type TodayMeal } from "@/lib/shield.functions";
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
  const [analysis, setAnalysis] = useState<string | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [macros, setMacros] = useState<MacroSummary | null>(null);
  const [meals, setMeals] = useState<TodayMeal[] | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const fn = useServerFn(analyzePhoto);
  const fetchMacros = useServerFn(getTodayMacroSummary);
  const fetchMeals = useServerFn(getTodayMeals);
  const logMealFn = useServerFn(logMeal);

  const reload = () => {
    fetchMacros().then(setMacros).catch(() => {});
    fetchMeals().then(setMeals).catch(() => setMeals([]));
  };

  useEffect(() => { reload(); /* eslint-disable-next-line */ }, []);

  const pct = (a: number, b: number) => (b > 0 ? Math.min(100, Math.round((a / b) * 100)) : 0);

  const onPhoto = async (file: File) => {
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

      // 1) Upload to storage so score-nutrition can re-fetch via signed URL.
      const { data: u } = await supabase.auth.getUser();
      const uid = u.user?.id;
      let photoUrl: string | null = null;
      if (uid) {
        const ext = (file.type.split("/")[1] || "jpg").replace("jpeg", "jpg");
        const path = `${uid}/${Date.now()}.${ext}`;
        const up = await supabase.storage.from("shield-uploads").upload(path, file, { contentType: file.type });
        if (!up.error) {
          const { data: signed } = await supabase.storage.from("shield-uploads").createSignedUrl(path, 60 * 60 * 24 * 30);
          photoUrl = signed?.signedUrl ?? null;
        }
      }

      // 2) Persist meal row → triggers score-nutrition (which fills estimated_* and macros card).
      try { await logMeal({ data: { meal_description: null, meal_photo_url: photoUrl } }); } catch {}

      // 3) Quick visual analysis for instant feedback.
      const r = await fn({
        data: {
          base64Image: dataUrl,
          mediaType: file.type || "image/jpeg",
          prompt:
            "Identify the food in this image. Estimate portion size and macros (calories, protein, carbs, fat). Format: short food name, then 'Est: XXX kcal · Pg / Cg / Fg', then a 1-sentence note. Be concise.",
        },
      });
      setAnalysis(r.content);

      // Reload after scoring has had a moment.
      reload();
      setTimeout(reload, 4000);
    } catch (e: any) {
      setError(e?.message ?? "Could not analyze photo.");
    } finally {
      setAnalyzing(false);
    }
  };

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
    <div className="min-h-screen bg-bg-1 pb-32">
      <header className="flex items-center justify-between px-5 pt-6">
        <Link to="/dashboard" className="text-text-secondary"><ChevronLeft size={24} /></Link>
        <span className="text-[11px] uppercase tracking-wider text-text-tertiary">Nutrition</span>
        <span className="w-6" />
      </header>

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

      {hasTarget && hasMeals && proteinShort >= 20 && (
        <div className="mx-5 mt-4">
          <AICard>
            You're <span className="text-text-primary font-semibold">{proteinShort}g short on protein</span>. Add a high-protein snack before 8pm to hit your{goalText ? ` ${goalText}` : ""} target.
          </AICard>
        </div>
      )}

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

      <section className="mx-5 mt-5">
        <div className="flex items-center justify-between mb-2">
          <p className="text-xs uppercase tracking-wider text-text-tertiary">Meals today</p>
          <p className="text-[11px] text-text-accent">Tap + to snap a photo and track your macros</p>
        </div>
        {meals == null ? (
          <div className="rounded-2xl bg-bg-2 border border-white/5 p-5 flex justify-center">
            <Loader2 size={16} className="animate-spin text-text-tertiary" />
          </div>
        ) : meals.length === 0 ? (
          <div className="rounded-2xl bg-bg-2 border border-white/5 p-5">
            <p className="text-sm text-text-secondary">No meals logged yet today. Tap the + button to snap your first.</p>
          </div>
        ) : (
          <div className="space-y-2">
            {meals.map((m) => (
              <div key={m.id} className="rounded-2xl bg-bg-2 border border-white/5 p-4">
                <div className="flex items-center justify-between">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold truncate">{m.meal_description || "Photo meal"}</p>
                    <p className="text-[11px] text-text-tertiary">
                      {new Date(m.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                    </p>
                  </div>
                  <p className="font-mono text-sm tabular-nums text-text-secondary">
                    {m.claude_score_status === "scored" && m.claude_quality_score != null ? `${m.claude_quality_score}/100` : "scoring…"}
                  </p>
                </div>
              </div>
            ))}
          </div>
        )}
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
        onClick={() => fileRef.current?.click()}
        className="fixed bottom-28 right-6 z-40 h-14 w-14 rounded-full gradient-brand ai-glow flex items-center justify-center text-white"
        aria-label="Snap a photo to log a meal"
      >
        <Plus size={26} />
      </button>

      <BottomNav />
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
