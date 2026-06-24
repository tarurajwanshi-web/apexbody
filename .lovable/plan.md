## Two changes

### 1. Fix dashboard avatar — make it route to /settings

`src/components/dashboard/Header.tsx`: the avatar (initials circle) is a plain `<div>` with no click handler. Convert it to a TanStack Router `<Link to="/settings">` keeping the exact same styles and `aria-label="Profile"`. Add a small `:active` press affordance (no visual change otherwise).

### 2. Add automated UI consistency check

Add a Node script `scripts/check-ui-consistency.mjs` that scans the unified routes and dashboard sub-components and fails (exit 1) on any forbidden token. Add an npm script `lint:ui` so it can run locally or in CI.

**Scanned files**
- `src/routes/home.tsx`
- `src/routes/nutrition.tsx`
- `src/routes/coach.tsx`
- `src/routes/workouts.tsx`
- `src/routes/_authenticated/dashboard.tsx`
- `src/components/dashboard/**/*.tsx`

**Forbidden patterns (regex, word-bounded inside className strings)**
- Radius: `\brounded-3xl\b`
- Font weights: `\bfont-(bold|semibold|extrabold|black)\b`
- Font sizes outside the locked list: any `\btext-(xs|sm|base|lg|xl|2xl|3xl|4xl|5xl|6xl|7xl)\b` AND any arbitrary `text-\[(\d+)px\]` whose number is not in `{10,12,14,16,18,20}`

**Output**
For each violation prints `file:line  token  ← snippet`. Exits 0 when clean, 1 when any violation found. Script is pure Node (no deps), uses `fs.readdirSync` recursion.

**Note on existing violations**
The recent bulk pass normalized weights and radius but did not remap every `text-sm`/`text-lg`/`text-[15px]` etc. in nutrition.tsx and workouts.tsx. The new linter will surface the remaining offenders so they can be cleaned up in a follow-up; this plan only adds the linter + avatar fix, it does not auto-rewrite those files.

### Files touched
- `src/components/dashboard/Header.tsx` — avatar → Link
- `scripts/check-ui-consistency.mjs` — new
- `package.json` — add `"lint:ui": "node scripts/check-ui-consistency.mjs"`

No backend, no other pages, no nav changes.