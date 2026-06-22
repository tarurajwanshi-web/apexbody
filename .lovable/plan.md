## Phase 1.5 — Diff Plan

Verified in code:
- `MealLogModal` already invokes `score-nutrition` on **both** create and edit (same awaited path at LogModals.tsx:888). No duplicate needed.
- `MealHistoryList` already auto-retries pending rows + manual retry. Keep.
- `score-nutrition` currently runs macro estimation **only when `meal_photo_url` is set** (index.ts:180). Text-only path missing.
- `updateMeal` clears macros + sets status `pending`, then client awaits `score-nutrition` — fine.
- `updateMealItems` overwrites `estimated_items` and sets status to `estimated` — needs to switch to `manual_edited` and preserve originals.
- `getTodayMacroSummary` filters `eq("calorie_estimate_status","estimated")` — must include `manual_edited`.

### Migrations
1. `extend_meal_estimate_status_and_originals.sql`
   - Drop/recreate CHECK on `shield_nutrition_logs.calorie_estimate_status` to allow `manual_edited`.
   - Add columns: `original_estimated_items jsonb`, `original_estimated_calories numeric`, `original_estimated_protein_g numeric`, `original_estimated_carbs_g numeric`, `original_estimated_fat_g numeric`, `user_corrected boolean default false`, `correction_count integer default 0`.

2. `shield_dispatch_score_nutrition_trigger.sql`
   - `public.shield_dispatch_score_nutrition(_id uuid)` SECURITY DEFINER → `net.http_post` to `score-nutrition` with `x-internal-secret`.
   - Trigger `shield_nutrition_logs_score_dispatch` AFTER INSERT: dispatch when `claude_score_status='pending'`. Idempotency: the edge fn already short-circuits if the row is no longer pending (we'll add an explicit guard — see edge function change). Client fast-path stays; trigger is the safety net.
   - Revoke EXECUTE on the new dispatch fn from `PUBLIC`/`sandbox_exec`; grant to `postgres`/`service_role`.

### Edge function: `supabase/functions/score-nutrition/index.ts`
- **Idempotency guard** at start of handler: re-fetch row, if `claude_score_status='scored'` AND `calorie_estimate_status IN ('estimated','manual_edited')`, return 200 `{ skipped:true }` without calling Anthropic. Prevents trigger+client race double-scoring.
- **Text-only estimation**: lift the macro-estimation block out of the `if (row.meal_photo_url)` gate. Priority handled by prompt + presence of image part:
  - photo+description → both image + description text
  - description only → text-only call with description
  - photo only → existing image path
  - neither → skip estimate.
- **Preserve originals**: when writing `estimated_*`, also write `original_estimated_*` **only if currently NULL** (first AI estimate). On re-score after edit (status reset), do NOT overwrite originals.

### Client server functions: `src/lib/shield.functions.ts`
- `updateMealItems`:
  - Fetch current row's `original_estimated_*`; if null, copy current `estimated_*` into them (first edit captures pre-edit baseline).
  - Set `calorie_estimate_status = 'manual_edited'`, `user_corrected = true`, `correction_count = correction_count + 1` (via single update with subquery or fetch+update).
- `updateMeal` (description/photo edit): unchanged — still clears macros & status pending; the rescore will write new originals only if they were cleared too. Decision: do NOT clear `original_estimated_*` on photo/description edit so the very first AI baseline persists across re-scores. Add `original_estimated_*` to NOT in the cleared set.
- Add `CalorieEstimateStatus` union type export.
- Update `TodayMeal` type to include `calorie_estimate_status`, `user_corrected`.

### Macro summary: `src/lib/macros.functions.ts`
- Change filter from `.eq("calorie_estimate_status","estimated")` to `.in("calorie_estimate_status",["estimated","manual_edited"])`. No other change.

### UI: `src/components/MealHistoryList.tsx`
- After successful item save, show small "Adjusted by you." line beneath the macro row when `m.calorie_estimate_status === 'manual_edited'` or `m.user_corrected`. No layout/styling changes beyond a single muted text line.
- Update pending detection to also treat `manual_edited` as done.

### Readiness recalc
- Gram edits do NOT change `claude_quality_score` (Shield readiness input), so no `calculate-score` re-dispatch is needed from `updateMealItems`. Score re-dispatch already fires via `shield_nutrition_logs_webhook` whenever the row is updated through the existing path — confirmed sufficient. No new dispatch.

### Files touched
- new: 2 migrations
- edited: `supabase/functions/score-nutrition/index.ts`
- edited: `src/lib/shield.functions.ts` (updateMeal, updateMealItems, types)
- edited: `src/lib/macros.functions.ts`
- edited: `src/components/MealHistoryList.tsx`

No new pages, no UI redesign, no chart additions. Cron remains untouched.
