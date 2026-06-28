# Plan: Verify macro-calculation.ts alignment (no changes needed)

## Finding

After reading `supabase/functions/_shared/macro-calculation.ts` (lines 440–526), the requested refactor is already in place from a prior turn. Specifically:

- **Line 452**: No `crypto.randomUUID()` — `review_id` is not generated in the function; DB assigns the id.
- **Lines 456–495 (`directInsertReview`)**: Inserts the review row with `.select("id").single()` and returns the new `id: string`.
- **Lines 497–516 (`shouldApply` branch)**:
  1. `const reviewId = await directInsertReview();`
  2. `await supa.rpc("apply_existing_weekly_macro_review", { p_review_id: reviewId, p_effective_start_date: new_effective_start_date })`
  3. On RPC error → `throw new Error('apply_rpc_failed: ...')`
  4. Returns `{ user_id, status: "adjusted", decision, flag_reason, applied_target_id }`
- **Line 518 (hold branch)**: Same `directInsertReview()` path, no RPC call.

The 22-param `apply_weekly_macro_review` call referenced at "lines 486–525" no longer exists in this file.

## Minor deviation from your spec

The current code returns `applied_target_id: (appliedTargetId as string | null) ?? null` (the RPC returns the new target id directly as a uuid scalar), whereas your spec wrote `applied?.id || review.id`. The current shape is correct given the RPC returns a uuid, not an object — `applied?.id` would be undefined and fall back to the review id (wrong column semantically).

## Action

None. Approve to close out, or tell me if you want the `applied_target_id` fallback changed.
