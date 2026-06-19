import { createFileRoute, Link } from "@tanstack/react-router";
import { useState, useRef, useEffect } from "react";
import { useServerFn } from "@tanstack/react-start";
import { ChevronLeft, Sparkles, Send, CheckCircle2 } from "lucide-react";
import { AIOrb } from "@/components/AIOrb";
import { BottomNav } from "@/components/BottomNav";
import { useProfile } from "@/lib/store";
import { todayMetrics, macroTargets, macroToday } from "@/lib/mock";
import { askCoach } from "@/lib/coach.functions";

export const Route = createFileRoute("/coach")({
  head: () => ({ meta: [{ title: "APEX Coach" }] }),
  component: Coach,
});

type Msg = { role: "user" | "assistant"; content: string };

const suggestions = [
  "Should I train hard today?",
  "How do I hit my protein?",
  "Why is my HRV down?",
  "Plan my next session",
];

function Coach() {
  const { profile } = useProfile();
  const fn = useServerFn(askCoach);
  const [messages, setMessages] = useState<Msg[]>([
    {
      role: "assistant",
      content: `Recovery ${todayMetrics.recovery}, HRV ${todayMetrics.hrv}ms, sleep ${todayMetrics.sleepHours}h. Ask me anything — training, nutrition, recovery.`,
    },
  ]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  const send = async (text: string) => {
    if (!text.trim() || loading) return;
    setError(null);
    const context = `User context — goal: ${profile.goal ?? "recomposition"}, experience: ${profile.experience ?? "intermediate"}, APEX score: ${todayMetrics.apexScore}/100, recovery: ${todayMetrics.recovery}, HRV: ${todayMetrics.hrv}ms, sleep: ${todayMetrics.sleepHours}h, protein deficit: ${macroTargets.p - macroToday.p}g.`;
    const userMsg: Msg = { role: "user", content: text };
    const next = [...messages, userMsg];
    setMessages(next);
    setInput("");
    setLoading(true);
    try {
      const r = await fn({
        data: {
          messages: [
            { role: "user", content: context },
            { role: "assistant", content: "Understood. I'll use that context." },
            ...next,
          ],
        },
      });
      setMessages((m) => [...m, { role: "assistant", content: r.content }]);
    } catch (e: any) {
      setError(e?.message ?? "Something went wrong.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-bg-1 pb-40 flex flex-col">
      <header className="flex items-center justify-between px-5 pt-6">
        <Link to="/home" className="text-text-secondary"><ChevronLeft size={24} /></Link>
        <span className="text-[11px] uppercase tracking-wider text-text-tertiary">Coach</span>
        <Link to="/settings" className="text-[11px] text-text-tertiary">Settings</Link>
      </header>

      <div className="mx-5 mt-6 flex items-center gap-3">
        <AIOrb size={48} />
        <div>
          <h1 className="text-xl font-bold">{profile.coachName} Coach</h1>
          <p className="text-[11px] text-text-secondary flex items-center gap-1">
            <CheckCircle2 size={11} className="text-success" /> Claude · Adaptive intelligence
          </p>
        </div>
      </div>

      <section className="mx-5 mt-5 flex-1 space-y-3">
        {messages.map((m, i) => (
          <div key={i} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
            <div
              className={`max-w-[85%] rounded-2xl px-4 py-3 text-sm leading-relaxed whitespace-pre-wrap ${
                m.role === "user"
                  ? "gradient-brand text-white"
                  : "bg-bg-2 border border-white/5"
              }`}
            >
              {m.content}
            </div>
          </div>
        ))}
        {loading && (
          <div className="flex justify-start">
            <div className="rounded-2xl bg-bg-2 border border-white/5 px-4 py-3 flex items-center gap-2">
              <span className="h-2 w-2 rounded-full bg-ai animate-pulse" />
              <span className="text-xs text-text-secondary">Thinking…</span>
            </div>
          </div>
        )}
        {error && (
          <div className="rounded-2xl border border-danger/30 bg-danger/10 p-3 text-sm text-danger">
            {error}
          </div>
        )}
        <div ref={endRef} />
      </section>

      {messages.length <= 1 && (
        <div className="mx-5 mt-4 flex flex-wrap gap-2">
          {suggestions.map((s) => (
            <button
              key={s}
              onClick={() => send(s)}
              className="rounded-full border border-white/8 bg-bg-2 px-3 py-1.5 text-xs text-text-secondary"
            >
              {s}
            </button>
          ))}
        </div>
      )}

      <div className="fixed bottom-20 left-0 right-0 px-5 z-30">
        <div className="mx-auto max-w-[430px] flex items-center gap-2 rounded-full bg-bg-2 border border-white/10 px-4 py-2 backdrop-blur">
          <Sparkles size={16} className="text-ai shrink-0" />
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && send(input)}
            placeholder="Ask your coach…"
            className="flex-1 bg-transparent text-sm outline-none placeholder:text-text-tertiary"
          />
          <button
            onClick={() => send(input)}
            disabled={loading || !input.trim()}
            className="h-8 w-8 rounded-full gradient-brand flex items-center justify-center text-white disabled:opacity-40"
          >
            <Send size={14} />
          </button>
        </div>
      </div>

      <BottomNav />
    </div>
  );
}
