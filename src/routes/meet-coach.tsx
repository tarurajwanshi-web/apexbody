import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Sparkles } from "lucide-react";

export const Route = createFileRoute("/meet-coach")({
  component: MeetCoach,
});

function MeetCoach() {
  const navigate = useNavigate();

  const messages = [
    "Hi. I'm your APEX Coach.",
    "I've set up a starting plan based on your profile. Follow it while I learn about you over the next 5 days.",
    "The more data you give me — workouts, meals, sleep, mood — the smarter I get. By Day 6, your plan will be completely customized to YOUR body.",
  ];

  return (
    <div className="min-h-screen w-full flex flex-col px-6 py-10" style={{ backgroundColor: "#06080F" }}>
      {/* Top */}
      <div className="flex flex-col items-center text-center mt-6">
        <div
          className="flex items-center justify-center rounded-full"
          style={{
            width: 120,
            height: 120,
            backgroundImage: "linear-gradient(135deg, #7C3AED 0%, #3B82F6 100%)",
            boxShadow: "0 0 60px rgba(124, 58, 237, 0.45)",
          }}
        >
          <Sparkles size={32} color="#ffffff" strokeWidth={2.5} />
        </div>
        <h1 className="mt-6 font-bold text-white" style={{ fontSize: 28 }}>
          Meet APEX Coach
        </h1>
        <p className="mt-2" style={{ fontSize: 14, color: "#8892A4" }}>
          Your adaptive AI performance system
        </p>
      </div>

      {/* Middle card */}
      <div
        className="mt-10"
        style={{ backgroundColor: "#0F1524", borderRadius: 24, padding: 24 }}
      >
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

        <div className="mt-6">
          <p style={{ fontSize: 12, color: "#8892A4", letterSpacing: 0.5 }}>
            Day 1 of 5 — Data collection phase
          </p>
          <div className="mt-3 flex gap-2">
            {[0, 1, 2, 3, 4].map((i) => (
              <span
                key={i}
                style={{
                  width: 10,
                  height: 10,
                  borderRadius: 999,
                  backgroundColor: i === 0 ? "#7C3AED" : "#171F33",
                  boxShadow: i === 0 ? "0 0 10px rgba(124,58,237,0.6)" : "none",
                }}
              />
            ))}
          </div>
        </div>
      </div>

      <div className="flex-1" />

      {/* Bottom */}
      <div className="mt-10">
        <button
          onClick={() => navigate({ to: "/home" })}
          className="w-full font-semibold text-white"
          style={{
            height: 56,
            borderRadius: 14,
            backgroundImage: "linear-gradient(135deg, #7C3AED 0%, #3B82F6 100%)",
            fontSize: 16,
          }}
        >
          See My Starting Plan →
        </button>
        <p className="mt-3 text-center" style={{ fontSize: 12, color: "#8892A4" }}>
          This plan adapts as I learn about you
        </p>
      </div>
    </div>
  );
}
