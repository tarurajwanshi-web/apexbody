import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { listCoachingCards, type CoachingCard } from "@/lib/coaching-cards.functions";

const TYPE_META: Record<string, { emoji: string; label: string }> = {
  daily_scorecard: { emoji: "📊", label: "Daily Scorecard" },
  daily_note: { emoji: "💡", label: "Coach Note" },
  weekly_pattern: { emoji: "📈", label: "Weekly Pattern" },
  training_sync: { emoji: "🏋️", label: "Training Sync" },
  permission_slip: { emoji: "🎯", label: "Permission Slip" },
};

const COLORS = {
  cardBg: "#10162A",
  textPrimary: "#F5F5F7",
  textSecondary: "#A8ADBD",
  teal: "#8B7FF7",
  gold: "#5FE3C4",
  dotted: "1px dotted rgba(139, 127, 247, 0.32)",
};

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
}

function sortCards(cards: CoachingCard[]): CoachingCard[] {
  return [...cards].sort((a, b) => {
    const aPin = a.card_type === "permission_slip" ? 0 : 1;
    const bPin = b.card_type === "permission_slip" ? 0 : 1;
    if (aPin !== bPin) return aPin - bPin;
    return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
  });
}

function renderContent(content: string) {
  // Render **bold** as section headings inline.
  const parts = content.split(/(\*\*[^*]+\*\*)/g);
  return parts.map((part, i) => {
    const m = part.match(/^\*\*([^*]+)\*\*$/);
    if (m) {
      return (
        <strong key={i} style={{ color: COLORS.teal, fontWeight: 600 }}>
          {m[1]}
        </strong>
      );
    }
    return <span key={i}>{part}</span>;
  });
}

function Card({ card }: { card: CoachingCard }) {
  const meta = TYPE_META[card.card_type] ?? { emoji: "✨", label: card.card_type };
  const isPermission = card.card_type === "permission_slip";
  const isWeekly = card.card_type === "weekly_pattern";
  const isTraining = card.card_type === "training_sync";
  const isNote = card.card_type === "daily_note";

  const padding = isPermission ? 22 : isWeekly ? 24 : isTraining ? 16 : 20;
  const bodyFontSize = isPermission ? 15 : isTraining ? 13 : 14;

  const baseStyle: React.CSSProperties = {
    borderRadius: 12,
    padding,
    background: isPermission
      ? "linear-gradient(135deg, #8B7FF7, #5FE3C4)"
      : COLORS.cardBg,
    color: isPermission ? "#0A0E1A" : COLORS.textPrimary,
    border: isPermission ? "none" : "1px solid rgba(255,255,255,0.06)",
    borderLeft: isNote ? `2px solid ${COLORS.teal}` : undefined,
    boxShadow: isPermission
      ? "0 16px 40px -16px rgba(139, 127, 247, 0.45)"
      : "inset 0 1px 0 rgba(255,255,255,0.04), 0 8px 24px -12px rgba(0,0,0,0.5)",
  };

  const labelColor = isPermission ? "rgba(10,14,26,0.7)" : COLORS.textSecondary;
  const timeColor = isPermission ? "rgba(10,14,26,0.55)" : COLORS.textSecondary;
  const separator = isPermission
    ? "1px dotted rgba(10,14,26,0.35)"
    : COLORS.dotted;

  return (
    <div style={baseStyle}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ fontSize: 18, lineHeight: 1 }}>{meta.emoji}</span>
        <span
          style={{
            fontSize: 11,
            fontWeight: 600,
            textTransform: "uppercase",
            letterSpacing: "1.2px",
            color: labelColor,
            flex: 1,
          }}
        >
          {meta.label}
        </span>
        <span style={{ fontSize: 11, color: timeColor }}>
          {relativeTime(card.created_at)}
        </span>
      </div>
      <div style={{ borderTop: separator, margin: "12px 0" }} />
      <div
        style={{
          fontSize: bodyFontSize,
          lineHeight: 1.55,
          whiteSpace: "pre-wrap",
          wordBreak: "break-word",
        }}
      >
        {renderContent(card.content)}
      </div>
    </div>
  );
}

export function CoachingFeed() {
  const fetchCards = useServerFn(listCoachingCards);
  const [cards, setCards] = useState<CoachingCard[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchCards()
      .then((data) => {
        if (!cancelled) setCards(sortCards(data));
      })
      .catch((e) => {
        if (!cancelled) setError(e?.message ?? "Failed to load coaching feed.");
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <section className="animate-fade-up" style={{ animationDelay: "350ms" }}>
      <h2
        style={{
          fontSize: 14,
          fontWeight: 600,
          color: COLORS.textPrimary,
          margin: "0 0 12px 4px",
          letterSpacing: "0.2px",
        }}
      >
        Your Coaching Feed
      </h2>

      {cards === null && !error && (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {[0, 1].map((i) => (
            <div
              key={i}
              style={{
                height: 96,
                borderRadius: 12,
                background: COLORS.cardBg,
                opacity: 0.5,
              }}
            />
          ))}
        </div>
      )}

      {error && (
        <div
          style={{
            borderRadius: 12,
            padding: 16,
            background: COLORS.cardBg,
            color: COLORS.textSecondary,
            fontSize: 13,
          }}
        >
          Couldn't load your coaching feed.
        </div>
      )}

      {cards && cards.length === 0 && (
        <div
          style={{
            borderRadius: 12,
            padding: 20,
            background: COLORS.cardBg,
            color: COLORS.textSecondary,
            fontSize: 13,
            textAlign: "center",
          }}
        >
          No coaching cards yet — check back after your next scorecard.
        </div>
      )}

      {cards && cards.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {cards.map((c) => (
            <Card key={c.id} card={c} />
          ))}
        </div>
      )}
    </section>
  );
}
