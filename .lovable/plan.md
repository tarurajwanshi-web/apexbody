
# Dashboard Visual Overhaul — Plan

## Scope confirmation

1. ✅ Only `src/routes/_authenticated/dashboard.tsx` is modified (plus new sibling components).
2. ✅ Zero backend changes — no Edge Functions, no migrations, no RLS, no schema edits.
3. ✅ No other page touched (Fuel, Training, Recovery, Settings, Profile, BottomNav all untouched).
4. ✅ State detection logic is 100% frontend — derived in React from existing Supabase tables already accessible via RLS.
5. ✅ Bottom sheet is a new frontend-only component (`useState` open/close, no library, tap-outside + swipe-down to close).

## Files

**New files**
- `src/components/dashboard/TopBar.tsx` — greeting + streak badge (all streak states)
- `src/components/dashboard/MomentumBar.tsx` — 3 metric cards (weight / training / compliance)
- `src/components/dashboard/ApexScoreCard.tsx` — score + status + pillar pills
- `src/components/dashboard/StreakNotification.tsx` — conditional banner (resting / rest day / milestone / ghost return)
- `src/components/dashboard/ContextCard.tsx` — priority router (P0–P7) + 8 sub-renderers
- `src/components/dashboard/WhatApexKnows.tsx` — 3-row signal/confidence panel
- `src/components/dashboard/ThisWeek.tsx` — Week in Review + Next Week's Plan rows (with dotted separator)
- `src/components/dashboard/QuickActions.tsx` — 4-button row
- `src/components/dashboard/BottomSheet.tsx` — reusable slide-up sheet
- `src/lib/dashboard-state.ts` — pure functions: `detectContextState()`, `detectStreakState()`, `computeMomentum()`, time helpers (user-local hour via profile timezone)
- `src/lib/dashboard-data.functions.ts` — single server function `getDashboardData()` that batch-fetches all needed rows for the authed user

**Edited file**
- `src/routes/_authenticated/dashboard.tsx` — replace current visual layout with the 8-section stack. Keeps the route registration, auth gate, and existing data-load entrypoints; removes the old visual blocks (APEX score card, recovery/sleep/mood, macros, CoachingFeed insertion) and replaces with the new components. Existing `CoachingFeed` stays in the codebase but is no longer rendered on the dashboard (per spec — "This Week" rows replace it).

**Not touched**
- All edge functions, all other routes, `BottomNav`, `client.ts`, `types.ts`, `styles.css` design tokens stay as-is (new tokens applied inline within dashboard components to avoid global side effects).

## Design tokens

All `--apex-*` colors, typography rules, card rules, and dotted separators applied via inline `style` props inside dashboard components only. No edits to `src/styles.css` (keeps global theme untouched and isolates the redesign).

## Data flow

One server function `getDashboardData()` calls (with the authed `supabase` client from `requireSupabaseAuth` middleware):

```text
profiles                          → name, goal, eating_pattern, coaching_time, timezone
readiness_scores (today)          → score + pillars
nutrition_daily_summaries (today) → totals + compliance_pct
nutrition_daily_summaries (7d)    → compliance avg
daily_macro_targets (active)      → protein/carbs/fat targets
workout_set_logs (today)          → sets count + most recent entry_time
workout_set_logs (this+last week) → momentum sets delta
daily_coaching_cards (today)      → by card_type
weekly_plans                      → today's planned session (next week for sync row)
body_measurement_events (last 2)  → weight delta
nutrition_meal_full_analysis      → today's meal count, last log date, frequent food_sources
```

Returned as a single typed `DashboardData` object. Component computes derived state via `dashboard-state.ts` pure helpers — no extra round-trips.

## Context card priority resolver

Pure function in `dashboard-state.ts`, returns `{ priority: 'P0'…'P7', props }`. Evaluated in spec order; first match wins. All thresholds (≥90% protein, ≥85% carbs, ≤115% fat, 70% carbs gate, 90-min recovery window, 20:00 / 18:00 / 12:00 hour gates, 2-day ghost) match spec verbatim. Time uses user's `profiles.timezone` (fallback browser tz).

## Streak resolver

Pure function returns one of: `active | silent-miss-1 | resting-miss-2 | protected-rest | milestone-7|14|30|60|100 | reset`. Drives both `TopBar` badge variant and conditional `StreakNotification` render.

## Layout order (top → bottom)

```text
TopBar
MomentumBar (3 cards)
ApexScoreCard
StreakNotification          ← conditional
ContextCard                 ← P0–P7 routed
WhatApexKnows
ThisWeek                    ← hidden if both rows empty
QuickActions
```

`BottomNav` continues to render via the `_authenticated` layout — untouched.

## Bottom sheet

`<BottomSheet open onClose>` portal-free, fixed-position overlay (`role="dialog"`, `aria-modal`). Backdrop click + swipe-down (pointer events Δy > 60px) closes. Used by `ThisWeek` rows to display full `weekly_pattern` / `training_sync` card content with preserved line breaks.

## Quick Actions wiring

Buttons navigate via TanStack `Link` to existing routes where available (`/nutrition` for meal/weigh-in, `/workouts` for sets). Recovery button opens existing recovery flow if present, otherwise no-ops with `aria-disabled` — no new pages.

## Out of scope (explicit)

- No changes to Shield score calculation, RLS, schema, edge functions, or any other route.
- No new dependencies. Pure React + Tailwind + inline styles for tokens.
- `CoachingFeed.tsx` file is left in place (unrendered) to avoid touching unrelated code; can be deleted in a follow-up if desired.

Approve to switch to build mode.
