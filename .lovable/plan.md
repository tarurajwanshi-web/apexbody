# Remove dead `/home` mock route, redirect trust CTA to live dashboard

## Changes

1. **Delete `src/routes/home.tsx`** (via `rm`).
2. **`src/routes/trust.tsx` line 27**: change `<Link to="/home" ...>` → `<Link to="/dashboard" ...>`.

## Route-tree regeneration

`src/routeTree.gen.ts` is authored by the TanStack Router Vite plugin, not by hand. Deleting a route file leaves the generated tree stale until the plugin re-runs. On next dev/build the plugin regenerates automatically, but the checked-in `src/routeTree.gen.ts` will still reference `./routes/home` until then — expect the plugin to rewrite it and commit that regenerated file alongside the deletion. No manual edit to `routeTree.gen.ts`.

## Verification

- `rg -n "/home\"|routes/home" src supabase` returns nothing after the change (except the regenerated route tree, if it still lists it before the plugin runs).
- `trust.tsx` line 27 shows `to="/dashboard"`.
- Preview `/trust` → clicking the CTA lands on `/dashboard` (auth-gated under `_authenticated`, so unauth users get redirected to `/auth` first — that's the intended live path).

## Not in scope

No other link audits, no copy changes on `trust.tsx`, no changes to `_authenticated/dashboard.tsx`.
