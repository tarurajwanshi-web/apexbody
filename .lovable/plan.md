# DecisionPanel + Sparkline/MetricRing rollout

Extend the AI decision layer to Coach/Nutrition/Workouts and replace static
`—` placeholders on the dashboard with real trend visuals.

## 1. New shared components

**`src/components/MetricRing.tsx`** — small conic-gradient ring (32/48/72 px)
with a centered numeric value. Props: `value` (0–100 | null), `size`, `label`,
`color` (defaults to T.green → T.primary gradient). Renders a neutral track +
overlay arc; null/0 → empty track with a hairline. Used in DecisionPanel
right slots (Coach readiness, Workouts strain) and inside MetricCards.

**`src/components/Sparkline.tsx`** — pure inline SVG, 7-point default.
Props: `points: (number|null)[]`, `width=80`, `height=24`, `color`, `fill`
(toggle area gradient). Skips null gaps; if all null → renders flat hairline
+ "no data" affordance. Tabular-numerals safe (no text, draws only path).

## 2. Dashboard wiring (`src/components/dashboard/MetricCards.tsx`)

- Each `ValueBlock` gets an optional `trend: (number|null)[]` prop.
- When trend present + has values → render `<Sparkline>` under the sub label.
- When weight delta is null → keep "—" but show 7-day weight `Sparkline` if
  any points exist, replacing the static dash with context.
- Consistency block gets a 7-bar mini bar grid (logged vs not, hairline track).
- New props plumbed from `dashboard.tsx`:
  - `weightTrend`: last 7 weight readings from a new field on `DashboardData`.
  - `consistencyDays`: boolean[7] derived from `recentMeals` (one entry per day).
  - `streakTrend`: optional — skip if data not cheaply available.

**`src/lib/dashboard-data.ts`** — add `weightTrend7d: (number|null)[]` by
selecting last 7 daily weight rows; add `consistency7d: boolean[]` derived
from existing `recentMeals` grouping (no new query — pure transform).

## 3. DecisionPanel on Coach (`src/routes/coach.tsx`)

Insert directly under `<header>`, only in the **unlocked** state (locked
state keeps the existing `LockedHero` to preserve the unlock UX):

```
<DecisionPanel
  eyebrow="TODAY'S BRIEF"
  brief={coachBrief}            // derived locally from activity + last readiness
  confidence={"medium"}         // bumped to "high" if last readiness > 70
  actions={[
    { label: "Plan today", href: "/workouts" },
    { label: "Fuel check", href: "/nutrition" },
  ]}
/>
```

`coachBrief` is computed from existing `activity` (streak / last 7) — no new
network calls. Example: streak ≥ 3 → "You've stacked 3 days. Keep tempo." /
no log today → "No log yet today — start with one quick action."

## 4. DecisionPanel on Nutrition (`src/routes/nutrition.tsx`)

Insert after `NutritionDateHeader` (above the goal-framing line). Brief
derived from existing `macros` + `proteinShort`:

- `proteinShort > 0` → "You're {n}g protein short — pick a high-protein snack."
- compliance ≥ 85 → "Macros locked in. Keep this pattern."
- no meals → "Log your first meal to start today's read."

Actions: `[Log meal, Log water]` (open existing modals via callbacks). Right
slot: small `MetricRing` showing calorie compliance.

## 5. DecisionPanel on Workouts (`src/routes/workouts.tsx`)

Insert after `<header>`, before `<LockBanner>`. Brief derived from `plan` +
`weekLogs`:

- today is rest → "Rest day — protect recovery, hit protein."
- today planned + not started → "Today: {session_name}. ~{n} sets."
- session in progress → "Session live — keep RPE ≤ 8."
- no plan → existing empty-state copy.

Actions:
- planned + not started → `[Start session]` (opens existing pre-check sheet).
- rest day → `[Train anyway]` triggers existing swap path.
- locked → `[See preview]` scrolls to plan.

Right slot: small `MetricRing` with today's planned-set completion %.

## 6. Out of scope

- No backend / edge-function / schema changes.
- No new model calls; briefs are deterministic from data already loaded.
- Visual regression baselines will be regenerated (`bun run test:visual:update`)
  after this lands — same workflow as the previous pass.
- Helper text in Nutrition continues to follow the lint rule (no
  `text-text-accent` for non-AI copy); DecisionPanel itself counts as AI UI.

## Files touched

New: `src/components/MetricRing.tsx`, `src/components/Sparkline.tsx`
Edited: `src/lib/dashboard-data.ts`, `src/components/dashboard/MetricCards.tsx`,
`src/routes/_authenticated/dashboard.tsx`, `src/routes/coach.tsx`,
`src/routes/nutrition.tsx`, `src/routes/workouts.tsx`
