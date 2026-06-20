import { Link, useLocation } from "@tanstack/react-router";
import { Home, Dumbbell, Apple, Brain, Sparkles } from "lucide-react";

const items = [
  { to: "/dashboard", icon: Home, label: "Home" },
  { to: "/workouts", icon: Dumbbell, label: "Train" },
  { to: "/nutrition", icon: Apple, label: "Eat" },
  { to: "/coach", icon: Brain, label: "Coach" },
] as const;

export function BottomNav() {
  const { pathname } = useLocation();
  return (
    <nav className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50">
      <div className="flex items-center gap-1 rounded-full border border-white/10 bg-bg-2/85 backdrop-blur-xl px-2 py-2 card-shadow">
        {items.slice(0, 2).map((it) => {
          const active = pathname.startsWith(it.to);
          const Icon = it.icon;
          return (
            <Link key={it.to} to={it.to} className={`flex h-11 w-11 items-center justify-center rounded-full transition ${active ? "text-text-accent bg-white/5" : "text-text-secondary"}`}>
              <Icon size={20} strokeWidth={active ? 2.5 : 2} />
            </Link>
          );
        })}
        <Link
          to="/coach"
          className="mx-1 flex h-12 w-12 items-center justify-center rounded-full gradient-brand ai-glow text-white"
          aria-label="AI Coach"
        >
          <Sparkles size={22} />
        </Link>
        {items.slice(2).map((it) => {
          const active = pathname.startsWith(it.to);
          const Icon = it.icon;
          return (
            <Link key={it.to} to={it.to} className={`flex h-11 w-11 items-center justify-center rounded-full transition ${active ? "text-text-accent bg-white/5" : "text-text-secondary"}`}>
              <Icon size={20} strokeWidth={active ? 2.5 : 2} />
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
