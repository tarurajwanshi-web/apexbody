import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { lovable } from "@/integrations/lovable";
import { ringGlow, ringSolid, ringStops } from "@/lib/ringColor";
import { toast } from "sonner";

export const Route = createFileRoute("/")({
  ssr: false,
  head: () => ({ meta: [{ title: "Sign in — APEX" }] }),
  component: AuthScreen,
});

// Only accept same-origin relative paths.
function safeNextParam(): string | null {
  if (typeof window === "undefined") return null;
  const raw = new URLSearchParams(window.location.search).get("next");
  if (!raw) return null;
  if (!raw.startsWith("/") || raw.startsWith("//")) return null;
  return raw;
}

async function routeAfterAuth(userId: string) {
  const next = safeNextParam();
  if (next) {
    window.location.replace(next);
    return;
  }
  const { data } = await supabase
    .from("profiles")
    .select("profile_completed_at, disclaimer_accepted_at")
    .eq("user_id", userId)
    .maybeSingle();
  if (!data) {
    await supabase.from("profiles").insert({ user_id: userId });
    window.location.replace("/disclaimer");
    return;
  }
  if (data.profile_completed_at) {
    window.location.replace("/dashboard");
    return;
  }
  window.location.replace(data.disclaimer_accepted_at ? "/onboarding" : "/disclaimer");
}

type EmailState = "collapsed" | "input" | "sent";

function AuthScreen() {
  const [loading, setLoading] = useState<"google" | "apple" | null>(null);
  const [checking, setChecking] = useState(true);
  const [emailState, setEmailState] = useState<EmailState>("collapsed");
  const [email, setEmail] = useState("");
  const [sentTo, setSentTo] = useState("");
  const [sending, setSending] = useState(false);
  const redirectingRef = useRef(false);

  const sendMagicLink = async () => {
    const trimmed = email.trim();
    if (!trimmed) return;
    setSending(true);
    const { error } = await supabase.auth.signInWithOtp({
      email: trimmed,
      options: { emailRedirectTo: window.location.origin },
    });
    setSending(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    setSentTo(trimmed);
    setEmail("");
    setEmailState("sent");
  };

  useEffect(() => {
    let mounted = true;
    const handleUser = (userId: string) => {
      if (redirectingRef.current) return;
      redirectingRef.current = true;
      routeAfterAuth(userId);
    };
    supabase.auth.getUser().then(({ data }) => {
      if (!mounted) return;
      if (data.user) handleUser(data.user.id);
      else setChecking(false);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === "SIGNED_IN" && session?.user) handleUser(session.user.id);
    });
    return () => { mounted = false; sub.subscription.unsubscribe(); };
  }, []);

  const signIn = async (provider: "google" | "apple") => {
    setLoading(provider);
    const next = safeNextParam();
    const redirectUri = next
      ? `${window.location.origin}/?next=${encodeURIComponent(next)}`
      : window.location.origin;
    const result = await lovable.auth.signInWithOAuth(provider, { redirect_uri: redirectUri });
    if (result.error) {
      toast.error(`Sign-in failed: ${result.error.message ?? "Unknown error"}`);
      setLoading(null);
      return;
    }
    if (result.redirected) return;
  };

  return (
    <div className="min-h-screen flex flex-col items-center px-6 animate-fade-up" style={{ paddingTop: "max(env(safe-area-inset-top, 0px), 48px)", paddingBottom: "max(env(safe-area-inset-bottom, 0px), 24px)" }}>
      <div className="flex-1 flex flex-col items-center justify-center w-full max-w-[380px]">
        {/* Wordmark */}
        <div className="flex flex-col items-center">
          <h1 className="text-display text-text-primary" style={{ marginLeft: "0.5em" /* optical center from tracking */ }}>APEX</h1>
          <p className="mt-2 text-label text-text-tertiary">Adaptive performance coach</p>
        </div>

        {/* Ring */}
        <div className="mt-10">
          <DemoRing />
        </div>

        {/* Tagline */}
        <p className="mt-10 text-center text-body text-text-secondary" style={{ lineHeight: 1.7 }}>
          Your body speaks.<br />We listen.
        </p>
      </div>

      {/* Buttons */}
      <div className="w-full max-w-[380px] mt-8">
        <button
          onClick={() => signIn("google")}
          disabled={loading !== null || checking}
          className="w-full flex items-center justify-center gap-3 text-body font-medium disabled:opacity-60 transition-colors"
          style={{
            height: 52, borderRadius: "var(--radius-md)", background: "#FFFFFF", color: "#0A0B12",
            boxShadow: "var(--shadow-inset-top)",
          }}
        >
          <GoogleIcon />
          {loading === "google" ? "Connecting…" : "Continue with Google"}
        </button>

        <button
          onClick={() => signIn("apple")}
          disabled={loading !== null || checking}
          className="mt-3 w-full flex items-center justify-center gap-3 text-body font-medium disabled:opacity-60 transition-colors"
          style={{
            height: 52, borderRadius: "var(--radius-md)",
            background: "var(--bg-2)", color: "var(--text-primary)",
            border: "1px solid var(--border-subtle)",
            boxShadow: "var(--shadow-inset-top)",
          }}
        >
          <AppleIcon />
          {loading === "apple" ? "Connecting…" : "Continue with Apple"}
        </button>

        {emailState === "collapsed" && (
          <button
            onClick={() => setEmailState("input")}
            disabled={loading !== null || checking}
            className="mt-4 w-full text-center text-body-sm text-text-tertiary hover:text-text-secondary transition-colors disabled:opacity-60"
            style={{ transitionDuration: "var(--dur-fast)" }}
          >
            Continue with email
          </button>
        )}

        {emailState === "input" && (
          <div className="mt-4 space-y-2" style={{ animation: "fade-up var(--dur-med) var(--ease-decel) both" }}>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              aria-label="Email address"
              autoComplete="email"
              inputMode="email"
              disabled={sending}
              className="w-full text-body focus:outline-none placeholder:text-text-tertiary"
              style={{
                height: 48, borderRadius: "var(--radius-md)",
                background: "var(--bg-2)", border: "1px solid var(--border-subtle)",
                color: "var(--text-primary)", padding: "0 16px",
              }}
            />
            <button
              onClick={sendMagicLink}
              disabled={sending || !email.trim()}
              className="w-full text-body font-medium disabled:opacity-40 transition-colors"
              style={{
                height: 48, borderRadius: "var(--radius-md)",
                background: "var(--brand-500)", color: "#0A0B12",
              }}
            >
              {sending ? "Sending…" : "Send sign-in link"}
            </button>
          </div>
        )}

        {emailState === "sent" && (
          <div className="mt-4">
            <p className="text-body text-text-secondary">
              Check your inbox. We sent a sign-in link to {sentTo}. It's valid for 1 hour.
            </p>
            <button
              onClick={() => { setEmailState("input"); setSentTo(""); }}
              className="mt-3 text-body-sm text-text-tertiary hover:text-text-secondary underline underline-offset-2"
            >
              Send another link
            </button>
          </div>
        )}

        <p className="mt-8 text-center text-body-sm text-text-quaternary">
          By continuing you agree to our{" "}
          <Link to="/terms" className="underline underline-offset-2 text-text-tertiary">Terms</Link>
          {" "}and{" "}
          <Link to="/privacy" className="underline underline-offset-2 text-text-tertiary">Privacy Policy</Link>.
        </p>
      </div>
    </div>
  );
}

/**
 * DemoRing — 200px ring; arc animates 0 → 74 once on mount, then breathes.
 * Color driven by ringGradient/ringGlow — 74 lands in the green band.
 */
function DemoRing() {
  const size = 200;
  const stroke = 4;
  const r = size / 2 - stroke / 2;
  const c = 2 * Math.PI * r;
  const target = 74;

  const [progress, setProgress] = useState(0);

  useEffect(() => {
    let raf: number | null = null;
    const start = performance.now();
    const dur = 1600;
    // ease-out cubic-bezier(0.16, 1, 0.3, 1) approximation
    const easeOut = (t: number) => 1 - Math.pow(1 - t, 3);
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / dur);
      setProgress(easeOut(t) * target);
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => { if (raf) cancelAnimationFrame(raf); };
  }, []);

  const arcFrac = progress / 100;
  const dash = c * arcFrac;

  // endpoint dot position on the arc (arc starts at top, -90°, sweeps clockwise)
  const angleDeg = -90 + arcFrac * 360;
  const angleRad = (angleDeg * Math.PI) / 180;
  const cx = size / 2 + r * Math.cos(angleRad);
  const cy = size / 2 + r * Math.sin(angleRad);

  const [stopA, stopB] = ringStops(target);
  const solid = ringSolid(target);
  const glow = ringGlow(target);

  return (
    <div className="relative" style={{ width: size, height: size }} aria-hidden>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ filter: glow }}>
        <defs>
          <linearGradient id="apexRingGrad" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor={stopA} />
            <stop offset="100%" stopColor={stopB} />
          </linearGradient>
        </defs>
        <circle
          cx={size / 2} cy={size / 2} r={r}
          fill="none" stroke="var(--border-hairline)" strokeWidth={stroke}
        />
        <circle
          cx={size / 2} cy={size / 2} r={r}
          fill="none" stroke="url(#apexRingGrad)" strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={`${dash} ${c}`}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
          style={{ animation: progress >= target ? "ring-breathe 4s ease-in-out infinite" : undefined }}
        />
        <circle
          cx={cx} cy={cy} r={3}
          fill={solid}
          style={{ animation: "apex-pulse 2.4s ease-in-out infinite" }}
        />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
        <span className="text-numeric-lg text-text-primary">{Math.round(progress)}</span>
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
