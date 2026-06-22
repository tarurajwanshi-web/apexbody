## Phase 1.5 QA Verification Report

### Per-item results

**1. Idempotency guard — PARTIAL FAIL**
Current guard (score-nutrition L81-89) skips the entire handler when `claude_score_status='scored'` AND macros ∈ {estimated, manual_edited}. For the case the QA brief specifies — `scored` + macros in `pending`/`failed` — the guard correctly does NOT skip, but the handler then re-runs the full Anthropic quality-scoring call too, wasting a Claude call and re-writing protein/carb/timing scores that were already valid.
Fix: split guard into two flags:
- `skipQuality = claude_score_status === 'scored'`
- `skipMacros  = calorie_estimate_status ∈ {'estimated','manual_edited'}`
Only return early when both are true. Otherwise gate each block independently so a scored row with failed macros only re-runs macro estimation.

**2. Double-invocation safety — PARTIAL FAIL**
- Idempotency guard prevents the most common race (trigger + client both arrive while row is already final). ✅
- BUT: `MealHistoryList.retryScore` (L57-69) unconditionally writes `claude_score_status='pending'` before invoking, bypassing the guard. If the row is already `manual_edited`, a user-triggered retry would let score-nutrition re-write `estimated_*` and flip `calorie_estimate_status` back to `'estimated'` — destroying the manual edit. ❌
  Fix: in score-nutrition, when `calorie_estimate_status='manual_edited'`, do NOT touch `estimated_*` / `estimated_items` / `calorie_estimate_status` — only write `protein_tier/carb_quality_score/timing_score`. Belt-and-braces: also gate retryScore client-side to skip if `manual_edited`.
- Two truly concurrent invocations (trigger + client overlapping before either finishes) both pass the guard and both call Anthropic. Not corrupting (last-writer-wins on identical fields) but a wasted Claude call. Acceptable; the guard handles the common case. ⚠️
- `original_estimated_*` overwrite protection: handler now writes originals only when `row.original_estimated_items == null AND row.original_estimated_calories == null`. Both concurrent runs read the same pre-snapshot row, so both would write the SAME originals — idempotent. ✅

**3. Manual-edited inclusion — 1 FAIL**
Grep of `calorie_estimate_status` across `src/` and `supabase/`:
- `src/lib/macros.functions.ts:30` — `.in(["estimated","manual_edited"])` ✅
- `supabase/functions/calculate-macros-weekly/index.ts:305` — `.eq("calorie_estimate_status","estimated")` ❌
  Weekly TDEE reconciliation silently drops manually-edited meals from intake, biasing observed_tdee and triggering wrong adjustments. Must change to `.in(["estimated","manual_edited"])`.
- Dashboard rings + `/nutrition` route both read via `getTodayMacroSummary` (single source of truth) ✅
- No other filters exist.

**4. Original-estimate preservation — PASS (with caveat from #2)**
- Edit grams → `updateMealItems` snapshots originals on first edit, sets `manual_edited` ✅
- Retry score-nutrition → guard short-circuits (manual_edited) ✅ — BUT only if `claude_score_status` is still `'scored'`. If the user hits the failed-state retry button, retryScore force-writes `pending` and bypasses the guard → originals stay, but `estimated_*` get clobbered (see #2 fix).

**5. Text-only macro estimation — PASS**
- Macro block is no longer gated on `row.meal_photo_url` (L195+).
- Description-only path uses a distinct prompt; photo-only path stays as before.
- Success → `calorie_estimate_status='estimated'`, items + macros populated.
- Failure → falls into `else` branch, status set to `'failed'`. ✅

**6. Pending detector — PASS**
- `MealHistoryList:50` treats `manual_edited` as complete (won't keep polling waiting for items).
- `claude_score_status='pending'` keeps polling. `failed` surfaces the "tap to retry" CTA. ✅

### Fixes to apply (no UI, no new pages)

1. `supabase/functions/score-nutrition/index.ts`:
   - Replace single skip-guard with split `skipQuality` / `skipMacros` flags. Wrap the Anthropic quality call + protein/carb/timing UPDATE in `if (!skipQuality)`. Wrap the macro estimation + estimated_* UPDATE in `if (!skipMacros)`.
   - When `row.calorie_estimate_status === 'manual_edited'`, treat `skipMacros=true` regardless of nullity of macros — never overwrite a manual edit.
   - Ensure a row that is fully done (both skips true) still returns `{ skipped: true }` without calling Anthropic.

2. `supabase/functions/calculate-macros-weekly/index.ts:305`:
   - Change `.eq("calorie_estimate_status","estimated")` → `.in("calorie_estimate_status",["estimated","manual_edited"])`.

3. `src/components/MealHistoryList.tsx:60`:
   - In `retryScore`, before flipping to `pending`, fetch current `calorie_estimate_status`; if `manual_edited`, skip the destructive reset and just re-invoke (the macro path will be skipped by the new guard, only quality will rerun if needed).
   - Lower-risk alternative if extra round-trip is undesirable: trust the server-side guard alone (which the fix in #1 already provides). Choosing the simpler path: leave retryScore unchanged and rely on score-nutrition's manual_edited protection.

### Files that will change
- `supabase/functions/score-nutrition/index.ts` (guard rewrite, manual_edited protection)
- `supabase/functions/calculate-macros-weekly/index.ts` (filter widening)

No UI redesign, no new pages, no schema changes, cron stays inactive.