import { useState } from "react";
import { Link, useLocation, useNavigate } from "@tanstack/react-router";
import { Home, Dumbbell, Apple, Plus } from "lucide-react";
import { FloatingCoach } from "@/components/FloatingCoach";
import { QuickActionSheet, type QuickAction } from "@/components/QuickActionSheet";
import { RecoveryLogModal, MealLogModal, BodyMeasurementModal } from "@/components/LogModals";

/**
 * Bottom nav — four flat tabs full-width: Home / Train / Fuel / Log.
 * Tapping "Log" opens the three-way quick-action sheet (Recovery / Meal /
 * Body). There is no separate floating "+" launcher and no brand-mark
 * segment in the nav — the floating Coach button (FloatingCoach) is the
 * single floating control and the single A-mark on screen.
 */
type Props = {
  onLogged?: () => void;
};

const TABS = [
  { to: "/dashboard", icon: Home,     label: "Home" },
  { to: "/workouts",  icon: Dumbbell, label: "Train" },
  { to: "/nutrition", icon: Apple,    label: "Fuel" },
] as const;

export function BottomNav({ onLogged }: Props = {}) {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const [sheetOpen, setSheetOpen] = useState(false);
  const [mealOpen, setMealOpen] = useState(false);
  const [recoveryOpen, setRecoveryOpen] = useState(false);
  const [bodyOpen, setBodyOpen] = useState(false);
  const isActive = (to: string) => pathname === to || pathname.startsWith(to + "/");
  const logActive = sheetOpen;

  const handlePick = (a: QuickAction) => {
    if (a === "meal") setMealOpen(true);
    else if (a === "recovery") setRecoveryOpen(true);
    else if (a === "body") setBodyOpen(true);
  };

  return (
    <>
      <nav
        className="fixed left-0 right-0 bottom-0 z-50 bg-bg-2/95 backdrop-blur-xl"
        style={{
          paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 6px)",
          paddingTop: 6,
          borderTop: "1px solid rgba(255,255,255,0.06)",
        }}
        aria-label="Primary"
      >
        <div className="mx-auto max-w-[640px] flex items-stretch">
          {TABS.map((t) => {
            const active = isActive(t.to);
            const Icon = t.icon;
            return (
              <Link
                key={t.to}
                to={t.to}
                aria-label={t.label}
                className="flex-1 flex flex-col items-center justify-center gap-1 py-2 min-h-[56px] transition"
                style={{ color: active ? "var(--color-text-accent, #A78BFA)" : "rgba(255,255,255,0.42)" }}
              >
                <Icon size={22} strokeWidth={active ? 2.4 : 1.8} />
                <span className="text-[10px] font-medium tracking-wide leading-none">
                  {t.label}
                </span>
              </Link>
            );
          })}
          <button
            type="button"
            onClick={() => setSheetOpen(true)}
            aria-label="Log"
            aria-haspopup="dialog"
            aria-expanded={sheetOpen}
            className="flex-1 flex flex-col items-center justify-center gap-1 py-2 min-h-[56px] transition"
            style={{ color: logActive ? "var(--color-text-accent, #A78BFA)" : "rgba(255,255,255,0.42)" }}
          >
            <Plus size={22} strokeWidth={logActive ? 2.4 : 1.8} />
            <span className="text-[10px] font-medium tracking-wide leading-none">Log</span>
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
      <BodyMeasurementModal
        open={bodyOpen}
        onClose={() => setBodyOpen(false)}
        onSaved={() => { onLogged?.(); }}
      />
    </>
  );
}
