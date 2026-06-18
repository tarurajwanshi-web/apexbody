import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { loadProfile } from "@/lib/store";
import { AIOrb } from "@/components/AIOrb";

export const Route = createFileRoute("/")({
  component: Splash,
});

function Splash() {
  const navigate = useNavigate();
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    const interval = setInterval(() => setProgress((p) => Math.min(p + 4, 100)), 40);
    const t = setTimeout(() => {
      const p = loadProfile();
      if (!p.agreedTerms) navigate({ to: "/disclaimer" });
      else if (!p.onboarded) navigate({ to: "/onboarding" });
      else navigate({ to: "/home" });
    }, 1400);
    return () => { clearInterval(interval); clearTimeout(t); };
  }, [navigate]);

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-bg-0 px-6">
      <AIOrb size={88} />
      <h1 className="mt-8 text-4xl font-extrabold tracking-[0.3em]">APEX</h1>
      <p className="mt-2 text-[11px] uppercase tracking-[0.25em] text-text-tertiary">
        Adaptive Performance Coach
      </p>
      <div className="mt-16 h-0.5 w-60 overflow-hidden rounded-full bg-white/5">
        <div className="h-full gradient-brand transition-all duration-100" style={{ width: `${progress}%` }} />
      </div>
    </div>
  );
}
