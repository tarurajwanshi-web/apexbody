
## Scope confirmation

- Only files touched: `src/routes/_authenticated/dashboard.tsx` and files under `src/components/dashboard/`.
- Zero changes to: `src/routes/nutrition.tsx`, `src/routes/workouts.tsx`, `src/routes/coach.tsx`, `src/routes/settings.tsx`, `src/routes/_authenticated/onboarding.tsx`, any other route, any Edge Function, any DB table, any RLS policy, score calculation, onboarding, or any component outside `src/components/dashboard/`.
- The shared `src/components/BottomNav.tsx` is used by other pages (nutrition, workouts). To honor "do not touch other pages" while still delivering the 5-tab spec, I will NOT edit that file. Instead I will add a dashboard-only nav component (`DashboardNav.tsx`) used only inside `dashboard.tsx`. Other pages keep their existing BottomNav exactly as-is.

## Files I will change

Edited:
- `src/routes/_authenticated/dashboard.tsx` — rewrite the page composition to use the new sections; swap `BottomNav` for `DashboardNav`; keep `RecoveryLogModal`/`MealLogModal` usage; keep data loader (`loadDashboardData`) and `useAutoRefreshOnVisible`.
- `src/components/dashboard/tokens.ts` — add the typography + ring + spectrum color constants from the spec (text tiers, ring colors, zone colors, spectrum stops, card radii/padding) so all sub-components share them.

Created:
- `src/components/dashboard/Header.tsx` — greeting + day-phase subline + avatar initials circle. No "log recovery" button.
- `src/components/dashboard/TodayCard.tsx` — "TODAY" label, three 82×82 SVG rings (Recovery / Fuel / Effort) using the same SVG approach as nutrition's `RingChart` (own copy, no import from nutrition), separator, `APEX · <score>` label, deterministic sentence (or `daily_note` first sentence via `cleanCardText` + `firstSentence` from existing `text.ts`).
- `src/components/dashboard/StateCard.tsx` — "YOUR STATE" header with zone chip; gradient spectrum bar with metallic sheen overlay and white marker pin positioned by readiness; four zone labels under bar.
- `src/components/dashboard/MetricCards.tsx` — three equal cards: Weight (delta from last two `body_measurement_events`, colored by `profile.goal`), Consistency (7-day meal-log %), Streak (existing `detectStreak` result).
- `src/components/dashboard/Insights.tsx` — accordion container with three rows (Your Day, Fuel Quality, Well Earned/Recovery Tip). Single-open behavior via local `useState<number | null>`. Inline max-height transition. Uses existing `cleanCardText` / `firstSentence` from `src/components/dashboard/text.ts`.
- `src/components/dashboard/DashboardNav.tsx` — 5-tab nav (Home, Fuel, +, Train, Coach) for use only on the dashboard page. The + button opens the existing `QuickActionSheet` (imported from `@/components/QuickActionSheet`) and wires the same modal set (`MealLogModal`, `RecoveryLogModal`, `BodyMeasurementModal`, `WeightOnlyModal`) the shared BottomNav uses, so logging flow is unchanged.

Removed from dashboard composition (file deletion not required — files stay for safety, just unused on dashboard):
- `TopBar`, `MomentumBar`, `ApexScoreCard`, `StreakNotification`, `ContextCard`, `WhatApexKnows`, `ThisWeek`, `QuickActions` imports are dropped from `dashboard.tsx`.

## Data sources (frontend only — no schema or function changes)

All read via existing `loadDashboardData(userId, tz)` which already returns: `profile`, `readiness`, `nutrition` (today summary + targets), `cards` (coaching cards), `measurements`, `workouts`, `lastLogDate`, plus existing helpers `detectStreak`, `computeMomentum`. New derivations added inline in `dashboard.tsx`:

- Pillar scores for rings: read from `data.readiness` (recovery/nutrition/training pillar fields already loaded).
- Weight delta: last two entries of `data.measurements` sorted desc.
- 7-day consistency: count distinct days in `data.nutrition.weekly` (or equivalent already loaded) — if not present I derive from existing `cards`/`weeklyNutrition` field already in `DashboardData`; if missing I add a small Supabase query inside `dashboard-data.ts` (no schema change, just an extra SELECT on `nutrition_daily_summaries` for the last 7 days). This is the only possible touch outside `src/components/dashboard/` and `dashboard.tsx`. Confirm if that's acceptable, otherwise I'll compute consistency from already-loaded fields and accept a lower-fidelity number.
- "Well Earned" state: training logged today (`data.workouts`), readiness > 70, today's carbs < 80% target (from `data.nutrition`).

## Typography / card tokens added to `tokens.ts`

```
text1=#EEEEF6  text2=#A8A8C8  text3=#6668A0  label=#44466A  disabled=#2A2C3A
ringRecovery=#7B6EF6  ringFuel=#F5A623  ringEffort=#2DD4A0
zoneRecover=#E05252  zoneSteady=#F5A623  zoneBuild=#2DD4A0  zonePeak=#7B6EF6
spectrum = linear-gradient(90deg,#4A1010,#7A2A0A,#B05010,#C8820A,#1A9A6A,#2A7ACC,#6A54E0)
card: radius 22 (nested 14), border 0.5px var(--border same as nutrition), padding 16-18, background matches nutrition card surface
weights: 300 / 400 / 500 only
letter-spacing: -0.4px headlines, 1.8px uppercase
line-height: 1.6 body
```

## Layout order in `dashboard.tsx`

```
Header
TodayCard            (3 rings + APEX sentence)
StateCard            (zone + spectrum)
MetricCards          (Weight | Consistency | Streak)
Insights             (3 expandable rows)
DashboardNav         (fixed bottom, 5 tabs)
+ existing modals (MealLogModal, RecoveryLogModal, BodyMeasurementModal, WeightOnlyModal via DashboardNav)
```

## Out of scope (will not change)

- `src/components/BottomNav.tsx`, `src/routes/nutrition.tsx`, `src/routes/workouts.tsx`, `src/routes/coach.tsx`, `src/routes/settings.tsx`, onboarding, all Edge Functions, all SQL/migrations/RLS, all score logic, `src/integrations/**`, `src/lib/dashboard-state.ts` (kept as-is — only `detectStreak`/`computeMomentum` are consumed).

## Open question before I implement

Consistency metric (7-day meal-log %) needs a 7-day day-count. `loadDashboardData` currently returns today's nutrition summary but I need to verify whether it already includes the last 7 days. If it does not, I'll extend `src/lib/dashboard-data.ts` with one extra SELECT (no schema change). OK to extend that file? If not, I'll derive a best-effort count from already-loaded fields.
