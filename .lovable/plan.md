# APEX Dashboard Redesign — Midnight Bevel

A premium reinvention that returns to a violet/teal-adjacent palette, removes the "signal cyan" electric look, and ships one cohesive design language across **every** screen (Dashboard, Fuel, Train, Coach, Settings, Onboarding).

No code changes in this plan — implementation runs after you approve.

---

## 1. Design language: "Midnight Bevel"

**Palette (locked, used everywhere)**
- Canvas `#0A0E1A` — single background, no per-screen drift
- Surface `#10162A` — primary card
- Surface raised `#161B2E` — nested card / modal
- Hairline `rgba(255,255,255,0.06)` — only border weight used
- Text 1 `#F5F5F7` · Text 2 `#A8ADBD` · Text 3 `#5E6478` · Label `#3E4256`
- Violet `#8B7FF7` — AI, decisions, interactive (single accent)
- Teal `#5FE3C4` — positive metric movement only
- Amber `#F5B544` · Coral `#F2727A` — warning / risk only
- **Removed:** all `#7DF9FF` cyan, `#00E5A0` electric green, neon glows

**Typography (Space Grotesk + DM Sans, disciplined)**
- Hero number: Space Grotesk 500, 72px, tracking −0.04em
- H1: Space Grotesk 500, 28px · H2: 20px · Section label: 11px, tracking 0.18em, uppercase
- Body: DM Sans 400, 15px/1.55 · Meta: 13px · Micro: 11px
- Only weights allowed: 400, 500. No bold/semibold anywhere.

**Surface system**
- Single radius scale: 12 / 16 / 20px (no `rounded-3xl`, no pill chrome)
- One elevation: hairline border + soft inner highlight `inset 0 1px 0 rgba(255,255,255,0.04)` + ambient shadow `0 24px 60px rgba(0,0,0,0.5)`
- Bevel = the inset highlight; that's the whole metaphor. No glow, no gradient borders.
- Glass only on the bottom sheet: `bg-[#10162A]/80 backdrop-blur-2xl`

**Motion**
- 320ms cubic-bezier(0.2, 0.8, 0.2, 1) for state changes
- Hero number counts up once on mount, never loops
- Removed: breathing rings, pulse glows, rotating ambient arcs, shimmer

---

## 2. Dashboard — single hero metric composition

Vertical stack, 430px max width, generous breathing room. No bento, no tiles competing for attention.

```text
┌──────────────────────────────────────┐
│  APEX                       ◐  A    │  ← top bar: wordmark + date + avatar→/settings
│  Friday · Jun 26                     │
│                                      │
│              ╭─────╮                 │
│             │  84  │                 │  ← Readiness hero, 72px number
│              ╰─────╯                 │     thin violet arc 0→score, hairline track
│           READINESS                  │     no breathing, no halo
│                                      │
│  Training load is pulling calories  │  ← Closed-loop sentence, 17px Space Grotesk
│  up 180 kcal. Recovery is steady.   │     This IS the product. One line. Updated daily.
│                                      │
│  ─────────── TODAY ───────────       │
│                                      │
│  Train      Upper push · 45 min      │  ← Quiet row, one line per engine
│  Fuel       1840 / 2400 kcal · 76%  │
│  Recovery   Sleep 7h 20m · HRV 58    │
│                                      │
│  ─────── THIS WEEK ───────           │
│                                      │
│  Load        ▁▂▄▆▅▃▂   moderate ↑   │  ← Sparkline + 1-word state
│  Adherence   89%      on track       │
│  Weight      −0.4 kg  on plan        │
│                                      │
│  ─────── COACH ───────               │
│                                      │
│  ╭──────────────────────────────╮   │
│  │ Pinned · Permission slip     │   │  ← Coaching feed, max 3 visible
│  │ Push carbs to 280g tonight.  │   │     "View all" → coach screen
│  │ Readiness high, glycogen low.│   │
│  ╰──────────────────────────────╯   │
│                                      │
│  ╭──────────────────────────────╮   │
│  │ Today's note                 │   │
│  │ Three weeks of consistent... │   │  (truncated at first sentence)
│  ╰──────────────────────────────╯   │
│                                      │
└──────────────────────────────────────┘
         [Home] [Fuel] (+) [Train] [Coach]
```

**What's removed from current dashboard**
- Momentum bar (weight/training/compliance triplet) — folded into "This week"
- Three-ring metric cards — replaced by quiet rows; the hero ring is the only ring
- "What APEX knows" card — its content becomes the closed-loop sentence
- All cyan accents, all electric green, all breathing animations
- Quick actions grid — replaced by the existing center `+` button

**What's new**
- The closed-loop sentence is the differentiator. One template, four variants — generated from the same readiness/load/nutrition/recovery state already on `DashboardData`.
- Sparklines stay (you have `Sparkline.tsx`) but restyled: 1px stroke, violet, no fill.

---

## 3. Cross-screen unification

Same canvas, same cards, same type scale on every route. Only the content changes.

**Fuel (`/nutrition`)**
- Top: today's macro ring trio collapsed into one combined hero ring (calories), with P/C/F as three thin arcs around it. Same hero treatment as readiness.
- Closed-loop sentence: "Carbs trending low post-training. Next meal should anchor here."
- Meal list: hairline rows, no card chrome per meal. Tap → existing modal.
- Monday auto-trigger banner stays but restyled as a single violet hairline strip.

**Train (`/workouts`)**
- Hero: today's session name + planned volume as the big number (sets or minutes)
- Closed-loop sentence references readiness pulling volume up/down
- Exercise list: same hairline rows

**Coach (`/coach`)**
- Hero: streak number or weeks-on-plan
- Feed of coaching cards using the same card chrome as the dashboard feed
- Decision panel becomes the input bar at the bottom, restyled to match (violet send button, no cyan)
- Safe-area top padding preserved (already fixed)

**Settings + Onboarding**
- Same canvas + hairlines. Onboarding step indicator becomes a single thin violet progress line at the top — no pill chips.

**Bottom nav**
- Identical to current 5-tab structure with raised center `+`
- Active indicator dot recolored violet, inactive icons `#3E4256` (was `#22243A`)
- Center button: violet `#8B7FF7` with same shadow recipe, no cyan ring

---

## 4. The "closed loop" as a first-class UI primitive

Today the four engines (readiness, load, nutrition, recovery) live in separate cards. The premium feel comes from showing they talk to each other.

Introduce one reusable component — a single sentence with four micro-dots in front of it, each dot colored by which engine fired the decision. Used on every screen's hero:

```text
●○○●  Training load is pulling calories up 180 kcal. Recovery is steady.
```

Dot states: filled violet = engine drove this decision, hollow = engine is neutral. No tooltip, no expansion — it's ambient evidence that APEX is reasoning across all four. This is the visual proof of the differentiator.

---

## 5. Implementation scope (when you approve)

**Tokens & CSS (1 file)**
- Rewrite `src/styles.css` palette + remove cyan/electric-green keyframes
- Rewrite `src/components/dashboard/tokens.ts` to match

**Dashboard (1 route + ~6 components)**
- Rewrite `src/routes/_authenticated/dashboard.tsx` to the single-column composition above
- New: `ClosedLoopSentence.tsx`, `HeroRing.tsx`, `QuietRow.tsx`, `WeekStat.tsx`
- Retire: `MomentumBar.tsx`, `MetricCards.tsx`, `WhatApexKnows.tsx`, `ApexStreakStrip.tsx`, `StateCard.tsx` (delete imports, leave files until cleanup pass)
- Keep & restyle: `CoachingFeed.tsx`, `TopBar.tsx`, `BottomSheet.tsx`, `DashboardNav.tsx`

**Cross-screen pass (3 routes)**
- `nutrition.tsx`, `workouts.tsx`, `coach.tsx` — replace per-screen surfaces with the unified hero + quiet-row pattern. No business-logic changes.

**Lint + visual regression**
- Update `scripts/check-ui-consistency.mjs` allowed colors (add `#8B7FF7`, `#5FE3C4`, drop `#7DF9FF`)
- Regenerate Playwright baselines in `tests/visual/__screenshots__/` after the redesign lands

**Untouched**
- All edge functions, server functions, Supabase schema, macro-calculation engine
- All data hooks and `dashboard-data.ts` / `dashboard-state.ts` logic
- `client.ts`, `client.server.ts`, `auth-middleware.ts`, `types.ts`

---

## 6. What you'll see after build

- Dashboard opens to one 72px readiness number and one sentence — silent confidence
- Every other screen feels like the same product: same canvas, same hero treatment, same closed-loop sentence
- Zero neon, zero breathing rings, zero competing accents — violet is the only thing that "speaks"
- The four-engine differentiator is visible on every hero via the dot-prefix sentence

Approve and I'll implement in this order: tokens → dashboard → cross-screen → lint/baselines.