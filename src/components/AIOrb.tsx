import { Sparkles } from "lucide-react";
import type { ReactNode } from "react";

export function AIOrb({ size = 56, className = "" }: { size?: number; className?: string }) {
  return (
    <div
      className={`relative inline-flex items-center justify-center rounded-full gradient-brand ai-glow animate-breathe ${className}`}
      style={{ width: size, height: size }}
    >
      <div className="absolute inset-0 rounded-full bg-gradient-to-br from-white/20 to-transparent" />
      <Sparkles size={size * 0.42} className="text-white relative" />
    </div>
  );
}

export function AICard({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <div className={`rounded-2xl bg-gradient-to-br from-ai/[0.08] to-sleep/[0.05] border border-ai/20 p-4 ${className}`}>
      <div className="flex gap-3">
        <Sparkles size={18} className="text-ai mt-0.5 shrink-0" />
        <div className="text-sm text-text-primary leading-relaxed flex-1">{children}</div>
      </div>
    </div>
  );
}

export function AIBadge() {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-ai/15 px-2 py-0.5 text-[10px] font-semibold tracking-wider text-text-accent uppercase">
      <Sparkles size={10} /> AI
    </span>
  );
}
