import { useState } from "react";
import { X, Sparkles, ChevronDown, ChevronUp } from "lucide-react";
import type { TodayMeal } from "@/lib/shield.functions";

/** Lightweight expand of a logged meal — confirmed description, estimated
 *  macros, per-meal score, and one short nutrient-balance callout. Reuses the
 *  carb-heavy / low-protein flagging logic from prior passes (kept local so
 *  this stays a presentational sheet, no server calls). */
export function MealDetailModal({ meal, onClose }: { meal: TodayMeal | null; onClose: () => void }) {
  if (!meal) return null;
  const cal = meal.estimated_calories ?? null;
  const p = meal.estimated_protein_g ?? null;
  const c = meal.estimated_carbs_g ?? null;
  const f = meal.estimated_fat_g ?? null;
  const callout = buildCallout(cal, p, c, f);

  return (
    <div className="fixed inset-0 z-[110] flex items-end justify-center" style={{ background: "rgba(0,0,0,0.55)" }} onClick={onClose}>
      <div
        className="w-full max-w-[480px] rounded-t-[24px] p-5 animate-fade-up"
        style={{
          background: "#0F1524",
          border: "1px solid rgba(255,255,255,0.06)",
          paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 20px)",
          maxHeight: "calc(90vh - env(safe-area-inset-bottom, 0px))",
          overflowY: "auto",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 mb-3">
          <div className="min-w-0">
            <p className="text-[10px] uppercase tracking-wider text-text-tertiary">
              {new Date(meal.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
            </p>
            <h2 className="text-[16px] font-semibold text-white mt-1 leading-snug">
              {meal.meal_description || "Photo meal"}
            </h2>
          </div>
          <button onClick={onClose} className="text-text-secondary p-1 active:scale-95" aria-label="Close"><X size={18} /></button>
        </div>

        {meal.meal_photo_url && (
          <img src={meal.meal_photo_url} alt="Meal" className="w-full max-h-44 object-cover rounded-xl mb-4" />
        )}

        {Array.isArray(meal.estimated_items) && meal.estimated_items.length > 0 && (
          <ul className="mb-4 space-y-1.5">
            {meal.estimated_items.map((it, i) => (
              <li key={i} className="rounded-lg p-2.5" style={{ background: "#0A0E1A", border: "1px solid rgba(255,255,255,0.05)" }}>
                <p className="text-[12px] text-white leading-snug">
                  {i + 1}. {it.name} — <span className="text-text-tertiary">~{it.grams}g</span>
                </p>
                <p className="text-[11px] text-text-tertiary tabular-nums">
                  {it.calories} kcal · {it.protein_g}g protein · {it.carbs_g}g carbs · {it.fat_g}g fat
                </p>
              </li>
            ))}
          </ul>
        )}

        <div className="grid grid-cols-4 gap-2">
          <Stat label="kcal" value={cal != null ? Math.round(cal).toString() : "—"} />
          <Stat label="protein" value={p != null ? `${Math.round(p)}g` : "—"} color="#F59E0B" />
          <Stat label="carbs"   value={c != null ? `${Math.round(c)}g` : "—"} color="#10B981" />
          <Stat label="fat"     value={f != null ? `${Math.round(f)}g` : "—"} color="#3B82F6" />
        </div>

        <div className="mt-4 flex items-center gap-2">
          <span className="text-[10px] uppercase tracking-wider text-text-tertiary">Meal score</span>
          <span className="text-[13px] font-semibold text-white tabular-nums">
            {meal.claude_score_status === "scored" && meal.claude_quality_score != null
              ? `${meal.claude_quality_score}/100`
              : meal.claude_score_status === "failed" ? "—" : "scoring…"}
          </span>
        </div>

        {callout && (
          <div className="mt-4 rounded-xl p-3 flex items-start gap-2"
            style={{ background: "linear-gradient(135deg, rgba(124,58,237,0.10), rgba(59,130,246,0.08))", border: "1px solid rgba(124,58,237,0.25)" }}>
            <Sparkles size={14} className="text-ai shrink-0 mt-0.5" />
            <p className="text-[12px] text-text-primary leading-snug">{callout}</p>
          </div>
        )}

        {cal == null && (
          <p className="mt-4 text-[11px] text-text-tertiary">Macros estimate is still being calculated — give it a few seconds.</p>
        )}
      </div>
    </div>
  );
}

function Stat({ label, value, color = "#FFFFFF" }: { label: string; value: string; color?: string }) {
  return (
    <div className="rounded-xl p-2.5" style={{ background: "#0A0E1A", border: "1px solid rgba(255,255,255,0.06)" }}>
      <p className="text-[10px] text-text-tertiary uppercase tracking-wider">{label}</p>
      <p className="mt-1 text-[13px] font-semibold tabular-nums" style={{ color }}>{value}</p>
    </div>
  );
}

/** One short nutrient-balance observation. Keeps tone matched to the
 *  workout-tab cue cards (brief, specific, not analytical). */
function buildCallout(cal: number | null, p: number | null, c: number | null, f: number | null): string | null {
  if (cal == null || (p == null && c == null && f == null)) return null;
  const pCal = (p ?? 0) * 4;
  const cCal = (c ?? 0) * 4;
  const fCal = (f ?? 0) * 9;
  const total = pCal + cCal + fCal;
  if (total < 40) return null;
  const pPct = pCal / total;
  const cPct = cCal / total;
  const fPct = fCal / total;
  if (cPct >= 0.6 && pPct < 0.2) return "This meal was carb-heavy and light on protein — pair the next one with a protein source.";
  if (cPct >= 0.6) return "This meal leaned carb-heavy — useful around training, lighter otherwise.";
  if (pPct >= 0.35) return "Solid protein hit in this meal — good for recovery.";
  if (fPct >= 0.5) return "This meal was fat-dominant — keep an eye on the day's calorie total.";
  if (pPct < 0.15) return "Protein ran light here — consider front-loading it at the next meal.";
  return "Balanced split across protein, carbs, and fat.";
}
