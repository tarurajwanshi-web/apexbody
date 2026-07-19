import { Activity, Camera, Heart, Ruler, Scale } from "lucide-react";

export type QuickAction = "meal" | "recovery" | "body" | "weight" | "cardio";
type Props = {
  open: boolean;
  onClose: () => void;
  onPick: (action: QuickAction) => void;
};

/**
 * Center-nav quick-action launcher. Direct-access logging shortcuts.
 */
export function QuickActionSheet({ open, onClose, onPick }: Props) {
  if (!open) return null;
  const items: Array<{ key: QuickAction; icon: typeof Camera; label: string; sub: string; tint: string }> = [
    { key: "recovery", icon: Heart,    label: "Log recovery",       sub: "How you feel, sleep, mood",                tint: "rgba(139,92,246,0.45)" },
    { key: "meal",     icon: Camera,   label: "Log a meal",         sub: "Snap a photo — itemized macros",           tint: "rgba(16,185,129,0.45)" },
    { key: "cardio",   icon: Activity, label: "Log cardio",         sub: "Minutes + intensity — feeds fatigue",      tint: "rgba(244,114,182,0.45)" },
    { key: "weight",   icon: Scale,    label: "Quick weigh-in",     sub: "Just today's weight",                      tint: "rgba(245,158,11,0.45)" },
    { key: "body",     icon: Ruler,    label: "Body measurement",   sub: "Weight, body fat, waist / hip / arms / thigh", tint: "rgba(59,130,246,0.45)" },
  ];

  return (
    <div
      className="fixed inset-0 z-[100] flex items-end justify-center"
      style={{ background: "rgba(0,0,0,0.55)" }}
      onClick={onClose}
    >
      <div
        className="w-full max-w-[480px] rounded-t-[24px] p-5 animate-fade-up"
        style={{
          background: "#0F1524",
          border: "1px solid rgba(255,255,255,0.06)",
          paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 20px)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mx-auto mb-4 h-1 w-10 rounded-full bg-white/15" />
        <h2 className="text-[16px] font-semibold text-white mb-4">Quick log</h2>
        <div className="space-y-2">
          {items.map((it) => {
            const Icon = it.icon;
            return (
              <button
                key={it.key}
                onClick={() => { onPick(it.key); onClose(); }}
                className="w-full flex items-center gap-3 rounded-2xl p-4 text-left active:scale-[0.99] transition"
                style={{ background: "#0A0E1A", border: `1px solid ${it.tint}` }}
              >
                <div
                  className="h-11 w-11 rounded-xl flex items-center justify-center shrink-0"
                  style={{ background: it.tint }}
                >
                  <Icon size={20} className="text-white" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-[14px] font-semibold text-white">{it.label}</p>
                  <p className="text-[12px] text-text-secondary mt-0.5">{it.sub}</p>
                </div>
                <span className="text-text-tertiary">›</span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
