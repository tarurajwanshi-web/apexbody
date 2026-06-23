import { useState } from "react";
import { ChevronRight, BarChart3, Dumbbell } from "lucide-react";
import { T } from "./tokens";
import { BottomSheet } from "./BottomSheet";
import type { DashboardCard } from "@/lib/dashboard-data";
import { cleanCardText } from "./text";

export function ThisWeek({ cards }: { cards: DashboardCard[] }) {
  const weekly = cards.find((c) => c.card_type === "weekly_pattern");
  const sync = cards.find((c) => c.card_type === "training_sync");
  const [open, setOpen] = useState<DashboardCard | null>(null);

  if (!weekly && !sync) return null;

  return (
    <div>
      <div
        style={{
          fontSize: 9,
          letterSpacing: "1.5px",
          textTransform: "uppercase",
          color: T.text3,
          fontWeight: 500,
          marginBottom: 8,
          paddingLeft: 4,
        }}
      >
        This Week
      </div>
      <div
        style={{
          background: T.surface,
          border: `0.5px solid ${T.border}`,
          borderRadius: 12,
          overflow: "hidden",
        }}
      >
        {weekly && (
          <Row
            iconBg="#0D0A28"
            icon={<BarChart3 size={14} color={T.primary} />}
            title="Week in Review"
            sub={truncate(cleanCardText(weekly.content), 40)}
            onClick={() => setOpen(weekly)}
          />
        )}
        {weekly && sync && (
          <div
            style={{
              height: 1,
              borderTop: `1px dotted ${T.dottedSoft}`,
              margin: "0 14px",
            }}
          />
        )}
        {sync && (
          <Row
            iconBg="#071E14"
            icon={<Dumbbell size={14} color={T.green} />}
            title="Next Week's Plan"
            sub={truncate(cleanCardText(sync.content), 40)}
            onClick={() => setOpen(sync)}
          />
        )}
      </div>

      <BottomSheet open={!!open} onClose={() => setOpen(null)}>
        {open && (
          <>
            <div
              style={{
                fontSize: 14,
                fontWeight: 500,
                color: T.text1,
                marginBottom: 12,
              }}
            >
              {open.card_type === "weekly_pattern"
                ? "Week in Review"
                : "Next Week's Plan"}
            </div>
            <p
              style={{
                fontSize: 14,
                lineHeight: 1.6,
                color: T.text1,
                whiteSpace: "pre-wrap",
              }}
            >
              {cleanCardText(open.content)}
            </p>
          </>
        )}
      </BottomSheet>
    </div>
  );
}

function truncate(s: string, n: number): string {
  if (s.length <= n) return s;
  return `${s.slice(0, n).trim()}...`;
}

function Row({
  iconBg,
  icon,
  title,
  sub,
  onClick,
}: {
  iconBg: string;
  icon: React.ReactNode;
  title: string;
  sub: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="w-full flex items-center gap-3 text-left active:scale-[0.995] transition"
      style={{ padding: "12px 14px" }}
    >
      <div
        style={{
          width: 28,
          height: 28,
          borderRadius: 7,
          background: iconBg,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          flexShrink: 0,
        }}
      >
        {icon}
      </div>
      <div className="flex-1 min-w-0">
        <div style={{ fontSize: 12, color: T.text1, fontWeight: 500 }}>
          {title}
        </div>
        <div
          style={{
            fontSize: 11,
            color: T.text2,
            marginTop: 2,
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          {sub}
        </div>
      </div>
      <ChevronRight size={16} color={T.text3} />
    </button>
  );
}
