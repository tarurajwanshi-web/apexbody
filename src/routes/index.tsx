import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { lovable } from "@/integrations/lovable";
import { toast } from "sonner";

export const Route = createFileRoute("/")({
  ssr: false,
  head: () => ({ meta: [{ title: "Sign in — APEX" }] }),
  component: AuthScreen,
});

async function routeAfterAuth(navigate: ReturnType<typeof useNavigate>, userId: string) {
  const { data } = await supabase
    .from("profiles")
    .select("profile_completed_at, disclaimer_accepted_at")
    .eq("user_id", userId)
    .maybeSingle();

  // STATE 1: no profile row → create it, then disclaimer
  if (!data) {
    await supabase.from("profiles").insert({ user_id: userId });
    navigate({ to: "/disclaimer" });
    return;
  }

  // STATE 3: fully onboarded
  if (data.profile_completed_at) {
    navigate({ to: "/dashboard" });
    return;
  }

  // STATE 2: profile exists, onboarding incomplete
  if (data.disclaimer_accepted_at) {
    navigate({ to: "/onboarding" });
  } else {
    navigate({ to: "/disclaimer" });
  }
}


function AuthScreen() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState<"google" | "apple" | null>(null);
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    let mounted = true;
    supabase.auth.getUser().then(({ data }) => {
      if (!mounted) return;
      if (data.user) routeAfterAuth(navigate, data.user.id);
      else setChecking(false);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === "SIGNED_IN" && session?.user) routeAfterAuth(navigate, session.user.id);
    });
    return () => {
      mounted = false;
      sub.subscription.unsubscribe();
    };
  }, [navigate]);

  const signIn = async (provider: "google" | "apple") => {
    setLoading(provider);
    const result = await lovable.auth.signInWithOAuth(provider, {
      redirect_uri: window.location.origin,
    });
    if (result.error) {
      toast.error(`Sign-in failed: ${result.error.message ?? "Unknown error"}`);
      setLoading(null);
      return;
    }
    if (result.redirected) return;
  };

  return (
    <div className="min-h-screen flex flex-col items-center justify-between bg-bg-0 px-6 py-12">
      <div className="flex-1 flex flex-col items-center justify-center w-full">
        <div className="flex flex-col items-center mb-8">
          <h1
            className="text-[34px] font-bold text-white leading-none"
            style={{ letterSpacing: "4px" }}
          >
            APEX
          </h1>
          <p className="mt-2 text-[11px] font-medium tracking-[0.2em] uppercase text-text-tertiary">
            Shield + Intelligence
          </p>
        </div>
        <DemoRing />
        <p className="mt-10 text-center text-[15px] text-text-secondary max-w-[300px] leading-relaxed">
          Confidence isn't given.<br />It's calculated.
        </p>
      </div>


      <div className="w-full max-w-sm">
        <button
          onClick={() => signIn("google")}
          disabled={loading !== null || checking}
          className="w-full flex items-center justify-center gap-3 rounded-2xl bg-white text-black py-3.5 text-sm font-semibold disabled:opacity-60 mb-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-bg-0"
        >
          <GoogleIcon />
          {loading === "google" ? "Connecting…" : "Continue with Google"}
        </button>

        <button
          onClick={() => signIn("apple")}
          disabled={loading !== null || checking}
          className="w-full flex items-center justify-center gap-3 rounded-2xl bg-bg-2 border border-white/10 py-3.5 text-sm font-semibold disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-bg-0"
        >
          <AppleIcon />
          {loading === "apple" ? "Connecting…" : "Continue with Apple"}
        </button>

        <p className="mt-6 text-center text-[11px] text-text-tertiary">
          By continuing you agree to our terms and privacy policy.
        </p>
      </div>
    </div>
  );
}

type DemoState = {
  score: number;
  confidence: "HIGH" | "MEDIUM";
  insight: string;
};

const DEMO_STATES: DemoState[] = [
  { score: 74, confidence: "HIGH", insight: "Backbone synced. Full range unlocked today." },
  { score: 52, confidence: "MEDIUM", insight: "Half the picture. Sleep data closes the gap." },
  { score: 38, confidence: "HIGH", insight: "Yesterday's strain didn't clear. This number means it." },
];


const CYCLE = {
  ambient: 1500,
  countUp: 1500,
  confidence: 500,
  typewriter: 2500,
  hold: 1500,
  fadeOut: 1000,
};
const CYCLE_TOTAL =
  CYCLE.ambient + CYCLE.countUp + CYCLE.confidence + CYCLE.typewriter + CYCLE.hold + CYCLE.fadeOut;

function easeOutCubic(t: number) {
  return 1 - Math.pow(1 - t, 3);
}

function DemoRing() {
  const size = 220;
  const stroke = 10;
  const r = size / 2 - stroke / 2;
  const c = 2 * Math.PI * r;

  const [reducedMotion, setReducedMotion] = useState(false);
  const [exampleIdx, setExampleIdx] = useState(0);
  const [progress, setProgress] = useState(0); // 0..1 for score/arc fill
  const [confidenceOpacity, setConfidenceOpacity] = useState(0);
  const [typedLen, setTypedLen] = useState(0);
  const [contentOpacity, setContentOpacity] = useState(1); // global fade for phase 6
  const rafRef = useRef<number | null>(null);
  const startRef = useRef<number | null>(null);
  const idxRef = useRef(0);

  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReducedMotion(mq.matches);
    const onChange = () => setReducedMotion(mq.matches);
    mq.addEventListener?.("change", onChange);
    return () => mq.removeEventListener?.("change", onChange);
  }, []);

  useEffect(() => {
    if (reducedMotion) return;
    const tick = (now: number) => {
      if (startRef.current == null) startRef.current = now;
      const elapsed = (now - startRef.current) % CYCLE_TOTAL;
      const cycleNum = Math.floor((now - startRef.current) / CYCLE_TOTAL);
      const targetIdx = cycleNum % DEMO_STATES.length;
      if (targetIdx !== idxRef.current) {
        idxRef.current = targetIdx;
        setExampleIdx(targetIdx);
      }
      const state = DEMO_STATES[targetIdx];

      const t1 = CYCLE.ambient;
      const t2 = t1 + CYCLE.countUp;
      const t3 = t2 + CYCLE.confidence;
      const t4 = t3 + CYCLE.typewriter;
      const t5 = t4 + CYCLE.hold;
      const t6 = t5 + CYCLE.fadeOut;

      if (elapsed < t1) {
        setProgress(0);
        setConfidenceOpacity(0);
        setTypedLen(0);
        setContentOpacity(1);
      } else if (elapsed < t2) {
        setProgress(easeOutCubic((elapsed - t1) / CYCLE.countUp));
        setConfidenceOpacity(0);
        setTypedLen(0);
        setContentOpacity(1);
      } else if (elapsed < t3) {
        setProgress(1);
        setConfidenceOpacity((elapsed - t2) / CYCLE.confidence);
        setTypedLen(0);
        setContentOpacity(1);
      } else if (elapsed < t4) {
        setProgress(1);
        setConfidenceOpacity(1);
        const frac = (elapsed - t3) / CYCLE.typewriter;
        setTypedLen(Math.floor(frac * state.insight.length));
        setContentOpacity(1);
      } else if (elapsed < t5) {
        setProgress(1);
        setConfidenceOpacity(1);
        setTypedLen(state.insight.length);
        setContentOpacity(1);
      } else if (elapsed < t6) {
        const fade = 1 - (elapsed - t5) / CYCLE.fadeOut;
        setContentOpacity(fade);
        setProgress(fade);
      }
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      startRef.current = null;
    };
  }, [reducedMotion]);

  // Reduced-motion static state = example 1
  const displayState = reducedMotion ? DEMO_STATES[0] : DEMO_STATES[exampleIdx];
  const displayScore = reducedMotion ? displayState.score : Math.round(progress * displayState.score);
  const arcFrac = reducedMotion ? displayState.score / 100 : (progress * displayState.score) / 100;
  const dash = c * arcFrac;
  const showScore = reducedMotion || progress > 0;
  const showConfidence = reducedMotion ? true : confidenceOpacity > 0;
  const insightText = reducedMotion ? displayState.insight : displayState.insight.slice(0, typedLen);

  return (
    <div className="flex flex-col items-center">
      <div
        className="relative ambient-ring"
        style={{ width: size, height: size }}
        aria-hidden
      >
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="ambient-ring-rotate">
          <defs>
            <linearGradient id="ambientRingGrad" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#7C3AED" />
              <stop offset="55%" stopColor="#3B82F6" />
              <stop offset="100%" stopColor="#10B981" />
            </linearGradient>
          </defs>
          <circle
            cx={size / 2} cy={size / 2} r={r}
            fill="none" stroke="rgba(255,255,255,0.05)" strokeWidth={stroke}
          />
          <circle
            cx={size / 2} cy={size / 2} r={r}
            fill="none" stroke="url(#ambientRingGrad)" strokeWidth={stroke}
            strokeLinecap="round"
            strokeDasharray={`${dash} ${c}`}
            transform={`rotate(-90 ${size / 2} ${size / 2})`}
            style={{ transition: "stroke-dasharray 80ms linear" }}
          />
        </svg>

        {/* Score + confidence inside the ring */}
        <div
          className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none"
          style={{ opacity: contentOpacity }}
        >
          <div
            className="font-display font-semibold tabular-nums text-text-primary"
            style={{
              fontSize: 64,
              lineHeight: 1,
              opacity: showScore ? 1 : 0,
              transition: "opacity 200ms ease",
            }}
          >
            {displayScore}
          </div>
          <div
            className="mt-2 flex items-center gap-1.5"
            style={{
              opacity: reducedMotion ? 1 : confidenceOpacity,
              transition: "opacity 200ms ease",
            }}
          >
            <span
              className="inline-block rounded-full"
              style={{
                width: 7,
                height: 7,
                backgroundColor: displayState.confidence === "HIGH" ? "#10B981" : "#F59E0B",
                boxShadow: `0 0 8px ${displayState.confidence === "HIGH" ? "rgba(16,185,129,0.6)" : "rgba(245,158,11,0.6)"}`,
              }}
            />
            <span
              className="text-[10px] font-semibold tracking-[0.12em]"
              style={{ color: displayState.confidence === "HIGH" ? "#10B981" : "#F59E0B" }}
            >
              {displayState.confidence}
            </span>
          </div>
        </div>
      </div>

      {/* Insight beneath the ring */}
      <div
        className="mt-5 h-5 text-center text-[13px] text-text-secondary max-w-[300px] leading-snug"
        style={{ opacity: contentOpacity }}
      >
        {insightText}
        {!reducedMotion && typedLen > 0 && typedLen < displayState.insight.length && (
          <span className="inline-block w-[1px] h-[12px] align-middle ml-[1px] bg-text-secondary animate-pulse" />
        )}
      </div>
    </div>
  );
}

function GoogleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden>
      <path fill="#4285F4" d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92c1.7-1.57 2.68-3.88 2.68-6.62z"/>
      <path fill="#34A853" d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.8.54-1.84.86-3.04.86-2.34 0-4.32-1.58-5.03-3.7H.96v2.32A9 9 0 0 0 9 18z"/>
      <path fill="#FBBC05" d="M3.97 10.72A5.42 5.42 0 0 1 3.68 9c0-.6.1-1.18.29-1.72V4.96H.96A9 9 0 0 0 0 9c0 1.45.35 2.83.96 4.04l3.01-2.32z"/>
      <path fill="#EA4335" d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.58C13.46.89 11.43 0 9 0A9 9 0 0 0 .96 4.96l3.01 2.32C4.68 5.16 6.66 3.58 9 3.58z"/>
    </svg>
  );
}

function AppleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M17.05 12.04c-.03-2.84 2.32-4.2 2.42-4.27-1.32-1.93-3.38-2.2-4.11-2.23-1.75-.18-3.42 1.03-4.31 1.03-.9 0-2.27-1-3.73-.98-1.92.03-3.69 1.12-4.68 2.83-2 3.47-.51 8.6 1.43 11.42.95 1.38 2.08 2.92 3.55 2.87 1.43-.06 1.97-.92 3.69-.92 1.71 0 2.21.92 3.72.89 1.54-.03 2.51-1.4 3.45-2.79 1.09-1.6 1.54-3.15 1.56-3.23-.03-.01-2.99-1.15-3.02-4.56zM14.4 3.66c.79-.96 1.32-2.29 1.17-3.62-1.13.05-2.5.76-3.32 1.71-.73.85-1.37 2.2-1.2 3.5 1.26.1 2.55-.64 3.35-1.59z"/>
    </svg>
  );
}
