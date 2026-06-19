import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useRef, useState } from "react";
import {
  ChevronLeft,
  Trophy,
  Flame,
  Dumbbell,
  Zap,
  Camera,
  Check,
  Activity,
} from "lucide-react";
import { useProfile, type Profile } from "@/lib/store";

export const Route = createFileRoute("/onboarding")({
  component: Onboarding,
});

const TOTAL = 7;

const hasAnyPhoto = (d: Profile) => !!(d.photos?.front || d.photos?.side || d.photos?.back);

function Onboarding() {
  const navigate = useNavigate();
  const { profile, update } = useProfile();
  const [step, setStep] = useState(1);
  const [draft, setDraft] = useState<Profile>(profile);

  const patch = (p: Partial<Profile>) => setDraft((d) => ({ ...d, ...p }));

  const canContinue = (() => {
    switch (step) {
      case 1: return !!draft.name.trim() && !!draft.gender && draft.age > 0;
      case 2: return draft.weightKg > 0 && draft.heightCm > 0;
      case 3: return !!draft.experience;
      case 4: return !!draft.goal;
      case 7: return !!draft.recoveryDevice;
      default: return true;
    }
  })();

  const next = () => {
    if (step === TOTAL) {
      update({ ...draft });
      navigate({ to: "/meet-coach" });
    } else {
      setStep(step + 1);
    }
  };
  const back = () =>
    step === 1 ? navigate({ to: "/disclaimer" }) : setStep(step - 1);

  return (
    <div className="min-h-screen flex flex-col px-6 pt-6 pb-8" style={{ backgroundColor: "#0A0E1A" }}>
      <div className="h-[3px] w-full overflow-hidden rounded-full bg-white/5">
        <div
          className="h-full gradient-brand transition-all duration-300"
          style={{ width: `${(step / TOTAL) * 100}%` }}
        />
      </div>

      <div className="mt-5 flex items-center justify-between">
        <button onClick={back} className="text-text-secondary -ml-1">
          <ChevronLeft size={26} />
        </button>
        <span className="text-[12px] text-text-secondary">Step {step} of {TOTAL}</span>
      </div>

      <div className="flex-1 mt-8 animate-fade-up" key={step}>
        {step === 1 && <StepBasics draft={draft} patch={patch} />}
        {step === 2 && <StepBody draft={draft} patch={patch} />}
        {step === 3 && <StepExperience draft={draft} patch={patch} />}
        {step === 4 && <StepGoal draft={draft} patch={patch} />}
        {step === 5 && <StepBodyFat draft={draft} patch={patch} />}
        {step === 6 && <StepPhotos draft={draft} patch={patch} />}
        {step === 7 && <StepRecovery draft={draft} patch={patch} />}
      </div>

      <button
        onClick={next}
        disabled={!canContinue && step !== 6}
        className={`w-full font-semibold text-white disabled:opacity-30 disabled:cursor-not-allowed transition active:scale-[0.98] ${
          step === 6 && !hasAnyPhoto(draft)
            ? "bg-[#171F33] border border-white/10 text-text-secondary"
            : "gradient-brand"
        }`}
        style={{ height: "56px", borderRadius: "14px" }}
      >
        {step === 6 && !hasAnyPhoto(draft) ? "Skip Photos" : "Next"}
      </button>
    </div>
  );
}

function Header({ q, sub }: { q: string; sub?: string }) {
  return (
    <div className="mb-7">
      <h1 className="text-[24px] font-bold leading-tight text-white">{q}</h1>
      {sub && <p className="mt-2 text-[14px] text-text-secondary">{sub}</p>}
    </div>
  );
}

const inputCls =
  "w-full rounded-xl border border-white/10 bg-[#171F33] px-4 py-3.5 text-white placeholder:text-text-tertiary outline-none focus:border-ai/60 transition";

/* STEP 1 */
function StepBasics({ draft, patch }: { draft: Profile; patch: (p: Partial<Profile>) => void }) {
  const genders: { v: Profile["gender"]; label: string }[] = [
    { v: "male", label: "Male" },
    { v: "female", label: "Female" },
    { v: "other", label: "Other" },
  ];
  return (
    <div>
      <Header q="Let's get to know you" sub="Tell us a little about yourself." />
      <div className="space-y-4">
        <div>
          <label className="block text-[12px] text-text-secondary mb-2">Full name</label>
          <input
            className={inputCls}
            placeholder="Your name"
            value={draft.name}
            onChange={(e) => patch({ name: e.target.value })}
          />
        </div>
        <div>
          <label className="block text-[12px] text-text-secondary mb-2">Age</label>
          <input
            type="number"
            inputMode="numeric"
            className={inputCls}
            placeholder="28"
            value={draft.age || ""}
            onChange={(e) => patch({ age: Number(e.target.value) })}
          />
        </div>
        <div>
          <label className="block text-[12px] text-text-secondary mb-2">Gender</label>
          <div className="grid grid-cols-3 gap-2">
            {genders.map(({ v, label }) => {
              const active = draft.gender === v;
              return (
                <button
                  key={v}
                  onClick={() => patch({ gender: v })}
                  className={`rounded-full py-3 text-sm font-medium transition ${
                    active
                      ? "gradient-brand text-white"
                      : "bg-[#171F33] text-text-secondary border border-white/10"
                  }`}
                >
                  {label}
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

/* STEP 2 */
function UnitPill<T extends string>({
  value, options, onChange,
}: { value: T; options: T[]; onChange: (v: T) => void }) {
  return (
    <div className="inline-flex rounded-full bg-[#171F33] border border-white/10 p-1">
      {options.map((o) => (
        <button
          key={o}
          onClick={() => onChange(o)}
          className={`px-3 py-1 text-xs font-semibold rounded-full transition ${
            value === o ? "gradient-brand text-white" : "text-text-secondary"
          }`}
        >
          {o}
        </button>
      ))}
    </div>
  );
}

function StepBody({ draft, patch }: { draft: Profile; patch: (p: Partial<Profile>) => void }) {
  const weightDisplay = draft.weightUnit === "kg"
    ? draft.weightKg
    : Math.round(draft.weightKg * 2.20462);
  const heightDisplay = draft.heightUnit === "cm"
    ? draft.heightCm
    : Number((draft.heightCm / 30.48).toFixed(1));

  return (
    <div>
      <Header q="Your current stats" sub="Used to calibrate training and nutrition." />
      <div className="space-y-5">
        <div>
          <div className="flex items-center justify-between mb-2">
            <label className="text-[12px] text-text-secondary">Weight</label>
            <UnitPill
              value={draft.weightUnit}
              options={["kg", "lbs"]}
              onChange={(u) => patch({ weightUnit: u })}
            />
          </div>
          <input
            type="number"
            inputMode="decimal"
            className={inputCls}
            value={weightDisplay || ""}
            onChange={(e) => {
              const v = Number(e.target.value);
              patch({ weightKg: draft.weightUnit === "kg" ? v : v / 2.20462 });
            }}
          />
        </div>
        <div>
          <div className="flex items-center justify-between mb-2">
            <label className="text-[12px] text-text-secondary">Height</label>
            <UnitPill
              value={draft.heightUnit}
              options={["cm", "ft"]}
              onChange={(u) => patch({ heightUnit: u })}
            />
          </div>
          <input
            type="number"
            inputMode="decimal"
            className={inputCls}
            value={heightDisplay || ""}
            onChange={(e) => {
              const v = Number(e.target.value);
              patch({ heightCm: draft.heightUnit === "cm" ? v : v * 30.48 });
            }}
          />
        </div>
      </div>
    </div>
  );
}

/* STEP 3 */
function SelectCard({
  active, title, sub, icon, onClick,
}: {
  active: boolean;
  title: string;
  sub: string;
  icon?: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`w-full flex items-center gap-4 rounded-2xl px-4 text-left transition ${
        active
          ? "bg-ai/10 border-l-4 border-ai pl-3"
          : "bg-[#171F33] border border-white/10"
      }`}
      style={{ minHeight: "72px" }}
    >
      {icon && (
        <div className={`flex-shrink-0 ${active ? "text-text-accent" : "text-text-secondary"}`}>
          {icon}
        </div>
      )}
      <div className="flex-1">
        <div className="font-semibold text-white text-[15px]">{title}</div>
        <div className="text-[12px] text-text-secondary mt-0.5">{sub}</div>
      </div>
    </button>
  );
}

function StepExperience({ draft, patch }: { draft: Profile; patch: (p: Partial<Profile>) => void }) {
  const opts: { v: Profile["experience"]; title: string; sub: string }[] = [
    { v: "beginner", title: "Beginner", sub: "Under 1 year consistent training" },
    { v: "intermediate", title: "Intermediate", sub: "1-3 years, comfortable with compound lifts" },
    { v: "advanced", title: "Advanced", sub: "3+ years, structured programming" },
  ];
  return (
    <div>
      <Header q="Your training experience" sub="We'll tune intensity and volume to your level." />
      <div className="space-y-3">
        {opts.map((o) => (
          <SelectCard
            key={o.v}
            active={draft.experience === o.v}
            title={o.title}
            sub={o.sub}
            onClick={() => patch({ experience: o.v })}
          />
        ))}
      </div>
    </div>
  );
}

/* STEP 4 */
function StepGoal({ draft, patch }: { draft: Profile; patch: (p: Partial<Profile>) => void }) {
  const opts: { v: Profile["goal"]; title: string; sub: string; Icon: typeof Trophy }[] = [
    { v: "recomp", title: "Body Recomposition", sub: "Lose fat, build muscle simultaneously", Icon: Trophy },
    { v: "fatloss", title: "Fat Loss", sub: "Reduce body fat, maintain muscle", Icon: Flame },
    { v: "strength", title: "Strength & Muscle", sub: "Build size and strength", Icon: Dumbbell },
    { v: "performance", title: "Performance", sub: "Athletic output and endurance", Icon: Zap },
  ];
  return (
    <div>
      <Header q="What's your main goal?" sub="We'll build your system around this." />
      <div className="space-y-3">
        {opts.map(({ v, title, sub, Icon }) => (
          <SelectCard
            key={v}
            active={draft.goal === v}
            title={title}
            sub={sub}
            icon={<Icon size={24} />}
            onClick={() => patch({ goal: v })}
          />
        ))}
      </div>
    </div>
  );
}

/* STEP 5 */
function StepBodyFat({ draft, patch }: { draft: Profile; patch: (p: Partial<Profile>) => void }) {
  return (
    <div>
      <Header q="Current and target body fat" sub="Estimate is fine. We'll track progress." />
      <div className="space-y-8 mt-2">
        <div>
          <div className="flex items-end justify-between mb-3">
            <span className="text-[13px] text-text-secondary">I'm currently around</span>
            <span className="text-3xl font-bold gradient-text tabular-nums">{draft.bodyFat}%</span>
          </div>
          <input
            type="range" min={8} max={40} value={draft.bodyFat}
            onChange={(e) => patch({ bodyFat: Number(e.target.value) })}
            className="w-full accent-[#7C3AED]"
          />
        </div>
        <div>
          <div className="flex items-end justify-between mb-3">
            <span className="text-[13px] text-text-secondary">My goal is</span>
            <span className="text-3xl font-bold gradient-text tabular-nums">{draft.targetBodyFat}%</span>
          </div>
          <input
            type="range" min={8} max={40} value={draft.targetBodyFat}
            onChange={(e) => patch({ targetBodyFat: Number(e.target.value) })}
            className="w-full accent-[#7C3AED]"
          />
        </div>
      </div>
      <p className="mt-8 text-[12px] text-text-tertiary text-center">
        We recalibrate every 2 weeks based on actual progress
      </p>
    </div>
  );
}

/* STEP 6 */
function PhotoButton({
  label, sub, value, onChange,
}: { label: string; sub: string; value?: string; onChange: (data: string) => void }) {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <div className="flex flex-col items-center gap-2">
      <button
        type="button"
        onClick={() => ref.current?.click()}
        className="relative flex flex-col items-center justify-center gap-2 overflow-hidden active:scale-[0.98] transition"
        style={{
          width: 140,
          height: 160,
          borderRadius: 16,
          backgroundColor: "#0F1524",
          border: value ? "1px solid rgba(16,185,129,0.4)" : "1px dashed rgba(124,58,237,0.30)",
        }}
      >
        {value ? (
          <>
            <img src={value} alt={label} className="absolute inset-0 h-full w-full object-cover" />
            <div
              className="absolute top-2 right-2 h-6 w-6 rounded-full flex items-center justify-center"
              style={{ backgroundColor: "#10B981" }}
            >
              <Check size={14} className="text-white" strokeWidth={3} />
            </div>
          </>
        ) : (
          <>
            <Camera size={26} className="text-text-accent" />
            <span className="text-[12px] text-text-secondary font-medium">{label}</span>
          </>
        )}
        <input
          ref={ref}
          type="file"
          accept="image/*"
          capture="environment"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (!f) return;
            const reader = new FileReader();
            reader.onload = () => onChange(String(reader.result));
            reader.readAsDataURL(f);
          }}
        />
      </button>
      <span className="text-[11px] text-text-tertiary">{sub}</span>
    </div>
  );
}

function StepPhotos({ draft, patch }: { draft: Profile; patch: (p: Partial<Profile>) => void }) {
  const set = (k: "front" | "side" | "back", v: string) =>
    patch({ photos: { ...draft.photos, [k]: v } });
  return (
    <div>
      <Header
        q="Take your starting photos"
        sub="This helps me assess your body composition and weak points."
      />
      <div className="flex gap-3 justify-center flex-wrap">
        <PhotoButton label="Front" sub="Front relaxed" value={draft.photos.front} onChange={(v) => set("front", v)} />
        <PhotoButton label="Side" sub="Side relaxed" value={draft.photos.side} onChange={(v) => set("side", v)} />
        <PhotoButton label="Back" sub="Back relaxed" value={draft.photos.back} onChange={(v) => set("back", v)} />
      </div>
      <p className="mt-6 text-center text-[12px] text-text-secondary italic">
        Same lighting each week for best comparison
      </p>
      <div className="mt-3 flex items-center justify-center gap-1.5 text-text-tertiary">
        <Lock size={11} />
        <span className="text-[11px]">Your photos stay private and are only used for body composition analysis</span>
      </div>
    </div>
  );
}

/* STEP 7 */
function RecoveryCard({
  active, title, sub, badge, badgeTone, disabled, onClick,
}: {
  active: boolean;
  title: string;
  sub?: string;
  badge?: string;
  badgeTone?: "green" | "gray";
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`w-full text-left rounded-2xl px-4 py-4 transition disabled:opacity-50 ${
        active
          ? "bg-ai/10 border-l-4 border-ai pl-3"
          : "bg-[#171F33] border border-white/10"
      }`}
    >
      <div className="flex items-center gap-2">
        <span className="font-semibold text-white text-[15px]">{title}</span>
        {badge && (
          <span
            className={`text-[10px] uppercase font-bold tracking-wide px-2 py-0.5 rounded-full ${
              badgeTone === "green"
                ? "bg-success/20 text-success"
                : "bg-white/10 text-text-tertiary"
            }`}
          >
            {badge}
          </span>
        )}
      </div>
      {sub && <div className="text-[12px] text-text-secondary mt-1">{sub}</div>}
    </button>
  );
}

function StepRecovery({ draft, patch }: { draft: Profile; patch: (p: Partial<Profile>) => void }) {
  return (
    <div>
      <Header
        q="How do you track recovery?"
        sub="Connect your wearable or upload screenshots."
      />
      <div className="space-y-3">
        <RecoveryCard
          active={draft.recoveryDevice === "whoop"}
          title="Connect WHOOP"
          badge="Recommended"
          badgeTone="green"
          onClick={() => patch({ recoveryDevice: "whoop" })}
        />
        <RecoveryCard
          active={draft.recoveryDevice === "screenshots"}
          title="Upload screenshots"
          sub="WHOOP, Oura, Ultrahuman, Garmin — I'll read them"
          onClick={() => patch({ recoveryDevice: "screenshots" })}
        />
        <RecoveryCard
          active={false}
          disabled
          title="Apple Health"
          badge="Coming Soon"
          badgeTone="gray"
          onClick={() => {}}
        />
        <RecoveryCard
          active={draft.recoveryDevice === "manual"}
          title="Manual entry"
          sub="I'll log sleep and recovery myself"
          onClick={() => patch({ recoveryDevice: "manual" })}
        />
      </div>
      <div className="mt-8 flex items-center justify-center gap-2 text-text-tertiary">
        <Activity size={14} />
        <span className="text-[11px]">Your data stays private and on-device</span>
      </div>
    </div>
  );
}
