import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { ChevronLeft, Check, Sparkles } from "lucide-react";
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
type EquipmentUi = "commercial_gym" | "dumbbells_only" | "bodyweight_only";
type EquipmentDb = "home_gym_db_only" | "commercial_gym" | "limited_equipment" | "bodyweight_only";
type LengthUnit = "cm" | "in";
type WeightUnit = "kg" | "lb";
type Sex = "male" | "female";
type ExperienceLevel = "beginner" | "intermediate" | "advanced";
type EatingPattern = "standard" | "intermittent" | "plant_based" | "flexible";

const TOTAL = 8;

const EQUIPMENT_UI_TO_DB: Record<EquipmentUi, EquipmentDb> = {
  commercial_gym: "commercial_gym",
  dumbbells_only: "home_gym_db_only",
  bodyweight_only: "bodyweight_only",
};
const EQUIPMENT_DB_TO_UI: Partial<Record<EquipmentDb, EquipmentUi>> = {
  commercial_gym: "commercial_gym",
  home_gym_db_only: "dumbbells_only",
  bodyweight_only: "bodyweight_only",
  // limited_equipment falls through to null in reset mode.
};

const GOALS: { id: Goal; label: string; desc: string }[] = [
  { id: "recomposition", label: "Recomposition", desc: "Build muscle, lose fat" },
  { id: "muscle_gain", label: "Muscle gain", desc: "Maximize hypertrophy" },
  { id: "fat_loss", label: "Fat loss", desc: "Cut while preserving muscle" },
  { id: "strength", label: "Strength", desc: "Raise your big lifts" },
  { id: "athletic_performance", label: "Athletic performance", desc: "Power, speed, conditioning" },
];

const EXPERIENCE: { id: ExperienceLevel; label: string; desc: string }[] = [
  { id: "beginner", label: "Beginner", desc: "Less than a year. We'll keep it simple." },
  { id: "intermediate", label: "Intermediate", desc: "1–3 years. You know the movements." },
  { id: "advanced", label: "Advanced", desc: "3+ years. We'll get technical." },
];

const EQUIPMENT_OPTIONS: { id: EquipmentUi; label: string; desc: string }[] = [
  { id: "commercial_gym", label: "Commercial gym", desc: "Machines, dumbbells, barbells, cables" },
  { id: "dumbbells_only", label: "Dumbbells only", desc: "Home setup with adjustable weights" },
  { id: "bodyweight_only", label: "Bodyweight only", desc: "No equipment needed" },
];

const EATING_PATTERNS: { id: EatingPattern; label: string; desc: string }[] = [
  { id: "standard", label: "Standard", desc: "3+ meals across the day" },
  { id: "intermittent", label: "Intermittent fasting", desc: "16:8 or similar window" },
  { id: "plant_based", label: "Plant-based", desc: "Vegan or vegetarian" },
  { id: "flexible", label: "Flexible", desc: "No fixed pattern" },
];

// Pace id is a broad string union across all goal-specific tables below.
type PaceId = string;

// Rate-based pace items: |%/week| magnitude. Sign applied at submit from GOAL_DIRECTION.
type RatePace = { id: string; label: string; pct: number; blurb: string };
// Recomp uses kcal/day magnitude below TDEE — converted to a small target_rate_pct at submit.
type KcalPace = { id: string; label: string; kcalDelta: number; blurb: string };

const PACES_FAT_LOSS: RatePace[] = [
  { id: "steady",     label: "Steady",     pct: 0.35, blurb: "0.35%/week — sustainable, protects lean mass" },
  { id: "standard",   label: "Standard",   pct: 0.5,  blurb: "0.5%/week — recommended for most" },
  { id: "aggressive", label: "Aggressive", pct: 0.75, blurb: "0.75%/week — lean users, short cuts only" },
];
const PACES_MUSCLE_GAIN: RatePace[] = [
  { id: "steady",     label: "Steady",     pct: 0.25, blurb: "0.25%/week — lean gains, trained lifters" },
  { id: "standard",   label: "Standard",   pct: 0.4,  blurb: "0.4%/week — recommended" },
  { id: "aggressive", label: "Aggressive", pct: 0.6,  blurb: "0.6%/week — beginners, returning lifters" },
];
const PACES_STRENGTH: RatePace[] = [
  { id: "recover_eat", label: "Recover-eat", pct: 0.15, blurb: "0.15%/week surplus — mild, minimal fat gain" },
  { id: "standard",    label: "Standard",    pct: 0.25, blurb: "0.25%/week surplus — recommended for PR chasing" },
  { id: "push_harder", label: "Push harder", pct: 0.4,  blurb: "0.4%/week surplus — bulking cycle, expect some fat" },
];
const PACES_RECOMP: KcalPace[] = [
  { id: "mild",     label: "Mild",     kcalDelta: 100, blurb: "100 kcal below TDEE — closest to maintenance" },
  { id: "moderate", label: "Moderate", kcalDelta: 250, blurb: "250 kcal below TDEE — recommended for most" },
  { id: "focused",  label: "Focused",  kcalDelta: 400, blurb: "400 kcal below TDEE — leaner, willing to trade some strength" },
];

function ratePacesFor(g: Goal): RatePace[] | null {
  if (g === "fat_loss") return PACES_FAT_LOSS;
  if (g === "muscle_gain") return PACES_MUSCLE_GAIN;
  if (g === "strength") return PACES_STRENGTH;
  return null;
}

const GOAL_DIRECTION: Record<Goal, "lose" | "gain" | "maintain"> = {
  fat_loss: "lose", muscle_gain: "gain", strength: "gain",
  recomposition: "maintain", athletic_performance: "maintain",
};

function computeNutritionTargets(draft: Draft): {
  target_rate_pct: number | null;
  target_kcal_delta: number | null;
} {
  const g = draft.goal;
  if (!g) return { target_rate_pct: null, target_kcal_delta: null };
  if (g === "athletic_performance") return { target_rate_pct: null, target_kcal_delta: null };
  if (g === "fat_loss") {
    const item = PACES_FAT_LOSS.find((p) => p.id === draft.pace) ?? PACES_FAT_LOSS[1];
    return { target_rate_pct: item.pct, target_kcal_delta: null };
  }
  if (g === "muscle_gain" || g === "strength") {
    const byExp: Record<string, number> = { beginner: 350, intermediate: 250, advanced: 150 };
    const delta = draft.experienceLevel ? (byExp[draft.experienceLevel] ?? 250) : 250;
    return { target_rate_pct: null, target_kcal_delta: delta };
  }
  if (g === "recomposition") {
    const item = PACES_RECOMP.find((p) => p.id === draft.pace) ?? PACES_RECOMP[1];
    return { target_rate_pct: null, target_kcal_delta: -item.kcalDelta };
  }
  return { target_rate_pct: null, target_kcal_delta: null };
}


type Draft = {
  name: string;
  age: string;
  sex: Sex | null;
  experienceLevel: ExperienceLevel | null;
  goal: Goal | null;
  trainingDays: string[];
  equipment: EquipmentUi | null;
  eatingPattern: EatingPattern | null;
  weightUnit: WeightUnit;
  lengthUnit: LengthUnit;
  weightKg: string;      // canonical kg
  heightCm: string;      // canonical cm
  heightFt: string;      // display-only when lengthUnit=in
  heightIn: string;      // display-only when lengthUnit=in
  targetWeightKg: string;
  pace: PaceId | null;
};

const EMPTY: Draft = {
  name: "", age: "", sex: null,
  experienceLevel: null,
  goal: null,
  trainingDays: [],
  equipment: null,
  eatingPattern: null,
  weightUnit: "kg", lengthUnit: "cm",
  weightKg: "", heightCm: "", heightFt: "", heightIn: "",
  targetWeightKg: "",
  pace: null,
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

  const patch = (p: Partial<Draft>) => setDraft((d) => ({ ...d, ...p }));

  useEffect(() => {
    if (!isReset) return;
    let cancelled = false;
    (async () => {
      const { data: userRes } = await supabase.auth.getUser();
      if (!userRes.user) return;
      const { data } = await supabase
        .from("profiles")
        .select("experience_level, eating_pattern, goal, equipment_access, training_day_codes, target_weight_kg, measurement_weight_kg, measurement_height_cm")
        .eq("user_id", userRes.user.id)
        .single();
      if (cancelled || !data) return;
      const uiEquip = data.equipment_access
        ? EQUIPMENT_DB_TO_UI[data.equipment_access as EquipmentDb] ?? null
        : null;
      patch({
        experienceLevel: (data.experience_level as ExperienceLevel | null) ?? null,
        eatingPattern: (data.eating_pattern as EatingPattern | null) ?? null,
        goal: (data.goal as Goal | null) ?? null,
        equipment: uiEquip,
        trainingDays: (data.training_day_codes as string[] | null) ?? [],
        targetWeightKg: data.target_weight_kg != null ? String(data.target_weight_kg) : "",
        weightKg: data.measurement_weight_kg != null ? String(data.measurement_weight_kg) : "",
        heightCm: data.measurement_height_cm != null ? String(data.measurement_height_cm) : "",
      });
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isReset]);

  const heightValid = Number(draft.heightCm) > 0;
  const weightValid = Number(draft.weightKg) > 0;

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
      case 6: {
        return weightValid && heightValid;
      }
      case 7: return !!draft.eatingPattern;
      case 8: {
        const cw = Number(draft.weightKg);
        const tw = Number(draft.targetWeightKg);
        if (!(tw > 0)) return false;
        const direction = GOAL_DIRECTION[draft.goal!];
        if (direction === "lose" && tw >= cw) return false;
        if (direction === "gain" && tw <= cw) return false;
        const heightM = Number(draft.heightCm) / 100;
        const bmi = heightM > 0 ? tw / (heightM * heightM) : 0;
        if (direction === "lose" && bmi > 0 && bmi < 18.5) return false;
        if (direction === "gain" && bmi >= 35) return false;
        return true;
      }
      default: return true;
    }
  })();

  const next = () => setStep((s) => Math.min(s + 1, TOTAL + 1)); // TOTAL + 1 = review
  const back = () => setStep((s) => Math.max(s - 1, minStep));

  const submit = async () => {
    setSubmitting(true);
    try {
      const { data: userRes, error: uerr } = await supabase.auth.getUser();
      if (uerr || !userRes.user) throw new Error("Not signed in");
      const userId = userRes.user.id;

      const trainingDaysCount = draft.trainingDays.length;
      const { target_rate_pct, target_kcal_delta } = computeNutritionTargets(draft);
      const equipmentDb = draft.equipment ? EQUIPMENT_UI_TO_DB[draft.equipment] : null;
      const twNum = Number(draft.targetWeightKg);
      const targetWeightKg = Number.isFinite(twNum) && twNum > 0 ? twNum : null;

      const commonBody = {
        experience_level: draft.experienceLevel,
        goal: draft.goal,
        training_days_per_week: trainingDaysCount,
        training_day_codes: draft.trainingDays,
        equipment_access: equipmentDb,
        eating_pattern: draft.eatingPattern,
        body_data_type: "measurements" as const,
        measurement_weight_kg: Number(draft.weightKg),
        measurement_height_cm: Number(draft.heightCm),
        target_weight_kg: targetWeightKg,
        target_rate_pct,
        target_kcal_delta,
      };

      let payload: Record<string, unknown>;
      if (isReset) {
        payload = { user_id: userId, ...commonBody };
      } else {
        const now = new Date();
        const unlock = new Date(now.getTime() + 7 * 86400000);
        payload = {
          user_id: userId,
          name: draft.name.trim(),
          age: Number(draft.age),
          biological_sex: draft.sex,
          input_path_preference: "manual",
          ...commonBody,
          profile_completed_at: now.toISOString(),
          plan_unlock_date: unlock.toISOString().slice(0, 10),
          timezone: getBrowserTimezone(),
        };
      }

      const { error } = await supabase.from("profiles").upsert(payload as any, { onConflict: "user_id" });
      if (error) throw error;

      try {
        await logMeasure({
          data: {
            source: "manual",
            weight_kg: Number(draft.weightKg),
            body_fat_pct: null,
            lean_mass_kg: null,
            waist_cm: null,
            hip_cm: null,
            arm_cm: null,
            thigh_cm: null,
            client_timezone: getBrowserTimezone(),
          },
        });
      } catch (e) {
        console.warn("logBodyMeasurement failed", e);
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

      // Strict sequential dependency chain: mesocycle init → macros → landmarks.
      // generate-plan reads weekly_volume_landmarks and macro/fuel context, so
      // it must fire AFTER landmarks. It returns 202 (writes a fallback plan
      // synchronously and queues the Sonnet upgrade for cron), so we
      // fire-and-forget and navigate immediately.
      const step1 = await supabase.functions.invoke("advance-mesocycle", { body: { user_id: userId, mode: "init" } });
      if (step1.error) {
        setSubmitting(false);
        toast.error("Could not initialize training block");
        return;
      }

      const step2 = await supabase.functions.invoke("calculate-macros", { body: { user_id: userId } });
      if (step2.error) {
        setSubmitting(false);
        toast.error("Could not calculate macros");
        return;
      }

      const step3 = await supabase.functions.invoke("compute-volume-landmarks", { body: { user_id: userId } });
      if (step3.error) {
        setSubmitting(false);
        toast.error("Could not compute volume targets");
        return;
      }

      supabase.functions
        .invoke("generate-plan", { body: { user_id: userId } })
        .catch((err) => console.warn("generate-plan dispatch failed", err));

      navigate({ to: "/dashboard" });

    } catch (e: any) {
      toast.error(e?.message ?? "Could not save profile");
      setSubmitting(false);
    }
  };

  if (submitting) return <BuildingPlanScreen />;

  const isReview = step > TOTAL;
  const displayStep = isReview ? TOTAL : step;
  const stepLabel = isReview ? "Review" : `Step ${displayStep} of ${TOTAL}`;

  return (
    <div className="min-h-screen pb-32" style={{ paddingTop: "env(safe-area-inset-top, 0px)" }}>
      <header className="flex items-center justify-between px-5 pt-6">
        <button onClick={step === minStep ? () => navigate({ to: isReset ? "/dashboard" : "/" }) : back} className="text-text-secondary" aria-label="Back">
          <ChevronLeft size={24} />
        </button>
        <span className="text-label text-text-tertiary">{stepLabel}</span>
        <span className="w-6" />
      </header>

      <div className="mx-5 mt-4 h-1 rounded-full overflow-hidden" style={{ background: "var(--border-hairline)" }}>
        <div
          className="h-full transition-all"
          style={{
            width: `${(displayStep / TOTAL) * 100}%`,
            background: "var(--brand-gradient)",
            transitionDuration: "var(--dur-med)",
          }}
        />
      </div>

      <main className="px-5 mt-8 max-w-[480px] mx-auto">
        {step === 1 && (
          <AboutYouStep
            name={draft.name} age={draft.age} sex={draft.sex}
            onName={(v) => patch({ name: v })}
            onAge={(v) => patch({ age: v })}
            onSex={(v) => patch({ sex: v })}
          />
        )}
        {step === 2 && (
          <ExperienceStep
            name={draft.name.trim()}
            value={draft.experienceLevel}
            onChange={(v) => patch({ experienceLevel: v })}
          />
        )}
        {step === 3 && (
          <GoalStep
            name={draft.name.trim()}
            value={draft.goal}
            onChange={(g) => patch({ goal: g })}
          />
        )}
        {step === 4 && (
          <DaysStep value={draft.trainingDays} onChange={(trainingDays) => patch({ trainingDays })} />
        )}
        {step === 5 && (
          <EquipmentStep value={draft.equipment} onChange={(equipment) => patch({ equipment })} />
        )}
        {step === 6 && <BodyBasicsStep draft={draft} patch={patch} />}
        {step === 7 && <EatingPatternStep name={draft.name.trim()} value={draft.eatingPattern} onChange={(v) => patch({ eatingPattern: v })} />}
        {step === 8 && <TargetStep draft={draft} patch={patch} />}
        {isReview && <ReviewStep draft={draft} />}
      </main>

      <footer
        className="fixed inset-x-0 bottom-0 z-20 pt-10"
        style={{
          background: "linear-gradient(to top, var(--bg-0) 0%, var(--bg-0) 60%, transparent 100%)",
          paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 20px)",
        }}
      >
        <div className="mx-auto max-w-[480px] px-5">
          {!isReview ? (
            <button
              disabled={!canContinue}
              onClick={next}
              className="block w-full text-body font-medium disabled:opacity-40"
              style={{
                height: 52, borderRadius: "var(--radius-md)",
                background: "var(--brand-gradient)",
                color: "#0A0B12",
                boxShadow: "var(--shadow-inset-top)",
              }}
            >
              Continue
            </button>
          ) : (
            <button
              disabled={submitting}
              onClick={submit}
              className="block w-full text-body font-medium disabled:opacity-40"
              style={{
                height: 52, borderRadius: "var(--radius-md)",
                background: "var(--brand-gradient)",
                color: "#0A0B12",
                boxShadow: "var(--shadow-inset-top)",
              }}
            >
              Build my plan
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
      <h1 className="text-hero text-text-primary">{title}</h1>
      {sub && <p className="mt-2 text-body-sm text-text-tertiary">{sub}</p>}
    </div>
  );
}

const CARD_BASE: React.CSSProperties = {
  background: "var(--bg-1)",
  border: "1px solid var(--border-subtle)",
  borderRadius: "var(--radius-lg)",
  padding: "var(--space-4)",
  transition: "border-color var(--dur-fast) var(--ease-standard), box-shadow var(--dur-fast) var(--ease-standard)",
};

const CARD_ACTIVE: React.CSSProperties = {
  ...CARD_BASE,
  borderColor: "var(--brand-500)",
  background: "linear-gradient(135deg, rgba(245,165,36,0.04), rgba(255,201,122,0.02))",
  boxShadow: "0 0 0 1px var(--brand-glow)",
};

const PACE_ACTIVE: React.CSSProperties = {
  ...CARD_BASE,
  borderColor: "var(--brand-500)",
  background: "linear-gradient(135deg, rgba(245,165,36,0.10), rgba(255,201,122,0.04))",
  boxShadow: "0 0 0 1px var(--brand-glow)",
};

function AboutYouStep({
  name, age, sex, onName, onAge, onSex,
}: { name: string; age: string; sex: Sex | null; onName: (v: string) => void; onAge: (v: string) => void; onSex: (v: Sex) => void }) {
  return (
    <>
      <StepHeader title="About you" sub="Quick basics so we can calculate your targets." />

      <div className="space-y-4">
        <FieldLabel>Name</FieldLabel>
        <InputBox>
          <input
            type="text"
            value={name}
            onChange={(e) => onName(e.target.value)}
            placeholder="Your first name"
            className="w-full bg-transparent text-body text-text-primary placeholder:text-text-tertiary focus:outline-none"
            autoComplete="given-name"
          />
        </InputBox>

        <FieldLabel>Age</FieldLabel>
        <InputBox>
          <input
            type="number" inputMode="numeric" min={10} max={100} step={1}
            value={age}
            onChange={(e) => onAge(e.target.value.replace(/[^\d]/g, ""))}
            placeholder="—"
            className="flex-1 bg-transparent text-body text-text-primary placeholder:text-text-tertiary focus:outline-none"
          />
          <span className="text-body-sm text-text-tertiary ml-2">yrs</span>
        </InputBox>

        <FieldLabel>Biological sex</FieldLabel>
        <div className="grid grid-cols-2 gap-2">
          {(["male", "female"] as Sex[]).map((s) => {
            const active = sex === s;
            return (
              <button
                key={s}
                type="button"
                onClick={() => onSex(s)}
                className="text-body font-medium"
                style={{
                  height: 44,
                  borderRadius: "var(--radius-pill)",
                  background: active ? "var(--brand-gradient)" : "var(--bg-1)",
                  color: active ? "#0A0B12" : "var(--text-secondary)",
                  border: active ? "1px solid transparent" : "1px solid var(--border-subtle)",
                }}
              >
                {s === "male" ? "Male" : "Female"}
              </button>
            );
          })}
        </div>
        <p className="text-body-sm text-text-tertiary">For accurate calorie targets.</p>
      </div>
    </>
  );
}

function ExperienceStep({ name, value, onChange }: { name: string; value: ExperienceLevel | null; onChange: (v: ExperienceLevel) => void }) {
  const title = name ? `How long have you been training, ${name}?` : "How long have you been training?";
  return (
    <>
      <StepHeader title={title} sub="Shapes how we talk to you." />
      <div className="space-y-2">
        {EXPERIENCE.map(({ id, label, desc }) => {
          const active = value === id;
          return (
            <button
              key={id} type="button" onClick={() => onChange(id)}
              className="w-full text-left"
              style={active ? CARD_ACTIVE : CARD_BASE}
            >
              <div className="flex items-start gap-3">
                <div className="flex-1 min-w-0">
                  <p className="text-body font-medium text-text-primary">{label}</p>
                  <p className="text-body-sm text-text-tertiary mt-1">{desc}</p>
                </div>
                {active && <Check size={18} style={{ color: "var(--brand-500)" }} className="shrink-0 mt-1" />}
              </div>
            </button>
          );
        })}
      </div>
    </>
  );
}

function GoalStep({ name, value, onChange }: { name: string; value: Goal | null; onChange: (g: Goal) => void }) {
  const title = name ? `What's your goal, ${name}?` : "What's your goal?";
  return (
    <>
      <StepHeader title={title} sub="We'll tune training and nutrition around this." />
      <div className="space-y-2">
        {GOALS.map(({ id, label, desc }) => {
          const active = value === id;
          return (
            <button
              key={id} type="button" onClick={() => onChange(id)}
              className="w-full text-left"
              style={active ? CARD_ACTIVE : CARD_BASE}
            >
              <div className="flex items-start gap-3">
                <div className="flex-1">
                  <p className="text-body font-medium text-text-primary">{label}</p>
                  <p className="text-body-sm text-text-tertiary mt-1">{desc}</p>
                </div>
                {active && <Check size={18} style={{ color: "var(--brand-500)" }} className="shrink-0 mt-1" />}
              </div>
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
              className="text-body font-medium transition-transform active:scale-95"
              style={{
                width: 48, height: 48,
                borderRadius: "var(--radius-pill)",
                background: active ? "var(--brand-gradient)" : "var(--bg-1)",
                color: active ? "#0A0B12" : "var(--text-secondary)",
                border: active ? "1px solid transparent" : "1px solid var(--border-subtle)",
                margin: "0 auto",
              }}
            >
              {label}
            </button>
          );
        })}
      </div>
      <div className="text-center mt-8">
        <span className="text-title text-text-primary" style={{ fontVariantNumeric: "tabular-nums", color: "var(--brand-500)" }}>{count}</span>
        <span className="ml-2 text-body text-text-secondary">{count === 1 ? "day" : "days"} / week</span>
      </div>
      <p className="mt-4 text-center text-body-sm text-text-tertiary">Pick at least one day to continue.</p>
    </>
  );
}

function EquipmentStep({ value, onChange }: { value: EquipmentUi | null; onChange: (e: EquipmentUi) => void }) {
  return (
    <>
      <StepHeader title="What's your setup?" sub="So we can pick exercises you can actually do." />
      <div className="space-y-2">
        {EQUIPMENT_OPTIONS.map(({ id, label, desc }) => {
          const active = value === id;
          return (
            <button
              key={id} type="button" onClick={() => onChange(id)}
              className="w-full text-left"
              style={active ? CARD_ACTIVE : CARD_BASE}
            >
              <div className="flex items-start gap-3">
                <div className="flex-1">
                  <p className="text-body font-medium text-text-primary">{label}</p>
                  <p className="text-body-sm text-text-tertiary mt-1">{desc}</p>
                </div>
                {active && <Check size={18} style={{ color: "var(--brand-500)" }} className="shrink-0 mt-1" />}
              </div>
            </button>
          );
        })}
      </div>
    </>
  );
}

function BodyBasicsStep({ draft, patch }: { draft: Draft; patch: (p: Partial<Draft>) => void }) {
  const setWeightDisplay = (raw: string) => {
    const clean = raw.replace(/[^\d.]/g, "");
    if (clean === "") { patch({ weightKg: "" }); return; }
    const n = Number(clean);
    if (!Number.isFinite(n)) return;
    const kg = draft.weightUnit === "kg" ? n : n * 0.4536;
    patch({ weightKg: String(Number(kg.toFixed(2))) });
  };
  const weightDisplay = draft.weightKg === "" ? "" : (draft.weightUnit === "kg"
    ? String(Number(Number(draft.weightKg).toFixed(1)))
    : String(Number((Number(draft.weightKg) / 0.4536).toFixed(1))));

  const setHeightCmDisplay = (raw: string) => {
    const clean = raw.replace(/[^\d.]/g, "");
    if (clean === "") { patch({ heightCm: "", heightFt: "", heightIn: "" }); return; }
    const n = Number(clean);
    if (!Number.isFinite(n)) return;
    patch({ heightCm: String(n) });
  };
  const setHeightFt = (raw: string) => {
    const clean = raw.replace(/[^\d]/g, "");
    const ft = clean === "" ? 0 : Number(clean);
    const inches = draft.heightIn === "" ? 0 : Number(draft.heightIn);
    const cm = ft * 30.48 + inches * 2.54;
    patch({ heightFt: clean, heightCm: cm > 0 ? String(Number(cm.toFixed(1))) : "" });
  };
  const setHeightIn = (raw: string) => {
    const clean = raw.replace(/[^\d.]/g, "");
    const ft = draft.heightFt === "" ? 0 : Number(draft.heightFt);
    const inches = clean === "" ? 0 : Number(clean);
    const cm = ft * 30.48 + inches * 2.54;
    patch({ heightIn: clean, heightCm: cm > 0 ? String(Number(cm.toFixed(1))) : "" });
  };
  const heightCmDisplay = draft.heightCm === "" ? "" : String(Number(Number(draft.heightCm).toFixed(1)));

  return (
    <>
      <StepHeader title="Your body basics" sub="We'll refine this from your weekly check-ins." />
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <FieldLabel inline>Weight</FieldLabel>
          <SegmentedPill
            options={[{ id: "kg", label: "kg" }, { id: "lb", label: "lb" }]}
            value={draft.weightUnit}
            onChange={(v) => patch({ weightUnit: v as WeightUnit })}
          />
        </div>
        <InputBox>
          <input
            type="text" inputMode="decimal"
            value={weightDisplay}
            onChange={(e) => setWeightDisplay(e.target.value)}
            placeholder="—"
            className="flex-1 bg-transparent text-body text-text-primary placeholder:text-text-tertiary focus:outline-none"
          />
          <span className="text-body-sm text-text-tertiary ml-2">{draft.weightUnit}</span>
        </InputBox>

        <div className="flex items-center justify-between pt-2">
          <FieldLabel inline>Height</FieldLabel>
          <SegmentedPill
            options={[{ id: "cm", label: "cm" }, { id: "in", label: "ft/in" }]}
            value={draft.lengthUnit}
            onChange={(v) => patch({ lengthUnit: v as LengthUnit })}
          />
        </div>
        {draft.lengthUnit === "cm" ? (
          <InputBox>
            <input
              type="text" inputMode="decimal"
              value={heightCmDisplay}
              onChange={(e) => setHeightCmDisplay(e.target.value)}
              placeholder="—"
              className="flex-1 bg-transparent text-body text-text-primary placeholder:text-text-tertiary focus:outline-none"
            />
            <span className="text-body-sm text-text-tertiary ml-2">cm</span>
          </InputBox>
        ) : (
          <div className="grid grid-cols-2 gap-2">
            <InputBox>
              <input
                type="text" inputMode="numeric"
                value={draft.heightFt}
                onChange={(e) => setHeightFt(e.target.value)}
                placeholder="—"
                className="flex-1 bg-transparent text-body text-text-primary placeholder:text-text-tertiary focus:outline-none"
              />
              <span className="text-body-sm text-text-tertiary ml-2">ft</span>
            </InputBox>
            <InputBox>
              <input
                type="text" inputMode="decimal"
                value={draft.heightIn}
                onChange={(e) => setHeightIn(e.target.value)}
                placeholder="—"
                className="flex-1 bg-transparent text-body text-text-primary placeholder:text-text-tertiary focus:outline-none"
              />
              <span className="text-body-sm text-text-tertiary ml-2">in</span>
            </InputBox>
          </div>
        )}
      </div>
    </>
  );
}

function EatingPatternStep({ name, value, onChange }: { name: string; value: EatingPattern | null; onChange: (v: EatingPattern) => void }) {
  const title = name ? `How do you eat, ${name}?` : "How do you eat?";
  return (
    <>
      <StepHeader title={title} sub="So we can time your meals right." />
      <div className="grid grid-cols-2 gap-2">
        {EATING_PATTERNS.map(({ id, label, desc }) => {
          const active = value === id;
          return (
            <button
              key={id} type="button" onClick={() => onChange(id)}
              className="text-left"
              style={active ? CARD_ACTIVE : CARD_BASE}
            >
              <p className="text-body font-medium text-text-primary">{label}</p>
              <p className="text-body-sm text-text-tertiary mt-1 leading-snug">{desc}</p>
            </button>
          );
        })}
      </div>
      <p className="mt-4 text-body-sm text-text-tertiary">You can change this any time in Settings.</p>
    </>
  );
}

function TargetStep({ draft, patch }: { draft: Draft; patch: (p: Partial<Draft>) => void }) {
  const goal = draft.goal!;
  const direction = GOAL_DIRECTION[goal];

  // Prefill target weight = current weight for recomp / athletic on first entry.
  useEffect(() => {
    if ((goal === "recomposition" || goal === "athletic_performance") &&
        draft.targetWeightKg === "" && draft.weightKg !== "") {
      patch({ targetWeightKg: draft.weightKg });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [goal]);

  const setTargetWeightDisplay = (raw: string) => {
    const clean = raw.replace(/[^\d.]/g, "");
    if (clean === "") { patch({ targetWeightKg: "" }); return; }
    const n = Number(clean);
    if (!Number.isFinite(n)) return;
    const kg = draft.weightUnit === "kg" ? n : n * 0.4536;
    patch({ targetWeightKg: String(Number(kg.toFixed(2))) });
  };
  const targetWeightDisplay = draft.targetWeightKg === "" ? "" : (draft.weightUnit === "kg"
    ? String(Number(Number(draft.targetWeightKg).toFixed(1)))
    : String(Number((Number(draft.targetWeightKg) / 0.4536).toFixed(1))));

  const cw = Number(draft.weightKg) || 0;
  const tw = Number(draft.targetWeightKg) || 0;
  const heightM = Number(draft.heightCm) / 100;
  const bmi = heightM > 0 && tw > 0 ? tw / (heightM * heightM) : 0;

  let targetError: string | null = null;
  if (direction === "lose" && tw > 0 && tw >= cw) targetError = "Target should be below your current weight.";
  if (direction === "gain" && tw > 0 && tw <= cw) targetError = "Target should be above your current weight.";
  if (direction === "lose" && bmi > 0 && bmi < 18.5) targetError = "Target weight is below a healthy BMI for your height.";
  if (direction === "gain" && bmi >= 35) targetError = "Target weight is above a safe range for your height.";

  const title =
    goal === "fat_loss" ? "How much would you like to lose, and how fast?" :
    goal === "muscle_gain" || goal === "strength" ? "How much would you like to gain, and how fast?" :
    goal === "recomposition" ? "How aggressive should the recomp be?" :
    "What's your competition weight?";
  const sub =
    goal === "recomposition" ? "Recomp works best in a small deficit while training hard." :
    goal === "athletic_performance" ? "We match your calories to training load — no target pace needed." :
    undefined;

  const ratePaces = ratePacesFor(goal);
  const selectedRate = ratePaces?.find((p) => p.id === draft.pace) ?? ratePaces?.[1] ?? null;
  const selectedRecomp = PACES_RECOMP.find((p) => p.id === draft.pace) ?? PACES_RECOMP[1];

  // Guardrail computations (rate-based goals only).
  let weeksToGoal: number | null = null;
  let floorWarn: string | null = null;
  let longCutHint = false;
  if (ratePaces && selectedRate && cw > 0 && tw > 0) {
    const delta = Math.abs(tw - cw);
    const weeklyKg = cw * (selectedRate.pct / 100);
    if (weeklyKg > 0) weeksToGoal = Math.ceil(delta / weeklyKg);

    // Mifflin-St Jeor (kg/cm/age), activity 1.55
    const age = Number(draft.age) || 30;
    const isMale = draft.sex === "male";
    const bmr = isMale
      ? 10 * cw + 6.25 * Number(draft.heightCm) - 5 * age + 5
      : 10 * cw + 6.25 * Number(draft.heightCm) - 5 * age - 161;
    const tdee = bmr * 1.55;
    const weeklyKcal = weeklyKg * 7700;
    const dailyDelta = weeklyKcal / 7;
    const estCalories = direction === "lose" ? tdee - dailyDelta : tdee + dailyDelta;
    const floor = isMale ? 1500 : 1200;
    if (direction === "lose" && estCalories < floor) {
      floorWarn = `This would put you below ${floor} kcal. We'll cap at the floor and the timeline extends.`;
    }
    if (goal === "fat_loss" && weeksToGoal !== null && weeksToGoal > 20) longCutHint = true;
  }

  const unit = draft.weightUnit;
  const targetDisplayForCopy = draft.targetWeightKg
    ? (unit === "kg" ? Number(Number(draft.targetWeightKg).toFixed(1)) : Number((Number(draft.targetWeightKg) / 0.4536).toFixed(1)))
    : null;

  return (
    <>
      <StepHeader title={title} sub={sub} />

      {goal !== "athletic_performance" && (
        <>
          <FieldLabel>{goal === "recomposition" ? "Target weight (usually your current weight)" : "Target weight"}</FieldLabel>
          <InputBox>
            <input
              type="text" inputMode="decimal"
              value={targetWeightDisplay}
              onChange={(e) => setTargetWeightDisplay(e.target.value)}
              placeholder="—"
              className="flex-1 bg-transparent text-body text-text-primary placeholder:text-text-tertiary focus:outline-none"
            />
            <span className="text-body-sm text-text-tertiary ml-2">{unit}</span>
          </InputBox>
          {targetError && (
            <p className="mt-2 text-body-sm" style={{ color: "var(--danger)" }}>{targetError}</p>
          )}
        </>
      )}

      {goal === "athletic_performance" && (
        <>
          <FieldLabel>Competition weight</FieldLabel>
          <InputBox>
            <input
              type="text" inputMode="decimal"
              value={targetWeightDisplay}
              onChange={(e) => setTargetWeightDisplay(e.target.value)}
              placeholder="—"
              className="flex-1 bg-transparent text-body text-text-primary placeholder:text-text-tertiary focus:outline-none"
            />
            <span className="text-body-sm text-text-tertiary ml-2">{unit}</span>
          </InputBox>
          <div className="mt-4" style={CARD_BASE}>
            <p className="text-body font-medium text-text-primary">Maintain your competition weight</p>
            <p className="text-body-sm text-text-tertiary mt-1 leading-snug">
              We'll match your calories to your training load. Your targets will move up on heavy days and down on rest days.
            </p>
          </div>
        </>
      )}

      {ratePaces && (
        <div className="mt-6">
          <FieldLabel>How fast?</FieldLabel>
          <div className="mt-2 space-y-2">
            {ratePaces.map((p) => {
              const active = draft.pace === p.id;
              return (
                <button
                  key={p.id} type="button" onClick={() => patch({ pace: p.id })}
                  className="w-full text-left flex items-center justify-between"
                  style={active ? PACE_ACTIVE : CARD_BASE}
                >
                  <div>
                    <p className="text-body font-medium text-text-primary">{p.label}</p>
                    <p className="text-body-sm text-text-tertiary mt-0.5">{p.blurb}</p>
                  </div>
                  {active && <Check size={18} style={{ color: "var(--brand-500)" }} />}
                </button>
              );
            })}
          </div>

          {selectedRate && weeksToGoal !== null && targetDisplayForCopy !== null && (
            <p className="mt-3 text-body-sm text-text-secondary">
              ~{weeksToGoal} weeks to reach {targetDisplayForCopy}{unit}
            </p>
          )}
          {floorWarn && (
            <p className="mt-2 text-body-sm" style={{ color: "var(--warn)" }}>{floorWarn}</p>
          )}
          {longCutHint && (
            <p className="mt-2 text-body-sm italic text-text-secondary">
              Long cuts are hard to sustain. Consider a Steady pace with a diet break every 8–12 weeks.
            </p>
          )}
        </div>
      )}

      {goal === "recomposition" && (
        <div className="mt-6">
          <FieldLabel>How aggressive?</FieldLabel>
          <div className="mt-2 space-y-2">
            {PACES_RECOMP.map((p) => {
              const active = draft.pace === p.id;
              return (
                <button
                  key={p.id} type="button" onClick={() => patch({ pace: p.id })}
                  className="w-full text-left flex items-center justify-between"
                  style={active ? PACE_ACTIVE : CARD_BASE}
                >
                  <div>
                    <p className="text-body font-medium text-text-primary">{p.label}</p>
                    <p className="text-body-sm text-text-tertiary mt-0.5">{p.blurb}</p>
                  </div>
                  {active && <Check size={18} style={{ color: "var(--brand-500)" }} />}
                </button>
              );
            })}
          </div>
          <p className="mt-3 text-body-sm text-text-secondary">
            Track for 8+ weeks to see change — scale weight won't move much.
          </p>
          {selectedRecomp && null}
        </div>
      )}
    </>
  );
}


function ReviewStep({ draft }: { draft: Draft }) {
  const goalLabel = GOALS.find((g) => g.id === draft.goal)?.label ?? "—";
  const expLabel = EXPERIENCE.find((e) => e.id === draft.experienceLevel)?.label ?? "—";
  const eqLabel = EQUIPMENT_OPTIONS.find((e) => e.id === draft.equipment)?.label ?? "—";
  const eatLabel = EATING_PATTERNS.find((e) => e.id === draft.eatingPattern)?.label ?? "—";
  const paceLabel = (() => {
    const g = draft.goal;
    if (!g) return "—";
    if (g === "athletic_performance") return "Match training load";
    if (g === "recomposition") {
      const item = PACES_RECOMP.find((p) => p.id === draft.pace) ?? PACES_RECOMP[1];
      return `${item.label} · ~${item.kcalDelta} kcal/day below TDEE`;
    }
    const table = ratePacesFor(g);
    if (!table) return "—";
    const item = table.find((p) => p.id === draft.pace) ?? table[1];
    return `${item.label} · ${item.pct}%/week`;
  })();

  const dayLabels: Record<string, string> = { mon: "Mon", tue: "Tue", wed: "Wed", thu: "Thu", fri: "Fri", sat: "Sat", sun: "Sun" };
  const order = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
  const daysPretty = order.filter((d) => draft.trainingDays.includes(d)).map((d) => dayLabels[d]).join(" ") || "—";

  const heading = draft.name.trim() ? `Ready, ${draft.name.trim()}?` : "Ready?";
  const weightStr = draft.weightKg ? `${Number(Number(draft.weightKg).toFixed(1))} kg` : "—";
  const heightStr = draft.heightCm ? `${Number(Number(draft.heightCm).toFixed(1))} cm` : "—";
  const targetStr = draft.targetWeightKg ? `${Number(Number(draft.targetWeightKg).toFixed(1))} kg` : "—";

  return (
    <>
      <StepHeader title={heading} />
      <div className="divide-y" style={{ background: "var(--bg-1)", borderRadius: "var(--radius-lg)", border: "1px solid var(--border-hairline)" }}>
        <Row label="Name" value={draft.name || "—"} />
        <Row label="Age" value={draft.age || "—"} />
        <Row label="Sex" value={draft.sex ?? "—"} />
        <Row label="Experience" value={expLabel} />
        <Row label="Goal" value={goalLabel} />
        <Row label="Training days" value={`${draft.trainingDays.length} / week · ${daysPretty}`} />
        <Row label="Setup" value={eqLabel} />
        <Row label="Eating" value={eatLabel} />
        <Row label="Weight" value={weightStr} />
        <Row label="Height" value={heightStr} />
        <Row label="Target" value={targetStr} />
        <Row label="Pace" value={paceLabel} />
      </div>
    </>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between px-4 py-3.5 gap-3" style={{ borderColor: "var(--border-hairline)" }}>
      <span className="text-body-sm text-text-secondary shrink-0">{label}</span>
      <span className="text-body text-text-primary text-right capitalize">{value}</span>
    </div>
  );
}

function FieldLabel({ children, inline }: { children: React.ReactNode; inline?: boolean }) {
  return <p className={`text-label text-text-tertiary ${inline ? "" : "mb-1"}`}>{children}</p>;
}

function InputBox({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center px-4"
      style={{
        height: 48,
        background: "var(--bg-1)",
        border: "1px solid var(--border-subtle)",
        borderRadius: "var(--radius-md)",
      }}
    >
      {children}
    </div>
  );
}

function SegmentedPill({ options, value, onChange }: { options: { id: string; label: string }[]; value: string; onChange: (v: string) => void }) {
  return (
    <div className="inline-flex p-0.5"
      style={{ background: "var(--bg-2)", borderRadius: "var(--radius-pill)", border: "1px solid var(--border-hairline)" }}>
      {options.map((o) => {
        const active = o.id === value;
        return (
          <button
            key={o.id} type="button" onClick={() => onChange(o.id)}
            className="text-body-sm font-medium transition-colors"
            style={{
              padding: "6px 14px",
              borderRadius: "var(--radius-pill)",
              background: active ? "var(--brand-gradient)" : "transparent",
              color: active ? "#0A0B12" : "var(--text-tertiary)",
              transitionDuration: "var(--dur-fast)",
            }}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

const APEX_FACTS = [
  "BMR calculated via Mifflin-St Jeor — the most validated formula for non-obese adults.",
  "Protein set at 1.8g/kg. During a cut APEX raises this to 2.2g/kg to protect lean mass.",
  "TDEE uses your training days as a PAL multiplier — not a generic activity level.",
  "APEX Shield scores 5 pillars: Recovery, Sleep, Nutrition, Training Load, and Mood.",
  "The adaptive macro engine adjusts targets weekly from real weight trend vs intake.",
  "Fat floor: 0.4g/kg or 25% of calories, whichever is higher — for hormonal health.",
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
    <div className="min-h-screen flex flex-col items-center justify-center px-6">
      <div className="flex items-center justify-center rounded-full"
        style={{
          width: 96, height: 96,
          background: "var(--brand-gradient)",
          boxShadow: "var(--shadow-glow-brand)",
          animation: "breathe 2.4s ease-in-out infinite",
        }}>
        <Sparkles size={28} color="#0A0B12" strokeWidth={2.5} />
      </div>
      <h1 className="mt-8 text-hero text-text-primary text-center">Generating your plan</h1>
      <div className="mt-4 max-w-sm w-full min-h-[60px] flex items-center justify-center">
        <p key={idx} className="text-body text-text-secondary text-center px-2" style={{ animation: "fade-up 0.5s ease-out both" }}>
          {APEX_FACTS[idx]}
        </p>
      </div>
      <div className="mt-8 w-full max-w-sm h-[3px] rounded-full overflow-hidden" style={{ background: "var(--border-hairline)" }}>
        <div
          className="h-full rounded-full"
          style={{
            width: `${progress}%`,
            background: "var(--brand-gradient)",
            transition: "width 200ms linear",
          }}
        />
      </div>
    </div>
  );
}
