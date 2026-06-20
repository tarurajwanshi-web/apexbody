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
type LengthUnit = "cm" | "in";
type WeightUnit = "kg" | "lb";

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

const TOTAL = 6;

type Sex = "male" | "female";

type Draft = {
  age: string;
  sex: Sex | null;
  goal: Goal | null;
  days: number;
  equipment: Equipment | null;
  bodyDataType: BodyDataType;
  dexaBf: string;
  dexaLean: string;
  // Stored in cm/kg always:
  waist: string;
  hip: string;
  weight: string;
  height: string;
};

const EMPTY: Draft = {
  age: "", sex: null,
  goal: null, days: 3, equipment: null, bodyDataType: null,
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
      case 1: {
        const a = Number(draft.age);
        return !!draft.sex && Number.isFinite(a) && a >= 10 && a <= 100;
      }
      case 2: return !!draft.goal;
      case 3: return draft.days >= 1 && draft.days <= 6;
      case 4: return !!draft.equipment;
      case 5: return bodyPathValid;
      case 6: return true;
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
        age: Number(draft.age),
        biological_sex: draft.sex,
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

      // Fire deterministic macro calc + Claude plan generation in parallel.
      const [macroRes, planRes] = await Promise.allSettled([
        supabase.functions.invoke("calculate-macros", { body: { user_id: userId } }),
        supabase.functions.invoke("generate-plan", { body: { user_id: userId } }),
      ]);
      if (macroRes.status === "rejected") console.warn("calculate-macros failed", macroRes.reason);
      if (planRes.status === "rejected") console.warn("generate-plan failed", planRes.reason);

      navigate({ to: "/dashboard" });
    } catch (e: any) {
      toast.error(e?.message ?? "Could not save profile");
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-bg-1 pb-32">
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

      <main className="px-5 mt-8 max-w-[480px] mx-auto">
        {step === 1 && <AboutYouStep age={draft.age} sex={draft.sex} onAge={(age) => patch({ age })} onSex={(sex) => patch({ sex })} />}
        {step === 2 && <GoalStep value={draft.goal} onChange={(goal) => patch({ goal })} />}
        {step === 3 && <DaysStep value={draft.days} onChange={(days) => patch({ days })} />}
        {step === 4 && <EquipmentStep value={draft.equipment} onChange={(equipment) => patch({ equipment })} />}
        {step === 5 && <BodyStep draft={draft} patch={patch} />}
        {step === 6 && <ReviewStep draft={draft} />}
      </main>

      <footer
        className="fixed inset-x-0 bottom-0 z-20 pt-10 pb-5"
        style={{
          background: "linear-gradient(to top, var(--bg-1) 0%, var(--bg-1) 60%, transparent 100%)",
        }}
      >
        <div className="mx-auto max-w-[480px] px-5">
          {step < TOTAL ? (
            <button
              disabled={!canContinue}
              onClick={next}
              className="block w-full rounded-2xl gradient-brand text-white py-3.5 text-sm font-semibold disabled:opacity-40"
              style={{ borderRadius: 18 }}
            >
              Continue
            </button>
          ) : (
            <button
              disabled={submitting}
              onClick={submit}
              className="block w-full rounded-2xl gradient-brand text-white py-3.5 text-sm font-semibold disabled:opacity-40"
              style={{ borderRadius: 18 }}
            >
              {submitting ? "Generating your plan…" : "Generate my plan"}
            </button>
          )}
        </div>
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

/* ---------- Selected-state helpers (gradient tint) ---------- */
const SELECTED_STYLE: React.CSSProperties = {
  background: "linear-gradient(135deg, rgba(124,58,237,0.28), rgba(59,130,246,0.22))",
  borderColor: "rgba(167,139,250,0.7)",
  boxShadow: "0 0 0 1px rgba(167,139,250,0.35), 0 8px 24px -12px rgba(124,58,237,0.5)",
};

function AboutYouStep({
  age, sex, onAge, onSex,
}: { age: string; sex: Sex | null; onAge: (v: string) => void; onSex: (v: Sex) => void }) {
  return (
    <>
      <StepHeader title="About you" sub="Quick basics so we can calculate your targets." />
      <label className="flex items-center justify-between rounded-2xl bg-bg-2 border border-white/5 px-4 py-3">
        <span className="text-sm text-text-secondary">Age</span>
        <span className="flex items-center gap-1">
          <input
            type="number" inputMode="numeric" min={10} max={100}
            value={age} onChange={(e) => onAge(e.target.value)}
            placeholder="—"
            className="w-20 bg-transparent text-right text-sm font-semibold focus:outline-none"
          />
          <span className="text-xs text-text-tertiary">yrs</span>
        </span>
      </label>
      <p className="mt-5 mb-2 text-[11px] uppercase tracking-wider text-text-tertiary">Biological sex</p>
      <div className="grid grid-cols-2 gap-2">
        {(["male", "female"] as Sex[]).map((s) => {
          const active = sex === s;
          return (
            <button
              key={s} type="button" onClick={() => onSex(s)}
              className={`rounded-2xl py-3 text-sm font-semibold border transition ${active ? "" : "border-white/5 bg-bg-2 text-text-secondary"}`}
              style={active ? SELECTED_STYLE : undefined}
            >
              {s === "male" ? "Male" : "Female"}
            </button>
          );
        })}
      </div>
      <p className="mt-4 text-[11px] text-text-tertiary">Used to estimate metabolic rate (Mifflin-St Jeor).</p>
    </>
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
              type="button"
              onClick={() => onChange(id)}
              className={`w-full flex items-center gap-3 rounded-2xl p-4 text-left border transition ${
                active ? "" : "border-white/5 bg-bg-2"
              }`}
              style={active ? SELECTED_STYLE : undefined}
            >
              <div className={`h-10 w-10 rounded-xl flex items-center justify-center ${active ? "gradient-brand text-white" : "bg-bg-1 text-text-secondary"}`}>
                <Icon size={18} />
              </div>
              <div className="flex-1">
                <p className="font-semibold text-sm">{label}</p>
                <p className="text-xs text-text-tertiary">{desc}</p>
              </div>
              {active && <Check size={18} className="text-white" />}
            </button>
          );
        })}
      </div>
    </>
  );
}

/* ---------- Training-days slider ---------- */
function DaysStep({ value, onChange }: { value: number; onChange: (n: number) => void }) {
  const pct = ((value - 1) / 5) * 100;
  return (
    <>
      <StepHeader title="How many days per week can you train?" />
      <div className="text-center mt-2 mb-8">
        <span className="text-6xl font-bold tabular-nums text-white">{value}</span>
        <span className="ml-2 text-base text-text-tertiary">{value === 1 ? "day" : "days"} / week</span>
      </div>

      <div className="px-2">
        <div className="relative h-10 flex items-center">
          {/* Track */}
          <div className="absolute inset-x-0 h-2 rounded-full bg-white/10" />
          {/* Filled portion */}
          <div
            className="absolute h-2 rounded-full gradient-brand pointer-events-none"
            style={{ width: `${pct}%` }}
          />
          {/* Thumb */}
          <div
            className="absolute h-6 w-6 rounded-full bg-white shadow-lg pointer-events-none -translate-x-1/2"
            style={{ left: `${pct}%`, boxShadow: "0 0 0 4px rgba(124,58,237,0.25)" }}
          />
          {/* Range input (transparent, on top) */}
          <input
            type="range"
            min={1}
            max={6}
            step={1}
            value={value}
            onChange={(e) => onChange(Number(e.target.value))}
            className="relative w-full h-10 opacity-0 cursor-pointer z-10"
            aria-label="Training days per week"
          />
        </div>

        {/* Tick labels */}
        <div className="mt-3 flex justify-between px-0.5">
          {[1, 2, 3, 4, 5, 6].map((n) => (
            <button
              key={n}
              type="button"
              onClick={() => onChange(n)}
              className={`text-xs tabular-nums w-6 h-6 rounded-full transition ${
                n === value ? "text-white font-semibold" : "text-text-tertiary hover:text-text-secondary"
              }`}
            >
              {n}
            </button>
          ))}
        </div>
      </div>

      <p className="mt-10 text-center text-xs text-text-tertiary">
        Drag the slider or tap a number.
      </p>
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
              type="button"
              onClick={() => onChange(id)}
              className={`w-full flex items-center justify-between rounded-2xl p-4 text-left border transition ${
                active ? "" : "border-white/5 bg-bg-2"
              }`}
              style={active ? SELECTED_STYLE : undefined}
            >
              <div>
                <p className="font-semibold text-sm text-white">{label}</p>
                <p className="text-xs text-text-tertiary">{desc}</p>
              </div>
              {active && (
                <div className="h-7 w-7 rounded-full gradient-brand flex items-center justify-center">
                  <Check size={16} className="text-white" />
                </div>
              )}
            </button>
          );
        })}
      </div>
    </>
  );
}

/* ---------- Body data: tabs + skip link + unit toggles ---------- */

function cmToIn(cm: number) { return cm / 2.54; }
function inToCm(inches: number) { return inches * 2.54; }
function kgToLb(kg: number) { return kg * 2.20462; }
function lbToKg(lb: number) { return lb / 2.20462; }

function BodyStep({ draft, patch }: { draft: Draft; patch: (p: Partial<Draft>) => void }) {
  const [lenUnit, setLenUnit] = useState<LengthUnit>("cm");
  const [wUnit, setWUnit] = useState<WeightUnit>("kg");

  const tabBtn = (id: Exclude<BodyDataType, null>, label: string) => {
    const active = draft.bodyDataType === id;
    return (
      <button
        type="button"
        onClick={() => patch({ bodyDataType: id })}
        className={`flex-1 rounded-xl py-2.5 text-xs font-semibold border transition ${
          active ? "text-white" : "border-white/5 bg-bg-2 text-text-secondary"
        }`}
        style={active ? SELECTED_STYLE : undefined}
      >
        {label}
      </button>
    );
  };

  return (
    <>
      <StepHeader title="Body data" sub="Optional — improves accuracy." />

      <div className="flex gap-2 mb-2">
        {tabBtn("dexa", "DEXA scan")}
        {tabBtn("measurements", "Measurements")}
      </div>
      <div className="text-right mb-5">
        <button
          type="button"
          onClick={() => patch({ bodyDataType: null })}
          className={`text-xs underline underline-offset-2 ${
            draft.bodyDataType === null ? "text-text-secondary" : "text-text-tertiary hover:text-text-secondary"
          }`}
        >
          Skip for now
        </button>
      </div>

      {draft.bodyDataType === "dexa" && (
        <div className="space-y-3">
          <Field label="Body fat %" value={draft.dexaBf} onChange={(v) => patch({ dexaBf: v })} suffix="%" />
          <Field label="Lean mass" value={draft.dexaLean} onChange={(v) => patch({ dexaLean: v })} suffix="kg" />
        </div>
      )}

      {draft.bodyDataType === "measurements" && (
        <div className="space-y-3">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[11px] uppercase tracking-wider text-text-tertiary">Length</span>
            <UnitToggle
              options={[{ id: "cm", label: "cm" }, { id: "in", label: "in" }]}
              value={lenUnit}
              onChange={(v) => setLenUnit(v as LengthUnit)}
            />
          </div>
          <UnitField
            label="Waist"
            cmValue={draft.waist}
            onChangeCm={(v) => patch({ waist: v })}
            unit={lenUnit}
            convertToDisplay={cmToIn}
            convertFromDisplay={inToCm}
          />
          <UnitField
            label="Hip"
            cmValue={draft.hip}
            onChangeCm={(v) => patch({ hip: v })}
            unit={lenUnit}
            convertToDisplay={cmToIn}
            convertFromDisplay={inToCm}
          />
          <UnitField
            label="Height"
            cmValue={draft.height}
            onChangeCm={(v) => patch({ height: v })}
            unit={lenUnit}
            convertToDisplay={cmToIn}
            convertFromDisplay={inToCm}
          />

          <div className="flex items-center justify-between gap-2 pt-2">
            <span className="text-[11px] uppercase tracking-wider text-text-tertiary">Weight</span>
            <UnitToggle
              options={[{ id: "kg", label: "kg" }, { id: "lb", label: "lb" }]}
              value={wUnit}
              onChange={(v) => setWUnit(v as WeightUnit)}
            />
          </div>
          <UnitField
            label="Weight"
            cmValue={draft.weight}
            onChangeCm={(v) => patch({ weight: v })}
            unit={wUnit}
            convertToDisplay={kgToLb}
            convertFromDisplay={lbToKg}
          />
        </div>
      )}

      {draft.bodyDataType === null && (
        <p className="text-center text-xs text-text-tertiary mt-10">
          No body data shared — you can add this later in Settings.
        </p>
      )}
    </>
  );
}

function UnitToggle({
  options, value, onChange,
}: {
  options: { id: string; label: string }[];
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="inline-flex rounded-full bg-bg-2 border border-white/10 p-0.5">
      {options.map((o) => {
        const active = o.id === value;
        return (
          <button
            key={o.id}
            type="button"
            onClick={() => onChange(o.id)}
            className={`px-3 py-1 text-xs rounded-full transition ${
              active ? "gradient-brand text-white" : "text-text-tertiary"
            }`}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

/* Stores cm or kg internally; displays converted value while typing in display unit. */
function UnitField({
  label, cmValue, onChangeCm, unit, convertToDisplay, convertFromDisplay,
}: {
  label: string;
  cmValue: string; // stored canonical (cm or kg)
  onChangeCm: (v: string) => void;
  unit: string; // "cm" | "in" | "kg" | "lb"
  convertToDisplay: (n: number) => number;
  convertFromDisplay: (n: number) => number;
}) {
  const isCanonical = unit === "cm" || unit === "kg";
  const display = (() => {
    if (!cmValue) return "";
    if (isCanonical) return cmValue;
    const n = Number(cmValue);
    if (Number.isNaN(n)) return "";
    return convertToDisplay(n).toFixed(1);
  })();

  const handle = (raw: string) => {
    if (raw === "") return onChangeCm("");
    if (isCanonical) return onChangeCm(raw);
    const n = Number(raw);
    if (Number.isNaN(n)) return onChangeCm("");
    onChangeCm(String(Number(convertFromDisplay(n).toFixed(2))));
  };

  return (
    <label className="flex items-center justify-between rounded-2xl bg-bg-2 border border-white/5 px-4 py-3">
      <span className="text-sm text-text-secondary">{label}</span>
      <span className="flex items-center gap-1">
        <input
          type="number"
          inputMode="decimal"
          value={display}
          onChange={(e) => handle(e.target.value)}
          className="w-24 bg-transparent text-right text-sm font-semibold focus:outline-none"
          placeholder="—"
        />
        <span className="text-xs text-text-tertiary">{unit}</span>
      </span>
    </label>
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
        <Row label="Training days" value={`${draft.days} / week`} />
        <Row label="Equipment" value={eqLabel} />
        <Row
          label="Body data"
          value={
            draft.bodyDataType === "dexa"
              ? `DEXA · ${draft.dexaBf}% · ${draft.dexaLean}kg`
              : draft.bodyDataType === "measurements"
              ? `Waist ${draft.waist}cm · Hip ${draft.hip}cm · ${draft.weight}kg · ${draft.height}cm`
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
