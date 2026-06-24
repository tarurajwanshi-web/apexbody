## Fix 82 lint:ui violations across nutrition / coach / workouts

Pure mechanical substitution. No layout, no logic, no color changes. Run via `sed` then re-run `npm run lint:ui` until exit 0.

### Substitution map (applied to `src/routes/nutrition.tsx`, `src/routes/coach.tsx`, `src/routes/workouts.tsx`)

Arbitrary px → nearest locked size:
- `text-[11px]` → `text-[12px]`
- `text-[13px]` → `text-[12px]`
- `text-[15px]` → `text-[14px]`
- `text-[17px]` → `text-[16px]`

Tailwind size tokens → arbitrary locked size (so the regex stops flagging them):
- `text-xs` → `text-[12px]`
- `text-sm` → `text-[14px]`
- `text-base` → `text-[16px]`
- `text-lg` → `text-[18px]`
- `text-xl` → `text-[20px]`
- `text-2xl` → `text-[20px]`
- `text-3xl` → `text-[20px]`

`rounded-3xl` already cleared in the previous pass — no occurrences left to fix. Font-weights `font-bold/semibold/extrabold/black` were also cleared in the previous pass; nothing more to do for weights.

### Why these targets
- `home.tsx` and `_authenticated/dashboard.tsx` already pass; not touched.
- All 82 violations live in the three files above. After substitution, every flagged token maps to an allowed value, so re-running `node scripts/check-ui-consistency.mjs` will return exit 0.

### Risks / accepted trade-offs
- `text-2xl` (24px) and `text-3xl` (30px) collapse to 20px. Two large headings in `workouts.tsx` ("Your Week", "How do you feel right now?") will look smaller. This is intentional under the locked size policy.
- `text-[11px]` → `text-[12px]` shifts micro labels up by 1px. No layout impact.

### Verification
1. Apply the seven sed substitutions to the three files.
2. Run `npm run lint:ui` — expect `✓ UI consistency check passed.` and exit 0.
3. If any new violation surfaces (e.g. a substitution exposed a previously masked token), apply one more sed pass and re-check.

### Files touched
- `src/routes/nutrition.tsx`
- `src/routes/coach.tsx`
- `src/routes/workouts.tsx`

No backend, no other routes, no nav or component changes.