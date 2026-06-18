import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { useProfile } from "@/lib/store";
import { Check } from "lucide-react";

export const Route = createFileRoute("/disclaimer")({
  component: Disclaimer,
});

function Disclaimer() {
  const navigate = useNavigate();
  const { update } = useProfile();
  const [agreed, setAgreed] = useState(false);

  return (
    <div className="min-h-screen bg-gradient-to-b from-bg-2 to-bg-0 px-6 py-10 flex flex-col">
      <div className="flex-1">
        <h1 className="text-3xl font-bold">Before we begin</h1>
        <div className="mt-8 space-y-5 text-[15px] leading-relaxed text-text-secondary">
          <p>
            APEX uses AI to generate personalized fitness and nutrition recommendations based on data you provide.
            These are <span className="text-text-primary">not medical recommendations</span>. Always consult a
            healthcare professional before changing your exercise or diet regimen.
          </p>
          <p>
            Results vary by individual. APEX is a performance coaching tool — not a substitute for professional
            medical advice, diagnosis, or treatment.
          </p>
        </div>
        <div className="mt-10 text-center text-[11px] text-text-tertiary">
          <span className="underline">Terms of Service</span> · <span className="underline">Privacy Policy</span> · <span className="underline">Health Data Policy</span>
        </div>
      </div>

      <div className="pt-8 space-y-4">
        <button
          onClick={() => setAgreed((v) => !v)}
          className="flex w-full items-center gap-3 rounded-2xl bg-bg-2 border border-white/5 px-4 py-3 text-left"
        >
          <span className={`flex h-5 w-5 items-center justify-center rounded-md border ${agreed ? "gradient-brand border-transparent" : "border-text-tertiary"}`}>
            {agreed && <Check size={14} className="text-white" strokeWidth={3} />}
          </span>
          <span className="text-sm">I have read and agree to the terms</span>
        </button>

        <button
          disabled={!agreed}
          onClick={() => { update({ agreedTerms: true }); navigate({ to: "/onboarding" }); }}
          className="w-full rounded-2xl gradient-brand py-4 font-semibold text-white disabled:opacity-30 disabled:cursor-not-allowed transition"
        >
          I Understand, Let's Begin
        </button>
        <p className="text-center text-[11px] text-text-tertiary">Powered by Lovable AI</p>
      </div>
    </div>
  );
}
