import { ShieldCheck, Trophy } from "lucide-react";
import { T } from "./tokens";
import type { StreakState } from "@/lib/dashboard-state";

export function StreakNotification({
  streak,
  ghostDays,
}: {
  streak: StreakState;
  ghostDays: number;
}) {
  if (streak.kind === "resting") {
    return (
      <Box bg="#1A1200" border="#3A2A00">
        <p style={{ fontSize: 12, color: T.text1, lineHeight: 1.5 }}>
          Streak resting (day 2 of 2) — log one thing today to keep it.
        </p>
      </Box>
    );
  }
  if (streak.kind === "protected") {
    return (
      <Box bg="#071E14" border="#0A2A1C">
        <div className="flex items-center gap-2">
          <ShieldCheck size={14} color={T.green} />
          <p style={{ fontSize: 12, color: T.text1 }}>
            Rest day · streak protected
          </p>
        </div>
      </Box>
    );
  }
  if (streak.kind === "milestone" && streak.days === 7) {
    return (
      <Box bg="#0E0A28" border={T.primary}>
        <div className="flex items-center gap-2">
          <Trophy size={14} color={T.primary} />
          <p style={{ fontSize: 12, color: T.text1 }}>
            7-day streak — this is where habits form.
          </p>
        </div>
      </Box>
    );
  }
  if (streak.kind === "reset" && ghostDays >= 3) {
    return (
      <Box bg={T.surface} border={T.border}>
        <p style={{ fontSize: 12, color: T.text1 }}>
          Welcome back — your data is still here. Start fresh.
        </p>
      </Box>
    );
  }
  return null;
}

function Box({
  children,
  bg,
  border,
}: {
  children: React.ReactNode;
  bg: string;
  border: string;
}) {
  return (
    <div
      style={{
        background: bg,
        border: `0.5px solid ${border}`,
        borderRadius: 10,
        padding: "10px 12px",
      }}
    >
      {children}
    </div>
  );
}
