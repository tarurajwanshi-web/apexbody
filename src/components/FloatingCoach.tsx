import { Link } from "@tanstack/react-router";
import { Sparkles } from "lucide-react";

/**
 * Floating circular Coach launcher, sits bottom-right above the BottomNav.
 * Distinct AI-glow + sparkle so it never reads as a nav tab.
 */
export function FloatingCoach() {
  return (
    <Link
      to="/coach"
      aria-label="Open APEX Coach"
      className="fixed z-50 h-14 w-14 rounded-full flex items-center justify-center text-white active:scale-95 transition"
      style={{
        right: "calc(env(safe-area-inset-right, 0px) + 16px)",
        bottom: "calc(env(safe-area-inset-bottom, 0px) + 88px)",
        background:
          "radial-gradient(circle at 30% 30%, rgba(167,139,250,0.95), rgba(124,58,237,0.95) 55%, rgba(59,130,246,0.95))",
        border: "1px solid rgba(255,255,255,0.18)",
        boxShadow:
          "0 0 0 1px rgba(124,58,237,0.35), 0 0 24px rgba(124,58,237,0.45), 0 8px 24px rgba(0,0,0,0.5)",
      }}
    >
      <Sparkles size={22} />
    </Link>
  );
}
