import { useState } from "react";
import { Link, useLocation, useNavigate } from "@tanstack/react-router";
import { Home, Apple, Dumbbell, MessageCircle, Plus } from "lucide-react";
import { QuickActionSheet, type QuickAction } from "@/components/QuickActionSheet";
import {
  RecoveryLogModal,
  MealLogModal,
  BodyMeasurementModal,
  WeightOnlyModal,
  CardioLogModal,
} from "@/components/LogModals";
import { supabase } from "@/integrations/supabase/client";
import { T } from "./tokens";

type Props = { onLogged?: () => void };

const TABS = [
  { to: "/dashboard", icon: Home, label: "Home" },
  { to: "/nutrition", icon: Apple, label: "Fuel" },
] as const;

const TABS_RIGHT = [
  { to: "/workouts", icon: Dumbbell, label: "Train" },
  { to: "/coach", icon: MessageCircle, label: "Coach" },
] as const;

async function recalcMacros() {
  try {
    const { data: u } = await supabase.auth.getUser();
    if (!u.user) return;
    await supabase.functions.invoke("calculate-macros", { body: { user_id: u.user.id } });
  } catch (e) {
    console.error("[DashboardNav] calculate-macros invoke failed", e);
  }
}

export function DashboardNav({ onLogged }: Props) {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const [sheetOpen, setSheetOpen] = useState(false);
  const [mealOpen, setMealOpen] = useState(false);
  const [recoveryOpen, setRecoveryOpen] = useState(false);
  const [bodyOpen, setBodyOpen] = useState(false);
  const [weightOpen, setWeightOpen] = useState(false);
  const [cardioOpen, setCardioOpen] = useState(false);

  const isActive = (to: string) => pathname === to || pathname.startsWith(to + "/");

  const handlePick = (a: QuickAction) => {
    if (a === "meal") setMealOpen(true);
    else if (a === "recovery") setRecoveryOpen(true);
    else if (a === "body") setBodyOpen(true);
    else if (a === "weight") setWeightOpen(true);
    else if (a === "cardio") setCardioOpen(true);
  };

  const renderTab = (t: { to: string; icon: typeof Home; label: string }) => {
    const active = isActive(t.to);
    const Icon = t.icon;
    return (
      <Link
        key={t.to}
        to={t.to}
        aria-label={t.label}
        className="flex-1 flex flex-col items-center justify-center gap-1 py-2 min-h-[56px] relative"
        style={{ color: active ? T.primary : "#22243A" }}
      >
        <Icon size={22} strokeWidth={active ? 2.2 : 1.8} />
        {active && (
          <span
            style={{
              position: "absolute",
              bottom: 6,
              width: 4,
              height: 4,
              borderRadius: "50%",
              background: T.primary,
            }}
          />
        )}
      </Link>
    );
  };

  return (
    <>
      <nav
        className="fixed left-0 right-0 bottom-0 z-50"
        style={{
          background: T.bg,
          borderTop: `0.5px solid ${T.border}`,
          paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 6px)",
          paddingTop: 6,
        }}
        aria-label="Primary"
      >
        <div className="mx-auto max-w-[480px] flex items-stretch">
          {TABS.map(renderTab)}
          <div className="flex-1 flex items-start justify-center">
            <button
              type="button"
              onClick={() => setSheetOpen(true)}
              aria-label="Log"
              aria-haspopup="dialog"
              style={{
                width: 42,
                height: 42,
                borderRadius: "50%",
                background: T.primary,
                color: "#FFFFFF",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                marginTop: -14,
                border: "none",
                boxShadow: "0 6px 18px rgba(123,110,246,0.45)",
                cursor: "pointer",
              }}
            >
              <Plus size={22} strokeWidth={2.4} />
            </button>
          </div>
          {TABS_RIGHT.map(renderTab)}
        </div>
      </nav>

      <QuickActionSheet open={sheetOpen} onClose={() => setSheetOpen(false)} onPick={handlePick} />
      <MealLogModal
        open={mealOpen}
        onClose={() => setMealOpen(false)}
        onSaved={() => {
          onLogged?.();
          navigate({ to: "/nutrition" });
        }}
      />
      <RecoveryLogModal
        open={recoveryOpen}
        onClose={() => setRecoveryOpen(false)}
        onSaved={() => onLogged?.()}
      />
      <BodyMeasurementModal
        open={bodyOpen}
        onClose={() => setBodyOpen(false)}
        onSaved={() => recalcMacros().finally(() => onLogged?.())}
      />
      <WeightOnlyModal
        open={weightOpen}
        onClose={() => setWeightOpen(false)}
        onSaved={() => recalcMacros().finally(() => onLogged?.())}
      />
      <CardioLogModal
        open={cardioOpen}
        onClose={() => setCardioOpen(false)}
        onSaved={() => onLogged?.()}
      />
    </>
  );
}
