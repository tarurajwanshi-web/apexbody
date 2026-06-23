import { useState, type ReactNode } from "react";
import { ChevronRight, Sparkles, Check, Lightbulb } from "lucide-react";
import { T, cardStyle, microLabel } from "./tokens";
import { cleanCardText, firstSentence } from "./text";

type DayProps = {
  compliancePct: number | null;
  noteContent: string | null;
};

type FuelProps = {
  score: number | null;
  mealCount: number;
  protein: { actual: number; target: number };
  carbs: { actual: number; target: number };
  fat: { actual: number; target: number };
};

type EarnedProps = {
  trainingLogged: boolean;
  readiness: number | null;
  setsCount: number;
  carbsPctOfTarget: number | null; // 0..1+
  goal: string | null;
  proteinTarget: number;
};

function MiniRing({
  value,
  color,
  fallback,
}: {
  value: number | null;
  color: string;
  fallback: ReactNode;
}) {
  const has = value != null && value > 0;
  const v = Math.max(0, Math.min(100, value ?? 0));
  const r = 14;
  const c = 2 * Math.PI * r;
  const filled = (v / 100) * c;
  return (
    <div style={{ position: "relative", width: 36, height: 36, flexShrink: 0 }}>
      <svg width={36} height={36} style={{ transform: "rotate(-90deg)" }}>
        <circle cx={18} cy={18} r={r} fill="none" stroke={T.ringTrack} strokeWidth={3} />
        {has && (
          <circle
            cx={18}
            cy={18}
            r={r}
            fill="none"
            stroke={color}
            strokeWidth={3}
            strokeLinecap="round"
            strokeDasharray={`${filled} ${c - filled}`}
          />
        )}
      </svg>
      <div
        style={{
          position: "absolute",
          inset: 0,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: 10,
          fontWeight: 400,
          color: has ? color : T.text3,
        }}
      >
        {has ? Math.round(v) : fallback}
      </div>
    </div>
  );
}

function truncate(s: string, n: number): string {
  if (s.length <= n) return s;
  const cut = s.slice(0, n);
  const last = cut.lastIndexOf(" ");
  return (last > 20 ? cut.slice(0, last) : cut).trim() + "…";
}

function Row({
  ringEl,
  title,
  subtitle,
  open,
  onToggle,
  children,
}: {
  ringEl: ReactNode;
  title: string;
  subtitle: string;
  open: boolean;
  onToggle: () => void;
  children: ReactNode;
}) {
  return (
    <div style={{ borderTop: `0.5px solid ${T.border}` }}>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        style={{
          width: "100%",
          minHeight: 56,
          padding: "10px 16px",
          display: "flex",
          alignItems: "center",
          gap: 12,
          background: "transparent",
          border: "none",
          cursor: "pointer",
          textAlign: "left",
        }}
      >
        {ringEl}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13, color: "#C8C8E0", fontWeight: 400, lineHeight: 1.3 }}>
            {title}
          </div>
          <div
            style={{
              fontSize: 12,
              color: T.text3,
              fontWeight: 400,
              marginTop: 2,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {subtitle}
          </div>
        </div>
        <ChevronRight
          size={16}
          color={T.text3}
          style={{
            transition: "transform 0.3s ease",
            transform: open ? "rotate(90deg)" : "rotate(0deg)",
            flexShrink: 0,
          }}
        />
      </button>
      <div
        style={{
          maxHeight: open ? 360 : 0,
          overflow: "hidden",
          transition: "max-height 0.3s ease",
        }}
      >
        <div style={{ padding: "0 16px 16px 64px" }}>{children}</div>
      </div>
    </div>
  );
}

function Tag({ text, color }: { text: string; color: string }) {
  return (
    <div
      style={{
        fontSize: 9,
        letterSpacing: "1.8px",
        textTransform: "uppercase",
        color,
        fontWeight: 500,
        marginBottom: 8,
      }}
    >
      {text}
    </div>
  );
}

function Body({ children }: { children: ReactNode }) {
  return (
    <div style={{ fontSize: 13, color: "#7070A0", lineHeight: 1.65, whiteSpace: "pre-wrap" }}>
      {children}
    </div>
  );
}

export function Insights({
  day,
  fuel,
  earned,
}: {
  day: DayProps;
  fuel: FuelProps;
  earned: EarnedProps;
}) {
  const [openIdx, setOpenIdx] = useState<number | null>(null);
  const toggle = (i: number) => setOpenIdx((cur) => (cur === i ? null : i));

  // --- Row 1: Your Day
  const noteClean = day.noteContent ? cleanCardText(day.noteContent) : "";
  const daySubtitleRaw = noteClean
    ? firstSentence(noteClean)
    : "Your coaching note arrives tonight at 9 PM";
  const daySubtitle = truncate(daySubtitleRaw, 45);

  // --- Row 2: Fuel Quality
  let fuelSubtitle = "No meals logged yet";
  if (fuel.score != null) {
    if (fuel.score >= 70) fuelSubtitle = "On track — targets within range";
    else if (fuel.score >= 40) fuelSubtitle = "Building — log more meals today";
    else if (fuel.mealCount === 0) fuelSubtitle = "No meals logged yet";
    else fuelSubtitle = "Below target — check macros";
  }

  // --- Row 3: Well Earned vs Recovery Tip
  const carbsLow = (earned.carbsPctOfTarget ?? 0) < 0.8;
  const stateA =
    earned.trainingLogged && (earned.readiness ?? 0) > 70 && carbsLow;
  const goalLabel = (earned.goal ?? "your").toLowerCase().replace(/_/g, " ");

  return (
    <div
      style={{
        ...cardStyle,
        padding: 0,
        overflow: "hidden",
      }}
    >
      <div style={{ ...microLabel, padding: "12px 16px 10px" }}>Insights</div>

      <Row
        ringEl={
          <MiniRing
            value={day.compliancePct}
            color={T.ringRecovery}
            fallback={<Sparkles size={12} color={T.text3} />}
          />
        }
        title="Your Day"
        subtitle={daySubtitle}
        open={openIdx === 0}
        onToggle={() => toggle(0)}
      >
        <Tag text="Tonight's read" color={T.ringRecovery} />
        <Body>
          {noteClean || "Your coaching note arrives tonight at 9 PM. Check back later."}
        </Body>
        {day.compliancePct != null && (
          <div
            style={{
              marginTop: 12,
              display: "inline-block",
              padding: "6px 12px",
              background: "#0A0D20",
              border: "1px solid #1A1E40",
              borderRadius: 999,
              color: T.ringRecovery,
              fontSize: 11,
              fontWeight: 500,
            }}
          >
            {Math.round(day.compliancePct)}% compliance today
          </div>
        )}
      </Row>

      <Row
        ringEl={
          <MiniRing
            value={fuel.score}
            color={T.ringFuel}
            fallback={<span>—</span>}
          />
        }
        title="Fuel Quality"
        subtitle={fuelSubtitle}
        open={openIdx === 1}
        onToggle={() => toggle(1)}
      >
        <Tag text="Today's fuel" color={T.ringFuel} />
        <Body>{fuelSubtitle}. Log more meals to keep your macros on track.</Body>
        <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
          <MacroChip label="Fat" actual={fuel.fat.actual} target={fuel.fat.target} color={T.ringRecovery} />
          <MacroChip label="Carbs" actual={fuel.carbs.actual} target={fuel.carbs.target} color={T.ringFuel} />
          <MacroChip label="Protein" actual={fuel.protein.actual} target={fuel.protein.target} color={T.ringEffort} />
        </div>
      </Row>

      <Row
        ringEl={
          stateA ? (
            <MiniRing value={100} color={T.ringEffort} fallback={<Check size={14} color={T.ringEffort} />} />
          ) : (
            <MiniRing value={null} color={T.ringRecovery} fallback={<Lightbulb size={12} color={T.ringRecovery} />} />
          )
        }
        title={stateA ? "Well Earned" : "Recovery Tip"}
        subtitle={
          stateA
            ? "High effort today — recovery window open"
            : "Rest day — here's what helps tomorrow"
        }
        open={openIdx === 2}
        onToggle={() => toggle(2)}
      >
        {stateA ? (
          <>
            <Tag text="You earned this" color={T.ringEffort} />
            <Body>
              {`You put in the work today — ${earned.setsCount} sets, recovery at ${
                earned.readiness != null ? Math.round(earned.readiness) : "—"
              }%. Your body needs fuel to repair overnight. A higher-carb meal now accelerates recovery without affecting your ${goalLabel} progress. This is part of the plan, not off it.`}
            </Body>
            <div
              style={{
                marginTop: 12,
                display: "inline-block",
                padding: "6px 12px",
                background: "rgba(45,212,160,0.08)",
                border: "1px solid rgba(45,212,160,0.25)",
                borderRadius: 999,
                color: T.ringEffort,
                fontSize: 11,
                fontWeight: 500,
              }}
            >
              Go enjoy a well-earned meal
            </div>
          </>
        ) : (
          <>
            <Tag text="For tomorrow" color={T.ringRecovery} />
            <Body>
              {`Rest days are where progress is made. Keep protein consistent (your target: ${Math.round(
                earned.proteinTarget || 0,
              )}g), stay hydrated, and sleep 7-9 hours. Your body is rebuilding right now.`}
            </Body>
          </>
        )}
      </Row>
    </div>
  );
}

function MacroChip({
  label,
  actual,
  target,
  color,
}: {
  label: string;
  actual: number;
  target: number;
  color: string;
}) {
  return (
    <div
      style={{
        flex: 1,
        background: "#0A0D20",
        border: `0.5px solid ${T.border}`,
        borderRadius: 8,
        padding: 8,
        display: "flex",
        flexDirection: "column",
        gap: 2,
      }}
    >
      <div style={{ fontSize: 13, fontWeight: 400, color, letterSpacing: "-0.2px" }}>
        {Math.round(actual)}g
      </div>
      <div style={{ fontSize: 9, color: T.label, letterSpacing: "1.8px", textTransform: "uppercase" }}>
        {label}
      </div>
      <div style={{ fontSize: 10, color: T.text3 }}>
        / {Math.round(target || 0)}g
      </div>
    </div>
  );
}
