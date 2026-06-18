import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { ChevronLeft, User, UserRound, Trophy, Flame, Dumbbell, Zap, Check } from "lucide-react";
import { useProfile, type Profile } from "@/lib/store";

export const Route = createFileRoute("/onboarding")({
  component: Onboarding,
});

const TOTAL = 8;

function Onboarding() {
  const navigate = useNavigate();
  const { profile, update } = useProfile();
  const [step, setStep] = useState(1);
  const [draft, setDraft] = useState<Profile>(profile);

  const next = () => {
    if (step === TOTAL) {
      update({ ...draft, onboarded: false });
      navigate({ to: "/meet-coach" });
    } else {
      setStep(step + 1);
    }
  };
  const back = () => (step === 1 ? navigate({ to: "/disclaimer" }) : setStep(step - 1));

  return (
    <div className="min-h-screen bg-bg-1 px-6 py-6 flex flex-col">
      <div className="flex items-center justify-between">
        <button onClick={back} className="text-text-secondary"><ChevronLeft size={24} /></button>
        <span className="text-[11px] uppercase tracking-widest text-text-tertiary">Step {step} of {TOTAL}</span>
      </div>
      <div className="mt-4 h-0.5 w-full overflow-hidden rounded-full bg-white/5">
        <div className="h-full gradient-brand transition-all" style={{ width: `${(step / TOTAL) * 100}%` }} />
      </div>

      <div className="flex-1 mt-10 animate-fade-up" key={step}>
        {step === 1 && <Gender value={draft.gender} onChange={(v) => setDraft({ ...draft, gender: v })} />}
        {step === 2 && <AgePicker value={draft.age} onChange={(v) => setDraft({ ...draft, age: v })} />}
        {step === 3 && <WeightPicker value={draft.weightKg} onChange={(v) => setDraft({ ...draft, weightKg: v })} />}
        {step === 4 && <HeightPicker value={draft.heightCm} onChange={(v) => setDraft({ ...draft, heightCm: v })} />}
        {step === 5 && <Goal value={draft.goal} onChange={(v) => setDraft({ ...draft, goal: v })} />}
        {step === 6 && <Experience value={draft.experience} onChange={(v) => setDraft({ ...draft, experience: v })} />}
        {step === 7 && <Frequency value={draft.frequency} days={draft.days} onChange={(f, d) => setDraft({ ...draft, frequency: f, days: d })} />}
        {step === 8 && <BodyFat current={draft.bodyFat} target={draft.targetBodyFat} onChange={(c, t) => setDraft({ ...draft, bodyFat: c, targetBodyFat: t })} />}
      </div>

      <button
        onClick={next}
        className="mt-6 w-full rounded-2xl gradient-brand py-4 font-semibold text-white"
      >
        {step === TOTAL ? "Build my plan" : "Continue"}
      </button>
    </div>
  );
}

function Title({ q, sub }: { q: string; sub?: string }) {
  return (
    <div className="mb-8">
      <h1 className="text-3xl font-bold leading-tight">{q}</h1>
      {sub && <p className="mt-2 text-[15px] text-text-secondary">{sub}</p>}
    </div>
  );
}

function Gender({ value, onChange }: { value: Profile["gender"]; onChange: (v: Profile["gender"]) => void }) {
  const opts = [
    { v: "male" as const, icon: User, label: "Male" },
    { v: "female" as const, icon: UserRound, label: "Female" },
  ];
  return (
    <div>
      <Title q="Tell us about yourself" sub="This helps personalize your experience" />
      <div className="grid grid-cols-2 gap-4">
        {opts.map(({ v, icon: Icon, label }) => {
          const active = value === v;
          return (
            <button
              key={v}
              onClick={() => onChange(v)}
              className={`rounded-3xl border p-6 flex flex-col items-center gap-3 transition ${active ? "border-transparent bg-ai/10 ring-2 ring-ai" : "border-white/8 bg-bg-2"}`}
            >
              <Icon size={48} className={active ? "text-text-accent" : "text-text-secondary"} />
              <span className={`font-semibold ${active ? "text-text-primary" : "text-text-secondary"}`}>{label}</span>
            </button>
          );
        })}
      </div>
      <button onClick={() => onChange("other")} className="mt-6 w-full text-center text-sm text-text-tertiary underline">
        Prefer not to say
      </button>
    </div>
  );
}

function AgePicker({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  return (
    <div>
      <Title q="How old are you?" sub="This calibrates your training and recovery." />
      <div className="flex flex-col items-center gap-2 mt-4">
        <div className="flex items-center gap-6">
          <button onClick={() => onChange(Math.max(16, value - 1))} className="h-12 w-12 rounded-full bg-bg-3 text-2xl">−</button>
          <div className="text-[72px] font-extrabold leading-none gradient-text tabular-nums">{value}</div>
          <button onClick={() => onChange(Math.min(90, value + 1))} className="h-12 w-12 rounded-full bg-bg-3 text-2xl">+</button>
        </div>
        <p className="text-text-secondary mt-2">years old</p>
      </div>
    </div>
  );
}

function WeightPicker({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  return (
    <div>
      <Title q="What's your weight?" />
      <div className="text-center mt-6">
        <span className="text-[72px] font-extrabold leading-none tabular-nums">{value}</span>
        <span className="text-2xl text-text-secondary ml-2">kg</span>
      </div>
      <input
        type="range" min={40} max={180} value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full mt-8 accent-[--ai-purple]"
      />
      <div className="flex justify-between text-xs text-text-tertiary mt-2"><span>40</span><span>180</span></div>
    </div>
  );
}

function HeightPicker({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  return (
    <div>
      <Title q="What's your height?" />
      <div className="text-center mt-6">
        <span className="text-[72px] font-extrabold leading-none tabular-nums">{value}</span>
        <span className="text-2xl text-text-secondary ml-2">cm</span>
      </div>
      <input
        type="range" min={140} max={220} value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full mt-8 accent-[--ai-purple]"
      />
      <div className="flex justify-between text-xs text-text-tertiary mt-2"><span>140</span><span>220</span></div>
    </div>
  );
}

function Goal({ value, onChange }: { value: Profile["goal"]; onChange: (v: Profile["goal"]) => void }) {
  const opts = [
    { v: "recomp" as const, icon: Trophy, label: "Body recomposition", sub: "Lose fat, build muscle simultaneously" },
    { v: "fatloss" as const, icon: Flame, label: "Fat loss", sub: "Reduce body fat, maintain muscle" },
    { v: "strength" as const, icon: Dumbbell, label: "Strength & muscle", sub: "Build size and strength" },
    { v: "performance" as const, icon: Zap, label: "Performance", sub: "Athletic output, endurance" },
  ];
  return (
    <div>
      <Title q="What's your main goal?" sub="We'll build your entire system around this." />
      <div className="space-y-3">
        {opts.map(({ v, icon: Icon, label, sub }) => {
          const active = value === v;
          return (
            <button
              key={v}
              onClick={() => onChange(v)}
              className={`w-full flex items-center gap-4 rounded-2xl border p-4 text-left transition ${active ? "border-transparent bg-ai/10 ring-2 ring-ai" : "border-white/8 bg-bg-2"}`}
            >
              <Icon size={24} className={active ? "text-text-accent" : "text-text-secondary"} />
              <div className="flex-1">
                <div className="font-semibold">{label}</div>
                <div className="text-xs text-text-secondary mt-0.5">{sub}</div>
              </div>
              {active && <Check size={18} className="text-text-accent" />}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function Experience({ value, onChange }: { value: Profile["experience"]; onChange: (v: Profile["experience"]) => void }) {
  const opts = [
    { v: "beginner" as const, label: "Beginner", sub: "Under 1 year of consistent training" },
    { v: "intermediate" as const, label: "Intermediate", sub: "1–3 years, comfortable with compounds" },
    { v: "advanced" as const, label: "Advanced", sub: "3+ years, structured programming" },
  ];
  return (
    <div>
      <Title q="Your training experience?" />
      <div className="space-y-3">
        {opts.map(({ v, label, sub }) => {
          const active = value === v;
          return (
            <button
              key={v}
              onClick={() => onChange(v)}
              className={`w-full rounded-2xl border p-4 text-left transition ${active ? "border-transparent bg-ai/10 ring-2 ring-ai" : "border-white/8 bg-bg-2"}`}
            >
              <div className="font-semibold">{label}</div>
              <div className="text-xs text-text-secondary mt-0.5">{sub}</div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function Frequency({ value, days, onChange }: { value: number; days: string[]; onChange: (f: number, d: string[]) => void }) {
  const weekdays = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  const toggle = (d: string) => {
    const next = days.includes(d) ? days.filter((x) => x !== d) : [...days, d];
    onChange(next.length, next);
  };
  return (
    <div>
      <Title q="How often do you train?" />
      <div className="flex justify-center gap-2 flex-wrap">
        {[2, 3, 4, 5, 6].map((n) => (
          <button
            key={n}
            onClick={() => onChange(n, days)}
            className={`h-12 w-12 rounded-full font-semibold ${value === n ? "gradient-brand text-white" : "bg-bg-3 text-text-secondary"}`}
          >
            {n}×
          </button>
        ))}
      </div>
      <p className="mt-8 text-xs uppercase tracking-wider text-text-tertiary">Which days?</p>
      <div className="mt-3 grid grid-cols-7 gap-2">
        {weekdays.map((d) => {
          const active = days.includes(d);
          return (
            <button
              key={d}
              onClick={() => toggle(d)}
              className={`h-12 rounded-xl text-xs font-medium ${active ? "gradient-brand text-white" : "bg-bg-3 text-text-secondary"}`}
            >
              {d.slice(0, 2)}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function BodyFat({ current, target, onChange }: { current: number; target: number; onChange: (c: number, t: number) => void }) {
  return (
    <div>
      <Title q="Current and target body fat?" sub="Estimate is fine — we recalibrate every 2 weeks." />
      <div className="space-y-8 mt-4">
        <div>
          <div className="flex justify-between text-sm mb-2"><span className="text-text-secondary">I'm currently around</span><span className="font-bold gradient-text">{current}%</span></div>
          <input type="range" min={8} max={40} value={current} onChange={(e) => onChange(Number(e.target.value), target)} className="w-full accent-[--ai-purple]" />
        </div>
        <div>
          <div className="flex justify-between text-sm mb-2"><span className="text-text-secondary">My goal is</span><span className="font-bold gradient-text">{target}%</span></div>
          <input type="range" min={8} max={40} value={target} onChange={(e) => onChange(current, Number(e.target.value))} className="w-full accent-[--ai-purple]" />
        </div>
      </div>
      <div className="mt-8 rounded-2xl bg-bg-3 border-l-2 border-ai p-4">
        <p className="text-[13px] text-text-secondary italic">
          APEX will build your coaching system around these numbers. We recalibrate every 2 weeks based on actual progress.
        </p>
      </div>
    </div>
  );
}
