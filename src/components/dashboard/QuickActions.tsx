import { Camera, HeartPulse, Dumbbell, Scale } from "lucide-react";
import { T } from "./tokens";

type Action = {
  label: string;
  icon: React.ReactNode;
  onClick: () => void;
};

export function QuickActions({
  onMeal,
  onRecovery,
  onSets,
  onWeigh,
}: {
  onMeal: () => void;
  onRecovery: () => void;
  onSets: () => void;
  onWeigh: () => void;
}) {
  const actions: Action[] = [
    { label: "Log meal", icon: <Camera size={18} color={T.primary} />, onClick: onMeal },
    { label: "Recovery", icon: <HeartPulse size={18} color={T.primary} />, onClick: onRecovery },
    { label: "Log sets", icon: <Dumbbell size={18} color={T.primary} />, onClick: onSets },
    { label: "Weigh in", icon: <Scale size={18} color={T.primary} />, onClick: onWeigh },
  ];
  return (
    <div
      style={{
        background: T.surface,
        border: `0.5px solid ${T.border}`,
        borderRadius: 12,
        padding: "12px 8px",
        display: "grid",
        gridTemplateColumns: "repeat(4, 1fr)",
        gap: 4,
      }}
    >
      {actions.map((a) => (
        <button
          key={a.label}
          onClick={a.onClick}
          className="flex flex-col items-center gap-1 active:scale-[0.97] transition"
          style={{ padding: "4px 2px" }}
        >
          {a.icon}
          <span style={{ fontSize: 10, color: T.text2 }}>{a.label}</span>
        </button>
      ))}
    </div>
  );
}
