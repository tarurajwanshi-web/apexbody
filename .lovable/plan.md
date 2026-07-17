# APEX Royal Blue + WHOOP-Grade Rebuild — Single Commit

Six coordinated changes across tokens, auth, onboarding, legal routing, settings, and app-wide color propagation. No edge functions, no migrations, no schema changes. Every profile column currently written continues to be written.

---

## Part 1 — Design tokens (`src/styles.css`)

Rewrite `:root` + `@theme inline`. Keep every existing token NAME (so downstream keeps compiling); swap VALUES.

**Surfaces** (cool blue-grey charcoals):
- `--bg-0 #101518`, `--bg-1 #1A2126`, `--bg-2 #232B31`, `--bg-3 #2C363D`

**Text**: primary `#F0F0F5`, secondary `#A8A8C8`, tertiary `#6B6D82`, quaternary `#3E4052`

**Borders**: hairline `rgba(255,255,255,0.06)`, subtle `.10`, strong `.16`

**Signature — royal blue**:
- `--brand-100 #E8EDFF`, `--brand-300 #8B9FFF`, `--brand-500 #4F6BF6`, `--brand-600 #3D51D9`
- `--brand-glow rgba(79,107,246,0.18)`
- `--brand-gradient linear-gradient(135deg,#4F6BF6 0%,#8B9FFF 100%)`

**Teal secondary**: `--teal-300 #7DD3C0`, `--teal-500 #2DD4BF`, `--teal-glow rgba(45,212,191,0.12)`

**Ring semantics** (traffic light, WHOOP-pattern — never deviate):
- high `#22C55E` / soft `#86EFAC`
- medium `#EAB308` / soft `#FDE047` (deeper mustard, not raw yellow)
- low `#EF4444` / soft `#FCA5A5`

**Semantic UI**: `--success #22C55E`, `--warn #EAB308`, `--danger #EF4444`

**Legacy shim repoint** (kill all amber/violet residue): `--ai-signal`, `--ai-signal-glow`, `--sleep-blue`, `--primary`, `--text-accent`, `--amber-*`, `--amber-gradient` → brand tokens. `--hrv-teal` → teal-500. `--gradient-brand` and `--gradient-text` utilities → `var(--brand-gradient)`. Add `--shadow-glow-brand`.

**Typography — two-font system**:
- `--font-sans: 'Inter', -apple-system, system-ui, sans-serif`
- `--font-numeric: 'JetBrains Mono', 'SF Mono', 'Roboto Mono', ui-monospace, monospace`
- Load JetBrains Mono weights 200/300/400/500 via `<link>` in `src/routes/__root.tsx` head (project has no root `index.html`; TanStack Start head owns links per the tailwind4 remote-imports rules).
- Type scale (CSS custom props + matching `@utility` classes): `text-display`, `text-hero`, `text-title`, `text-body`, `text-body-sm`, `text-label` on `--font-sans`; `text-numeric` (48/300/-.02em) and `text-numeric-lg` (72/200) on `--font-numeric` with `font-feature-settings: "tnum"; font-variant-numeric: tabular-nums`.

**Spacing** `--space-1..16`, **radii** sm/md/lg/xl/pill, **shadows** inset-top/card/glow-brand/glow-teal, **motion** ease-standard/decel + dur-fast/med/slow/hero (1600ms).

**Ambient background** on `html, body, #root`:
```
radial-gradient(ellipse 80% 50% at 50% 0%, rgba(79,107,246,0.05), transparent 60%),
radial-gradient(ellipse 60% 40% at 10% 100%, rgba(45,212,191,0.03), transparent 60%),
linear-gradient(180deg, #283339 0%, #101518 100%);
background-attachment: fixed;
```

Preserve animations, `legal-prose`, safe-area utilities.

---

## Part 2 — Ring color helper (`src/lib/ringColor.ts`, new)

```ts
export function ringGradient(score: number | null): string { … }
export function ringGlow(score: number | null): string { … }
```
Thresholds: ≥67 green, 34–66 yellow, <34 red, null grey. Every ring in the app consumes these — no hardcoded ring color anywhere.

---

## Part 3 — Auth screen (`src/routes/index.tsx`)

Full rebuild against tokens.

- Root: viewport-centered column, max-w 380px, `animate-fade-up` (dur-slow / ease-decel).
- Wordmark **APEX** in `text-display`. Sub `ADAPTIVE PERFORMANCE COACH` (`text-label text-tertiary`, mt space-2). Remove "SHIELD + INTELLIGENCE" and "Powered by Anthropic".
- **DemoRing** inline SVG 200px, track stroke 4 in `--border-hairline`, progress arc 0→74% with `<linearGradient>` derived from `ringGradient(74)` (green), `stroke-linecap="round"`, filter `ringGlow(74)`. Center `74` in `text-numeric-lg` (visibly monospace, distinct from body). 6px endpoint dot pulsing opacity 0.7↔1.0 over 2.4s.
- **Motion**: mount count-up 0→74 over 1600ms `cubic-bezier(0.16,1,0.3,1)` synced with `stroke-dashoffset`. After settle, arc opacity 0.85↔1.0 and glow blur 30↔46px on 4s sine cycle. Dot keeps 2.4s pulse.
- Tagline: "Your body speaks." / "We listen." (`text-body text-secondary`, line-height 1.7, mt space-10).
- **Buttons** (stack, gap space-3):
  - Google: bg `#FFFFFF`, text `#0A0B12`, height **exactly 52px**, radius-md, icon + gap space-3, `shadow-inset-top` with `rgba(255,255,255,0.4)`. Press → `#F3F3F5`.
  - Apple: `bg-2`, `border-subtle`, `text-primary`, 52px, radius-md, shadow-inset-top. Press → `bg-3`.
  - Email: text button "Continue with email" (`text-body-sm text-tertiary`, mt space-4). Tap → inline expand (dur-med ease-decel) to input (`bg-2`, `border-subtle`, h-48, radius-md) + "Send sign-in link" (h-48, `--brand-gradient`, white weight 500, press `--brand-600`). Uses existing `supabase.auth.signInWithOtp({ email, options: { emailRedirectTo: window.location.origin } })`. Success → confirmation + "Send another link" reset. Error toast preserved.
- **Legal footer**: "By continuing you agree to our Terms and Privacy Policy." explicit `text-body-sm text-quaternary` (fixes ~15px bug). "Terms" → `/terms`, "Privacy Policy" → `/privacy` (plain `<Link>`, underlined, `text-tertiary`). Bottom padding space-6.
- Session-check redirect and OAuth `signInWithOAuth` handlers preserved unchanged.

---

## Part 4 — Onboarding rebuild (`src/routes/_authenticated/onboarding.tsx`)

9 → 8 steps. Every step fits iPhone SE (667pt) without scroll. `TOTAL = 8`; progress bar 12.5% increments using `--brand-gradient`; header "STEP N OF 8" with N in `--font-numeric`.

**Step 1 — About you**: name (label above field), age (numeric + "yrs"), sex (M/F pills, h-44 radius-pill). Helper: "For accurate calorie targets."

**Step 2 — "How long have you been training, {name}?"** / "Shapes how we talk to you." Three cards Beginner / Intermediate / Advanced with new copy. Selected: 1px `--brand-500` + `--brand-glow`.

**Step 3 — "What's your goal, {name}?"** / "We'll tune training and nutrition around this." Five cards (existing `GOALS`), sentence-cased.

**Step 4 — Training days**: 7 day-circles 48px radius-pill (M T W T F S S). Unselected `bg-1` + `border-subtle` + `text-secondary`; selected `--brand-gradient` fill + white weight 500. Below: "{n} days / week" in `text-title` with n in numeric font. Helper: "Pick at least one day to continue." Writes `training_day_codes` + derived `training_days_per_week`.

**Step 5 — Setup** (3 cards only, delete Home gym + Limited):
- Commercial gym → `commercial_gym`
- Dumbbells only → `home_gym_db_only`
- Bodyweight only → `bodyweight_only`

**Step 6 — Body basics**: weight + kg/lb segmented pill (selected `--brand-gradient`, white weight 500), lb→kg × 0.4536. Height: cm → single input; in → **two inputs ft + in**, `cm = ft*30.48 + in*2.54` (fixes existing bug where "5 in" stored 12.7 cm). Nothing else on screen.

**Step 7 — "How do you eat, {name}?"** / "So we can time your meals right." 2×2 grid of `EATING_PATTERNS`. Selected: brand-highlighted card. Helper: "You can change this any time in Settings." Writes `eating_pattern`.

**Step 8 — Target**: title varies by goal (fat_loss / muscle_gain|strength / recomposition / athletic_performance sub-copy). Target weight numeric, unit inherited from Step 6. "How fast?" label + **three vertical pill buttons** (delete slider): Steady 0.15%/week, Standard 0.25%/week, Aggressive 0.5%/week. Sign flipped by goal (fat_loss negative; muscle_gain/strength positive; recomposition/athletic null-safe → Standard default persisted on submit even if untapped, so engines never see null).

**Review — "Ready, {name}?"** — table of every captured field. Button "Build my plan" full-width h-52 radius-md `--brand-gradient` white weight 500 shadow-inset-top.

**Removed from onboarding but written to keep engines happy**: `body_fat`, DEXA lean mass, tape → null. `coaching_time` default `'08:00'` if unset. `timezone` via existing `getBrowserTimezone()`.

**Copy pass**: interpolate name only in Steps 2, 3, 7. Sentence case, no emoji/markdown. Replace robotic strings per spec.

**Reset mode**: `minStep = isReset ? 3 : 1` preserved. `canContinue` split per-step.

---

## Part 5 — Legal routing + auth gate

**5a. `src/routes/_authenticated/route.tsx`** — extend `beforeLoad`: if `profile_completed_at` null AND `disclaimer_accepted_at` null → `/disclaimer`; else if `profile_completed_at` null → `/onboarding` (exempting `/onboarding` itself to avoid loop). Current gate already close; adjust exempt list.

**5b. Legal pages** (`privacy.tsx`, `terms.tsx`, `health-data.tsx` — shared `LegalShell`): back chevron becomes `router.history.length > 1 ? router.history.back() : navigate({ to: fallback })`. Fallback: disclaimer_accepted_at null → `/disclaimer`; else authenticated → `/settings`; else → `/`.

**5c. Auth-screen legal links**: plain `<Link>`; browser history returns to `/` naturally.

---

## Part 6 — Settings (`src/routes/settings.tsx`)

New **"Precision"** group above "Recovery tracking method":
- **Body composition** → existing `/settings/body-composition` (already scaffolded). Header copy: "Optional — add these to sharpen your calorie targets. Otherwise we adapt from your weekly weight trend." Reuses body-fat slider + stub upload + optional tape.
- **Connect device** → existing `/settings/device`. Copy: "Coming with the iOS app. For now, use the daily check-in to log recovery." No fake vendor buttons.

All other sections preserved.

---

## Part 7 — App-wide color propagation (token-level only)

Kill the visible seam. NO structural changes — color only:
- `src/components/dashboard/tokens.ts` — every hardcoded violet/`#8B7FF7`/purple → `var(--brand-500)` / `var(--brand-gradient)` / `var(--brand-glow)`.
- `src/routes/workouts.tsx`, `nutrition.tsx`, `coach.tsx` — same sweep.
- Any `src/components/dashboard/*` with hardcoded violet — same.
- Every ring render (dashboard `HeroRing`, previews) consumes `ringGradient(score)` + `ringGlow(score)`. No hardcoded ring color.

Structural work on those routes (Home density, PR celebration, Weekly Review, Fuel logging) is deferred.

---

## Out of scope
- Edge functions, migrations, `.env`, `supabase/*`
- New npm dependencies (JetBrains Mono via CDN `<link>`, not a package)
- Structural component rework beyond color on dashboard/workouts/nutrition/coach

---

## Verification checklist

1. `rg "amber|#F5A524|#FFC97A|violet|purple|#8B7FF7" src/` → no hits outside comments.
2. JetBrains Mono `<link>` present in `__root.tsx` head; auth "74" visibly monospace.
3. Fresh signup → 8 steps → all 13 profile columns non-null.
4. 5 ft 10 in → `measurement_height_cm ≈ 177.8`.
5. `equipment_access ∈ {commercial_gym, home_gym_db_only, bodyweight_only}`; `generate-plan` accepts.
6. `target_rate_pct` never null; sign matches goal.
7. Legal back nav: disclaimer → Privacy → back → disclaimer. Auth (logged out) → Terms → back → `/`. Settings → Privacy → back → Settings.
8. `/dashboard` mid-onboarding redirects to `/onboarding`.
9. Auth ring green (74≥67), royal-blue buttons/glows, count-up on mount, breathing after.
10. Dashboard HeroRing adapts: seed readiness 25 red, 55 yellow, 82 green.
11. Ambient bg cool charcoal `#283339 → #101518` with royal-blue top tint, teal bottom-left.
12. Legal footer text 13px; Google/Apple buttons exactly 52px.
13. Every onboarding step fits iPhone SE without scroll.
14. Every visible number uses `--font-numeric` (scores, weight, macros, PRs, timers, %s, step counters).
15. `bun run test:visual` and `bun run lint:ui` pass or baselines regenerated intentionally.
