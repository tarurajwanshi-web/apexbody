import { useEffect, useState } from "react";
import { Pencil, Trash2, Loader2, Sparkles } from "lucide-react";
import { useServerFn } from "@tanstack/react-start";
import {
  getTodayMeals,
  softDeleteMeal,
  type TodayMeal,
} from "@/lib/shield.functions";
import { MealLogModal } from "@/components/LogModals";

type Props = {
  /** Called after the user adds, edits, or deletes a meal. Parent uses it to
   *  capture the pre-change readiness score so a "score updated" toast can fire. */
  onMutationStart?: () => void;
  /** Called after any mutation succeeds so parent can begin polling readiness. */
  onMutationDone?: () => void;
};

export function MealHistoryList({ onMutationStart, onMutationDone }: Props) {
  const [meals, setMeals] = useState<TodayMeal[] | null>(null);
  const [editing, setEditing] = useState<TodayMeal | null>(null);
  const [confirmDel, setConfirmDel] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const fetchMeals = useServerFn(getTodayMeals);
  const del = useServerFn(softDeleteMeal);

  const reload = () => {
    fetchMeals().then(setMeals).catch(() => setMeals([]));
  };

  useEffect(() => { reload(); /* eslint-disable-next-line */ }, []);

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
              return (
                <li
                  key={m.id}
                  className="rounded-xl p-3 flex items-start gap-3"
                  style={{ background: "#0A0E1A", border: "1px solid rgba(255,255,255,0.06)" }}
                >
                  <div className="flex-1 min-w-0">
                    <p className="text-[13px] text-white leading-snug truncate">
                      {m.meal_description || "(no description)"}
                    </p>
                    <div className="mt-1 flex items-center gap-2 text-[11px] text-text-tertiary">
                      <span>{new Date(m.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
                      <span>•</span>
                      {m.claude_score_status === "scored" && m.claude_quality_score != null ? (
                        <span className="inline-flex items-center gap-1 text-success">
                          <Sparkles size={10} /> {m.claude_quality_score}/100
                        </span>
                      ) : m.claude_score_status === "failed" ? (
                        <span className="text-red-400">scoring failed</span>
                      ) : (
                        <span className="inline-flex items-center gap-1"><Loader2 size={10} className="animate-spin" /> scoring…</span>
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
                      <button
                        onClick={() => setEditing(m)}
                        aria-label="Edit meal"
                        className="p-1.5 text-text-secondary active:scale-95 transition"
                      >
                        <Pencil size={14} />
                      </button>
                      <button
                        onClick={() => setConfirmDel(m.id)}
                        aria-label="Delete meal"
                        className="p-1.5 text-text-secondary active:scale-95 transition"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
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
