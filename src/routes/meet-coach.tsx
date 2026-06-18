import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { AIOrb } from "@/components/AIOrb";
import { Sparkles } from "lucide-react";
import { useProfile } from "@/lib/store";

export const Route = createFileRoute("/meet-coach")({
  component: MeetCoach,
});

function MeetCoach() {
  const navigate = useNavigate();
  const { profile, update } = useProfile();
  const [name, setName] = useState(profile.coachName || "APEX");

  const finish = () => {
    update({ coachName: name, onboarded: true });
    navigate({ to: "/home" });
  };

  return (
    <div className="min-h-screen bg-bg-0 px-6 py-10 flex flex-col">
      <div className="flex flex-col items-center text-center mt-6">
        <AIOrb size={120} />
        <h1 className="mt-6 text-3xl font-bold">Meet your Coach</h1>
        <p className="mt-2 text-[15px] text-text-secondary">Your adaptive AI performance system</p>
      </div>

      <div className="mt-10 space-y-3 flex-1">
        <Bubble delay={0}>Hi {profile.name}, I'm your APEX Coach.</Bubble>
        <Bubble delay={120}>
          I've built your initial program based on your profile. I'll adapt it every week based on how you train, eat, sleep, and recover.
        </Bubble>
        <Bubble delay={240}>
          The more data you give me, the smarter I get. Talk to me anytime — I'm here to make you better.
        </Bubble>

        <div className="mt-8 rounded-2xl bg-bg-2 border border-white/5 p-5">
          <p className="text-xs uppercase tracking-wider text-text-tertiary">What should I call myself?</p>
          <div className="mt-3 flex gap-2">
            {["Coach", "APEX", "My Coach"].map((n) => (
              <button
                key={n}
                onClick={() => setName(n)}
                className={`flex-1 rounded-full py-2.5 text-sm font-medium ${name === n ? "gradient-brand text-white" : "bg-bg-3 text-text-secondary"}`}
              >
                {n}
              </button>
            ))}
          </div>
        </div>
      </div>

      <button onClick={finish} className="mt-8 w-full rounded-2xl gradient-brand py-4 font-semibold text-white">
        Let's Begin →
      </button>
    </div>
  );
}

function Bubble({ children, delay }: { children: React.ReactNode; delay: number }) {
  return (
    <div className="rounded-2xl bg-bg-2 border border-white/5 p-4 flex gap-3 animate-fade-up" style={{ animationDelay: `${delay}ms` }}>
      <Sparkles size={16} className="text-ai mt-0.5 shrink-0" />
      <p className="text-[15px] text-text-primary leading-relaxed">{children}</p>
    </div>
  );
}
