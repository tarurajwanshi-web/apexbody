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
    .select("profile_completed_at")
    .eq("user_id", userId)
    .maybeSingle();
  if (data?.profile_completed_at) {
    navigate({ to: "/dashboard" });
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
        <AmbientRing />
        <p className="mt-10 text-center text-[15px] text-text-secondary max-w-[280px] leading-relaxed">
          Not just a number.<br />Know how much to trust it.
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

function AmbientRing() {
  const size = 220;
  const stroke = 10;
  const r = size / 2 - stroke / 2;
  const c = 2 * Math.PI * r;
  // Incomplete/ambiguous arc — ~62% of circumference filled
  const dash = c * 0.62;
  return (
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
          className="ambient-ring-arc"
          cx={size / 2} cy={size / 2} r={r}
          fill="none" stroke="url(#ambientRingGrad)" strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={`${dash} ${c}`}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      </svg>
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
