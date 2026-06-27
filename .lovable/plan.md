## Fix nutrition Apply button to use new RPC

**File:** `src/routes/nutrition.tsx`

**Scope:** Only `handleApplyReview` (lines 196–242). No UI, no fetch logic, no other changes.

### Change

Replace the 22-parameter `apply_weekly_macro_review` call and its follow-up manual review-row UPDATE with a single call to the new atomic RPC `apply_existing_weekly_macro_review`, passing only the review ID.

### New handler shape (lines 196–242)

```ts
const handleApplyReview = async () => {
  if (!weeklyReview || applyingReview) return;
  setApplyingReview(true);
  try {
    const { error } = await supabase.rpc(
      "apply_existing_weekly_macro_review",
      { p_review_id: weeklyReview.id },
    );
    if (error) throw error;
  } catch (e) {
    console.error("[apply-weekly-review]", e);
  } finally {
    setApplyingReview(false);
    await reloadNutritionSnapshot();
  }
};
```

### What's removed

- `crypto.randomUUID()` review id generation.
- All 22 `p_*` parameters reconstructed from `weeklyReview`.
- Manual `supabase.from("nutrition_weekly_reviews").update({ applied_target_id, applied_at })` — the new RPC handles this atomically.
- Unused locals (`u`, `uid`, `today`, `getLocalDateISO` call, `newTargetId` binding).

### What's preserved

- Guard against null/in-flight (`if (!weeklyReview || applyingReview) return`).
- `setApplyingReview(true/false)` flow.
- Error log channel `[apply-weekly-review]`.
- `reloadNutritionSnapshot()` in `finally` (refreshes Fuel page to show new active target).

### Verification

After save, the Apply button:
1. Reads existing `weeklyReview.id`.
2. Calls `apply_existing_weekly_macro_review` with only that ID.
3. Surfaces error via console; success falls through.
4. Reloads snapshot to show new active target.

No other file is touched. The trailing reference at line 1565 is a comment and stays as-is unless you want it updated too — flag if so.
