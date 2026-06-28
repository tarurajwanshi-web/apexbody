# Plan: Coach Dashboard — 4 Panels (Single Build)

No schema changes. Reads only. All auth-gated via `requireSupabaseAuth`.

## Files

**New (4)**
- `src/components/dashboard/ExerciseHistoryPanel.tsx`
- `src/components/dashboard/MuscleGroupVolumeGrid.tsx`
- `src/components/dashboard/WeightTrendChart.tsx`
- `src/components/dashboard/TDEETrendChart.tsx`

**Modified (2)**
- `src/lib/coach.functions.ts` — add 4 server fns
- `src/routes/_authenticated/dashboard.tsx` — mount panels with Suspense

**Dependency check**: `recharts` is already used in repo (per `MetricCards`/`Sparkline` ecosystem). I'll verify on build; if missing, `bun add recharts`.

---

## Server functions (`src/lib/coach.functions.ts`)

All four use `.middleware([requireSupabaseAuth])`, no input validator (or empty z.object).

### `getExerciseHistory()`
- Query `workout_set_logs` for `user_id = context.userId`, `entry_date >= today-30d`, `completed = true`
- Cols: `exercise_name, entry_date, weight_kg, reps_completed, rir, muscle_group`
- JS aggregate:
  - Top 5 exercises by set count
  - Per exercise: last 5 sessions (max weight×reps per date), best set this month, 4-week volume & RIR series (ISO week bucket), `rirTrend = week4 - week1`, `deloadSuggested = rirTrend < -1.0`
- Returns `{ exercises: [{ name, lastFiveSessions, bestSet, volumeSeries, rirSeries, rirTrend, deloadSuggested }] }`

### `getMuscleGroupWeeklyVolume()`
- Resolve TZ via `resolveUserTimezone` + `getLocalDateISO`; compute Mon–Sun in user TZ
- Query `workout_set_logs` for current week (completed=true), select `muscle_group`
- Normalize to 6 buckets: chest, back, shoulders, legs (glutes/quads/hamstrings/calves), arms (biceps/triceps/forearms), core (abs/obliques/core)
- Returns `{ groups: { chest, back, shoulders, legs, arms, core } }`

### `getWeightTrend()`
- Query `body_measurement_events` for last 30 days where `weight_kg IS NOT NULL`, ASC
- JS: 7-day rolling avg (use available window for early days); `weightDelta = latest - oldest (≤4wk back)`; `trendArrow` string ("↓ 1.2 kg in 4 weeks", "→ Stable", "↑ 0.5 kg")
- Returns `{ rawWeight, smoothedTrend, weightDelta, trendArrow }`

### `getTDEETrend()`
- Query `nutrition_weekly_reviews` for last 12 weeks; select `week_start_date, blended_tdee`, ASC
- Compute `trendDirection`: compare first-4-weeks avg vs last-4-weeks avg (Δ > +100 → positive; |Δ| ≤ 100 → flat; Δ < -100 → negative)
- Build annotation strings per direction
- Returns `{ weeks, trendDirection, annotation }`

---

## Components

All four:
- `useSuspenseQuery` + `useServerFn`
- `staleTime: 1h`, `gcTime: 2h`
- APEX tokens (`T.surface`, `T.border`, `T.text1/2`)
- Allowed font sizes only: 10/12/14/16/18/20px; no bold variants; no `rounded-3xl`; avoid `text-text-accent` in dashboard scope (lint compliance)

### `ExerciseHistoryPanel.tsx`
Per-exercise card: name + volume sparkline (right) → last 5 sessions list (`date · Xkg × Y @ RIR Z`) → "Best: …" → RIR sparkline (green if `rirTrend ≥ 0`, red if `< 0`) → amber callout if `deloadSuggested`.
Empty state: "Log a few sessions to see your exercise history."

### `MuscleGroupVolumeGrid.tsx`
Fixed order [Chest, Back, Shoulders, Legs, Arms, Core].
Grid: `grid-cols-3 md:grid-cols-6`.
Color: green `#10B981` (10–20), yellow `#D97706` (5–9 or 21–25), red `#EF4444` (<5 or >25).
Cell: muscle label (10px uppercase tracked) · set count (20px) · "sets" (10px).

### `WeightTrendChart.tsx`
Recharts `LineChart`: smoothed line (bold, `T.primary`), raw line (light, dotted). XAxis `date`, YAxis weight. Trend arrow caption beneath.
Empty state: "Log weight measurements to see trends."

### `TDEETrendChart.tsx`
Recharts `LineChart` of `blendedTDEE` per week. Line color from `trendDirection` (green/amber/red). Annotation caption beneath.
Empty state: "Track your nutrition to see TDEE trends."

---

## Dashboard mount (`src/routes/_authenticated/dashboard.tsx`)

After existing `CoachingFeed` block, before the debug seed button:

```tsx
<SectionLabel>Training history</SectionLabel>
<Suspense fallback={<SkeletonRow />}><ExerciseHistoryPanel /></Suspense>

<SectionLabel>This week's volume</SectionLabel>
<Suspense fallback={<SkeletonRow />}><MuscleGroupVolumeGrid /></Suspense>

<SectionLabel>Weight trend</SectionLabel>
<Suspense fallback={<SkeletonRow />}><WeightTrendChart /></Suspense>

<SectionLabel>TDEE trend</SectionLabel>
<Suspense fallback={<SkeletonRow />}><TDEETrendChart /></Suspense>
```

Add imports + `Suspense` from React. `SkeletonRow` = lightweight placeholder div using `T.surface`.

---

## Risks / notes

- Container is `max-w-[480px]`; muscle grid's `md:grid-cols-6` will still render 6 cells but compressed. Acceptable per spec (mobile-first dashboard).
- `nutrition_weekly_reviews.blended_tdee` confirmed in schema (RPC references it).
- `workout_set_logs.muscle_group` present (RIR task added it).
- `body_measurement_events.weight_kg` + `entry_date` confirmed.
- All queries scoped by RLS via `requireSupabaseAuth` context.supabase.