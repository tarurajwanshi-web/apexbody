import { useEffect, useRef, useState } from "react";
import { Pencil, Trash2, Loader2, Sparkles, RotateCw, ChevronDown, ChevronUp } from "lucide-react";
import { useServerFn } from "@tanstack/react-start";
import {
  getTodayMeals,
  softDeleteMeal,
  updateMealItems,
  type TodayMeal,
  type MealItem,
} from "@/lib/shield.functions";
import { MealLogModal } from "@/components/LogModals";
import { supabase } from "@/integrations/supabase/client";

type Props = {
  onMutationStart?: () => void;
  onMutationDone?: () => void;
  /** Optional YYYY-MM-DD; defaults to today on the server. */
  entryDate?: string;
};

const STALE_PENDING_MS = 60_000;

export function MealHistoryList({ onMutationStart, onMutationDone, entryDate }: Props) {
  const [meals, setMeals] = useState<TodayMeal[] | null>(null);
  const [editing, setEditing] = useState<TodayMeal | null>(null);
  const [confirmDel, setConfirmDel] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [retryingId, setRetryingId] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const autoRetriedRef = useRef<Set<string>>(new Set());
  const fetchMeals = useServerFn(getTodayMeals);
  const del = useServerFn(softDeleteMeal);
  const saveItems = useServerFn(updateMealItems);

  const reload = () => {
    fetchMeals(entryDate ? { data: { entryDate } } : undefined as any)
      .then(setMeals)
      .catch(() => setMeals([]));
  };

  useEffect(() => { reload(); /* eslint-disable-next-line */ }, [entryDate]);

  useEffect(() => {
    if (!meals) return;
    const now = Date.now();
    for (const m of meals) {
      if (m.claude_score_status !== "pending") continue;
      if (autoRetriedRef.current.has(m.id)) continue;
      const age = now - new Date(m.created_at).getTime();
      if (age < STALE_PENDING_MS) continue;
      autoRetriedRef.current.add(m.id);
      void retryScore(m.id, /*silent*/ true).then(() => setTimeout(reload, 3000));
    }
    const hasPending = meals.some((m) => m.claude_score_status === "pending" || (m.meal_photo_url && !m.estimated_items && m.calorie_estimate_status !== "manual_edited"));
    if (!hasPending) return;
    const id = setInterval(reload, 5000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [meals]);

  const retryScore = async (id: string, silent = false) => {
    if (!silent) setRetryingId(id);
    try {
      try { await supabase.from("shield_nutrition_logs").update({ claude_score_status: "pending" }).eq("id", id); } catch {}
      await supabase.functions.invoke("score-nutrition", { body: { nutrition_log_id: id } });
    } catch (e) {
      console.error("[meal] retry score-nutrition failed", e);
      try { await supabase.from("shield_nutrition_logs").update({ claude_score_status: "failed" }).eq("id", id); } catch {}
    } finally {
      if (!silent) setRetryingId(null);
      reload();
    }
  };

  const handleDelete = async (id: string) => {
    setBusyId(id);
    onMutationStart?.();
    try {
      await del({ data: { id } });
      setConfirmDel(null);
      reload();
      onMutationDone?.();
    } finally {
      setBusyId(null);
    }
  };

  const handleItemsSave = async (id: string, items: MealItem[]) => {
    await saveItems({ data: { id, items } });
    reload();
  };

  if (meals == null) {
    return (
      <div className="rounded-2xl p-5 flex justify-center" style={{ background: "#0F1524", border: "1px solid rgba(255,255,255,0.06)" }}>
        <Loader2 className="animate-spin text-text-tertiary" size={18} />
      </div>
    );
  }

  return (
    <>
      <div className="rounded-2xl p-5" style={{ background: "#0F1524", border: "1px solid rgba(255,255,255,0.06)" }}>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-[16px] font-bold text-white">Today's meals</h3>
          {meals.length > 0 && (
            <span className="text-[11px] text-text-tertiary">{meals.length} logged</span>
          )}
        </div>

        {meals.length === 0 ? (
          <p className="text-[13px] text-text-secondary">No meals logged yet today.</p>
        ) : (
          <ul className="space-y-2">
            {meals.map((m) => {
              const isConfirm = confirmDel === m.id;
              const isExpanded = expanded[m.id] ?? false;
              const hasItems = Array.isArray(m.estimated_items) && m.estimated_items.length > 0;
              return (
                <li
                  key={m.id}
                  className="rounded-xl p-3"
                  style={{ background: "#0A0E1A", border: "1px solid rgba(255,255,255,0.06)" }}
                >
                  <div className="flex items-start gap-3">
                    <div className="flex-1 min-w-0">
                      <p className="text-[13px] text-white leading-snug truncate">
                        {m.meal_description || "(no description)"}
                      </p>
                      <div className="mt-1 flex items-center gap-2 text-[11px] text-text-tertiary flex-wrap">
                        <span>{new Date(m.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
                        <span>•</span>
                        {m.claude_score_status === "scored" && m.claude_quality_score != null ? (
                          <span className="inline-flex items-center gap-1 text-success">
                            <Sparkles size={10} /> {m.claude_quality_score}/100
                          </span>
                        ) : m.claude_score_status === "failed" ? (
                          <button
                            onClick={() => retryScore(m.id)}
                            disabled={retryingId === m.id}
                            className="inline-flex items-center gap-1 text-red-400 active:scale-95 transition disabled:opacity-50"
                            aria-label="Retry scoring"
                          >
                            {retryingId === m.id
                              ? <><Loader2 size={10} className="animate-spin" /> retrying…</>
                              : <><RotateCw size={10} /> scoring failed — tap to retry</>}
                          </button>
                        ) : (
                          <span className="inline-flex items-center gap-1"><Loader2 size={10} className="animate-spin" /> scoring…</span>
                        )}
                        {m.estimated_calories != null && (
                          <>
                            <span>•</span>
                            <span className="tabular-nums">{m.estimated_calories} kcal · {m.estimated_protein_g ?? 0}P · {m.estimated_carbs_g ?? 0}C · {m.estimated_fat_g ?? 0}F</span>
                          </>
                        )}
                        {(m.calorie_estimate_status === "manual_edited" || m.user_corrected) && (
                          <>
                            <span>•</span>
                            <span className="text-text-secondary italic">Adjusted by you</span>
                          </>
                        )}
                      </div>
                    </div>

                    {isConfirm ? (
                      <div className="flex items-center gap-1.5">
                        <button
                          onClick={() => handleDelete(m.id)}
                          disabled={busyId === m.id}
                          className="rounded-full px-2.5 py-1 text-[11px] font-semibold text-white active:scale-95 transition disabled:opacity-50"
                          style={{ background: "rgba(239,68,68,0.9)" }}
                        >
                          {busyId === m.id ? "…" : "Delete"}
                        </button>
                        <button
                          onClick={() => setConfirmDel(null)}
                          className="rounded-full px-2.5 py-1 text-[11px] text-text-secondary active:scale-95 transition"
                          style={{ border: "1px solid rgba(255,255,255,0.12)" }}
                        >
                          Cancel
                        </button>
                      </div>
                    ) : (
                      <div className="flex items-center gap-1 shrink-0">
                        {hasItems && (
                          <button
                            onClick={() => setExpanded((s) => ({ ...s, [m.id]: !s[m.id] }))}
                            aria-label={isExpanded ? "Collapse items" : "Expand items"}
                            className="p-1.5 text-text-secondary active:scale-95 transition"
                          >
                            {isExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                          </button>
                        )}
                        <button onClick={() => setEditing(m)} aria-label="Edit meal" className="p-1.5 text-text-secondary active:scale-95 transition">
                          <Pencil size={14} />
                        </button>
                        <button onClick={() => setConfirmDel(m.id)} aria-label="Delete meal" className="p-1.5 text-text-secondary active:scale-95 transition">
                          <Trash2 size={14} />
                        </button>
                      </div>
                    )}
                  </div>

                  {isExpanded && hasItems && (
                    <ItemBreakdown
                      mealId={m.id}
                      items={m.estimated_items!}
                      onSave={(items) => handleItemsSave(m.id, items)}
                    />
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <MealLogModal
        open={!!editing}
        editing={editing ? { id: editing.id, meal_description: editing.meal_description, meal_photo_url: editing.meal_photo_url } : null}
        onClose={() => setEditing(null)}
        onSaved={() => {
          onMutationStart?.();
          reload();
          onMutationDone?.();
        }}
      />
    </>
  );
}

/** Per-item editable grams. Linearly rescales an item's macros when grams
 *  change so each item stays internally consistent; totals are recomputed
 *  server-side on save. */
function ItemBreakdown({ mealId: _mealId, items: initial, onSave }: { mealId: string; items: MealItem[]; onSave: (items: MealItem[]) => Promise<void> }) {
  const [items, setItems] = useState<MealItem[]>(initial);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => { setItems(initial); setDirty(false); }, [initial]);

  const editGrams = (idx: number, raw: string) => {
    if (!/^\d*\.?\d*$/.test(raw)) return;
    const next = items.slice();
    const orig = initial[idx];
    const newGrams = raw === "" || raw === "." ? 0 : Number(raw);
    const ratio = orig.grams > 0 ? newGrams / orig.grams : 0;
    next[idx] = {
      ...orig,
      grams: Math.max(0, Math.round(newGrams)),
      calories: Math.max(0, Math.round(orig.calories * ratio)),
      protein_g: Math.max(0, Math.round(orig.protein_g * ratio)),
      carbs_g: Math.max(0, Math.round(orig.carbs_g * ratio)),
      fat_g: Math.max(0, Math.round(orig.fat_g * ratio)),
    };
    setItems(next);
    setDirty(true);
  };

  const totals = items.reduce(
    (a, b) => ({ c: a.c + b.calories, p: a.p + b.protein_g, ca: a.ca + b.carbs_g, f: a.f + b.fat_g }),
    { c: 0, p: 0, ca: 0, f: 0 },
  );

  const save = async () => {
    setSaving(true);
    try { await onSave(items); setDirty(false); } finally { setSaving(false); }
  };

  return (
    <div className="mt-3 pt-3 border-t border-white/5 space-y-2">
      {items.map((it, i) => (
        <div key={i} className="flex items-start gap-3">
          <div className="flex-1 min-w-0">
            <p className="text-[12px] text-white leading-snug">
              {i + 1}. {it.name}
            </p>
            <p className="text-[11px] text-text-tertiary tabular-nums">
              {it.calories} kcal · {it.protein_g}g P · {it.carbs_g}g C · {it.fat_g}g F
            </p>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            <input
              type="text"
              inputMode="decimal"
              value={String(it.grams)}
              onChange={(e) => editGrams(i, e.target.value)}
              className="w-14 bg-bg-1 border border-white/10 rounded px-2 py-1 text-[12px] text-right text-white focus:outline-none"
              style={{ fontSize: 16 }}
              aria-label={`${it.name} grams`}
            />
            <span className="text-[11px] text-text-tertiary">g</span>
          </div>
        </div>
      ))}
      <div className="flex items-center justify-between pt-2 border-t border-white/5">
        <span className="text-[11px] uppercase tracking-wider text-text-tertiary">Total</span>
        <span className="text-[12px] text-white font-semibold tabular-nums">
          {totals.c} kcal · {totals.p}P · {totals.ca}C · {totals.f}F
        </span>
      </div>
      {dirty && (
        <button
          onClick={save}
          disabled={saving}
          className="w-full mt-2 rounded-xl py-2 text-[12px] font-semibold text-white gradient-brand active:scale-[0.98] transition disabled:opacity-50"
        >
          {saving ? "Saving…" : "Save adjusted portions"}
        </button>
      )}
    </div>
  );
}
