# Apex — Whoop Obsidian Revamp

A full UI/UX redesign of every screen around a near-black canvas, electric data accents, and a persistent AI decision layer. Inspired by Whoop's data density and Bevel's clinical calm.

## Design system (foundation)

**Color tokens** (rewrite `src/styles.css` + `src/components/dashboard/tokens.ts`)
- `--bg-base` `#0A0A0A` — page
- `--bg-surface` `#141416` — cards
- `--bg-elevated` `#1C1C1F` — modals, sheets, hover
- `--border-hairline` `#26262A` (1px) / `--border-strong` `#3A3A3F`
- `--text-primary` `#F5F5F7` / `--text-secondary` `#A1A1A6` / `--text-tertiary` `#6E6E73`
- `--accent-data` `#00E5A0` (recovery / positive metrics, ring fills)
- `--accent-signal` `#7DF9FF` (AI insights, coach voice, links)
- `--accent-warn` `#FFB627` / `--accent-strain` `#FF5A5F`
- Ring gradients: `conic-gradient(from -90deg, #00E5A0, #7DF9FF)`

**Typography** — Space Grotesk (display/metrics) + DM Sans (body/UI). Loaded via `<link>` in `__root.tsx`. Tabular numerals for all metrics. Sizes: 10/12/14/16/20/28/40/56 px. No bold; weight 500 max for body, 600 for metric numerals.

**Motion** — 180ms standard ease, 320ms spring on data updates, ring sweep on mount.

## AI decision layer (new pattern)

A `DecisionPanel` component pinned to the top of every primary screen:
- Single-sentence AI brief ("Recovery's at 62 — keep training, but cap RPE at 7.")
- 1–3 contextual action chips ("Log breakfast", "Start session", "Move workout")
- Confidence dot + "Why" affordance → opens reasoning sheet
- Same component, screen-specific content driven by Coach functions

## Screen redesigns

**Dashboard (`_authenticated/dashboard.tsx`)**
- DecisionPanel → Today ring trio (Recovery / Fuel / Strain) at 180px, conic gradients, tabular % inside
- Below: 2-col metric strip (Sleep, HRV, Steps, Protein) with sparklines
- "This Week" → 7-day bar grid, hairline borders, accent fills for completed days
- Insights → stacked editorial cards, no rounded-3xl, 12px radius max

**Coach (`coach.tsx`)**
- Full-bleed chat surface, AI Elements `Conversation` + `Message` + `PromptInput`
- Signal-cyan assistant text, no bubble; user messages in elevated surface
- Sticky DecisionPanel header with safe-area inset
- Quick-prompt chips above composer

**Nutrition (`nutrition.tsx`)**
- DecisionPanel → macro rings (P/C/F) horizontal, target vs actual
- Meal timeline (vertical rail), tap → MealDetailModal restyled to elevated surface
- All helper/snackbar/link text uses `--text-secondary`, never accent

**Workouts (`workouts.tsx`)**
- DecisionPanel → "Today's session" hero card with strain forecast
- Exercise list as dense rows (Whoop-style), set × rep × load in tabular
- Empty state: cyan outline ring

**Settings / Resources / Trust / Health-data / Onboarding / Meet-coach**
- Adopt new tokens, restyle headers, cards, form controls (input bg `--bg-surface`, border hairline, focus ring signal-cyan)
- Onboarding: full-screen panels, large display type, single CTA per step

**Navigation (`DashboardNav.tsx`)**
- Floating bottom bar, `--bg-elevated` with hairline top border, blur backdrop
- 5 tabs + center "+" → QuickActionSheet restyled
- Active state: signal-cyan dot under icon, no fill

## Components touched

Tokens/system: `styles.css`, `tokens.ts`, `text.ts`, `__root.tsx` (font links)
New: `src/components/DecisionPanel.tsx`, `src/components/MetricRing.tsx` (replaces ad-hoc rings), `src/components/Sparkline.tsx`
Restyled: `Dashboard*`, `Header`, `TopBar`, `BottomNav`, `DashboardNav`, `TodayCard`, `ApexScoreCard`, `ContextCard`, `Insights`, `MetricCards`, `MomentumBar`, `ThisWeek`, `WhatApexKnows`, `QuickActions`, `QuickActionSheet`, `MealDetailModal`, `NutritionDateHeader`, `RingChart`, `AIOrb`, `FloatingCoach`, `CoachingFeed`, `LogModals`, `ApexStreakStrip`
Routes: all under `src/routes/` except generated files

## Out of scope

- Backend / edge functions / DB schema unchanged
- AI brief copy will use existing coach functions; no new model calls this pass
- Visual regression baselines will be regenerated after redesign lands (`bun run test:visual:update`)
- Lint rule for `text-text-accent` stays; new `--accent-signal` (cyan) replaces purple

## Rollout

Single PR, structured per screen. Order: tokens → DecisionPanel → Dashboard → Nav → Coach → Nutrition → Workouts → secondary screens → regenerate visual baselines.
