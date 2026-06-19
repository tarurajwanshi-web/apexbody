import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { useProfile } from "@/lib/store";
import { Sparkles } from "lucide-react";

export const Route = createFileRoute("/disclaimer")({
  component: Disclaimer,
});

function Disclaimer() {
  const navigate = useNavigate();
  const { update } = useProfile();
  const [agreed, setAgreed] = useState(false);

  return (
    <div className="relative min-h-screen bg-gradient-to-b from-bg-2 to-bg-0 px-6 py-10 flex flex-col">
      <div className="absolute top-0 left-0 right-0 h-[2px] gradient-brand" />

      <div className="flex-1">
        <div className="flex flex-col items-center pt-2">
          <div className="h-16 w-16 rounded-full gradient-brand flex items-center justify-center ai-glow">
            <Sparkles size={28} className="text-white" strokeWidth={2.5} />
          </div>
          <h1
            className="mt-5 text-[28px] font-bold text-white"
            style={{ letterSpacing: "3px" }}
          >
            APEX
          </h1>
          <p className="mt-1 text-[13px] text-text-secondary">
            Adaptive Performance Coach
          </p>
        </div>

        <div className="mt-10 space-y-5 text-text-secondary" style={{ fontSize: "14px", lineHeight: 1.7 }}>
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
        <label className="flex w-full items-center gap-3 rounded-2xl bg-bg-2 border border-white/5 px-4 py-3 cursor-pointer">
          <input
            type="checkbox"
            checked={agreed}
            onChange={(e) => setAgreed(e.target.checked)}
            className="h-5 w-5 rounded accent-[#7C3AED] cursor-pointer"
          />
          <span className="text-sm">I have read and agree to the terms</span>
        </label>

        <button
          disabled={!agreed}
          onClick={() => { update({ agreedTerms: true }); navigate({ to: "/onboarding" }); }}
          className="w-full gradient-brand font-semibold text-white disabled:opacity-30 disabled:cursor-not-allowed transition"
          style={{ height: "56px", borderRadius: "14px" }}
        >
          I Understand, Let's Begin
        </button>
        <p className="text-center text-[10px] text-text-tertiary">Powered by Claude AI</p>
      </div>
    </div>
  );
}
