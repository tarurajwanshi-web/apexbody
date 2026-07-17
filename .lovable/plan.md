## Goal

Add a secondary, collapsed-by-default magic-link email option to `src/routes/index.tsx`, below the Apple button and above the terms text. Preserves Google/Apple as the primary hierarchy and reuses existing tokens.

## Scope

Single file: `src/routes/index.tsx`. No routing, no `routeAfterAuth`, no `useEffect` changes — the existing `onAuthStateChange` listener already handles the redirect back to `/` after the user clicks the magic link.

## Changes

1. **New state** inside `AuthScreen`:
   - `emailOpen: boolean` — controls inline expansion (default `false`)
   - `email: string` — input value
   - `sending: boolean` — disables button while `signInWithOtp` is in flight

2. **New handler** `sendMagicLink()`:
   - Guards on empty/whitespace email
   - Calls `supabase.auth.signInWithOtp({ email, options: { emailRedirectTo: window.location.origin } })` directly (not via `lovable` wrapper)
   - On success: `toast.success("Check your email for the sign-in link")`, clears the input, collapses the section
   - On error: `toast.error(error.message)`
   - Preserves any `?next=` param by using `window.location.href` origin only per the spec (spec says `window.location.origin` — followed exactly; the existing `safeNextParam` isn't threaded because the spec forbids touching auth logic beyond this addition)

3. **New UI block** rendered between the Apple button and the terms `<p>`:
   - Collapsed state: a plain text button `"Continue with email"`, `text-text-tertiary`, small font (`text-[13px]`), centered, `mt-4`, no border/background, opens the section on click.
   - Expanded state: a small stack with
     - `<input type="email">` styled with `w-full bg-bg-2 border border-white/10 rounded-2xl py-3.5 px-4 text-sm text-white placeholder:text-text-tertiary`, placeholder `"you@example.com"`
     - `"Send magic link"` button styled `w-full rounded-2xl bg-bg-2 border border-white/10 py-3.5 text-sm font-semibold` (mirrors Apple button structure), disabled while `sending` or when email is empty; shows `"Sending…"` while in flight
   - Both states disabled when `loading !== null || checking` (matches OAuth buttons)

4. **No changes** to: `routeAfterAuth`, the `useEffect` auth listener, `signIn` (OAuth), `DemoRing`, icons, or any styling of Google/Apple buttons.

## Technical notes

- `toast` is already imported from `sonner`.
- `supabase` is already imported from `@/integrations/supabase/client`.
- No new dependencies, no new tokens, no new routes.
- Accessibility: input gets `aria-label="Email address"`, `autoComplete="email"`, `inputMode="email"`; the expand button gets `aria-expanded`.
