import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Sparkles, Flame, Heart, BookOpen, RefreshCw, Dumbbell, Droplet, Lock } from "lucide-react";
import { useProfile } from "@/lib/store";
import { getOrCreateDailyInsight } from "@/lib/coach.functions";
import { getTodayReadiness, getActivityWeek, getTodayHydration, type TodayReadiness, type ActivityWeek, type HydrationSummary } from "@/lib/shield.functions";
import { RecoveryLogModal, MealLogModal } from "@/components/LogModals";
import { getTodayMacroSummary, type MacroSummary } from "@/lib/macros.functions";
import { BottomNav } from "@/components/BottomNav";
import { RefreshStamp } from "@/components/RefreshStamp";
import { useAutoRefreshOnVisible } from "@/hooks/use-auto-refresh";
import { supabase } from "@/integrations/supabase/client";
import { scoreColor, isExtreme, scoreColorRgba } from "@/lib/score-color";
import { useUserTimezone, getLocalDateISO } from "@/lib/dates";

export const Route = createFileRoute("/_authenticated/dashboard")({
  head: () => ({ meta: [{ title: "Dashboard — APEX" }] }),
  component: Dashboard,
});

const LEARNING_DAYS = 7;


const PILLAR_META: { key: "recovery" | "sleep" | "nutrition" | "training" | "mood"; label: string; color: string }[] = [
  { key: "recovery", label: "Recovery", color: "#10B981" },
  { key: "sleep", label: "Sleep", color: "#3B82F6" },
  { key: "nutrition", label: "Nutrition", color: "#22C55E" },
  { key: "training", label: "Training", color: "#F59E0B" },
  { key: "mood", label: "Mood", color: "#8B5CF6" },
];

function Dashboard() {
  const { profile, update } = useProfile();
  const navigate = useNavigate();
  const userTz = useUserTimezone();
  const [serverProfile, setServerProfile] = useState<{ profile_completed_at: string | null } | null>(null);
  const day = useMemo(() => {
    const completed = serverProfile?.profile_completed_at;
    if (!completed) return 1;
    const diff = Math.floor(
      (Date.now() - new Date(completed).getTime()) / 86400000
    );
    return Math.max(1, diff + 1);
  }, [serverProfile?.profile_completed_at]);
  const [greet, setGreet] = useState("Hello");
  const [insight, setInsight] = useState("Your recovery is strong. Ready to push intensity today.");
  const [insightTime] = useState("Just now");
  // Lazy-init from localStorage so dismissal persists across remounts within
  // the same day. The "Got it" button writes today's YYYY-MM-DD; on a fresh
  // day we reset to false so the new daily insight surfaces.
  const [insightDismissed, setInsightDismissed] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    try {
      const stored = localStorage.getItem("apex_insight_dismissed_at");
      return stored === getLocalDateISO(typeof Intl !== "undefined" ? Intl.DateTimeFormat().resolvedOptions().timeZone : "UTC");
    } catch { return false; }
  });
  const [expanded, setExpanded] = useState(false);
  const [readiness, setReadiness] = useState<TodayReadiness>(null);
  const [recoveryOpen, setRecoveryOpen] = useState(false);
  const [mealOpen, setMealOpen] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [lastUpdatedAt, setLastUpdatedAt] = useState<number | null>(null);
  const fn = useServerFn(getOrCreateDailyInsight);
  const fetchReadiness = useServerFn(getTodayReadiness);
  const fetchMacros = useServerFn(getTodayMacroSummary);
  const fetchActivity = useServerFn(getActivityWeek);
  const fetchHydration = useServerFn(getTodayHydration);
  const [macros, setMacros] = useState<MacroSummary | null>(null);
  const [activity, setActivity] = useState<ActivityWeek | null>(null);
  const [hydration, setHydration] = useState<HydrationSummary | null>(null);
  const [todaySession, setTodaySession] = useState<{ rest: boolean; session_name: string | null; doneSets: number; totalSets: number } | null>(null);
  const reloadMacros = () => { fetchMacros().then(setMacros).catch(() => {}); };
  const reloadActivity = () => { fetchActivity().then(setActivity).catch(() => {}); };

  const reloadReadiness = () => {
    fetchReadiness().then(setReadiness).catch(() => setReadiness(null));
  };

  const reloadTodaySession = async () => {
    try {
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) return;
      const todayIso = getLocalDateISO(userTz);
      const jsDay = new Date().getDay();
      const todayIdx = (jsDay + 6) % 7;
      const [planRes, logsRes] = await Promise.all([
        supabase.from("weekly_plans").select("plan_data").eq("user_id", u.user.id).order("week_start_date", { ascending: false }).limit(1).maybeSingle(),
        supabase.from("workout_set_logs").select("completed").eq("user_id", u.user.id).eq("entry_date", todayIso),
      ]);
      const days = (planRes.data?.plan_data as any)?.days ?? [];
      const today = days[todayIdx];
      if (!today) { setTodaySession(null); return; }
      const totalSets = today.rest ? 0 : (today.exercises ?? []).reduce((s: number, ex: any) => s + (ex.sets ?? 0), 0);
      const doneSets = (logsRes.data ?? []).filter((l: any) => l.completed).length;
      setTodaySession({ rest: !!today.rest, session_name: today.session_name ?? null, doneSets, totalSets });
    } catch { setTodaySession(null); }
  };

  const reloadAll = async () => {
    setRefreshing(true);
    await Promise.allSettled([
      fetchReadiness().then(setReadiness),
      fetchMacros().then(setMacros),
      fetchActivity().then(setActivity),
      fetchHydration().then(setHydration).catch(() => {}),
      reloadTodaySession(),
    ]);
    setLastUpdatedAt(Date.now());
    setRefreshing(false);
  };

  // Silent refresh whenever the PWA comes back to the foreground (>60s gap).
  useAutoRefreshOnVisible(reloadAll, lastUpdatedAt);

  // Hydrate name from server profile (canonical) into the local store
  // so we stop greeting everyone as "Athlete".
  useEffect(() => {
    (async () => {
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) return;
      const { data } = await supabase
        .from("profiles")
        .select("name, goal, profile_completed_at")
        .eq("user_id", u.user.id)
        .maybeSingle();
      if (data?.name && data.name !== profile.name) update({ name: data.name });
      setServerProfile({ profile_completed_at: (data as any)?.profile_completed_at ?? null });
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const h = new Date().getHours();
    setGreet(h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening");
    // Initial load — establishes the "Updated [time]" stamp.
    reloadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Pull-to-refresh (touch only, simple resistance).
  const ptrRef = useRef<HTMLDivElement>(null);
  const ptrStart = useRef<number | null>(null);
  const [ptrDelta, setPtrDelta] = useState(0);
  useEffect(() => {
    const el = ptrRef.current;
    if (!el) return;
    const onStart = (e: TouchEvent) => {
      if (window.scrollY > 0) return;
      ptrStart.current = e.touches[0].clientY;
    };
    const onMove = (e: TouchEvent) => {
      if (ptrStart.current == null) return;
      const d = e.touches[0].clientY - ptrStart.current;
      if (d > 0) setPtrDelta(Math.min(80, d * 0.5));
    };
    const onEnd = () => {
      if (ptrDelta >= 60) reloadAll();
      ptrStart.current = null;
      setPtrDelta(0);
    };
    el.addEventListener("touchstart", onStart, { passive: true });
    el.addEventListener("touchmove", onMove, { passive: true });
    el.addEventListener("touchend", onEnd);
    return () => {
      el.removeEventListener("touchstart", onStart);
      el.removeEventListener("touchmove", onMove);
      el.removeEventListener("touchend", onEnd);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ptrDelta]);

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 2400);
  };

  // Capture score before a mutation; poll readiness for change for ~6s.
  const preScoreRef = useRef<number | null>(null);
  const captureScore = () => {
    preScoreRef.current = readiness?.final_score != null ? Number(readiness.final_score) : null;
  };
  const pollScoreChange = () => {
    const start = Date.now();
    const tick = async () => {
      try {
        const r = await fetchReadiness();
        setReadiness(r);
        const newScore = r?.final_score != null ? Number(r.final_score) : null;
        const prev = preScoreRef.current;
        if (newScore != null && prev != null && newScore !== prev) {
          showToast(`Score updated: ${prev} → ${newScore}`);
          return;
        }
      } catch {}
      if (Date.now() - start < 6000) setTimeout(tick, 1000);
    };
    setTimeout(tick, 1200);
  };


  // Daily AI insight — cached server-side in daily_ai_insights, one per user per day.
  // This fires only once per dashboard mount; the server returns the cached row
  // without calling Claude when one already exists for today.
  useEffect(() => {
    let cancelled = false;
    fn({
      data: {
        userData: {
          name: profile.name,
          goal: profile.goal,
          day,
          score: readiness?.final_score ?? null,
        },
      },
    })
      .then((r: { content: string }) => { if (!cancelled && r.content) setInsight(r.content); })
      .catch(() => {});
    return () => { cancelled = true; };
    // Intentionally only depend on `day` (the calendar day) so we hit cache on tab switches.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [day]);

  const today = getLocalDateISO(userTz);
  const hasToday = !!readiness && readiness.score_date === today;
  const inLearning = day <= LEARNING_DAYS;
  const week = Math.max(1, Math.ceil((day - LEARNING_DAYS) / 7));
  const subline = inLearning ? `Day ${day} of ${LEARNING_DAYS} — Learning phase` : `Week ${week} — Custom plan active`;

  // Ring math
  const ringSize = 90;
  const ringStroke = 8;
  const ringR = ringSize / 2 - ringStroke / 2;
  const ringC = 2 * Math.PI * ringR;
  const score = hasToday ? readiness!.final_score : null;
  const fillPct = score != null ? score / 100 : 0;

  return (
    <div
      ref={ptrRef}
      className="min-h-screen relative"
      style={{
        backgroundColor: "#0A0E1A",
        paddingTop: "max(env(safe-area-inset-top, 0px), 0px)",
        paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 128px)",
        transform: ptrDelta ? `translateY(${ptrDelta}px)` : undefined,
        transition: ptrDelta ? "none" : "transform 0.2s ease",
      }}
    >
      {/* PTR indicator — always shows the word "Refreshing…" so the gesture is unambiguous. */}
      {(ptrDelta > 0 || refreshing) && (
        <div className="absolute left-1/2 -translate-x-1/2 top-2 z-50 inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[11px] font-medium text-text-secondary"
          style={{ background: "rgba(15,21,36,0.85)", border: "1px solid rgba(255,255,255,0.08)", backdropFilter: "blur(8px)" }}>
          <RefreshCw size={12} className={refreshing ? "animate-spin" : ""} style={{ transform: refreshing ? undefined : `rotate(${ptrDelta * 4}deg)` }} />
          <span>{refreshing ? "Refreshing…" : ptrDelta >= 60 ? "Release to refresh" : "Pull to refresh"}</span>
        </div>
      )}
      {/* Subtle radial backdrop */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0"
        style={{
          height: "40vh",
          background: "radial-gradient(ellipse at 50% 0%, rgba(124,58,237,0.07), transparent 70%)",
        }}
      />
      <div className="relative px-5 pt-6 max-w-[480px] mx-auto space-y-4">
        {/* Header */}
        <header className="flex items-start justify-between gap-3 animate-fade-up" style={{ animationDelay: "0ms" }}>
          <div className="min-w-0 flex-1">
            <h1 className="text-[20px] font-semibold text-white leading-tight truncate">
              {greet}, {profile.name || "Athlete"}
            </h1>
            <p className="text-[13px] text-text-secondary mt-1">{subline}</p>
            <RefreshStamp className="mt-1.5" refreshing={refreshing} lastUpdatedAt={lastUpdatedAt} />
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <span
              className="inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[12px] font-semibold text-white"
              style={{ background: "rgba(124,58,237,0.10)", border: "1px solid rgba(124,58,237,0.20)" }}
            >
              <Flame size={12} className="text-warning" /> {activity?.streak ?? 0}
            </span>
            <Link
              to="/settings"
              aria-label="Profile and settings"
              className="h-10 w-10 rounded-full gradient-brand flex items-center justify-center text-white font-bold text-[14px] active:scale-95 transition shrink-0"
            >
              {(profile.name || "A").trim().charAt(0).toUpperCase()}
            </Link>
          </div>
        </header>

        {/* Data collection banner (days 1-5) */}
        {inLearning && (
          <div
            className="rounded-2xl p-4 animate-fade-up"
            style={{
              background: "linear-gradient(135deg, rgba(124,58,237,0.10), rgba(59,130,246,0.08))",
              border: "1px solid rgba(124,58,237,0.30)",
              animationDelay: "100ms",
            }}
          >
            <div className="flex items-start gap-3">
              <Sparkles size={18} className="text-ai shrink-0 mt-0.5" />
              <p className="text-[13px] text-text-primary leading-snug">
                Day {day} of {LEARNING_DAYS} — I'm learning your patterns to personalize your program.
              </p>
            </div>
            <div className="mt-3 h-1.5 w-full rounded-full overflow-hidden" style={{ background: "rgba(255,255,255,0.06)" }}>
              <div
                className="h-full gradient-brand transition-all"
                style={{ width: `${(Math.min(day, LEARNING_DAYS) / LEARNING_DAYS) * 100}%` }}
              />
            </div>
          </div>
        )}

        {/* AI Insight */}
        {!insightDismissed && (
        <div
          className="rounded-2xl p-5 animate-fade-up"
          style={{
            background: "linear-gradient(135deg, rgba(124,58,237,0.08), rgba(59,130,246,0.08))",
            border: "1px solid rgba(124,58,237,0.25)",
            animationDelay: "200ms",
          }}
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Sparkles size={20} className="text-ai" />
              <span className="text-[10px] font-medium text-ai uppercase" style={{ letterSpacing: "1.5px" }}>
                AI Insight
              </span>
            </div>
            <span className="text-[11px] text-text-tertiary">{insightTime}</span>
          </div>
          <p className="mt-3 text-[14px] text-text-primary leading-relaxed">{insight}</p>
          <div className="mt-4 flex gap-2">
            <button
              onClick={() => navigate({ to: "/coach" })}
              className="rounded-full px-3 py-1.5 text-[12px] font-medium text-sleep active:scale-[0.98] transition"
              style={{ border: "1px solid rgba(59,130,246,0.4)" }}
            >
              Tell me why
            </button>
            <button
              onClick={() => {
                setInsightDismissed(true);
                try { localStorage.setItem("apex_insight_dismissed_at", getLocalDateISO(userTz)); } catch {}
              }}
              className="rounded-full px-3 py-1.5 text-[12px] font-medium text-text-secondary active:scale-[0.98] transition"
              style={{ border: "1px solid rgba(255,255,255,0.12)" }}
            >
              Got it
            </button>
          </div>
        </div>
        )}

        {/* Pre-workout readiness adjustment note */}
        {readiness?.pre_session_adjustment != null && Number(readiness.pre_session_adjustment) < 0 && (
          <div
            className="rounded-2xl p-3 flex items-start gap-2"
            style={{
              background: "rgba(245,158,11,0.08)",
              border: "1px solid rgba(245,158,11,0.25)",
            }}
          >
            <Sparkles size={14} className="text-warning shrink-0 mt-0.5" />
            <p className="text-[12px] text-text-primary leading-snug">
              Pre-workout check flagged low readiness - today's score reflects this.
            </p>
          </div>
        )}



        {/* APEX Score Card — instrument-panel treatment */}
        <button
          onClick={() => setExpanded((v) => !v)}
          className="w-full text-left rounded-[20px] p-6 animate-fade-up active:scale-[0.995] transition relative overflow-hidden"
          style={{
            background:
              "radial-gradient(120% 90% at 50% 0%, rgba(124,58,237,0.18) 0%, rgba(15,21,36,0.85) 55%, #0B1020 100%)",
            border: "1px solid rgba(124,58,237,0.22)",
            boxShadow:
              "inset 0 1px 0 rgba(255,255,255,0.04), 0 12px 36px -12px rgba(124,58,237,0.35), 0 1px 0 rgba(255,255,255,0.02)",
            animationDelay: "300ms",
          }}
        >
          {/* Particle texture (CSS-only, no animation → reduced-motion safe) */}
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0 opacity-60 mix-blend-screen"
            style={{
              backgroundImage: [
                "radial-gradient(1px 1px at 12% 28%, rgba(167,139,250,0.55), transparent 60%)",
                "radial-gradient(1px 1px at 78% 18%, rgba(59,130,246,0.45), transparent 60%)",
                "radial-gradient(1.5px 1.5px at 88% 64%, rgba(16,185,129,0.4), transparent 60%)",
                "radial-gradient(1px 1px at 32% 78%, rgba(255,255,255,0.35), transparent 60%)",
                "radial-gradient(1px 1px at 62% 42%, rgba(167,139,250,0.35), transparent 60%)",
                "radial-gradient(1px 1px at 48% 12%, rgba(255,255,255,0.25), transparent 60%)",
              ].join(","),
            }}
          />
          {/* Hairline grid for instrument feel — toned way down so it reads as ambient depth, not a noisy artifact. */}
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0 opacity-[0.015]"
            style={{
              backgroundImage:
                "linear-gradient(rgba(255,255,255,0.6) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.6) 1px, transparent 1px)",
              backgroundSize: "48px 48px",
            }}
          />

          <div className="relative flex items-center justify-between gap-6">
            {/* LEFT */}
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <p className="text-[10px] font-medium text-text-tertiary uppercase" style={{ letterSpacing: "2px" }}>
                  APEX Score
                </p>
                {hasToday && readiness?.confidence_level && (
                  <ConfidenceBadge level={readiness.confidence_level} />
                )}
              </div>
              {score != null ? (
                <>
                  <div className="mt-2 flex items-baseline gap-1">
                    <span
                      className="text-white tabular-nums"
                      style={{
                        fontSize: 64,
                        fontWeight: 200,
                        lineHeight: 1,
                        letterSpacing: "-0.04em",
                        textShadow: "0 0 28px rgba(124,58,237,0.45), 0 0 2px rgba(255,255,255,0.6)",
                      }}
                    >
                      {score}
                    </span>
                    <span className="text-text-tertiary" style={{ fontSize: 18, fontWeight: 300 }}>/100</span>
                  </div>
                  <ConfidenceExplainer readiness={readiness} />
                </>
              ) : (
                <>
                  <p className="mt-3 text-[13px] text-text-secondary leading-snug">
                    Log today's recovery to see your score
                  </p>
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); setRecoveryOpen(true); }}
                    className="mt-3 rounded-full px-3 py-1.5 text-[12px] font-semibold text-white gradient-brand active:scale-[0.98] transition"
                  >
                    Log recovery →
                  </button>
                </>
              )}
            </div>

            {/* RIGHT — ring + halo breathe together as one unit. */}
            <div className="shrink-0 relative score-ring-breathe">
              {(() => {
                const ringHex = score != null ? scoreColor(score) : "#7C3AED";
                const extreme = isExtreme(score);
                const haloAlpha = extreme ? 0.65 : 0.4;
                const haloAlpha2 = extreme ? 0.32 : 0.18;
                return (
                  <>
                    <div
                      aria-hidden
                      className="absolute inset-0 rounded-full score-halo-breathe"
                      style={{
                        background: `radial-gradient(circle, ${scoreColorRgba(score, haloAlpha)} 0%, ${scoreColorRgba(score, haloAlpha2)} 45%, transparent 70%)`,
                      }}
                    />
                    <svg width={ringSize} height={ringSize} viewBox={`0 0 ${ringSize} ${ringSize}`} className="relative overflow-visible">
                      <defs>
                        <linearGradient id="scoreRingGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                          <stop offset="0%" stopColor={ringHex} stopOpacity="0.85" />
                          <stop offset="50%" stopColor={ringHex} stopOpacity="1" />
                          <stop offset="100%" stopColor={ringHex} stopOpacity="0.9" />
                        </linearGradient>
                        <linearGradient id="scoreRingSpec" x1="0%" y1="0%" x2="0%" y2="100%">
                          <stop offset="0%" stopColor="#ffffff" stopOpacity="0.55" />
                          <stop offset="60%" stopColor="#ffffff" stopOpacity="0" />
                        </linearGradient>
                        <filter id="scoreRingGlow" x="-50%" y="-50%" width="200%" height="200%">
                          <feGaussianBlur stdDeviation={extreme ? "3.4" : "2.0"} result="b" />
                          <feMerge>
                            <feMergeNode in="b" />
                            <feMergeNode in="SourceGraphic" />
                          </feMerge>
                        </filter>
                      </defs>
                      <circle
                        cx={ringSize / 2} cy={ringSize / 2} r={ringR}
                        fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth={ringStroke}
                      />
                      {score != null && (
                        <>
                          <circle
                            cx={ringSize / 2} cy={ringSize / 2} r={ringR}
                            fill="none" stroke="url(#scoreRingGrad)" strokeWidth={ringStroke}
                            strokeLinecap="round"
                            strokeDasharray={ringC}
                            strokeDashoffset={ringC * (1 - fillPct)}
                            transform={`rotate(-90 ${ringSize / 2} ${ringSize / 2})`}
                            filter="url(#scoreRingGlow)"
                          />
                          {/* specular highlight arc for instrument depth */}
                          <circle
                            cx={ringSize / 2} cy={ringSize / 2} r={ringR}
                            fill="none" stroke="url(#scoreRingSpec)" strokeWidth={ringStroke * 0.45}
                            strokeLinecap="round"
                            strokeDasharray={`${ringC * 0.18 * fillPct} ${ringC}`}
                            strokeDashoffset={ringC * (1 - fillPct) + ringC * 0.04}
                            transform={`rotate(-90 ${ringSize / 2} ${ringSize / 2})`}
                            style={{ mixBlendMode: "screen" }}
                          />
                        </>
                      )}
                      <text
                        x="50%" y="50%" textAnchor="middle" dominantBaseline="central"
                        className="fill-white" style={{ fontSize: 16, fontWeight: 500 }}
                      >
                        {score ?? "—"}
                      </text>
                    </svg>
                  </>
                );
              })()}
            </div>
          </div>

          {/* Score explainability — ALWAYS visible (collapsed view).
              Surfaces pillar contributions plainly so a LOW-confidence score
              never reads as "all clear". Pillars that haven't been logged
              today show "not logged yet" rather than silently disappearing,
              with one-line framing that the score is incomplete, not okay. */}
          <PillarExplainer readiness={readiness} expanded={expanded} />

          {expanded && readiness?.nudge_message && (
            <div
              className="mt-4 rounded-xl p-3 flex items-start gap-2"
              style={{
                background: "linear-gradient(135deg, rgba(124,58,237,0.08), rgba(59,130,246,0.08))",
                border: "1px solid rgba(124,58,237,0.25)",
              }}
            >
              <Sparkles size={14} className="text-ai shrink-0 mt-0.5" />
              <p className="text-[12px] text-text-primary leading-snug">{readiness.nudge_message}</p>
            </div>
          )}
        </button>

        {/* Coaching feed — daily/weekly cards generated by the AI coach */}
        <CoachingFeed />

        {/* Recovery / Sleep / Mood — primary entry point (no dedicated tab) */}

        <button
          onClick={() => setRecoveryOpen(true)}
          className="w-full flex items-center gap-3 rounded-2xl p-4 text-left active:scale-[0.99] transition"
          style={{
            background: "linear-gradient(135deg, rgba(124,58,237,0.14), rgba(59,130,246,0.10))",
            border: "1px solid rgba(124,58,237,0.35)",
          }}
        >
          <div className="h-10 w-10 rounded-full gradient-brand flex items-center justify-center shrink-0">
            <Heart size={18} className="text-white" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-[14px] font-semibold text-white">
              {hasToday ? "Update today's recovery" : "Log today's recovery"}
            </p>
            <p className="text-[12px] text-text-secondary mt-0.5">
              Sleep, mood &amp; how you feel — feeds your APEX score
            </p>
          </div>
          <span className="text-text-tertiary">›</span>
        </button>

        {/* Two parallel status cards: training + macros (glanceable only —
            details live on their respective tabs). */}
        <WorkoutStatusCard session={todaySession} onNav={() => navigate({ to: "/workouts" })} />

        {/* Macros (estimated from photos) — Home shows aggregate only.
            The per-meal list lives exclusively on the Nutrition tab. */}
        <MacrosCard macros={macros} hydration={hydration} onHydrationTap={() => navigate({ to: "/nutrition" })} />


        {/* Resource library — read-only browse */}
        <button
          onClick={() => navigate({ to: "/resources" })}
          className="w-full flex items-center gap-3 rounded-2xl p-4 text-left active:scale-[0.99] transition"
          style={{ background: "#0F1524", border: "1px solid rgba(255,255,255,0.06)" }}
        >
          <div className="h-10 w-10 rounded-xl gradient-brand flex items-center justify-center shrink-0">
            <BookOpen size={18} className="text-white" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-[14px] font-semibold text-white">Guides & resources</p>
            <div className="flex items-center gap-2 opacity-40 mt-0.5">
              <Lock size={12} className="text-text-tertiary" />
              <span className="text-[12px] text-text-tertiary">Available soon</span>
            </div>
          </div>
          <span className="text-text-tertiary">›</span>
        </button>

      </div>

      {/* Center quick-action launcher (meal + recovery) lives inside BottomNav.
       *  We pipe onLogged → dashboard reloads so the score toast still fires. */}
      <BottomNav onLogged={() => {
        captureScore();
        showToast("Logged");
        reloadReadiness();
        reloadActivity();
        reloadMacros();
        pollScoreChange();
      }} />

      {/* Local modals used by the "Log recovery" / "Log meal" buttons elsewhere on Home. */}
      <RecoveryLogModal open={recoveryOpen} onClose={() => setRecoveryOpen(false)} onSaved={() => { captureScore(); showToast("Recovery logged"); reloadReadiness(); reloadActivity(); pollScoreChange(); }} />
      <MealLogModal open={mealOpen} onClose={() => setMealOpen(false)} onSaved={() => { captureScore(); showToast("Meal logged"); pollScoreChange(); reloadActivity(); setTimeout(reloadMacros, 4000); }} />


      {toast && (
        <div
          className="fixed left-1/2 -translate-x-1/2 bottom-28 z-[101] px-4 py-2 rounded-full text-[13px] text-white animate-fade-up"
          style={{ background: "rgba(15,21,36,0.95)", border: "1px solid rgba(124,58,237,0.4)", backdropFilter: "blur(20px)" }}
        >
          ✓ {toast}
        </div>
      )}
    </div>
  );
}

function ConfidenceBadge({ level }: { level: "HIGH" | "MEDIUM" | "LOW" }) {
  const color = level === "HIGH" ? "#10B981" : level === "MEDIUM" ? "#F59E0B" : "#8892A4";
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[9px] font-semibold uppercase"
      style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)", color, letterSpacing: "1px" }}
    >
      <span className="h-1.5 w-1.5 rounded-full" style={{ background: color }} />
      {level}
    </span>
  );
}

/** Inline explanation for the confidence badge so "HIGH" never reads as
 *  "your score is good". Lists which pillars actually fed today's number. */
function ConfidenceExplainer({ readiness }: { readiness: TodayReadiness }) {
  const level = readiness?.confidence_level ?? null;
  const breakdown = readiness?.pillar_breakdown ?? null;
  const logged = PILLAR_META.filter((p) => {
    const v = breakdown?.[p.key];
    return typeof v === "number" || (typeof v === "string" && v !== "" && v !== "—");
  }).map((p) => p.label);

  const phrase =
    level === "HIGH" ? "High confidence" :
    level === "MEDIUM" ? "Medium confidence" :
    level === "LOW" ? "Low confidence" : "Confidence";

  const basis =
    logged.length === 0
      ? "nothing logged yet today"
      : logged.length === 1
        ? `based on ${logged[0]}`
        : `based on ${logged.slice(0, -1).join(", ")} & ${logged[logged.length - 1]}`;

  return (
    <p className="mt-3 text-[11px] text-text-tertiary leading-snug max-w-[240px]">
      <span className="text-text-secondary">{phrase}</span> — {basis}.
    </p>
  );
}

function MetricRow({
  color, name, value, trend, note, last, hideNote,
}: {
  color: string;
  name: string;
  value: string;
  trend: "up" | "stable" | "down";
  note: string;
  last?: boolean;
  hideNote?: boolean;
}) {
  const trendChar = trend === "up" ? "↑" : trend === "down" ? "↓" : "→";
  const trendColor = trend === "up" ? "#10B981" : trend === "down" ? "#EF4444" : "#F59E0B";
  return (
    <div
      className="py-3"
      style={!last ? { borderBottom: "1px solid rgba(255,255,255,0.05)" } : undefined}
    >
      <div className="flex items-center gap-2.5">
        <span className="h-2 w-2 rounded-full shrink-0" style={{ background: color }} />
        <span className="text-[13px] text-white flex-1">{name}</span>
        <span className="text-[13px] font-semibold text-white tabular-nums">{value}</span>
        <span className="text-[13px] font-semibold tabular-nums" style={{ color: trendColor }}>
          {trendChar}
        </span>
      </div>
      {!hideNote && note && <p className="ml-[18px] mt-1 text-[11px] text-text-tertiary">{note}</p>}
    </div>
  );
}


function MacrosCard({ macros, hydration, onHydrationTap }: { macros: MacroSummary | null; hydration: HydrationSummary | null; onHydrationTap: () => void }) {
  const target = macros?.target_calories ?? null;
  const consumed = macros?.consumed_calories ?? 0;
  const hasAny = (macros?.meals_estimated ?? 0) > 0;
  const pct = target ? Math.min(100, Math.round((consumed / target) * 100)) : 0;

  return (
    <div className="rounded-2xl p-5" style={{ background: "#0F1524", border: "1px solid rgba(255,255,255,0.06)" }}>
      <div className="flex items-center justify-between">
        <h3 className="text-[16px] font-bold text-white">Macros</h3>
        <span className="text-[10px] uppercase tracking-wider text-text-tertiary">Estimated</span>
      </div>

      {!hasAny ? (
        <p className="mt-3 text-[13px] text-text-secondary">Log a meal to see your progress.</p>
      ) : (
        <>
          <p className="mt-3 text-[14px] text-text-primary">
            <span className="text-2xl font-semibold tabular-nums">{consumed.toLocaleString()}</span>
            <span className="text-text-tertiary"> of {target ? target.toLocaleString() : "—"} kcal</span>
          </p>
          {target && (
            <div className="mt-3 h-1.5 w-full rounded-full overflow-hidden" style={{ background: "rgba(255,255,255,0.06)" }}>
              <div className="h-full gradient-brand transition-all" style={{ width: `${pct}%` }} />
            </div>
          )}
          <div className="mt-4 grid grid-cols-3 gap-3 text-[12px]">
            <MacroLine label="Protein" v={macros!.consumed_protein_g} t={macros!.target_protein_g} color="#F59E0B" />
            <MacroLine label="Carbs"   v={macros!.consumed_carbs_g}   t={macros!.target_carbs_g}   color="#10B981" />
            <MacroLine label="Fat"     v={macros!.consumed_fat_g}     t={macros!.target_fat_g}     color="#3B82F6" />
          </div>
          <p className="mt-3 text-[11px] text-text-tertiary">
            Estimates from photo analysis — useful for trends, not precise tracking.
          </p>
        </>
      )}

      {/* Inline hydration indicator — display only; tap routes to Nutrition.
          Chose inline-on-Macros (vs separate card) to avoid crowding Home. */}
      {hydration && (
        <button
          onClick={(e) => { e.stopPropagation(); onHydrationTap(); }}
          className="mt-4 w-full flex items-center justify-between rounded-xl px-3 py-2 active:scale-[0.99] transition"
          style={{ background: "rgba(59,130,246,0.08)", border: "1px solid rgba(59,130,246,0.25)" }}
          aria-label="Hydration today — open Nutrition"
        >
          <span className="flex items-center gap-2 text-[12px] text-text-primary">
            <Droplet size={13} className="text-sleep" />
            <span className="tabular-nums">
              {(hydration.consumed_ml / 1000).toFixed(hydration.consumed_ml >= 1000 ? 1 : 2)}L
              {hydration.target_ml ? ` / ${(hydration.target_ml / 1000).toFixed(1)}L` : ""}
            </span>
            <span className="text-text-tertiary">water</span>
          </span>
          <span className="text-text-tertiary text-[12px]">›</span>
        </button>
      )}
    </div>
  );
}

/** Glanceable training status. Mirrors MacrosCard's weight; never shows
 *  exercise lists or set/rep detail (that's the Training tab's job). */
function WorkoutStatusCard({ session, onNav }: { session: { rest: boolean; session_name: string | null; doneSets: number; totalSets: number } | null; onNav: () => void }) {
  let title = "Today: Training";
  let sub = "Open the training tab to start.";
  if (!session) {
    title = "Today: Training";
    sub = "Open the training tab to start.";
  } else if (session.rest) {
    title = "Today: Rest day";
    sub = "Want to train anyway?";
  } else {
    const name = session.session_name || "Session";
    const status = session.totalSets === 0 ? "" : session.doneSets === 0 ? "not started" : session.doneSets >= session.totalSets ? "complete" : `in progress · ${session.doneSets}/${session.totalSets} sets`;
    title = `Today: ${name}`;
    sub = status || "Open the training tab.";
  }
  return (
    <button
      onClick={onNav}
      className="w-full flex items-center gap-3 rounded-2xl p-4 text-left active:scale-[0.99] transition"
      style={{ background: "#0F1524", border: "1px solid rgba(255,255,255,0.06)" }}
    >
      <div className="h-10 w-10 rounded-xl flex items-center justify-center shrink-0" style={{ background: "rgba(245,158,11,0.15)", border: "1px solid rgba(245,158,11,0.3)" }}>
        <Dumbbell size={16} className="text-warning" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-[14px] font-semibold text-white truncate">{title}</p>
        <p className="text-[12px] text-text-secondary mt-0.5 truncate">{sub}</p>
      </div>
      <span className="text-text-tertiary">›</span>
    </button>
  );
}

/** Always-visible pillar breakdown. For each pillar we either show today's
 *  contribution OR an explicit "not logged yet" framing — so a LOW-confidence
 *  score reads as incomplete, not reassuring. Tapping the card still expands
 *  the wider readout with the nudge message. */
function PillarExplainer({ readiness, expanded }: { readiness: TodayReadiness; expanded: boolean }) {
  const breakdown = readiness?.pillar_breakdown ?? null;
  const conf = readiness?.confidence_level ?? null;
  const status = PILLAR_META.map((p) => {
    const v = breakdown?.[p.key];
    const has = typeof v === "number" || (typeof v === "string" && v !== "" && v !== "—");
    return { ...p, value: has ? String(v) : null, logged: has };
  });
  const missing = status.filter((s) => !s.logged).map((s) => s.label);
  const incompleteFraming =
    missing.length === 0
      ? null
      : conf === "LOW" || missing.length >= 3
        ? `${missing.slice(0, 2).join(" and ")}${missing.length > 2 ? ` (+${missing.length - 2} more)` : ""} haven't been logged yet — your score will get more accurate as you log them.`
        : `Still missing today: ${missing.join(", ")}.`;

  if (!expanded) {
    return (
      <div className="mt-4">
        <div className="flex flex-wrap gap-1.5">
          {status.map((s) => (
            <span
              key={s.key}
              className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium"
              style={{
                background: s.logged ? "rgba(255,255,255,0.05)" : "rgba(255,255,255,0.02)",
                border: `1px solid ${s.logged ? "rgba(255,255,255,0.08)" : "rgba(255,255,255,0.05)"}`,
                color: s.logged ? "#F0F4FF" : "#4A566A",
              }}
            >
              <span
                className="h-1.5 w-1.5 rounded-full"
                style={{
                  background: s.logged ? scoreColor(Number(s.value)) : "#4A566A",
                  boxShadow: s.logged ? `0 0 6px ${scoreColorRgba(Number(s.value), 0.55)}` : undefined,
                }}
              />
              {s.label}
              {s.logged ? <span className="tabular-nums opacity-70">{s.value}</span> : <span className="opacity-70">— not logged</span>}
            </span>
          ))}
        </div>
        {incompleteFraming && (
          <p className="mt-2 text-[11px] text-text-tertiary leading-snug">{incompleteFraming}</p>
        )}
      </div>
    );
  }

  return (
    <div className="mt-5 overflow-hidden" style={{ animation: "fade-up 0.3s ease both" }}>
      {status.map((s, i) => (
        <MetricRow
          key={s.key}
          color={s.logged ? scoreColor(Number(s.value)) : "#4A566A"}
          name={s.label}
          value={s.logged ? s.value! : "not logged yet"}
          trend="stable"
          note=""
          hideNote
          last={i === status.length - 1}
        />
      ))}
      {incompleteFraming && (
        <p className="mt-3 text-[12px] text-text-tertiary leading-snug">{incompleteFraming}</p>
      )}
    </div>
  );
}


function MacroLine({ label, v, t, color }: { label: string; v: number; t: number | null; color: string }) {
  return (
    <div className="rounded-xl bg-bg-3/30 p-2.5">
      <p className="text-[10px] text-text-tertiary uppercase tracking-wider">{label}</p>
      <p className="mt-1 text-[13px] font-semibold tabular-nums" style={{ color }}>
        {Math.round(v)}<span className="text-text-tertiary text-[11px]"> / {t ? Math.round(t) : "—"}g</span>
      </p>
    </div>
  );
}
