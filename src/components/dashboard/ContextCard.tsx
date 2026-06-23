import { Trophy } from "lucide-react";
import { Link } from "@tanstack/react-router";
import { T } from "./tokens";
import type { ContextPriority } from "@/lib/dashboard-state";
import { topFoodSources, minutesSince, pctOf } from "@/lib/dashboard-state";
import type { DashboardData } from "@/lib/dashboard-data";
import { cleanCardText, firstSentence } from "./text";

type Props = {
  priority: ContextPriority;
  d: DashboardData;
  onLogMeal: () => void;
  onViewBreakdown: () => void;
};

export function ContextCard({ priority, d, onLogMeal, onViewBreakdown }: Props) {
  switch (priority) {
    case "P0":
      return <VictoryMeal d={d} />;
    case "P1":
      return <RecoveryWindow d={d} onLogMeal={onLogMeal} />;
    case "P2":
      return <ApexSays d={d} onViewBreakdown={onViewBreakdown} />;
    case "P3":
      return <TrainingAhead d={d} />;
    case "P4":
      return <InProgress d={d} onLogMeal={onLogMeal} />;
    case "P5":
      return <FastingWindow />;
    case "P6":
      return <FreshStart d={d} onLogMeal={onLogMeal} />;
    case "P7":
      return <GhostReturn d={d} onLogMeal={onLogMeal} />;
  }
}

const macroPct = (d: DashboardData) => {
  const t = d.targets;
  if (!t) return { protein: 0, carbs: 0, fat: 0 };
  return {
    protein: pctOf(d.macros?.total_protein ?? 0, t.target_protein_g),
    carbs: pctOf(d.macros?.total_carbs ?? 0, t.target_carbs_g),
    fat: pctOf(d.macros?.total_fat ?? 0, t.target_fat_g),
  };
};

function leftAccent(color: string): React.CSSProperties {
  return { borderLeft: `2px solid ${color}` };
}

function ProgressBar({ pct, color }: { pct: number; color: string }) {
  return (
    <div
      style={{
        height: 3,
        width: "100%",
        background: T.surface2,
        borderRadius: 2,
        overflow: "hidden",
      }}
    >
      <div
        style={{
          height: "100%",
          width: `${Math.min(100, Math.max(0, pct * 100))}%`,
          background: color,
        }}
      />
    </div>
  );
}

function MacroBars({ d, only }: { d: DashboardData; only?: ("protein" | "carbs" | "fat")[] }) {
  const m = macroPct(d);
  const keys = only ?? (["protein", "carbs", "fat"] as const);
  return (
    <div className="space-y-2 mt-3">
      {keys.map((k) => {
        const v = (m as any)[k] as number;
        const color = v >= 0.85 ? T.green : v >= 0.6 ? T.amber : T.red;
        const label = k.charAt(0).toUpperCase() + k.slice(1);
        return (
          <div key={k}>
            <div className="flex justify-between" style={{ fontSize: 10, color: T.text3 }}>
              <span>{label}</span>
              <span>{Math.round(v * 100)}%</span>
            </div>
            <ProgressBar pct={v} color={color} />
          </div>
        );
      })}
    </div>
  );
}

function Tag({ children, color }: { children: React.ReactNode; color: string }) {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        fontSize: 10,
        fontWeight: 500,
        color,
        letterSpacing: "1.2px",
        textTransform: "uppercase",
      }}
    >
      <span style={{ width: 6, height: 6, borderRadius: 999, background: color }} />
      {children}
    </span>
  );
}

function PrimaryButton({
  children,
  onClick,
  color = T.primary,
}: {
  children: React.ReactNode;
  onClick?: () => void;
  color?: string;
}) {
  return (
    <button
      onClick={onClick}
      style={{
        marginTop: 12,
        background: `${color}1A`,
        border: `0.5px solid ${color}4D`,
        color,
        borderRadius: 999,
        padding: "8px 14px",
        fontSize: 12,
        fontWeight: 500,
      }}
    >
      {children}
    </button>
  );
}

/* ---------------- P0 ---------------- */
function VictoryMeal({ d }: { d: DashboardData }) {
  const foods = topFoodSources(d.recentMeals);
  const chips = foods.length >= 3 ? foods.slice(0, 3) : ["Biryani", "Pasta", "Rice bowl"];
  return (
    <div
      style={{
        background: "#0A150A",
        border: "1px solid rgba(168, 255, 120, 0.3)",
        borderRadius: 16,
        padding: 16,
      }}
    >
      <div className="flex items-center gap-2">
        <Trophy size={16} color={T.victory} />
        <span style={{ fontSize: 15, fontWeight: 500, color: T.text1 }}>You earned this.</span>
      </div>
      <p style={{ fontSize: 12, color: T.text2, marginTop: 6 }}>
        All targets hit today.
      </p>
      <span
        style={{
          display: "inline-block",
          marginTop: 10,
          background: "rgba(168,255,120,0.1)",
          border: "0.5px solid rgba(168,255,120,0.3)",
          color: T.victory,
          borderRadius: 20,
          padding: "4px 12px",
          fontSize: 10,
          fontWeight: 500,
          letterSpacing: "1px",
          textTransform: "uppercase",
        }}
      >
        Victory Meal unlocked
      </span>
      <div className="grid grid-cols-3 gap-2 mt-3">
        {chips.map((c) => (
          <div
            key={c}
            style={{
              background: "#0C1A0C",
              border: "0.5px solid #1A2A1A",
              borderRadius: 9,
              padding: "8px 10px",
              fontSize: 12,
              color: T.text1,
              textAlign: "center",
            }}
          >
            {c}
          </div>
        ))}
      </div>
    </div>
  );
}

/* ---------------- P1 ---------------- */
function RecoveryWindow({ d, onLogMeal }: { d: DashboardData; onLogMeal: () => void }) {
  const m = macroPct(d);
  const carbsPct = Math.round(m.carbs * 100);
  const mins = minutesSince(d.todayLastSetTime) ?? 0;
  const windowLeft = Math.max(15, 90 - mins);
  return (
    <div
      style={{
        background: "#0A1E14",
        border: "0.5px solid #0A2A1C",
        borderRadius: 16,
        padding: 16,
        ...leftAccent(T.green),
      }}
    >
      <Tag color={T.green}>Recovery Window</Tag>
      <p style={{ fontSize: 15, fontWeight: 500, color: T.text1, marginTop: 8 }}>
        Workout done. Fuel now.
      </p>
      <p style={{ fontSize: 12, color: T.text2, marginTop: 6, lineHeight: 1.5 }}>
        {d.todaySetsCount} sets logged. Carbs are at {carbsPct}% — your recovery
        window is open. Eat carbs + protein in the next {windowLeft} min.
      </p>
      <MacroBars d={d} only={["protein", "carbs"]} />
      <PrimaryButton onClick={onLogMeal} color={T.green}>
        Log recovery meal
      </PrimaryButton>
    </div>
  );
}

/* ---------------- P2 ---------------- */
function ApexSays({ d, onViewBreakdown }: { d: DashboardData; onViewBreakdown: () => void }) {
  const note = d.cards.find((c) => c.card_type === "daily_note");
  const raw = note?.content ?? "";
  const content = cleanCardText(raw);
  const headline = firstSentence(raw);
  const body = headline && content.startsWith(headline)
    ? content.slice(headline.length).replace(/^[.!?\s]+/, "")
    : content;
  const orange = "#FF8C42";
  const compliance = d.macros?.compliance_pct ?? null;
  return (
    <div
      style={{
        background: "#120E08",
        border: "0.5px solid #2A1A0A",
        borderRadius: 16,
        padding: 16,
        ...leftAccent(orange),
      }}
    >
      <Tag color={orange}>APEX says</Tag>
      <p style={{ fontSize: 15, fontWeight: 500, color: T.text1, marginTop: 8 }}>
        {headline}
      </p>
      {body && (
        <p
          style={{
            fontSize: 13,
            color: T.text2,
            marginTop: 8,
            lineHeight: 1.6,
            whiteSpace: "pre-wrap",
          }}
        >
          {body}
        </p>
      )}
      <div className="flex items-center justify-between mt-3">
        {compliance != null ? (
          <span
            style={{
              background: "#071E14",
              color: T.green,
              padding: "3px 9px",
              borderRadius: 20,
              fontSize: 10,
              fontWeight: 500,
            }}
          >
            {Math.round(compliance)}% compliance
          </span>
        ) : (
          <span />
        )}
        <button
          onClick={onViewBreakdown}
          style={{ fontSize: 12, color: T.primary, fontWeight: 500 }}
        >
          Full breakdown →
        </button>
      </div>
    </div>
  );
}

/* ---------------- P3 ---------------- */
function TrainingAhead({ d }: { d: DashboardData }) {
  const session = d.todayPlannedSession;
  const totalSets = session?.exercises.reduce((s, ex) => s + (ex.sets ?? 0), 0) ?? 0;
  const ex = session?.exercises?.[0]?.name ?? session?.session_name ?? "Today's session";
  return (
    <div
      style={{
        background: "#0D0A28",
        border: "0.5px solid #1A1640",
        borderRadius: 16,
        padding: 16,
        ...leftAccent(T.primary),
      }}
    >
      <Tag color={T.primary}>Training ahead</Tag>
      <p style={{ fontSize: 15, fontWeight: 500, color: T.text1, marginTop: 8 }}>
        Fueled well. Go crush it.
      </p>
      <p style={{ fontSize: 12, color: T.text2, marginTop: 6 }}>
        {ex} · ~{totalSets} sets planned
      </p>
      <MacroBars d={d} />
      <p style={{ fontSize: 10, color: T.text3, marginTop: 10 }}>
        Victory Meal unlocks after you log your workout.
      </p>
      <Link to="/workouts">
        <PrimaryButton color={T.primary}>Log workout after</PrimaryButton>
      </Link>
    </div>
  );
}

/* ---------------- P4 ---------------- */
function InProgress({ d, onLogMeal }: { d: DashboardData; onLogMeal: () => void }) {
  const m = macroPct(d);
  let headline = "You're on track";
  if (m.protein < 0.6) headline = "Protein needs attention";
  else if (m.carbs < 0.6) headline = "Carbs below target";
  return (
    <div
      style={{
        background: "#0F0D00",
        border: "0.5px solid #2A2000",
        borderRadius: 16,
        padding: 16,
        ...leftAccent(T.amber),
      }}
    >
      <Tag color={T.amber}>Tracking</Tag>
      <p style={{ fontSize: 15, fontWeight: 500, color: T.text1, marginTop: 8 }}>
        {headline}
      </p>
      <p style={{ fontSize: 12, color: T.text2, marginTop: 6 }}>
        {d.todayMeals.length} meal{d.todayMeals.length === 1 ? "" : "s"} logged.
      </p>
      <MacroBars d={d} />
      <PrimaryButton color={T.amber} onClick={onLogMeal}>
        Log next meal
      </PrimaryButton>
    </div>
  );
}

/* ---------------- P5 ---------------- */
function FastingWindow() {
  return (
    <div
      style={{
        background: T.surface,
        border: `0.5px solid ${T.border}`,
        borderRadius: 16,
        padding: 16,
        borderLeft: `2px solid ${T.primary}80`,
      }}
    >
      <Tag color={T.primary}>Fasting window</Tag>
      <p style={{ fontSize: 15, fontWeight: 500, color: T.text1, marginTop: 8 }}>
        Fasting mode — on track.
      </p>
      <p style={{ fontSize: 12, color: T.text2, marginTop: 6, lineHeight: 1.5 }}>
        No meals before noon — APEX knows this is your pattern. Break your fast
        at your usual time for optimal results.
      </p>
      <div className="flex gap-2 mt-3">
        <PrimaryButton color={T.primary}>Break fast now</PrimaryButton>
        <PrimaryButton color={T.text2}>Continue fasting</PrimaryButton>
      </div>
    </div>
  );
}

/* ---------------- P6 ---------------- */
function FreshStart({ d, onLogMeal }: { d: DashboardData; onLogMeal: () => void }) {
  const score = d.readiness?.final_score ?? null;
  let body = "Take it easy today.";
  if (score != null) {
    if (score > 75) body = `Readiness ${score} — strong. Push hard today.`;
    else if (score >= 60) body = `Readiness ${score} — solid. Consistent effort today.`;
    else body = `Readiness ${score} — take it easy today.`;
  }
  return (
    <div
      style={{
        background: T.surface,
        border: `0.5px solid ${T.border}`,
        borderRadius: 16,
        padding: 16,
        ...leftAccent(T.primary),
      }}
    >
      <Tag color={T.primary}>Today's mission</Tag>
      <p style={{ fontSize: 15, fontWeight: 500, color: T.text1, marginTop: 8 }}>
        Here's what matters today
      </p>
      <p style={{ fontSize: 12, color: T.text2, marginTop: 6 }}>{body}</p>
      <MacroBars d={d} />
      <div className="flex gap-2">
        <PrimaryButton color={T.primary} onClick={onLogMeal}>
          Log first meal
        </PrimaryButton>
        <Link to="/workouts">
          <PrimaryButton color={T.text2}>View plan</PrimaryButton>
        </Link>
      </div>
    </div>
  );
}

/* ---------------- P7 ---------------- */
function GhostReturn({ d, onLogMeal }: { d: DashboardData; onLogMeal: () => void }) {
  const ghostDays = d.lastLogDate
    ? Math.max(2, daysAgo(d.lastLogDate))
    : 2;
  const best = d.recentMeals.length;
  return (
    <div
      style={{
        background: T.surface,
        border: `0.5px solid ${T.border}`,
        borderRadius: 16,
        padding: 16,
      }}
    >
      <Tag color={T.text2}>Welcome back</Tag>
      <p style={{ fontSize: 15, fontWeight: 500, color: T.text1, marginTop: 8 }}>
        Good to see you. No pressure.
      </p>
      <p style={{ fontSize: 12, color: T.text2, marginTop: 6, lineHeight: 1.5 }}>
        {ghostDays >= 3
          ? "Starting fresh — your data from before is still here."
          : `Your ${best}-day best is saved. One log today keeps the momentum alive.`}
      </p>
      <PrimaryButton color={T.primary} onClick={onLogMeal}>
        Log one meal
      </PrimaryButton>
    </div>
  );
}

function daysAgo(iso: string): number {
  const [y, m, d] = iso.split("-").map(Number);
  const t = Date.UTC(y, (m ?? 1) - 1, d ?? 1);
  return Math.round((Date.now() - t) / 86400000);
}
