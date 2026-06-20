import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { ChevronLeft, Check, Trophy, Flame, Dumbbell, Zap, Activity } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/onboarding")({
  head: () => ({ meta: [{ title: "Profile setup — APEX" }] }),
  component: ProfileSetup,
});

type Goal = "recomposition" | "muscle_gain" | "fat_loss" | "strength" | "athletic_performance";
type Equipment = "home_gym_db_only" | "commercial_gym" | "limited_equipment" | "bodyweight_only";
type BodyDataType = "dexa" | "measurements" | null;

const GOALS: { id: Goal; label: string; desc: string; Icon: typeof Trophy }[] = [
  { id: "recomposition", label: "Recomposition", desc: "Build muscle, lose fat", Icon: Activity },
  { id: "muscle_gain", label: "Muscle Gain", desc: "Maximize hypertrophy", Icon: Dumbbell },
  { id: "fat_loss", label: "Fat Loss", desc: "Cut while preserving muscle", Icon: Flame },
  { id: "strength", label: "Strength", desc: "Raise your big lifts", Icon: Trophy },
  { id: "athletic_performance", label: "Athletic Performance", desc: "Power, speed, conditioning", Icon: Zap },
];

const EQUIPMENT: { id: Equipment; label: string; desc: string }[] = [
  { id: "home_gym_db_only", label: "Home gym", desc: "Dumbbells only" },
  { id: "commercial_gym", label: "Commercial gym", desc: "Full equipment" },
  { id: "limited_equipment", label: "Limited equipment", desc: "Society / condo gym" },
  { id: "bodyweight_only", label: "Bodyweight only", desc: "No equipment" },
];

const TOTAL = 5;

type Draft = {
  goal: Goal | null;
  days: number | null;
  equipment: Equipment | null;
  bodyDataType: BodyDataType;
  dexaBf: string;
  dexaLean: string;
  waist: string;
  hip: string;
  weight: string;
  height: string;
};

const EMPTY: Draft = {
  goal: null, days: null, equipment: null, bodyDataType: null,
  dexaBf: "", dexaLean: "", waist: "", hip: "", weight: "", height: "",
};

function ProfileSetup() {
  const navigate = useNavigate();
  const [step, setStep] = useState(1);
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [submitting, setSubmitting] = useState(false);

  const patch = (p: Partial<Draft>) => setDraft((d) => ({ ...d, ...p }));

  const bodyPathValid = (() => {
    if (draft.bodyDataType === null) return true;
    if (draft.bodyDataType === "dexa") return !!draft.dexaBf && !!draft.dexaLean;
    return !!draft.waist && !!draft.hip && !!draft.weight && !!draft.height;
  })();

  const canContinue = (() => {
    switch (step) {
      case 1: return !!draft.goal;
      case 2: return !!draft.days;
      case 3: return !!draft.equipment;
      case 4: return bodyPathValid;
      case 5: return true;
      default: return false;
    }
  })();

  const next = () => setStep((s) => Math.min(s + 1, TOTAL));
  const back = () => setStep((s) => Math.max(s - 1, 1));

  const submit = async () => {
    setSubmitting(true);
    try {
      const { data: userRes, error: uerr } = await supabase.auth.getUser();
      if (uerr || !userRes.user) throw new Error("Not signed in");
      const userId = userRes.user.id;

      const now = new Date();
      const unlock = new Date(now.getTime() + 7 * 86400000);
      const unlockDate = unlock.toISOString().slice(0, 10);

      const payload = {
        user_id: userId,
        goal: draft.goal,
        training_days_per_week: draft.days,
        equipment_access: draft.equipment,
        body_data_type: draft.bodyDataType,
        dexa_body_fat_pct: draft.bodyDataType === "dexa" ? Number(draft.dexaBf) : null,
        dexa_lean_mass_kg: draft.bodyDataType === "dexa" ? Number(draft.dexaLean) : null,
        measurement_waist_cm: draft.bodyDataType === "measurements" ? Number(draft.waist) : null,
        measurement_hip_cm: draft.bodyDataType === "measurements" ? Number(draft.hip) : null,
        measurement_weight_kg: draft.bodyDataType === "measurements" ? Number(draft.weight) : null,
        measurement_height_cm: draft.bodyDataType === "measurements" ? Number(draft.height) : null,
        profile_completed_at: now.toISOString(),
        plan_unlock_date: unlockDate,
      };

      const { error } = await supabase
        .from("profiles")
        .upsert(payload, { onConflict: "user_id" });
      if (error) throw error;

      const { error: fnErr } = await supabase.functions.invoke("generate-plan", {
        body: { user_id: userId },
      });
      if (fnErr) {
        // Non-blocking — plan generation will be retried later.
        console.warn("generate-plan failed", fnErr);
      }

      navigate({ to: "/dashboard" });
    } catch (e: any) {
      toast.error(e?.message ?? "Could not save profile");
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-bg-1 pb-24">
      <header className="flex items-center justify-between px-5 pt-6">
        <button onClick={step === 1 ? () => navigate({ to: "/" }) : back} className="text-text-secondary">
          <ChevronLeft size={24} />
        </button>
        <span className="text-[11px] uppercase tracking-wider text-text-tertiary">
          Step {step} of {TOTAL}
        </span>
        <span className="w-6" />
      </header>

      <div className="mx-5 mt-4 h-1 rounded-full bg-white/5 overflow-hidden">
        <div className="h-full gradient-brand transition-all" style={{ width: `${(step / TOTAL) * 100}%` }} />
      </div>

      <main className="px-5 mt-8">
        {step === 1 && <GoalStep value={draft.goal} onChange={(goal) => patch({ goal })} />}
        {step === 2 && <DaysStep value={draft.days} onChange={(days) => patch({ days })} />}
        {step === 3 && <EquipmentStep value={draft.equipment} onChange={(equipment) => patch({ equipment })} />}
        {step === 4 && <BodyStep draft={draft} patch={patch} />}
        {step === 5 && <ReviewStep draft={draft} />}
      </main>

      <footer className="fixed inset-x-0 bottom-0 p-5 bg-gradient-to-t from-bg-1 via-bg-1 to-transparent pt-10">
        {step < TOTAL ? (
          <button
            disabled={!canContinue}
            onClick={next}
            className="w-full rounded-2xl gradient-brand text-white py-3.5 text-sm font-semibold disabled:opacity-40"
          >
            Continue
          </button>
        ) : (
          <button
            disabled={submitting}
            onClick={submit}
            className="w-full rounded-2xl gradient-brand text-white py-3.5 text-sm font-semibold disabled:opacity-40"
          >
            {submitting ? "Generating your plan…" : "Generate my plan"}
          </button>
        )}
      </footer>
    </div>
  );
}

function StepHeader({ title, sub }: { title: string; sub?: string }) {
  return (
    <div className="mb-6">
      <h1 className="text-2xl font-bold">{title}</h1>
      {sub && <p className="mt-1 text-sm text-text-secondary">{sub}</p>}
    </div>
  );
}

function GoalStep({ value, onChange }: { value: Goal | null; onChange: (g: Goal) => void }) {
  return (
    <>
      <StepHeader title="What's your goal?" sub="We'll tune training and nutrition around this." />
      <div className="space-y-2">
        {GOALS.map(({ id, label, desc, Icon }) => {
          const active = value === id;
          return (
            <button
              key={id}
              onClick={() => onChange(id)}
              className={`w-full flex items-center gap-3 rounded-2xl p-4 text-left border transition ${
                active ? "border-accent bg-accent/10" : "border-white/5 bg-bg-2"
              }`}
            >
              <div className={`h-10 w-10 rounded-xl flex items-center justify-center ${active ? "gradient-brand text-white" : "bg-bg-1 text-text-secondary"}`}>
                <Icon size={18} />
              </div>
              <div className="flex-1">
                <p className="font-semibold text-sm">{label}</p>
                <p className="text-xs text-text-tertiary">{desc}</p>
              </div>
              {active && <Check size={18} className="text-accent" />}
            </button>
          );
        })}
      </div>
    </>
  );
}

function DaysStep({ value, onChange }: { value: number | null; onChange: (n: number) => void }) {
  return (
    <>
      <StepHeader title="How many days per week can you train?" />
      <div className="grid grid-cols-3 gap-2">
        {[1, 2, 3, 4, 5, 6].map((n) => {
          const active = value === n;
          return (
            <button
              key={n}
              onClick={() => onChange(n)}
              className={`rounded-2xl py-6 text-center border transition ${
                active ? "border-accent bg-accent/10" : "border-white/5 bg-bg-2"
              }`}
            >
              <p className="text-3xl font-bold">{n}</p>
              <p className="text-[10px] uppercase tracking-wider text-text-tertiary mt-1">
                {n === 1 ? "day" : "days"}
              </p>
            </button>
          );
        })}
      </div>
    </>
  );
}

function EquipmentStep({ value, onChange }: { value: Equipment | null; onChange: (e: Equipment) => void }) {
  return (
    <>
      <StepHeader title="What equipment do you have access to?" />
      <div className="space-y-2">
        {EQUIPMENT.map(({ id, label, desc }) => {
          const active = value === id;
          return (
            <button
              key={id}
              onClick={() => onChange(id)}
              className={`w-full flex items-center justify-between rounded-2xl p-4 text-left border transition ${
                active ? "border-accent bg-accent/10" : "border-white/5 bg-bg-2"
              }`}
            >
              <div>
                <p className="font-semibold text-sm">{label}</p>
                <p className="text-xs text-text-tertiary">{desc}</p>
              </div>
              {active && <Check size={18} className="text-accent" />}
            </button>
          );
        })}
      </div>
    </>
  );
}

function BodyStep({ draft, patch }: { draft: Draft; patch: (p: Partial<Draft>) => void }) {
  const tabBtn = (id: BodyDataType, label: string) => {
    const active = draft.bodyDataType === id;
    return (
      <button
        onClick={() => patch({ bodyDataType: id })}
        className={`flex-1 rounded-xl py-2.5 text-xs font-semibold border ${
          active ? "border-accent bg-accent/10 text-white" : "border-white/5 bg-bg-2 text-text-secondary"
        }`}
      >
        {label}
      </button>
    );
  };

  return (
    <>
      <StepHeader title="Body data" sub="Optional — improves accuracy. You can skip this." />

      <div className="flex gap-2 mb-4">
        {tabBtn(null, "Skip for now")}
        {tabBtn("dexa", "DEXA scan")}
        {tabBtn("measurements", "Measurements")}
      </div>

      {draft.bodyDataType === "dexa" && (
        <div className="space-y-3">
          <Field label="Body fat %" value={draft.dexaBf} onChange={(v) => patch({ dexaBf: v })} suffix="%" />
          <Field label="Lean mass" value={draft.dexaLean} onChange={(v) => patch({ dexaLean: v })} suffix="kg" />
        </div>
      )}

      {draft.bodyDataType === "measurements" && (
        <div className="space-y-3">
          <Field label="Waist" value={draft.waist} onChange={(v) => patch({ waist: v })} suffix="cm" />
          <Field label="Hip" value={draft.hip} onChange={(v) => patch({ hip: v })} suffix="cm" />
          <Field label="Weight" value={draft.weight} onChange={(v) => patch({ weight: v })} suffix="kg" />
          <Field label="Height" value={draft.height} onChange={(v) => patch({ height: v })} suffix="cm" />
        </div>
      )}

      {draft.bodyDataType === null && (
        <p className="text-center text-xs text-text-tertiary mt-8">
          No body data shared — you can add this later in Settings.
        </p>
      )}
    </>
  );
}

function Field({ label, value, onChange, suffix }: { label: string; value: string; onChange: (v: string) => void; suffix?: string }) {
  return (
    <label className="flex items-center justify-between rounded-2xl bg-bg-2 border border-white/5 px-4 py-3">
      <span className="text-sm text-text-secondary">{label}</span>
      <span className="flex items-center gap-1">
        <input
          type="number"
          inputMode="decimal"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="w-20 bg-transparent text-right text-sm font-semibold focus:outline-none"
          placeholder="—"
        />
        {suffix && <span className="text-xs text-text-tertiary">{suffix}</span>}
      </span>
    </label>
  );
}

function ReviewStep({ draft }: { draft: Draft }) {
  const goalLabel = GOALS.find((g) => g.id === draft.goal)?.label ?? "—";
  const eqLabel = EQUIPMENT.find((e) => e.id === draft.equipment)?.label ?? "—";
  return (
    <>
      <StepHeader title="Review" sub="Confirm and we'll build your plan." />
      <div className="rounded-2xl bg-bg-2 border border-white/5 divide-y divide-white/5">
        <Row label="Goal" value={goalLabel} />
        <Row label="Training days" value={`${draft.days ?? "—"} / week`} />
        <Row label="Equipment" value={eqLabel} />
        <Row
          label="Body data"
          value={
            draft.bodyDataType === "dexa"
              ? `DEXA · ${draft.dexaBf}% · ${draft.dexaLean}kg`
              : draft.bodyDataType === "measurements"
              ? `Waist ${draft.waist} · Hip ${draft.hip} · ${draft.weight}kg · ${draft.height}cm`
              : "Not provided"
          }
        />
      </div>
      <p className="mt-4 text-center text-[11px] text-text-tertiary">
        Your plan unlocks for customization 7 days from now.
      </p>
    </>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between px-4 py-3.5">
      <span className="text-sm text-text-secondary">{label}</span>
      <span className="text-sm font-medium text-right">{value}</span>
    </div>
  );
}
