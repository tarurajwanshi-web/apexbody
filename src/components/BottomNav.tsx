import { Link, useLocation, useNavigate } from "@tanstack/react-router";
import { Home, Dumbbell, Apple, Brain, Camera } from "lucide-react";

/**
 * Single, consistent bottom nav used on every screen.
 * - Same 5 icon glyphs everywhere; active style derives from the current route.
 * - Center button is a fixed quick-action (Camera → quick log a meal). Its
 *   glyph never changes; it does not auto-highlight any tab.
 */
type Props = {
  /** Optional center action. Defaults to navigating to /nutrition. */
  onCenter?: () => void;
};

const TABS = [
  { to: "/dashboard", icon: Home, label: "Home" },
  { to: "/workouts", icon: Dumbbell, label: "Train" },
  { to: "/nutrition", icon: Apple, label: "Eat" },
  { to: "/coach", icon: Brain, label: "Coach" },
] as const;

export function BottomNav({ onCenter }: Props = {}) {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const isActive = (to: string) => pathname === to || pathname.startsWith(to + "/");

  const handleCenter = () => {
    if (onCenter) return onCenter();
    navigate({ to: "/nutrition" });
  };

  const renderTab = (t: (typeof TABS)[number]) => {
    const active = isActive(t.to);
    const Icon = t.icon;
    return (
      <Link
        key={t.to}
        to={t.to}
        aria-label={t.label}
        className={`flex h-11 w-11 items-center justify-center rounded-full transition ${
          active ? "text-text-accent bg-white/5" : "text-text-secondary"
        }`}
      >
        <Icon size={20} strokeWidth={active ? 2.5 : 2} />
      </Link>
    );
  };

  return (
    <nav
      className="fixed left-1/2 -translate-x-1/2 z-50"
      style={{ bottom: "calc(env(safe-area-inset-bottom, 0px) + 16px)" }}
    >
      <div className="flex items-center gap-1 rounded-full border border-white/10 bg-bg-2/85 backdrop-blur-xl px-2 py-2 card-shadow">
        {TABS.slice(0, 2).map(renderTab)}
        <button
          type="button"
          onClick={handleCenter}
          aria-label="Quick log a meal"
          className="mx-1 flex h-12 w-12 items-center justify-center rounded-full gradient-brand ai-glow text-white active:scale-95 transition"
        >
          <Camera size={22} />
        </button>
        {TABS.slice(2).map(renderTab)}
      </div>
    </nav>
  );
}
