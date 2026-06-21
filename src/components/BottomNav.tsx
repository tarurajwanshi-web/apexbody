import { useState } from "react";
import { Link, useLocation, useNavigate } from "@tanstack/react-router";
import { Home, Dumbbell, Apple, MoreHorizontal, Plus } from "lucide-react";
import { FloatingCoach } from "@/components/FloatingCoach";
import { QuickActionSheet, type QuickAction } from "@/components/QuickActionSheet";
import { RecoveryLogModal, MealLogModal, BodyMeasurementModal } from "@/components/LogModals";

/**
 * WHOOP-style bottom nav. Four flat tabs (Home / Train / Fuel / More)
 * occupy the left ~2/3 of the bar; a visually distinct, non-tappable A-mark
 * sits in the right ~1/3 separated by a vertical divider. Active tab uses
 * the APEX brand accent color, inactive sits in muted grey — no pill or
 * box behind the active icon. A separate floating "+" launcher above the
 * nav opens the three-way quick-log sheet (Recovery / Meal / Body).
 */
type Props = {
  onCenter?: () => void;
  onLogged?: () => void;
};

const TABS = [
  { to: "/dashboard", icon: Home,            label: "Home" },
  { to: "/workouts",  icon: Dumbbell,        label: "Train" },
  { to: "/nutrition", icon: Apple,           label: "Fuel" },
  { to: "/settings",  icon: MoreHorizontal,  label: "More" },
] as const;

export function BottomNav({ onCenter, onLogged }: Props = {}) {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const [sheetOpen, setSheetOpen] = useState(false);
  const [mealOpen, setMealOpen] = useState(false);
  const [recoveryOpen, setRecoveryOpen] = useState(false);
  const [bodyOpen, setBodyOpen] = useState(false);
  const isActive = (to: string) => pathname === to || pathname.startsWith(to + "/");

  const onNutritionTab = pathname === "/nutrition" || pathname.startsWith("/nutrition/");

  const handleCenter = () => {
    if (onCenter) return onCenter();
    if (onNutritionTab) { setMealOpen(true); return; }
    setSheetOpen(true);
  };

  const handlePick = (a: QuickAction) => {
    if (a === "meal") setMealOpen(true);
    else if (a === "recovery") setRecoveryOpen(true);
    else if (a === "body") setBodyOpen(true);
  };

  return (
    <>
      {/* Floating + launcher, sits above the nav on the right */}
      <button
        type="button"
        onClick={handleCenter}
        aria-label="Quick log"
        className="fixed z-[60] h-14 w-14 rounded-full flex items-center justify-center text-white active:scale-95 transition gradient-brand ai-glow"
        style={{
          right: "calc(env(safe-area-inset-right, 0px) + 16px)",
          bottom: "calc(env(safe-area-inset-bottom, 0px) + 84px)",
        }}
      >
        <Plus size={26} />
      </button>

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
          {/* Left 2/3 — four tabs */}
          <div className="flex flex-[2] items-stretch">
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
          </div>

          {/* Divider */}
          <div className="w-px self-stretch my-1.5" style={{ background: "rgba(255,255,255,0.10)" }} />

          {/* Right 1/3 — non-tappable A brand-mark */}
          <div
            className="flex flex-[1] items-center justify-center py-2 min-h-[56px]"
            aria-hidden="true"
          >
            <BrandAMark />
          </div>
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

/** Dash-styled "A" mark matching the SSO/login screen treatment. */
function BrandAMark() {
  return (
    <span className="inline-flex items-center">
      <span
        className="text-[20px] font-black tracking-tight leading-none"
        style={{
          background: "linear-gradient(180deg, #ffffff 0%, #cbd5e1 100%)",
          WebkitBackgroundClip: "text",
          WebkitTextFillColor: "transparent",
          backgroundClip: "text",
          letterSpacing: "0.05em",
        }}
      >
        A
      </span>
      <span
        aria-hidden
        className="ml-1 h-[2px] w-3 rounded-full"
        style={{ background: "linear-gradient(90deg, rgba(167,139,250,0.9), rgba(59,130,246,0.0))" }}
      />
    </span>
  );
}
