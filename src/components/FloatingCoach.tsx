import { Link } from "@tanstack/react-router";

/**
 * Floating circular Coach launcher, sits above the BottomNav.
 *
 * Brand-mark icon: a glossy gradient ring (matching the APEX app icon) with
 * a centered "A" wordmark fragment — ties the in-app assistant visually to
 * the app's identity instead of using a generic sparkle.
 *
 * Position: bottom-LEFT, well clear of the "+" button (which now lives at
 * the right end of the widened bottom nav). Lifted above the nav with a
 * comfortable gap so the two controls read as distinct UI elements.
 */
export function FloatingCoach() {
  return (
    <Link
      to="/coach"
      aria-label="Open APEX Intelligence"
      className="fixed z-[60] h-14 w-14 rounded-full flex items-center justify-center text-white active:scale-95 transition"
      style={{
        right: "calc(env(safe-area-inset-right, 0px) + 16px)",
        bottom: "calc(env(safe-area-inset-bottom, 0px) + 84px)",
        background:
          "radial-gradient(circle at 30% 28%, rgba(167,139,250,0.98), rgba(124,58,237,0.95) 50%, rgba(59,130,246,0.95) 85%)",
        border: "1px solid rgba(255,255,255,0.22)",
        boxShadow:
          "inset 0 1px 0 rgba(255,255,255,0.35), 0 0 0 1px rgba(124,58,237,0.35), 0 0 24px rgba(124,58,237,0.45), 0 8px 24px rgba(0,0,0,0.55)",
      }}
    >

      {/* Inner darker disc creates the "ring" silhouette of the app icon */}
      <span
        className="absolute inset-[5px] rounded-full flex items-center justify-center"
        style={{
          background:
            "radial-gradient(circle at 50% 60%, rgba(15,23,42,0.85), rgba(10,14,26,0.95))",
          boxShadow: "inset 0 0 8px rgba(124,58,237,0.35)",
        }}
      >
        <span
          className="text-[20px] font-extrabold leading-none tracking-tight"
          style={{
            background: "linear-gradient(180deg, #ffffff 0%, #cbd5e1 100%)",
            WebkitBackgroundClip: "text",
            WebkitTextFillColor: "transparent",
            backgroundClip: "text",
          }}
        >
          A
        </span>
      </span>
    </Link>
  );
}
