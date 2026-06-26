## Findings

- `src/lib/nutrition.functions.ts` does not exist; the spec imports from there. Existing nutrition server functions live in `src/lib/macros.functions.ts`.
- No `triggerWeeklyMacroReview` server fn exists yet — needs to be created.
- The edge function `trigger-weekly-macro-review` is JWT-gated. Easiest path is a thin `createServerFn` wrapper that uses `requireSupabaseAuth` and calls the edge function via the authenticated `context.supabase.functions.invoke("trigger-weekly-macro-review")` — that forwards the user's bearer.
- `Nutrition()` already imports `useUserTimezone` and `getLocalDateISO`, has `reloadNutritionSnapshot`, and uses `useServerFn` for other calls.
- The spec's effect body calls `useUserTimezone()` inside `useEffect` — that's an invalid hook call. The component already holds `userTz` in scope; the effect should reference it directly.

## Plan

1. **New file `src/lib/nutrition.functions.ts`**: export `triggerWeeklyMacroReview` as a `createServerFn({ method: "POST" }).middleware([requireSupabaseAuth]).handler(...)` that calls `context.supabase.functions.invoke("trigger-weekly-macro-review", { body: {} })` and returns a typed `{ status: "computed" | "already_computed" | "not_monday", decision?, applied_target_id?, review_id?, user_id? }`. Errors are returned as `{ status: "error", error }` so the client effect's catch is rarely needed but still wired.

2. **`src/routes/nutrition.tsx`**: 
   - Import `triggerWeeklyMacroReview` from `@/lib/nutrition.functions`.
   - Inside `Nutrition()`, after the existing `useServerFn` setup, add `const triggerReview = useServerFn(triggerWeeklyMacroReview);`.
   - Add a `useEffect(..., [userTz])` placed after state init that:
     - Computes today's day-of-week from `getLocalDateISO(userTz)` (matches the spec's UTC-parse trick — for a YYYY-MM-DD anchored to `T00:00:00Z`, `getUTCDay()` returns the correct weekday).
     - Returns early if not Monday (day 1).
     - Calls `triggerReview()`; on `computed`/`already_computed`, calls `reloadNutritionSnapshot()`. Logs errors, doesn't throw.
   - Uses a `useRef` guard so it doesn't double-fire under React StrictMode dev double-invoke.

No edge function, DB, or other route changes. Confirm and I'll build.