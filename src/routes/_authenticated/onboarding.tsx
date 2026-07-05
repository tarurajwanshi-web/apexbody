import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { ChevronLeft, ChevronDown, Check, Trophy, Flame, Dumbbell, Zap, Activity, Sparkles } from "lucide-react";
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
type LengthUnit = "cm" | "in";
type WeightUnit = "kg" | "lb";
type Sex = "male" | "female";
type ExperienceLevel = "beginner" | "intermediate" | "advanced";
type EatingPattern = "standard" | "intermittent" | "plant_based" | "flexible";

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

const EXPERIENCE: { id: ExperienceLevel; label: string; desc: string; hint: string }[] = [
  { id: "beginner", label: "Beginner", desc: "Less than 1 year of consistent training", hint: "We keep it simple. No jargon." },
  { id: "intermediate", label: "Intermediate", desc: "1–3 years. You know the movements.", hint: "We add structure and progression." },
  { id: "advanced", label: "Advanced", desc: "3+ years. You track sets and effort closely.", hint: "Full RIR-based intensity control." },
];

const EATING_PATTERNS: { id: EatingPattern; label: string; desc: string }[] = [
  { id: "standard", label: "Standard", desc: "3+ meals across the day" },
  { id: "intermittent", label: "Intermittent fasting", desc: "16:8 or similar eating window" },
  { id: "plant_based", label: "Plant-based", desc: "Vegan or vegetarian" },
  { id: "flexible", label: "Flexible", desc: "No fixed pattern" },
];

const TOTAL = 9;

const GOAL_DIRECTION: Record<Goal, "lose" | "gain" | "maintain"> = {
  fat_loss: "lose", muscle_gain: "gain", strength: "gain",
  recomposition: "maintain", athletic_performance: "maintain",
};

const RATE_CEILING: Record<Goal, number> = {
  fat_loss: 1.5, muscle_gain: 0.5, strength: 0.35,
  recomposition: 0.4, athletic_performance: 0.4,
};

const RATE_ZONES: Record<Goal, { max: number; label: string; blurb: string }[]> = {
  fat_loss: [
    { max: 0.5, label: "Sustainable", blurb: "Protects lean mass, easiest to stick to." },
    { max: 1.0, label: "Moderate", blurb: "Faster, still evidence-supported for most people." },
    { max: 1.5, label: "Aggressive", blurb: "Faster results, higher risk of losing muscle alongside fat." },
  ],
  muscle_gain: [
    { max: 0.15, label: "Sustainable", blurb: "Minimizes fat gain while building muscle." },
    { max: 0.25, label: "Moderate", blurb: "Standard lean-gain pace." },
    { max: 0.5, label: "Aggressive", blurb: "Faster scale movement, more of it will be fat, not muscle." },
  ],
  strength: [
    { max: 0.15, label: "Sustainable", blurb: "Small surplus, supports strength adaptation." },
    { max: 0.25, label: "Moderate", blurb: "Standard pace for a strength-focused gain." },
    { max: 0.35, label: "Aggressive", blurb: "Faster gain, more of it will be fat." },
  ],
  recomposition: [
    { max: 0.15, label: "Gentle", blurb: "Wide tolerance — we rarely adjust unless you drift." },
    { max: 0.3, label: "Moderate", blurb: "Standard correction if your weight moves off target." },
    { max: 0.4, label: "Tight", blurb: "We correct quickly — best if you want to hold a precise number." },
  ],
  athletic_performance: [
    { max: 0.15, label: "Gentle", blurb: "Wide tolerance — we rarely adjust unless you drift." },
    { max: 0.3, label: "Moderate", blurb: "Standard correction if your weight moves off target." },
    { max: 0.4, label: "Tight", blurb: "We correct quickly — best if you want to hold a precise number." },
  ],
};

function getZone(goal: Goal, value: number) {
  const zones = RATE_ZONES[goal];
  return zones.find((z) => value <= z.max) ?? zones[zones.length - 1];
}

// Body fat slider config — ACE/ACSM-derived ranges, appearance-only descriptions.
const BF_RANGE = {
  female: { min: 10, max: 50, default: 28 },
  male:   { min: 5,  max: 40, default: 20 },
} as const;

const BF_DESCRIPTIONS = {
  female: [
    { max: 13, label: "Very lean",  cue: "Minimal body fat. Visible muscle separation, very little softness anywhere. Typical of competitive athletes." },
    { max: 20, label: "Athletic",   cue: "Lean with visible muscle tone. Some definition in the arms and legs. Stomach is flat with some muscle visible." },
    { max: 24, label: "Fit",        cue: "Defined shape with some softness. Arms and legs look toned. Stomach is mostly flat. Some curve at the hips and waist." },
    { max: 31, label: "Average",    cue: "Soft and rounded in the midsection. Arms and legs have some shape but no visible muscle. Hips and thighs carry more volume." },
    { max: 38, label: "Soft",       cue: "Noticeable softness across the midsection, arms, and thighs. Little visible muscle definition." },
    { max: 50, label: "Very high",  cue: "Significant fat across the whole body. Stomach protrudes. Arms and legs are thick with no muscle definition." },
  ],
  male: [
    { max: 8,  label: "Very lean",  cue: "Extremely low body fat. Visible abs, striations in shoulders and chest. Typical of competitive athletes." },
    { max: 13, label: "Athletic",   cue: "Visible six-pack at rest or close to it. Clear muscle separation in shoulders and arms. Very little fat anywhere." },
    { max: 17, label: "Fit",        cue: "Flat stomach, some ab definition visible. Arms and shoulders look muscular. A small amount of fat around the waist." },
    { max: 24, label: "Average",    cue: "Soft midsection, no visible abs. Some fat around the waist and lower stomach. Arms have some shape but are not defined." },
    { max: 30, label: "Soft",       cue: "Noticeable belly. Face and neck carry more fat. Arms and chest are soft. Little visible muscle definition." },
    { max: 40, label: "Very high",  cue: "Large stomach, significant fat across the chest, arms, and back. Minimal muscle definition visible anywhere." },
  ],
} as const;

function getBfDescription(pct: number, sex: Sex) {
  const buckets = BF_DESCRIPTIONS[sex];
  return buckets.find((b) => pct <= b.max) ?? buckets[buckets.length - 1];
}

function bfLabelColor(label: string) {
  if (label === "Very lean" || label === "Athletic") return "text-blue-400";
  if (label === "Fit") return "text-green-400";
  if (label === "Soft" || label === "Very high") return "text-amber-400";
  return "text-text-secondary";
}

type Draft = {
  // Step 1
  name: string;
  age: string;
  sex: Sex | null;
  // Step 2
  experienceLevel: ExperienceLevel | null;
  // Step 3
  goal: Goal | null;
  // Step 4
  trainingDays: string[];
  // Step 5
  equipment: Equipment | null;
  // Step 6
  eatingPattern: EatingPattern | null;
  // Step 7 — bodyDataType is computed at submit.
  bodyDataType: "dexa" | "measurements" | null;
  dexaBf: string;
  dexaLean: string;
  waist: string;
  hip: string;
  arm: string;
  thigh: string;
  weight: string;
  height: string;
  bodyFatSkipped: boolean;
  targetWeight: string;
  targetRatePct: string;
};

const EMPTY: Draft = {
  name: "", age: "", sex: null,
  experienceLevel: null,
  goal: null,
  trainingDays: [],
  equipment: null,
  eatingPattern: null,
  bodyDataType: null,
  dexaBf: "", dexaLean: "",
  waist: "", hip: "", arm: "", thigh: "",
  weight: "", height: "",
  bodyFatSkipped: false,
  targetWeight: "", targetRatePct: "",
};

function ProfileSetup() {
  const navigate = useNavigate();
  const { reset: isResetParam } = Route.useSearch();
  const isReset = isResetParam === "true";
  const logMeasure = useServerFn(logBodyMeasurement);
  const minStep = isReset ? 3 : 1;
  const [step, setStep] = useState(minStep);
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [submitting, setSubmitting] = useState(false);
  const [bodySkipped, setBodySkipped] = useState(false);

  const patch = (p: Partial<Draft>) => setDraft((d) => ({ ...d, ...p }));

  // Reset-mode pre-population: hydrate Steps 2 + 6 (skipped in reset flow) and
  // any other plan-shaping fields from the existing profile so submit doesn't
  // null them out.
  useEffect(() => {
    if (!isReset) return;
    let cancelled = false;
    (async () => {
      const { data: userRes } = await supabase.auth.getUser();
      if (!userRes.user) return;
      const { data } = await supabase
        .from("profiles")
        .select("experience_level, eating_pattern, goal, equipment_access, training_day_codes")
        .eq("user_id", userRes.user.id)
        .single();
      if (cancelled || !data) return;
      patch({
        experienceLevel: (data.experience_level as ExperienceLevel | null) ?? null,
        eatingPattern: (data.eating_pattern as EatingPattern | null) ?? null,
        goal: (data.goal as Goal | null) ?? null,
        equipment: (data.equipment_access as Equipment | null) ?? null,
        trainingDays: (data.training_day_codes as string[] | null) ?? [],
      });
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isReset]);

  const bodyDataType: "dexa" | "measurements" | null = useMemo(() => {
    if (bodySkipped) return null;
    if (!draft.weight || !draft.height) return null;
    return draft.dexaLean ? "dexa" : "measurements";
  }, [bodySkipped, draft.weight, draft.height, draft.dexaLean]);

  const canContinue = (() => {
    switch (step) {
      case 1: {
        const a = Number(draft.age);
        return draft.name.trim().length >= 1 && !!draft.sex && Number.isFinite(a) && a >= 10 && a <= 100;
      }
      case 2: return !!draft.experienceLevel;
      case 3: return !!draft.goal;
      case 4: return draft.trainingDays.length >= 1;
      case 5: return !!draft.equipment;
      case 6: return !!draft.eatingPattern;
      case 7: {
        if (bodySkipped) return true;
        if (!draft.weight && !draft.height && !draft.dexaBf) return true;
        return !!draft.weight && !!draft.height;
      }
      case 8: return true;
      default: return false;
    }
  })();

  const next = () => setStep((s) => Math.min(s + 1, TOTAL));
  const back = () => setStep((s) => Math.max(s - 1, minStep));

  const skipBody = () => {
    setBodySkipped(true);
    patch({
      dexaBf: "", dexaLean: "",
      waist: "", hip: "", arm: "", thigh: "",
      weight: "", height: "",
    });
    next();
  };

  const submit = async () => {
    setSubmitting(true);
    try {
      const { data: userRes, error: uerr } = await supabase.auth.getUser();
      if (uerr || !userRes.user) throw new Error("Not signed in");
      const userId = userRes.user.id;

      const trainingDaysCount = draft.trainingDays.length;
      const hasBody = bodyDataType !== null && !!draft.weight && !!draft.height;

      let payload: any;
      if (isReset) {
        payload = {
          user_id: userId,
          experience_level: draft.experienceLevel,
          goal: draft.goal,
          training_days_per_week: trainingDaysCount,
          training_day_codes: draft.trainingDays,
          equipment_access: draft.equipment,
          eating_pattern: draft.eatingPattern,
          body_data_type: bodyDataType,
          dexa_body_fat_pct: hasBody && draft.dexaLean && draft.dexaBf ? Number(draft.dexaBf) : null,
          dexa_lean_mass_kg: hasBody && draft.dexaLean ? Number(draft.dexaLean) : null,
          measurement_waist_cm: draft.waist ? Number(draft.waist) : null,
          measurement_hip_cm: draft.hip ? Number(draft.hip) : null,
          measurement_weight_kg: hasBody ? Number(draft.weight) : null,
          measurement_height_cm: hasBody ? Number(draft.height) : null,
        };
      } else {
        const now = new Date();
        const unlock = new Date(now.getTime() + 7 * 86400000);
        payload = {
          user_id: userId,
          name: draft.name.trim(),
          age: Number(draft.age),
          biological_sex: draft.sex,
          experience_level: draft.experienceLevel,
          input_path_preference: "manual",
          goal: draft.goal,
          training_days_per_week: trainingDaysCount,
          training_day_codes: draft.trainingDays,
          equipment_access: draft.equipment,
          eating_pattern: draft.eatingPattern,
          body_data_type: bodyDataType,
          dexa_body_fat_pct: hasBody && draft.dexaLean && draft.dexaBf ? Number(draft.dexaBf) : null,
          dexa_lean_mass_kg: hasBody && draft.dexaLean ? Number(draft.dexaLean) : null,
          measurement_waist_cm: draft.waist ? Number(draft.waist) : null,
          measurement_hip_cm: draft.hip ? Number(draft.hip) : null,
          measurement_weight_kg: hasBody ? Number(draft.weight) : null,
          measurement_height_cm: hasBody ? Number(draft.height) : null,
          profile_completed_at: now.toISOString(),
          plan_unlock_date: unlock.toISOString().slice(0, 10),
          timezone: getBrowserTimezone(),
        };
      }

      const { error } = await supabase.from("profiles").upsert(payload, { onConflict: "user_id" });
      if (error) throw error;

      if (hasBody) {
        try {
          await logMeasure({
            data: {
              source: bodyDataType === "dexa" ? "dexa" : "manual",
              weight_kg: Number(draft.weight),
              body_fat_pct: draft.dexaBf ? Number(draft.dexaBf) : null,
              lean_mass_kg: bodyDataType === "dexa" && draft.dexaLean ? Number(draft.dexaLean) : null,
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

      if (!isReset) {
        try {
          const raw = localStorage.getItem("apex_user_profile");
          const obj = raw ? JSON.parse(raw) : {};
          obj.name = draft.name.trim();
          obj.goal = draft.goal;
          localStorage.setItem("apex_user_profile", JSON.stringify(obj));
        } catch {}
      }

      if (hasBody) {
        const [macroRes, planRes] = await Promise.allSettled([
          supabase.functions.invoke("calculate-macros", { body: { user_id: userId } }),
          supabase.functions.invoke("generate-plan", { body: { user_id: userId } }),
        ]);
        if (macroRes.status === "rejected") console.warn("calculate-macros failed", macroRes.reason);
        if (planRes.status === "rejected") console.warn("generate-plan failed", planRes.reason);
      } else {
        // Skip-body path still needs a starting macro target. calculate-macros
        // falls back to default anthropometrics (170cm / 70kg / 30y / male)
        // when measurements are absent — the user updates these in Settings
        // later and the weekly review recalibrates from actual intake.
        const [macroRes, planRes] = await Promise.allSettled([
          supabase.functions.invoke("calculate-macros", { body: { user_id: userId } }),
          supabase.functions.invoke("generate-plan", { body: { user_id: userId } }),
        ]);
        if (macroRes.status === "rejected") console.warn("calculate-macros failed", macroRes.reason);
        if (planRes.status === "rejected") console.warn("generate-plan failed", planRes.reason);
      }

      navigate({ to: "/dashboard" });
    } catch (e: any) {
      toast.error(e?.message ?? "Could not save profile");
      setSubmitting(false);
    }
  };

  if (submitting) return <BuildingPlanScreen />;

  const stepLabel = `Step ${step} of ${TOTAL}`;

  return (
    <div className="min-h-screen bg-bg-1 pb-32" style={{ paddingTop: "env(safe-area-inset-top, 0px)" }}>
      <header className="flex items-center justify-between px-5 pt-6">
        <button onClick={step === minStep ? () => navigate({ to: isReset ? "/dashboard" : "/" }) : back} className="text-text-secondary">
          <ChevronLeft size={24} />
        </button>
        <span className="text-[11px] uppercase tracking-wider text-text-tertiary">{stepLabel}</span>
        <span className="w-6" />
      </header>

      <div className="mx-5 mt-4 h-1 rounded-full bg-white/5 overflow-hidden">
        <div className="h-full gradient-brand transition-all" style={{ width: `${(step / TOTAL) * 100}%` }} />
      </div>

      <main className="px-5 mt-8 max-w-[480px] mx-auto">
        {step === 1 && <AboutYouStep name={draft.name} age={draft.age} sex={draft.sex} onName={(n) => patch({ name: n })} onAge={(age) => patch({ age })} onSex={(sex) => patch({ sex })} />}
        {step === 2 && <ExperienceStep value={draft.experienceLevel} onChange={(v) => patch({ experienceLevel: v })} />}
        {step === 3 && <GoalStep value={draft.goal} onChange={(goal) => patch({ goal })} />}
        {step === 4 && <DaysStep value={draft.trainingDays} onChange={(trainingDays) => patch({ trainingDays })} />}
        {step === 5 && <EquipmentStep value={draft.equipment} onChange={(equipment) => patch({ equipment })} />}
        {step === 6 && <EatingPatternStep value={draft.eatingPattern} onChange={(v) => patch({ eatingPattern: v })} />}
        {step === 7 && (
          <BodyStep
            draft={draft}
            patch={patch}
            bodySkipped={bodySkipped}
            unskip={() => setBodySkipped(false)}
            onSkip={skipBody}
          />
        )}
        {step === 8 && <ReviewStep draft={draft} bodyDataType={bodyDataType} />}
      </main>

      <footer
        className="fixed inset-x-0 bottom-0 z-20 pt-10"
        style={{
          background: "linear-gradient(to top, var(--bg-1) 0%, var(--bg-1) 60%, transparent 100%)",
          paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 20px)",
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
              {submitting
                ? "Generating your plan…"
                : bodyDataType === null
                ? "Continue without body data"
                : "Generate my plan"}
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
          <p className="mt-3 text-[11px] text-text-tertiary">Used to calculate your metabolic rate.</p>
        </div>
      </div>
    </>
  );
}

function ExperienceStep({ value, onChange }: { value: ExperienceLevel | null; onChange: (v: ExperienceLevel) => void }) {
  return (
    <>
      <StepHeader title="How long have you been training?" sub="Shapes your plan complexity and how we talk about effort." />
      <div className="space-y-2">
        {EXPERIENCE.map(({ id, label, desc, hint }) => {
          const active = value === id;
          return (
            <button
              key={id} type="button" onClick={() => onChange(id)}
              className={`w-full text-left rounded-2xl p-4 border transition ${active ? "" : "border-white/5 bg-bg-2"}`}
              style={active ? SELECTED_STYLE : undefined}
            >
              <div className="flex items-start gap-3">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-white">{label}</p>
                  <p className="text-xs text-text-tertiary mt-0.5">{desc}</p>
                  <p className="text-xs text-text-secondary mt-2">→ {hint}</p>
                </div>
                {active && <Check size={18} className="text-white shrink-0 mt-1" />}
              </div>
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

function DaysStep({ value, onChange }: { value: string[]; onChange: (days: string[]) => void }) {
  const DAYS: { id: string; label: string }[] = [
    { id: "mon", label: "M" }, { id: "tue", label: "T" }, { id: "wed", label: "W" },
    { id: "thu", label: "T" }, { id: "fri", label: "F" }, { id: "sat", label: "S" }, { id: "sun", label: "S" },
  ];
  const toggle = (id: string) => {
    const next = value.includes(id) ? value.filter((d) => d !== id) : [...value, id];
    onChange(next);
  };
  const count = value.length;
  return (
    <>
      <StepHeader title="Which days can you train?" sub="Tap the days that work for your schedule." />
      <div className="grid grid-cols-7 gap-2 mt-2">
        {DAYS.map(({ id, label }) => {
          const active = value.includes(id);
          return (
            <button
              key={id} type="button" onClick={() => toggle(id)} aria-pressed={active}
              className={`h-12 rounded-full text-sm font-semibold transition active:scale-95 ${active ? "gradient-brand text-white" : "bg-bg-2 text-text-secondary border border-white/5"}`}
            >
              {label}
            </button>
          );
        })}
      </div>
      <div className="text-center mt-8">
        <span className="text-4xl font-bold tabular-nums text-white">{count}</span>
        <span className="ml-2 text-base text-text-tertiary">{count === 1 ? "day" : "days"} / week</span>
      </div>
      <p className="mt-4 text-center text-xs text-text-tertiary">Pick at least one day to continue.</p>
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

function EatingPatternStep({ value, onChange }: { value: EatingPattern | null; onChange: (v: EatingPattern) => void }) {
  return (
    <>
      <StepHeader title="How do you eat?" sub="Shapes your macro timing and how we read your meal logs." />
      <div className="grid grid-cols-2 gap-2">
        {EATING_PATTERNS.map(({ id, label, desc }) => {
          const active = value === id;
          return (
            <button
              key={id} type="button" onClick={() => onChange(id)}
              className={`text-left rounded-2xl p-4 border transition ${active ? "" : "border-white/5 bg-bg-2"}`}
              style={active ? SELECTED_STYLE : undefined}
            >
              <p className="text-sm font-semibold text-white">{label}</p>
              <p className="text-xs text-text-tertiary mt-0.5 leading-snug">{desc}</p>
            </button>
          );
        })}
      </div>
      <p className="mt-3 text-[11px] text-text-tertiary">You can update this any time in Settings.</p>
    </>
  );
}

function cmToIn(cm: number) { return cm / 2.54; }
function inToCm(inches: number) { return inches * 2.54; }
function kgToLb(kg: number) { return kg * 2.20462; }
function lbToKg(lb: number) { return lb / 2.20462; }

function BodyStep({
  draft, patch, bodySkipped, unskip, onSkip,
}: {
  draft: Draft;
  patch: (p: Partial<Draft>) => void;
  bodySkipped: boolean;
  unskip: () => void;
  onSkip: () => void;
}) {
  const [wUnit, setWUnit] = useState<WeightUnit>("kg");
  const [lUnit, setLUnit] = useState<LengthUnit>("cm");
  const [scanOpen, setScanOpen] = useState(false);
  const [measureOpen, setMeasureOpen] = useState(false);

  const sex: Sex = draft.sex ?? "male";
  const range = BF_RANGE[sex];

  // Initialise body-fat to the sex-linked default on first mount of this step.
  useEffect(() => {
    if (!draft.dexaBf) patch({ dexaBf: String(range.default) });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (bodySkipped) {
    return (
      <>
        <StepHeader title="Your starting point" sub="Used to calculate your calorie and macro targets." />
        <div className="rounded-2xl bg-bg-2 border border-white/5 p-4">
          <p className="text-sm text-text-secondary">
            You've skipped body data. Macro targets will be rough estimates until you add this from your profile.
          </p>
          <button
            type="button"
            onClick={unskip}
            className="mt-3 text-xs text-text-secondary underline underline-offset-2"
          >
            Add it now instead
          </button>
        </div>
      </>
    );
  }

  const bfNum = Number(draft.dexaBf) || range.default;
  const desc = getBfDescription(bfNum, sex);

  return (
    <>
      <StepHeader title="Your starting point" sub="Used to calculate your calorie and macro targets." />
      <p className="text-xs text-text-tertiary mb-4">
        No scan needed — a rough estimate is enough to start. We adjust from your real data every week.
      </p>

      <div className="space-y-3">
        <div className="flex items-center justify-between gap-2">
          <span className="text-[11px] uppercase tracking-wider text-text-tertiary">Weight unit</span>
          <UnitToggle options={[{ id: "kg", label: "kg" }, { id: "lb", label: "lb" }]} value={wUnit} onChange={(v) => setWUnit(v as WeightUnit)} />
        </div>
        <UnitField label="Weight" cmValue={draft.weight} onChangeCm={(v) => patch({ weight: v })} unit={wUnit} convertToDisplay={kgToLb} convertFromDisplay={lbToKg} />

        <div className="flex items-center justify-between gap-2 pt-1">
          <span className="text-[11px] uppercase tracking-wider text-text-tertiary">Length unit</span>
          <UnitToggle options={[{ id: "cm", label: "cm" }, { id: "in", label: "in" }]} value={lUnit} onChange={(v) => setLUnit(v as LengthUnit)} />
        </div>
        <UnitField label="Height" cmValue={draft.height} onChangeCm={(v) => patch({ height: v })} unit={lUnit} convertToDisplay={cmToIn} convertFromDisplay={inToCm} />

        {/* Sex-linked body-fat slider */}
        <div className="rounded-2xl bg-bg-2 border border-white/5 p-4">
          <p className="text-[11px] uppercase tracking-wider text-text-tertiary text-center">Body fat</p>
          <p className="text-center mt-2 text-white" style={{ fontSize: 32, fontWeight: 700 }}>{bfNum}%</p>
          <p className={`text-center text-sm font-semibold mt-1 ${bfLabelColor(desc.label)}`}>{desc.label}</p>
          <input
            type="range"
            min={range.min}
            max={range.max}
            step={1}
            value={bfNum}
            onChange={(e) => patch({ dexaBf: e.target.value })}
            className="w-full mt-4 accent-violet-400"
          />
          <p className="text-xs italic text-text-tertiary text-center mt-3 mx-auto" style={{ maxWidth: 320 }}>
            {desc.cue}
          </p>
          <p className="text-[11px] text-text-tertiary text-center mt-3">
            Based on ACE classifications. We track the trend — the exact number matters less than consistency.
          </p>
        </div>

        {/* Optional — body scan */}
        <button
          type="button"
          onClick={() => setScanOpen((v) => !v)}
          className="w-full flex items-center justify-between rounded-2xl bg-bg-2 border border-white/5 px-4 py-3 text-left"
        >
          <span className="text-sm text-text-secondary">I have a body scan result</span>
          <ChevronDown size={16} className={`text-text-tertiary transition-transform ${scanOpen ? "rotate-180" : ""}`} />
        </button>
        {scanOpen && (
          <div className="space-y-2">
            <UnitField label="Lean mass" cmValue={draft.dexaLean} onChangeCm={(v) => patch({ dexaLean: v })} unit={wUnit} convertToDisplay={kgToLb} convertFromDisplay={lbToKg} />
            <p className="text-[11px] text-text-tertiary px-1">
              From your InBody or DEXA report (PBF and SMM). Improves your BMR calculation.
            </p>
          </div>
        )}

        {/* Optional — circumferences */}
        <button
          type="button"
          onClick={() => setMeasureOpen((v) => !v)}
          className="w-full flex items-center justify-between rounded-2xl bg-bg-2 border border-white/5 px-4 py-3 text-left"
        >
          <span className="text-sm text-text-secondary">Add measurements</span>
          <ChevronDown size={16} className={`text-text-tertiary transition-transform ${measureOpen ? "rotate-180" : ""}`} />
        </button>
        {measureOpen && (
          <div className="space-y-2">
            <UnitField label="Waist" cmValue={draft.waist} onChangeCm={(v) => patch({ waist: v })} unit={lUnit} convertToDisplay={cmToIn} convertFromDisplay={inToCm} />
            <UnitField label="Hip" cmValue={draft.hip} onChangeCm={(v) => patch({ hip: v })} unit={lUnit} convertToDisplay={cmToIn} convertFromDisplay={inToCm} />
            <UnitField label="Arm" cmValue={draft.arm} onChangeCm={(v) => patch({ arm: v })} unit={lUnit} convertToDisplay={cmToIn} convertFromDisplay={inToCm} />
            <UnitField label="Thigh" cmValue={draft.thigh} onChangeCm={(v) => patch({ thigh: v })} unit={lUnit} convertToDisplay={cmToIn} convertFromDisplay={inToCm} />
          </div>
        )}

        <button
          type="button"
          onClick={onSkip}
          className="w-full bg-bg-2 border border-white/5 rounded-2xl py-3 text-sm text-text-tertiary"
        >
          Skip for now — I'll add this from my profile later
        </button>
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

function UnitField({
  label, cmValue, onChangeCm, unit, convertToDisplay, convertFromDisplay,
}: {
  label: string; cmValue: string; onChangeCm: (v: string) => void;
  unit: string; convertToDisplay: (n: number) => number; convertFromDisplay: (n: number) => number;
}) {
  const isCanonical = unit === "cm" || unit === "kg";
  const [localDisplay, setLocalDisplay] = useState<string>("");

  useEffect(() => {
    if (cmValue === "") { setLocalDisplay(""); return; }
    if (isCanonical) { setLocalDisplay(cmValue); return; }
    const n = Number(cmValue);
    if (!Number.isFinite(n)) { setLocalDisplay(""); return; }
    setLocalDisplay(String(Number(convertToDisplay(n).toFixed(1))));
  }, [cmValue, unit, isCanonical, convertToDisplay]);

  const handle = (raw: string) => {
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

function ReviewStep({ draft, bodyDataType }: { draft: Draft; bodyDataType: "dexa" | "measurements" | null }) {
  const goalLabel = GOALS.find((g) => g.id === draft.goal)?.label ?? "—";
  const eqLabel = EQUIPMENT.find((e) => e.id === draft.equipment)?.label ?? "—";
  const expLabel = EXPERIENCE.find((e) => e.id === draft.experienceLevel)?.label ?? "—";
  const eatLabel = EATING_PATTERNS.find((e) => e.id === draft.eatingPattern)?.label ?? "—";

  const dayLabels: Record<string, string> = { mon: "Mon", tue: "Tue", wed: "Wed", thu: "Thu", fri: "Fri", sat: "Sat", sun: "Sun" };
  const order = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
  const daysPretty = draft.trainingDays.length
    ? order.filter((d) => draft.trainingDays.includes(d)).map((d) => dayLabels[d]).join(" ")
    : "—";

  let bodyValue = "Not provided — macro targets will be estimated";
  let bodyAmber = true;
  if (bodyDataType === "dexa") {
    bodyValue = `DEXA · ${draft.weight}kg · ${draft.dexaBf}%bf`;
    bodyAmber = false;
  } else if (bodyDataType === "measurements") {
    bodyValue = `Visual estimate · ${draft.weight}kg · ${draft.dexaBf}%bf`;
    bodyAmber = false;
  }

  return (
    <>
      <StepHeader title="All set" sub="Confirm and we'll build your plan." />
      <div className="rounded-2xl bg-bg-2 border border-white/5 divide-y divide-white/5">
        <Row label="Name" value={draft.name || "—"} />
        <Row label="Experience" value={expLabel} />
        <Row label="Goal" value={goalLabel} />
        <Row label="Training days" value={`${draft.trainingDays.length} / week · ${daysPretty}`} />
        <Row label="Equipment" value={eqLabel} />
        <Row label="Eating pattern" value={eatLabel} />
        <Row label="Body data" value={bodyValue} valueClass={bodyAmber ? "text-amber-400" : undefined} />
      </div>
    </>
  );
}

function Row({ label, value, valueClass }: { label: string; value: string; valueClass?: string }) {
  return (
    <div className="flex items-center justify-between px-4 py-3.5 gap-3">
      <span className="text-sm text-text-secondary shrink-0">{label}</span>
      <span className={`text-sm font-medium text-right ${valueClass ?? ""}`}>{value}</span>
    </div>
  );
}

const APEX_FACTS = [
  "BMR calculated via Mifflin-St Jeor — the most validated formula for non-obese adults.",
  "Protein set at 1.8g/kg. During a cut APEX raises this to 2.2g/kg to protect lean mass.",
  "TDEE uses your training days as a PAL multiplier — not a generic activity level.",
  "APEX Shield scores 5 pillars: Recovery, Sleep, Nutrition, Training Load, and Mood.",
  "The adaptive macro engine adjusts targets weekly from real weight trend vs intake.",
  "Engine B coaching unlocks Day 7 — grounded in your actual data, not generic advice.",
  "Fat floor: 0.4g/kg or 25% of calories, whichever is higher — for hormonal health.",
  "Weekly macro review unlocks after 3 logged nutrition days and 3 weigh-ins.",
];

function BuildingPlanScreen() {
  const [idx, setIdx] = useState(0);
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    const id = setInterval(() => setIdx((i) => (i + 1) % APEX_FACTS.length), 3000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    const start = Date.now();
    const id = setInterval(() => {
      const pct = Math.min(90, ((Date.now() - start) / 20000) * 90);
      setProgress(pct);
      if (pct >= 90) clearInterval(id);
    }, 100);
    return () => clearInterval(id);
  }, []);

  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-6" style={{ backgroundColor: "#06080F" }}>
      <div className="flex items-center justify-center rounded-full"
        style={{ width: 96, height: 96, backgroundImage: "linear-gradient(135deg, #7C3AED 0%, #3B82F6 100%)", boxShadow: "0 0 60px rgba(124, 58, 237, 0.45)", animation: "coach-breathe 2.4s ease-in-out infinite" }}>
        <Sparkles size={28} color="#fff" strokeWidth={2.5} />
      </div>
      <h1 className="mt-8 text-2xl font-semibold text-white text-center">Generating your plan</h1>
      <div className="mt-4 max-w-sm w-full min-h-[60px] flex items-center justify-center">
        <p
          key={idx}
          className="text-[14px] text-text-secondary text-center px-2"
          style={{ animation: "fact-fade 3s ease-in-out" }}
        >
          {APEX_FACTS[idx]}
        </p>
      </div>
      <div className="mt-6 flex gap-1.5">
        {APEX_FACTS.map((_, i) => (
          <span
            key={i}
            className="h-1.5 w-1.5 rounded-full transition-colors"
            style={{ background: i === idx ? "white" : "rgba(255,255,255,0.2)" }}
          />
        ))}
      </div>
      <div className="mt-8 w-full max-w-sm h-[3px] rounded-full overflow-hidden" style={{ background: "rgba(255,255,255,0.08)" }}>
        <div
          className="h-full rounded-full"
          style={{
            width: `${progress}%`,
            backgroundImage: "linear-gradient(90deg, #7C3AED 0%, #3B82F6 100%)",
            transition: "width 200ms linear",
          }}
        />
      </div>
      <style>{`
        @keyframes coach-breathe { 0%,100% { transform: scale(0.97); } 50% { transform: scale(1.04); } }
        @keyframes fact-fade { 0% { opacity: 0; } 15% { opacity: 1; } 85% { opacity: 1; } 100% { opacity: 0.6; } }
      `}</style>
    </div>
  );
}
