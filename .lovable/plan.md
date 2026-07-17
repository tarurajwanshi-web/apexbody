
# APEX visual + onboarding overhaul

One commit, four coordinated changes. No edge functions, no schema changes. Every profile column currently written continues to be written.

---

## Part 1 — Design tokens (src/styles.css)

Rewrite `:root` and `@theme inline` in `src/styles.css` (single source of truth — no new `tokens.ts`, no tailwind.config file since the project is Tailwind v4 CSS-first). Existing token NAMES kept so downstream components don't break; VALUES swap to the new palette.

**Color additions / changes:**
- `--bg-0: #08090E`, `--bg-1: #0F1116`, `--bg-2: #161822`, `--bg-3: #1E2130`
- Text: `--text-primary #F0F0F5`, `--text-secondary #A8A8C8`, `--text-tertiary #6B6D82`, new `--text-quaternary #3E4052`
- Borders: `--border-hairline`, `--border-subtle`, `--border-strong` (rgba white 0.06 / 0.10 / 0.16)
- Signature amber: `--amber-100/300/500/600` and `--amber-glow`
- Teal: `--teal-300 #7DD3C0`, `--teal-500 #2DD4BF`, `--teal-glow`
- Semantic: `--success #34D399`, `--warn` = amber-500, `--danger #EF6B6B`
- Data-viz: readiness=amber-500, training=#B8A5F0, macros=teal-500, weight=text-primary
- `--text-accent` re-pointed to amber-500 (was violet). Since dashboard components currently use violet-heavy `src/components/dashboard/tokens.ts` hard-coded values, that palette is **out of scope** for this commit (per constraint "do not modify routes other than those named") — tokens.ts stays; only global tokens change. Dashboard visual sweep is a follow-up.
- Legacy shims kept so existing components render: `--ai-signal`, `--ai-signal-glow`, `--sleep-blue`, `--hrv-teal`, `--primary` all repointed to amber (was violet). `gradient-brand` / `gradient-text` utilities re-authored to amber-500 → amber-300.

**Typography tokens (new CSS custom properties + matching `@utility` classes):**
`--text-display` (32/200/0.5em/upper), `--text-hero` (34/300/-0.02em), `--text-title` (22/400/-0.01em), `--text-body` (15/400/1.55), `--text-body-sm` (13/400/1.5), `--text-label` (11/500/0.14em/upper), `--text-numeric` (48/300/tnum), `--text-numeric-lg` (72/200/tnum). Add utilities `text-display`, `text-hero`, `text-title`, `text-body`, `text-body-sm`, `text-label`, `text-numeric`, `text-numeric-lg` that apply size+weight+tracking+`font-feature-settings: "tnum"` on numeric variants.

**Spacing tokens:** `--space-1 … --space-16` in 4px steps.

**Radii:** `--radius-sm 8`, `--radius-md 14`, `--radius-lg 22`, `--radius-xl 32`, `--radius-pill 999`. (Overrides existing smaller values.)

**Shadows:** `--shadow-inset-top`, `--shadow-card`, `--shadow-glow-amber`, `--shadow-glow-teal`.

**Motion:** `--ease-standard`, `--ease-decel`, `--dur-fast/med/slow/hero`.

**Ambient gradient:** applied in `@layer base` on `html, body, #root`:
```
background:
  radial-gradient(ellipse 80% 50% at 50% 0%, rgba(245,165,36,0.04), transparent 60%),
  radial-gradient(ellipse 60% 40% at 10% 100%, rgba(45,212,191,0.03), transparent 60%),
  linear-gradient(180deg, #0A0B12 0%, #08090E 100%);
background-attachment: fixed;
```
Every route inherits it (verified against Dashboard, Workouts, Nutrition, Coach, Settings via preview screenshot in verification step).

Nothing else in styles.css changes (animations, legal-prose, safe-area utilities preserved).

---

## Part 2 — Auth screen (src/routes/index.tsx)

Full rebuild of `AuthScreen`. All values reference tokens.

- Root: full viewport, centered column max-w 380px, `animate-fade-up` (dur-slow / ease-decel).
- Wordmark "APEX" in `text-display`, then "ADAPTIVE PERFORMANCE COACH" in `text-label text-tertiary` (mt space-2). Remove existing "SHIELD + INTELLIGENCE" line.
- **DemoRing** rebuilt as inline SVG: 200px, track stroke 4 border-hairline; progress arc 0→74% stroke 4 with `<linearGradient>` amber-500→amber-300, `stroke-linecap="round"`, `filter: drop-shadow(shadow-glow-amber)`. Center "74" `text-numeric-lg text-primary`. 6px dot at arc endpoint pulsing opacity 0.7↔1.0 over 2.4s. On mount: `strokeDasharray` animates 0→74 over `--dur-hero` with `--ease-decel`, once.
- Tagline "Your body speaks." newline "We listen." `text-body text-secondary` line-height 1.7, mt space-10.
- Buttons (stack, gap space-3):
  - Google: bg #FFFFFF, text #0A0B12, 52px, radius-md, icon+gap space-3, `shadow-inset-top`. Press → #F3F3F5.
  - Apple: bg-2, border-subtle, text-primary, 52px, radius-md. Press → bg-3.
  - Email: text button "Continue with email" `text-body-sm text-tertiary`, mt space-4. Tap → inline expand (dur-med ease-decel) to input (bg-2 border-subtle h-48 radius-md) + "Send sign-in link" button (h-48 bg amber-500 text #0A0B12, press amber-600). Uses existing `supabase.auth.signInWithOtp({ email, options: { emailRedirectTo: window.location.origin } })` directly. After success: replace with "Check your inbox…" + "Send another link" reset button. Toast on error kept.
- Legal footer: "By continuing you agree to our Terms and Privacy Policy." in `text-body-sm text-quaternary`. "Terms" → `/terms`, "Privacy Policy" → `/privacy`, underlined, `text-tertiary`. (Router-history back handled in Part 4.)
- Preserves existing session-check/redirect and OAuth `signInWithOAuth` handlers unchanged. Removes "Powered by Anthropic" line + old gradient bar.

---

## Part 3 — Onboarding rebuild (src/routes/_authenticated/onboarding.tsx)

Reduce 9 steps → 6. Every currently written profile column continues to be written. Removed inputs (body-fat slider, DEXA/tape, "add measurements", home_gym/limited_equipment, pace slider) move to Settings or are replaced by pill defaults.

**Steps:**

1. **About you** — Name (text, label above), Age (numeric, "yrs"), Biological sex (two pills M/F). Helper: "For accurate calorie targets."
2. **How long have you been training, {name}?** — three cards Beginner / Intermediate / Advanced with new copy. Selected: border amber-500, ring shadow amber-glow.
3. **What's your goal, {name}?** — five cards, existing GOALS array with new descriptions (label sentence-cased).
4. **Which days can you train?** — 7 day-circles (48px, radius-pill). Selected uses amber-500→amber-300 gradient bg with #0A0B12 text. Below: "{n} days / week" `text-title`. Helper: "Pick at least one day to continue." Writes `training_day_codes` + derived `training_days_per_week` (existing behaviour).
5. **What's your setup?** — three cards only: Commercial gym / Dumbbells only / Bodyweight only. Values map:
   - `commercial_gym` → existing `commercial_gym`
   - `dumbbells_only` → existing `home_gym_db_only` (translation in write path; DB enum unchanged, generate-plan verified to accept `home_gym_db_only`)
   - `bodyweight_only` → existing `bodyweight_only`
   The label→value translation lives in the onboarding write path so the DB column type is untouched.
6. **Your fuel plan** — labelled "Step 6 of 6". Three sections stacked on one screen:
   - A. "How do you eat?" 2×2 grid of pattern cards → `eating_pattern`.
   - B. "Target weight" numeric input, unit inherited from Step 1's kg/lb toggle → `target_weight_kg` (lb→kg convert on save).
   - C. "How fast?" three pills Steady / Standard / Aggressive → `target_rate_pct` = 0.15 / 0.25 / 0.5. Sign flipped by goal (fat_loss negative, muscle_gain/strength positive, else null). **Persist a goal-appropriate default (Standard = 0.25 with correct sign) on submit even if user didn't tap** so engines always get a value.

**Step 1's Weight + Height inputs currently on old Step 6 move up:** rethinking — height/weight are body basics needed by macro engine. Keep them together on **Step 1 as a "basics" step alongside name/age/sex** would overload. Cleaner: keep the 6-count by using this final layout:

Revised final step list (this is what ships):
1. About you: name, age, sex
2. Experience: {name} card set
3. Goal: {name} card set
4. Training days
5. Setup (equipment)
6. Body & fuel plan — Weight (kg/lb toggle), Height (cm OR ft+in with correct conversion `cm = ft*30.48 + in*2.54` fixing current 12.7cm bug), eating pattern, target weight, pace pills

If Step 6 renders too dense at 375px, split into 6a/6b with the progress bar denominator updated to 7. Decision made at implementation time based on viewport screenshot; default is single-screen with clear section dividers.

**Final summary screen** ("Ready, {name}?") stays as a post-step confirmation before submit. Button "Build my plan" full-width h-52 radius-md, bg amber-500→amber-300 gradient, `shadow-inset-top`.

**Copy pass (Part 3B):** captured name interpolated on Steps 2 & 3 only. All helper copy rewritten per spec (no "metabolic rate", no "plan complexity"). Sentence case, no emoji, no markdown.

**Removed from onboarding, kept in the write payload with either null or Settings-supplied values:**
- Body fat, DEXA lean mass, tape measurements → written null (engines already tolerate null; today's macro engine has direction-specific validation that requires only weight/height/age/sex/goal).
- `coaching_time` → default '08:00' persisted at submit if not set. `timezone` auto-detected via existing `getBrowserTimezone()`.

---

## Part 4 — Legal links + auth gate

**4a. `src/routes/_authenticated/route.tsx`**: extend `beforeLoad` to fetch the caller's profile and:
- If `profile_completed_at` is null AND `disclaimer_accepted_at` is null → `redirect({ to: "/disclaimer" })`
- Else if `profile_completed_at` is null → `redirect({ to: "/onboarding" })`
- Exempt `/onboarding` itself from the second redirect to avoid a loop.

**4b. Legal pages** (`src/routes/privacy.tsx`, `src/routes/terms.tsx`, `src/routes/health-data.tsx` — all share `LegalShell`):
- Replace the hard-coded `<Link to="/settings">` back chevron with a router-history back handler:
  ```ts
  const router = useRouter();
  const canGoBack = router.history.length > 1;
  const onBack = () => canGoBack ? router.history.back() : navigate({ to: fallback });
  ```
- Fallback: if `disclaimer_accepted_at` is null → `/disclaimer`, else if authenticated → `/settings`, else → `/`. Fallback computed via the same session/profile check already used elsewhere (single `getUser` + `profiles` select).

**4c. Auth-screen legal links**: added in Part 2, use plain `<Link to="/terms" />` — router history naturally returns to `/`.

Verification flows a/b/c/d in the spec become the acceptance criteria.

---

## Part 5 — Settings additions (src/routes/settings.tsx)

New "Precision" group inserted **above** "Recovery tracking method":

- Row "Body composition" → new route `src/routes/_authenticated/settings.body-composition.tsx` (chevron). Reuses body-fat slider UI + a stubbed "Upload DEXA/InBody" affordance + optional tape fields. Header text per spec.
- Row "Connect device" → new route `src/routes/_authenticated/settings.device.tsx` with the "Coming with the iOS app…" copy. No fake vendor buttons.

Existing "Recovery tracking method", "Integrations", "Legal & data", sign-out, reset block untouched.

---

## Out of scope for this commit
- Dashboard/Workouts/Nutrition/Coach visual sweep (violet accents in `src/components/dashboard/tokens.ts` and route files). Ambient gradient inherits, so bg improves, but component-level color audit is a follow-up.
- Any edge function, migration, or `.env` change.
- New dependencies.

---

## Acceptance checks (run after implementation)

1. `grep -n "#8B7FF7\|violet\|purple" src/routes/index.tsx src/routes/_authenticated/onboarding.tsx` → no hits.
2. Fresh signup → complete 6 steps → SQL verify all 13 profile columns non-null (per spec).
3. Height 5 ft 10 in → `measurement_height_cm` ≈ 177.8.
4. `equipment_access` ∈ {commercial_gym, home_gym_db_only, bodyweight_only}; generate-plan accepts.
5. `target_rate_pct` never null after submit; sign matches goal.
6. Legal back-nav flows (a/b/c) return to origin; direct-URL fallback correct.
7. `/dashboard` mid-onboarding → redirects to `/onboarding`.
8. iPhone SE viewport screenshot: no overflow, wordmark tracking readable.
9. Playwright visual specs `bun run test:visual` and `bun run lint:ui` still pass (or baselines updated intentionally with `test:visual:update`).
