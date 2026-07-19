# Fix onboarding edge-function dispatch ordering

**File:** `src/routes/_authenticated/onboarding.tsx` (only). Lines ~313–330 in the profile-submit handler.

## Current bugs

1. `calculate-macros`, `generate-plan`, and `compute-volume-landmarks` fire in parallel via `Promise.allSettled`. `generate-plan` reads `weekly_volume_landmarks` for volume targets and `compute-volume-landmarks` reads fuel data from `calculate-macros` — so on first onboarding the plan is generated before landmarks exist.
2. Navigation `await`s the entire `allSettled`, but `generate-plan` returns 202 immediately after writing a fallback and queuing the Sonnet upgrade — so waiting on it serves no purpose and any slow response stalls the onboarding→dashboard transition.
3. Failures are swallowed with `console.warn`; a failed macro or landmark step silently produces a degraded plan.

## Change

Replace the current dispatch block with a strict sequential chain, then fire-and-forget the plan:

```text
await advance-mesocycle  { user_id, mode: "init" }
await calculate-macros   { user_id }
await compute-volume-landmarks { user_id }
// fire-and-forget — do NOT await
supabase.functions.invoke("generate-plan", { body: { user_id } })
navigate({ to: "/dashboard" })
```

Rules:

- Each of the three awaited invokes: check both the thrown error path AND the `{ error }` returned in the invoke result. On failure, call the existing `toast.error(...)` with a specific message (e.g. `"Could not initialize training block"`, `"Could not calculate macros"`, `"Could not compute volume targets"`) and `return` — do not proceed, do not navigate, do not swallow with `console.warn`.
- `generate-plan` is dispatched without `await`. Attach a `.catch(err => console.warn("generate-plan dispatch failed", err))` purely so an unhandled rejection doesn't surface — the server writes the fallback plan synchronously and cron drains the Sonnet upgrade, so the UI does not need to wait or report.
- Preserve every dispatch body verbatim: `{ user_id: userId }` for macros/landmarks/plan, `{ user_id: userId, mode: "init" }` for mesocycle.
- Remove the now-obsolete comment about "must land BEFORE compute-volume-landmarks" and replace with a one-line comment noting the strict sequential dependency chain.

## Not touched

- No other files.
- No changes to the edge functions themselves, their bodies, or the outer try/catch that already funnels errors through `toast.error`.
- No changes to the loading/submitting state variable — it remains held until navigate, which now happens right after the landmarks step resolves and the plan is dispatched.

&nbsp;

**on every failure path that `return`s early, call `setSubmitting(false)` before the `toast.error` and `return**`, matching the existing outer catch. Everything else ships as written.