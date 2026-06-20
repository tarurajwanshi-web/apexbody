import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Sparkles, Check } from "lucide-react";
import { useProfile } from "@/lib/store";

export const Route = createFileRoute("/meet-coach")({
  component: MeetCoach,
});

function MeetCoach() {
  const navigate = useNavigate();
  const { profile } = useProfile();
  const name = profile.name?.trim() || "there";

  const messages = [
    `Hi ${name}. I'm APEX - your adaptive coach.`,
    "I've set up a starting plan for you. Follow it for 7 days while I study your training, nutrition, and recovery patterns.",
    "By Day 8, I'll know your weak points, your strengths, and exactly how to build YOUR program. Not a template. Yours.",
  ];

  const unlocks = [
    "Body composition assessment from your photos",
    "Strength profile from your training",
    "Custom program built for YOUR weak points",
  ];

  return (
    <div className="min-h-screen w-full flex flex-col px-6 py-10" style={{ backgroundColor: "#06080F" }}>
      <div className="flex flex-col items-center text-center mt-6">
        <div
          className="flex items-center justify-center rounded-full"
          style={{
            width: 120,
            height: 120,
            backgroundImage: "linear-gradient(135deg, #7C3AED 0%, #3B82F6 100%)",
            boxShadow: "0 0 60px rgba(124, 58, 237, 0.45)",
            animation: "coach-breathe 3s ease-in-out infinite",
          }}
        >
          <Sparkles size={32} color="#ffffff" strokeWidth={2.5} />
        </div>
        <h1 className="mt-6 font-semibold text-white" style={{ fontSize: 28 }}>
          Meet APEX Coach
        </h1>
        <p className="mt-2" style={{ fontSize: 14, color: "#8892A4" }}>
          Your adaptive AI performance system
        </p>
      </div>

      {/* Messages */}
      <div className="mt-10" style={{ backgroundColor: "#0F1524", borderRadius: 24, padding: 24, border: "1px solid rgba(255,255,255,0.06)" }}>
        <div className="space-y-3">
          {messages.map((m, i) => (
            <div
              key={i}
              className="animate-fade-up flex gap-3 items-start"
              style={{
                animationDelay: `${i * 150}ms`,
                backgroundColor: "rgba(124, 58, 237, 0.12)",
                border: "1px solid rgba(124, 58, 237, 0.25)",
                borderRadius: 16,
                padding: "12px 14px",
              }}
            >
              <Sparkles size={16} className="shrink-0 mt-0.5" style={{ color: "#A78BFA" }} />
              <p style={{ fontSize: 15, color: "#F0F4FF", lineHeight: 1.55 }}>{m}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Unlock card */}
      <div
        className="mt-4 animate-fade-up"
        style={{
          animationDelay: "500ms",
          backgroundColor: "#0F1524",
          border: "1px solid rgba(255,255,255,0.06)",
          borderRadius: 16,
          padding: 18,
        }}
      >
        <p className="text-[12px] font-medium uppercase" style={{ color: "#8892A4", letterSpacing: "1.5px" }}>
          After 5 days of data, you unlock:
        </p>
        <div className="mt-3 space-y-2.5">
          {unlocks.map((u) => (
            <div key={u} className="flex items-center gap-3 opacity-60">
              <div
                className="flex items-center justify-center rounded-full shrink-0"
                style={{ width: 22, height: 22, backgroundColor: "rgba(124,58,237,0.15)", border: "1px solid rgba(124,58,237,0.25)" }}
              >
                <Check size={12} style={{ color: "#A78BFA" }} strokeWidth={3} />
              </div>
              <span className="text-[13px]" style={{ color: "#F0F4FF" }}>{u}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="flex-1" />

      <div className="mt-10">
        <button
          onClick={() => navigate({ to: "/dashboard" })}
          className="w-full font-semibold text-white active:scale-[0.98] transition"
          style={{
            height: 56,
            borderRadius: 14,
            backgroundImage: "linear-gradient(90deg, #7C3AED 0%, #3B82F6 100%)",
            fontSize: 16,
          }}
        >
          Let's Begin →
        </button>
        <p className="mt-3 text-center" style={{ fontSize: 12, color: "#8892A4" }}>
          This plan adapts as I learn about you
        </p>
      </div>

      <style>{`@keyframes coach-breathe { 0%,100% { transform: scale(0.97); } 50% { transform: scale(1.03); } }`}</style>
    </div>
  );
}
