## Goal

Replace the existing `createServerFn`-based `triggerWeeklyMacroReview` in `src/lib/nutrition.functions.ts` with a direct client-side `fetch` wrapper that calls the `trigger-weekly-macro-review` edge function with the user's JWT — per the APEX spec.

## Why the small departure from "add to existing file"

The file currently exports `triggerWeeklyMacroReview` as a TanStack server function. The spec's new version is a plain async function with a different signature (no `{ data }` wrapper, no `useServerFn`). We can't have both under the same name, so this is a replace, not an add. The caller in `nutrition.tsx` must be updated in the same change or the build breaks.

## Changes

1. **`src/lib/nutrition.functions.ts`**
   - Remove the `createServerFn` version of `triggerWeeklyMacroReview` and its `TriggerWeeklyMacroReviewResult` type.
   - Add the spec's `triggerWeeklyMacroReview` async function exactly as provided: gets session via `supabase.auth.getSession()`, reads `VITE_SUPABASE_URL`, POSTs to `/functions/v1/trigger-weekly-macro-review` with `Authorization: Bearer <token>`, handles 204 → `{status: "not_monday"}`, parses JSON otherwise, throws on `!response.ok`.
   - Keep the other server-fn exports in this file untouched.

2. **`src/routes/nutrition.tsx`**
   - Drop `const triggerReview = useServerFn(triggerWeeklyMacroReview);` and call `triggerWeeklyMacroReview()` directly in the Monday-trigger `useEffect`.
   - Result-handling stays the same: on `"computed"` or `"already_computed"` call `reloadNutritionSnapshot()`; `"not_monday"` is a no-op; `.catch` already logs.
   - Remove the now-unused `useServerFn` import only if no other call site uses it (it does — leave the import alone).

## Out of scope

- No changes to the edge function itself, RPC, or DB.
- No changes to the Monday detection / StrictMode guard logic.
- No changes to other server fns in `nutrition.functions.ts`.

## Verification

- `bun run build` (typecheck) passes.
- Manual: on a Monday in user tz, opening Fuel logs `[nutrition-trigger] result {status: "computed"|"already_computed"}` and the snapshot reloads; non-Monday returns `{status: "not_monday"}` without error.
