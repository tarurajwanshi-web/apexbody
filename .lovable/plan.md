## Three follow-ups: lint guard, header padding, visual regression

### 1. Extend `scripts/check-ui-consistency.mjs` to ban `text-text-accent` outside AI/action UI

Add a new rule that flags `text-text-accent` in the route + component scan, with an allowlist for files where the purple accent is legitimately the AI/action color:
- `src/components/AIOrb.tsx` (AI badge)
- `src/components/ApexStreakStrip.tsx` (streak action tag)

Anywhere else (helper copy, snackbar undo, settings links, descriptive labels) the lint fails with `text-text-accent reserved for AI/action UI — use text-text-secondary`. Re-run `bun lint:ui` and fix any current violations the rule surfaces (audit already shows Nutrition is clean; no further code edits expected unless the run prints a hit).

### 2. Coach header safe-area: cover iPhone notch / Dynamic Island AND Android cutouts

Current fix uses `pt-[max(1.5rem,env(safe-area-inset-top))]` which works on iOS but Android Chrome only honors `env(safe-area-inset-top)` when the viewport meta includes `viewport-fit=cover`. Plan:

- Verify `viewport-fit=cover` is in the `<meta name="viewport">` tag in `src/routes/__root.tsx`. Add it if missing — without it, Android display-cutout devices (Pixel 6+, Samsung S-series punch-hole) get `env()` = 0 and the header sits under the camera cutout.
- Bump the Coach header floor from `1.5rem` to `1rem` and let `env()` take over on notched devices: `pt-[calc(env(safe-area-inset-top,0px)+1rem)]`. This matches the pattern already used in `settings.tsx`, `privacy.tsx`, and `onboarding.tsx` and gives consistent clearance on iPhone 14/15 Pro Dynamic Island (~59px), iPhone notch (~47px), and Android cutouts (~24–32px).
- Same horizontal safe-area on the header row: add `pl-[max(1.25rem,env(safe-area-inset-left))] pr-[max(1.25rem,env(safe-area-inset-right))]` so landscape on notched devices doesn't clip the chevron/Settings link.
- Manual verification matrix via the preview device toolbar: iPhone 14 Pro, iPhone SE (no notch — floor must hold), Pixel 7, Galaxy S22.

### 3. Visual regression tests for Dashboard, Coach, Nutrition

Add Playwright-based screenshot regression (no new heavy framework — Playwright is already available in the sandbox; install as a dev dep so CI can run it):

- New folder `tests/visual/` with one spec per tab: `dashboard.spec.ts`, `coach.spec.ts`, `nutrition.spec.ts`.
- Each spec: launch headless Chromium at 390×844 (iPhone 14) and 412×915 (Pixel 7) viewports, restore the injected Supabase session into localStorage, navigate to the route, wait for network idle + a stable selector, then `expect(page).toHaveScreenshot()`.
- Also assert per-tab DOM invariants so the test fails with a meaningful diff, not just a pixel delta:
  - **Background**: `getComputedStyle(document.body).backgroundColor` resolves to `rgb(10, 14, 26)` (#0A0E1A) on all three routes.
  - **Safe-area**: Coach `<header>` computed `padding-top` ≥ 16px even when `env()` = 0.
  - **No stray purple**: assert no element matching helper-text selectors (`p.text-\\[12px\\]`, snackbar button, settings link) has computed `color` equal to the accent `#A78BFA`.
- Baselines committed under `tests/visual/__screenshots__/`. Add `bun test:visual` script wrapping `playwright test tests/visual` and document in `AGENTS.md`.
- Add `@playwright/test` to devDependencies; do **not** auto-run in `build`. CI hook is out of scope for this turn — the script + baselines land first, wiring into the release pipeline is a follow-up.

### Out of scope
- Backend / edge function changes
- Refactoring the dashboard token system
- Replacing inline styles with utility classes

### Files touched
- `scripts/check-ui-consistency.mjs` (add rule)
- `src/routes/coach.tsx` (header padding)
- `src/routes/__root.tsx` (viewport-fit=cover, if missing)
- `tests/visual/*.spec.ts` (new)
- `playwright.config.ts` (new)
- `package.json` (devDep + script)
- `AGENTS.md` (doc note)