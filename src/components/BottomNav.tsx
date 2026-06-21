import { useState } from "react";
import { Link, useLocation, useNavigate } from "@tanstack/react-router";
import { Home, Dumbbell, Apple, Plus } from "lucide-react";
import { FloatingCoach } from "@/components/FloatingCoach";
import { QuickActionSheet } from "@/components/QuickActionSheet";
import { RecoveryLogModal, MealLogModal } from "@/components/LogModals";

/**
 * Bottom nav: 3 flat tabs (Home / Train / Eat) + center quick-action launcher.
 * The center button now opens an action sheet with Meal + Recovery options
 * (Prompt B addendum) instead of being hardwired to a single action.
 * Coach lives on its own as the FloatingCoach so the AI surface reads
 * separately from navigation.
 */
type Props = {
  /** When provided, overrides the built-in launcher (e.g. dashboard wants
   *  to fire its own meal-modal that piggybacks score-update toasts). */
  onCenter?: () => void;
  /** Fires after any modal logs successfully — parent reload hook. */
  onLogged?: () => void;
};

const TABS = [
  { to: "/dashboard", icon: Home, label: "Home" },
  { to: "/workouts", icon: Dumbbell, label: "Train" },
  { to: "/nutrition", icon: Apple, label: "Eat" },
] as const;

export function BottomNav({ onCenter, onLogged }: Props = {}) {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const [sheetOpen, setSheetOpen] = useState(false);
  const [mealOpen, setMealOpen] = useState(false);
  const [recoveryOpen, setRecoveryOpen] = useState(false);
  const isActive = (to: string) => pathname === to || pathname.startsWith(to + "/");

  const onNutritionTab = pathname === "/nutrition" || pathname.startsWith("/nutrition/");

  const handleCenter = () => {
    if (onCenter) return onCenter();
    // On the Nutrition tab, the center + is unambiguously "log a meal" so we
    // skip the action-sheet detour (recovery already has its own surfaces).
    if (onNutritionTab) { setMealOpen(true); return; }
    setSheetOpen(true);
  };

  const handlePick = (a: "meal" | "recovery") => {
    if (a === "meal") setMealOpen(true);
    else setRecoveryOpen(true);
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
    <>
      <nav
        className="fixed left-1/2 -translate-x-1/2 z-50"
        style={{ bottom: "calc(env(safe-area-inset-bottom, 0px) + 16px)" }}
      >
        <div className="flex items-center gap-1 rounded-full border border-white/10 bg-bg-2/85 backdrop-blur-xl px-2 py-2 card-shadow">
          {renderTab(TABS[0])}
          {renderTab(TABS[1])}
          {renderTab(TABS[2])}
          <button
            type="button"
            onClick={handleCenter}
            aria-label="Quick log"
            className="ml-1 flex h-12 w-12 items-center justify-center rounded-full gradient-brand ai-glow text-white active:scale-95 transition"
          >
            <Plus size={24} />
          </button>
        </div>
      </nav>
      <FloatingCoach />

      <QuickActionSheet open={sheetOpen} onClose={() => setSheetOpen(false)} onPick={handlePick} />
      <MealLogModal
        open={mealOpen}
        onClose={() => setMealOpen(false)}
        onSaved={() => { onLogged?.(); navigate({ to: "/nutrition" }); }}
      />
      <RecoveryLogModal
        open={recoveryOpen}
        onClose={() => setRecoveryOpen(false)}
        onSaved={() => { onLogged?.(); }}
      />
    </>
  );
}
