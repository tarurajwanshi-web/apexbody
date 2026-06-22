import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { ChevronLeft, Check, Trophy, Flame, Dumbbell, Zap, Activity, Sparkles, Watch, Pencil } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useServerFn } from "@tanstack/react-start";
import { logBodyMeasurement } from "@/lib/shield.functions";
import { getBrowserTimezone } from "@/lib/dates";
import { toast } from "sonner";
import { z } from "zod";

export const Route = createFileRoute("/_authenticated/onboarding")({
  head: () => ({ meta: [{ title: "Profile setup — APEX" }] }),
  validateSearch: z.object({ reset: z.string().optional() }),
  component: ProfileSetup,
});


type Goal = "recomposition" | "muscle_gain" | "fat_loss" | "strength" | "athletic_performance";
type Equipment = "home_gym_db_only" | "commercial_gym" | "limited_equipment" | "bodyweight_only";
type BodyDataType = "dexa" | "measurements" | null;
type LengthUnit = "cm" | "in";
type WeightUnit = "kg" | "lb";
type Sex = "male" | "female";
type InputPath = "device" | "manual";

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

const TOTAL = 8; // 1 About-you  2 Recovery-method  3 Goal  4 Days  5 Equipment  6 Body-data  7 Review

type Draft = {
  name: string;
  age: string;
  sex: Sex | null;
  inputPath: InputPath | null;
  goal: Goal | null;
  days: number;
  trainingDays: string[];
  equipment: Equipment | null;
  bodyDataType: BodyDataType;       // "dexa" | "measurements" | null  (null = skipped)
  dexaBf: string;                   // body-fat %  (path-agnostic; named for legacy column)
  dexaLean: string;                 // lean mass kg (device path only)
  dexaFileName: null;               // legacy; always null now
  waist: string;                    // cm canonical
  hip: string;                      // cm canonical
  arm: string;                      // cm canonical
  thigh: string;                    // cm canonical
  weight: string;                   // kg canonical
  height: string;                   // cm canonical
};

const EMPTY: Draft = {
  name: "", age: "", sex: null, inputPath: null,
  goal: null, days: 3, trainingDays: [], equipment: null, bodyDataType: null,
  dexaBf: "", dexaLean: "", dexaFileName: null,
  waist: "", hip: "", arm: "", thigh: "", weight: "", height: "",
};


function ProfileSetup() {
  const navigate = useNavigate();
  const { reset: isResetParam } = Route.useSearch();
  const isReset = isResetParam === "true";
  const logMeasure = useServerFn(logBodyMeasurement);
  const minStep = isReset ? 3 : 1;
  const [step, setStep] = useState(minStep);
  const [bodySub, setBodySub] = useState<"A" | "B">("A"); // sub-step inside step 6
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [submitting, setSubmitting] = useState(false);

  const patch = (p: Partial<Draft>) => setDraft((d) => ({ ...d, ...p }));

  // Step 6 sub-A requires: a path picked + weight + body-fat + height (needed for BMR).
  const bodyAValid = (() => {
    if (draft.bodyDataType === null) return false;
    return !!draft.weight && !!draft.dexaBf && !!draft.height;
  })();
  // Step 6 sub-B circumferences are always optional.
  const bodyBValid = true;

  const canContinue = (() => {
    switch (step) {
      case 1: {
        const a = Number(draft.age);
        return draft.name.trim().length >= 1 && !!draft.sex && Number.isFinite(a) && a >= 10 && a <= 100;
      }
      case 2: return !!draft.inputPath;
      case 3: return !!draft.goal;
      case 4: return draft.trainingDays.length >= 1;
      case 5: return !!draft.equipment;
      case 6: return bodySub === "A" ? bodyAValid : bodyBValid;
      case 7: return true;
      default: return false;
    }
  })();

  const next = () => {
    if (step === 6 && bodySub === "A") { setBodySub("B"); return; }
    if (step === 6 && bodySub === "B") { setBodySub("A"); setStep((s) => Math.min(s + 1, TOTAL - 1)); return; }
    setStep((s) => Math.min(s + 1, TOTAL - 1));
  };
  const back = () => {
    if (step === 6 && bodySub === "B") { setBodySub("A"); return; }
    setStep((s) => Math.max(s - 1, minStep));
  };

  const skipBody = () => {
    patch({
      bodyDataType: null,
      dexaBf: "", dexaLean: "",
      waist: "", hip: "", arm: "", thigh: "",
      weight: "", height: "",
    });
    setBodySub("A");
    setStep((s) => Math.min(s + 1, TOTAL - 1));
  };

  const submit = async () => {
    setSubmitting(true);
    try {
      const { data: userRes, error: uerr } = await supabase.auth.getUser();
      if (uerr || !userRes.user) throw new Error("Not signed in");
      const userId = userRes.user.id;

      const trainingDaysCount = draft.trainingDays.length || draft.days;

      let payload: any;
      if (isReset) {
        // Reset mode: only update plan-shaping fields. Identity, recovery method,
        // and profile_completed_at are preserved so we don't reset learning phase.
        payload = {
          user_id: userId,
          goal: draft.goal,
          training_days_per_week: trainingDaysCount,
          training_day_codes: draft.trainingDays,
          equipment_access: draft.equipment,
          body_data_type: draft.bodyDataType,
          dexa_body_fat_pct: draft.bodyDataType === "dexa" && draft.dexaBf ? Number(draft.dexaBf) : null,
          dexa_lean_mass_kg: draft.bodyDataType === "dexa" && draft.dexaLean ? Number(draft.dexaLean) : null,
          measurement_waist_cm: draft.waist ? Number(draft.waist) : null,
          measurement_hip_cm: draft.hip ? Number(draft.hip) : null,
          measurement_weight_kg: draft.weight ? Number(draft.weight) : null,
          measurement_height_cm: draft.height ? Number(draft.height) : null,
        };
      } else {
        const now = new Date();
        const unlock = new Date(now.getTime() + 7 * 86400000);
        const unlockDate = unlock.toISOString().slice(0, 10);
        payload = {
          user_id: userId,
          name: draft.name.trim(),
          age: Number(draft.age),
          biological_sex: draft.sex,
          input_path_preference: draft.inputPath,
          goal: draft.goal,
          training_days_per_week: trainingDaysCount,
          training_day_codes: draft.trainingDays,
          equipment_access: draft.equipment,
          body_data_type: draft.bodyDataType,
          dexa_body_fat_pct: draft.bodyDataType === "dexa" && draft.dexaBf ? Number(draft.dexaBf) : null,
          dexa_lean_mass_kg: draft.bodyDataType === "dexa" && draft.dexaLean ? Number(draft.dexaLean) : null,
          measurement_waist_cm: draft.waist ? Number(draft.waist) : null,
          measurement_hip_cm: draft.hip ? Number(draft.hip) : null,
          measurement_weight_kg: draft.weight ? Number(draft.weight) : null,
          measurement_height_cm: draft.height ? Number(draft.height) : null,
          profile_completed_at: now.toISOString(),
          plan_unlock_date: unlockDate,
          timezone: getBrowserTimezone(),
        };
      }

      const { error } = await supabase.from("profiles").upsert(payload, { onConflict: "user_id" });
      if (error) throw error;

      // Persist a per-entry row in body_measurement_events so the new history table
      // gets seeded from onboarding (Section 6 requirement: every save = a dated row).
      if (draft.bodyDataType !== null) {
        try {
          await logMeasure({
            data: {
              source: draft.bodyDataType === "dexa" ? "dexa" : "manual",
              weight_kg: draft.weight ? Number(draft.weight) : null,
              body_fat_pct: draft.dexaBf ? Number(draft.dexaBf) : null,
              lean_mass_kg: draft.bodyDataType === "dexa" && draft.dexaLean ? Number(draft.dexaLean) : null,
              waist_cm: draft.waist ? Number(draft.waist) : null,
              hip_cm: draft.hip ? Number(draft.hip) : null,
              arm_cm: draft.arm ? Number(draft.arm) : null,
              thigh_cm: draft.thigh ? Number(draft.thigh) : null,
              client_timezone: getBrowserTimezone(),
            },
          });
        } catch (e) {
          console.warn("logBodyMeasurement failed", e);
        }
      }

      // Mirror name to local store so the dashboard greets immediately.
      if (!isReset) {
        try {
          const raw = localStorage.getItem("apex_user_profile");
          const obj = raw ? JSON.parse(raw) : {};
          obj.name = draft.name.trim();
          obj.goal = draft.goal;
          localStorage.setItem("apex_user_profile", JSON.stringify(obj));
        } catch {}
      }

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

  if (submitting) return <BuildingPlanScreen />;

  const stepLabel = step === 6 ? `Step 6${bodySub} of ${TOTAL - 1}` : `Step ${step} of ${TOTAL - 1}`;

  return (
    <div className="min-h-screen bg-bg-1 pb-32" style={{ paddingTop: "env(safe-area-inset-top, 0px)" }}>
      <header className="flex items-center justify-between px-5 pt-6">
        <button onClick={step === 1 ? () => navigate({ to: "/" }) : back} className="text-text-secondary">
          <ChevronLeft size={24} />
        </button>
        <span className="text-[11px] uppercase tracking-wider text-text-tertiary">{stepLabel}</span>
        <span className="w-6" />
      </header>

      <div className="mx-5 mt-4 h-1 rounded-full bg-white/5 overflow-hidden">
        <div className="h-full gradient-brand transition-all" style={{ width: `${(step / (TOTAL - 1)) * 100}%` }} />
      </div>

      <main className="px-5 mt-8 max-w-[480px] mx-auto">
        {step === 1 && <AboutYouStep name={draft.name} age={draft.age} sex={draft.sex} onName={(n) => patch({ name: n })} onAge={(age) => patch({ age })} onSex={(sex) => patch({ sex })} />}
        {step === 2 && <RecoveryMethodStep value={draft.inputPath} onChange={(v) => patch({ inputPath: v })} />}
        {step === 3 && <GoalStep value={draft.goal} onChange={(goal) => patch({ goal })} />}
        {step === 4 && <DaysStep value={draft.days} onChange={(days) => patch({ days })} />}
        {step === 5 && <EquipmentStep value={draft.equipment} onChange={(equipment) => patch({ equipment })} />}
        {step === 6 && <BodyStep draft={draft} patch={patch} subStep={bodySub} onSkip={skipBody} />}
        {step === 7 && <ReviewStep draft={draft} />}
      </main>

      <footer
        className="fixed inset-x-0 bottom-0 z-20 pt-10"
        style={{
          background: "linear-gradient(to top, var(--bg-1) 0%, var(--bg-1) 60%, transparent 100%)",
          paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 20px)",
        }}
      >
        <div className="mx-auto max-w-[480px] px-5">
          {step < TOTAL - 1 ? (
            <button
              disabled={!canContinue}
              onClick={next}
              className="block w-full rounded-2xl gradient-brand text-white py-3.5 text-sm font-semibold disabled:opacity-40"
              style={{ borderRadius: 18 }}
            >
              {step === 6 && bodySub === "A" ? "Next: measurements" : "Continue"}
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

const SELECTED_STYLE: React.CSSProperties = {
  background: "linear-gradient(135deg, rgba(124,58,237,0.28), rgba(59,130,246,0.22))",
  borderColor: "rgba(167,139,250,0.7)",
  boxShadow: "0 0 0 1px rgba(167,139,250,0.35), 0 8px 24px -12px rgba(124,58,237,0.5)",
};

function AboutYouStep({
  name, age, sex, onName, onAge, onSex,
}: { name: string; age: string; sex: Sex | null; onName: (v: string) => void; onAge: (v: string) => void; onSex: (v: Sex) => void }) {
  return (
    <>
      <StepHeader title="About you" sub="Quick basics so we can calculate your targets." />

      <div className="space-y-3">
        <label className="flex items-center justify-between rounded-2xl bg-bg-2 border border-white/5 px-4 py-3">
          <span className="text-sm text-text-secondary">Name</span>
          <input
            type="text"
            value={name}
            onChange={(e) => onName(e.target.value)}
            placeholder="What should we call you?"
            className="w-44 bg-transparent text-right text-sm font-semibold focus:outline-none placeholder:text-text-tertiary"
            autoComplete="given-name"
            style={{ fontSize: 16 }}
          />
        </label>

        <label className="flex items-center justify-between rounded-2xl bg-bg-2 border border-white/5 px-4 py-3">
          <span className="text-sm text-text-secondary">Age</span>
          <span className="flex items-center gap-1">
            <input
              type="number" inputMode="numeric" min={10} max={100} step={1}
              value={age}
              onChange={(e) => onAge(e.target.value.replace(/[^\d]/g, ""))}
              placeholder="—"
              className="w-20 bg-transparent text-right text-sm font-semibold focus:outline-none"
              style={{ fontSize: 16 }}
            />
            <span className="text-xs text-text-tertiary">yrs</span>
          </span>
        </label>

        <div>
          <p className="mb-2 text-[11px] uppercase tracking-wider text-text-tertiary">Biological sex</p>
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
          <p className="mt-3 text-[11px] text-text-tertiary">Used to estimate metabolic rate (Mifflin-St Jeor).</p>
        </div>
      </div>
    </>
  );
}

function RecoveryMethodStep({ value, onChange }: { value: InputPath | null; onChange: (v: InputPath) => void }) {
  const opts: { id: InputPath; label: string; desc: string; Icon: typeof Watch }[] = [
    { id: "device", label: "I have a wearable", desc: "WHOOP, Oura, Garmin, Apple Watch — we'll read your recovery and sleep data directly.", Icon: Watch },
    { id: "manual", label: "I'll log manually", desc: "Quick daily check-in — takes 10 seconds.", Icon: Pencil },
  ];
  return (
    <>
      <StepHeader title="How will you track recovery?" sub="This shapes how your APEX score is calculated. You can change this later in Settings." />
      <div className="space-y-2">
        {opts.map(({ id, label, desc, Icon }) => {
          const active = value === id;
          return (
            <button
              key={id} type="button" onClick={() => onChange(id)}
              className={`w-full flex items-start gap-3 rounded-2xl p-4 text-left border transition ${active ? "" : "border-white/5 bg-bg-2"}`}
              style={active ? SELECTED_STYLE : undefined}
            >
              <div className={`h-10 w-10 rounded-xl flex items-center justify-center shrink-0 ${active ? "gradient-brand text-white" : "bg-bg-1 text-text-secondary"}`}>
                <Icon size={18} />
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-semibold text-sm">{label}</p>
                <p className="text-xs text-text-tertiary mt-0.5 leading-snug">{desc}</p>
              </div>
              {active && <Check size={18} className="text-white shrink-0 mt-1" />}
            </button>
          );
        })}
      </div>
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
            <button key={id} type="button" onClick={() => onChange(id)}
              className={`w-full flex items-center gap-3 rounded-2xl p-4 text-left border transition ${active ? "" : "border-white/5 bg-bg-2"}`}
              style={active ? SELECTED_STYLE : undefined}>
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
          <div className="absolute inset-x-0 h-2 rounded-full bg-white/10" />
          <div className="absolute h-2 rounded-full gradient-brand pointer-events-none" style={{ width: `${pct}%` }} />
          <div className="absolute h-6 w-6 rounded-full bg-white shadow-lg pointer-events-none -translate-x-1/2"
            style={{ left: `${pct}%`, boxShadow: "0 0 0 4px rgba(124,58,237,0.25)" }} />
          <input type="range" min={1} max={6} step={1} value={value}
            onChange={(e) => onChange(Number(e.target.value))}
            className="relative w-full h-10 opacity-0 cursor-pointer z-10" aria-label="Training days per week" />
        </div>
        <div className="mt-3 flex justify-between px-0.5">
          {[1, 2, 3, 4, 5, 6].map((n) => (
            <button key={n} type="button" onClick={() => onChange(n)}
              className={`text-xs tabular-nums w-6 h-6 rounded-full transition ${n === value ? "text-white font-semibold" : "text-text-tertiary"}`}>
              {n}
            </button>
          ))}
        </div>
      </div>
      <p className="mt-10 text-center text-xs text-text-tertiary">Drag the slider or tap a number.</p>
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
            <button key={id} type="button" onClick={() => onChange(id)}
              className={`w-full flex items-center justify-between rounded-2xl p-4 text-left border transition ${active ? "" : "border-white/5 bg-bg-2"}`}
              style={active ? SELECTED_STYLE : undefined}>
              <div>
                <p className="font-semibold text-sm text-white">{label}</p>
                <p className="text-xs text-text-tertiary">{desc}</p>
              </div>
              {active && <div className="h-7 w-7 rounded-full gradient-brand flex items-center justify-center"><Check size={16} className="text-white" /></div>}
            </button>
          );
        })}
      </div>
    </>
  );
}

function cmToIn(cm: number) { return cm / 2.54; }
function inToCm(inches: number) { return inches * 2.54; }
function kgToLb(kg: number) { return kg * 2.20462; }
function lbToKg(lb: number) { return lb / 2.20462; }

function BodyStep({
  draft, patch, subStep, onSkip,
}: { draft: Draft; patch: (p: Partial<Draft>) => void; subStep: "A" | "B"; onSkip: () => void }) {
  const [wUnit, setWUnit] = useState<WeightUnit>("kg");
  const [lUnit, setLUnit] = useState<LengthUnit>("cm");

  const pathBtn = (id: Exclude<BodyDataType, null>, label: string, sub: string) => {
    const active = draft.bodyDataType === id;
    return (
      <button
        type="button"
        onClick={() => patch({ bodyDataType: id })}
        className={`flex-1 rounded-xl py-3 px-3 text-left border transition ${active ? "text-white" : "border-white/5 bg-bg-2 text-text-secondary"}`}
        style={active ? SELECTED_STYLE : undefined}
      >
        <p className="text-[13px] font-semibold">{label}</p>
        <p className="text-[11px] text-text-tertiary mt-0.5">{sub}</p>
      </button>
    );
  };

  if (subStep === "A") {
    return (
      <>
        <StepHeader title="Body composition" sub="Required for accurate macro targets — takes 20 seconds." />

        <div className="flex gap-2 mb-2">
          {pathBtn("dexa", "I have DEXA / InBody", "Enter scan results")}
          {pathBtn("measurements", "Estimate manually", "Quick visual estimate")}
        </div>
        <div className="text-right mb-5">
          <button type="button" onClick={onSkip} className="text-xs underline underline-offset-2 text-text-tertiary">
            Skip for now →
          </button>
        </div>

        {draft.bodyDataType !== null && (
          <div className="space-y-3">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[11px] uppercase tracking-wider text-text-tertiary">Weight unit</span>
              <UnitToggle options={[{ id: "kg", label: "kg" }, { id: "lb", label: "lb" }]} value={wUnit} onChange={(v) => setWUnit(v as WeightUnit)} />
            </div>
            <UnitField label="Weight" cmValue={draft.weight} onChangeCm={(v) => patch({ weight: v })} unit={wUnit} convertToDisplay={kgToLb} convertFromDisplay={lbToKg} />
            <UnitField label="Height" cmValue={draft.height} onChangeCm={(v) => patch({ height: v })} unit={lUnit} convertToDisplay={cmToIn} convertFromDisplay={inToCm} />
            <Field label="Body fat %" value={draft.dexaBf} onChange={(v) => patch({ dexaBf: v })} suffix="%" />
            {draft.bodyDataType === "dexa" && (
              <UnitField label="Lean mass (optional)" cmValue={draft.dexaLean} onChangeCm={(v) => patch({ dexaLean: v })} unit={wUnit} convertToDisplay={kgToLb} convertFromDisplay={lbToKg} />
            )}
            <p className="text-[11px] text-text-tertiary px-1">
              {draft.bodyDataType === "dexa"
                ? "Enter values directly from your DEXA or InBody report."
                : "A rough visual estimate is fine — we'll refine this from your circumference history over time."}
            </p>
          </div>
        )}

        {draft.bodyDataType === null && (
          <p className="text-center text-xs text-text-tertiary mt-10">
            Pick one to continue, or skip and add this later from the Log tab.
          </p>
        )}
      </>
    );
  }

  // Sub-step B — circumferences (all optional).
  return (
    <>
      <StepHeader title="Circumferences" sub="Optional — improves progress tracking." />

      <div className="space-y-3">
        <div className="flex items-center justify-between gap-2">
          <span className="text-[11px] uppercase tracking-wider text-text-tertiary">Length unit</span>
          <UnitToggle options={[{ id: "cm", label: "cm" }, { id: "in", label: "in" }]} value={lUnit} onChange={(v) => setLUnit(v as LengthUnit)} />
        </div>
        <UnitField label="Waist" cmValue={draft.waist} onChangeCm={(v) => patch({ waist: v })} unit={lUnit} convertToDisplay={cmToIn} convertFromDisplay={inToCm} />
        <UnitField label="Hip" cmValue={draft.hip} onChangeCm={(v) => patch({ hip: v })} unit={lUnit} convertToDisplay={cmToIn} convertFromDisplay={inToCm} />
        <UnitField label="Arm" cmValue={draft.arm} onChangeCm={(v) => patch({ arm: v })} unit={lUnit} convertToDisplay={cmToIn} convertFromDisplay={inToCm} />
        <UnitField label="Thigh" cmValue={draft.thigh} onChangeCm={(v) => patch({ thigh: v })} unit={lUnit} convertToDisplay={cmToIn} convertFromDisplay={inToCm} />
      </div>
    </>
  );
}


function UnitToggle({ options, value, onChange }: { options: { id: string; label: string }[]; value: string; onChange: (v: string) => void }) {
  return (
    <div className="inline-flex rounded-full bg-bg-2 border border-white/10 p-0.5">
      {options.map((o) => {
        const active = o.id === value;
        return (
          <button key={o.id} type="button" onClick={() => onChange(o.id)}
            className={`px-3 py-1 text-xs rounded-full transition ${active ? "gradient-brand text-white" : "text-text-tertiary"}`}>
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

/* Stores canonical (cm or kg). Typed input is parsed as a literal number — no implied decimals. */
function UnitField({
  label, cmValue, onChangeCm, unit, convertToDisplay, convertFromDisplay,
}: {
  label: string; cmValue: string; onChangeCm: (v: string) => void;
  unit: string; convertToDisplay: (n: number) => number; convertFromDisplay: (n: number) => number;
}) {
  const isCanonical = unit === "cm" || unit === "kg";
  const [localDisplay, setLocalDisplay] = useState<string>("");

  // Initialize / sync display whenever the canonical value or unit changes from outside.
  useEffect(() => {
    if (cmValue === "") { setLocalDisplay(""); return; }
    if (isCanonical) { setLocalDisplay(cmValue); return; }
    const n = Number(cmValue);
    if (!Number.isFinite(n)) { setLocalDisplay(""); return; }
    setLocalDisplay(String(Number(convertToDisplay(n).toFixed(1))));
  }, [cmValue, unit, isCanonical, convertToDisplay]);

  const handle = (raw: string) => {
    // Allow empty, digits, optional single '.'
    if (raw === "") { setLocalDisplay(""); onChangeCm(""); return; }
    if (!/^\d*\.?\d*$/.test(raw)) return;
    setLocalDisplay(raw);
    if (raw === "." || raw === "") return;
    const n = Number(raw);
    if (!Number.isFinite(n)) return;
    if (isCanonical) onChangeCm(String(n));
    else onChangeCm(String(Number(convertFromDisplay(n).toFixed(2))));
  };

  return (
    <label className="flex items-center justify-between rounded-2xl bg-bg-2 border border-white/5 px-4 py-3">
      <span className="text-sm text-text-secondary">{label}</span>
      <span className="flex items-center gap-1">
        <input
          type="text"
          inputMode="decimal"
          value={localDisplay}
          onChange={(e) => handle(e.target.value)}
          className="w-24 bg-transparent text-right text-sm font-semibold focus:outline-none"
          placeholder="—"
          style={{ fontSize: 16 }}
        />
        <span className="text-xs text-text-tertiary">{unit}</span>
      </span>
    </label>
  );
}

function Field({ label, value, onChange, suffix }: { label: string; value: string; onChange: (v: string) => void; suffix?: string }) {
  const handle = (raw: string) => {
    if (raw === "") return onChange("");
    if (!/^\d*\.?\d*$/.test(raw)) return;
    onChange(raw);
  };
  return (
    <label className="flex items-center justify-between rounded-2xl bg-bg-2 border border-white/5 px-4 py-3">
      <span className="text-sm text-text-secondary">{label}</span>
      <span className="flex items-center gap-1">
        <input
          type="text"
          inputMode="decimal"
          value={value}
          onChange={(e) => handle(e.target.value)}
          className="w-20 bg-transparent text-right text-sm font-semibold focus:outline-none"
          placeholder="—"
          style={{ fontSize: 16 }}
        />
        {suffix && <span className="text-xs text-text-tertiary">{suffix}</span>}
      </span>
    </label>
  );
}

function ReviewStep({ draft }: { draft: Draft }) {
  const goalLabel = GOALS.find((g) => g.id === draft.goal)?.label ?? "—";
  const eqLabel = EQUIPMENT.find((e) => e.id === draft.equipment)?.label ?? "—";
  const pathLabel = draft.inputPath === "device" ? "Wearable device" : draft.inputPath === "manual" ? "Manual log" : "—";
  return (
    <>
      <StepHeader title="Review" sub="Confirm and we'll build your plan." />
      <div className="rounded-2xl bg-bg-2 border border-white/5 divide-y divide-white/5">
        <Row label="Name" value={draft.name || "—"} />
        <Row label="Recovery method" value={pathLabel} />
        <Row label="Goal" value={goalLabel} />
        <Row label="Training days" value={`${draft.days} / week`} />
        <Row label="Equipment" value={eqLabel} />
        <Row label="Body data"
          value={draft.bodyDataType === null
            ? "Not provided"
            : `${draft.bodyDataType === "dexa" ? "DEXA/InBody" : "Manual"} · ${draft.weight || "—"}kg · ${draft.dexaBf || "—"}%`} />

      </div>
      <p className="mt-4 text-center text-[11px] text-text-tertiary">Your plan unlocks for customization 7 days from now.</p>
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

function BuildingPlanScreen() {
  const MESSAGES = [
    "Building your training split…",
    "Calculating your macro targets…",
    "Tailoring exercises to your equipment…",
    "Setting your weekly volume…",
    "Almost ready…",
  ];
  const [idx, setIdx] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setIdx((i) => (i + 1) % MESSAGES.length), 1800);
    return () => clearInterval(id);
  }, []);
  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-6" style={{ backgroundColor: "#06080F" }}>
      <div className="flex items-center justify-center rounded-full"
        style={{ width: 96, height: 96, backgroundImage: "linear-gradient(135deg, #7C3AED 0%, #3B82F6 100%)", boxShadow: "0 0 60px rgba(124, 58, 237, 0.45)", animation: "coach-breathe 2.4s ease-in-out infinite" }}>
        <Sparkles size={28} color="#fff" strokeWidth={2.5} />
      </div>
      <h1 className="mt-8 text-2xl font-semibold text-white text-center">Generating your plan</h1>
      <p key={idx} className="mt-3 text-[14px] text-text-secondary text-center animate-fade-up min-h-[20px]">{MESSAGES[idx]}</p>
      <div className="mt-8 flex gap-1.5">
        <span className="h-2 w-2 rounded-full bg-ai" style={{ animation: "typing-dot 1.2s ease-in-out infinite" }} />
        <span className="h-2 w-2 rounded-full bg-ai" style={{ animation: "typing-dot 1.2s ease-in-out infinite", animationDelay: "150ms" }} />
        <span className="h-2 w-2 rounded-full bg-ai" style={{ animation: "typing-dot 1.2s ease-in-out infinite", animationDelay: "300ms" }} />
      </div>
      <style>{`
        @keyframes coach-breathe { 0%,100% { transform: scale(0.97); } 50% { transform: scale(1.04); } }
        @keyframes typing-dot { 0%,60%,100% { opacity: 0.3; transform: scale(0.85); } 30% { opacity: 1; transform: scale(1); } }
      `}</style>
    </div>
  );
}
