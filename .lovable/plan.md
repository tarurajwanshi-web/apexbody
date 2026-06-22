## Meal logging flow — technical audit (read-only)

No code changes proposed. This is an audit + a list of file-level changes that *would* be needed if/when we proceed.

---

### 1. End-to-end flow: photo / text → saved nutrition log

```text
User taps "+" (BottomNav)
        │
        ▼
MealLogModal  (src/components/LogModals.tsx, line ~809)
  step "capture":
    • file picker (camera/library) → File
    • optional textarea description
    • on "Next: confirm" →
        - supabase.storage.from("shield-uploads").upload(uid/meals/ts.ext)
        - createSignedUrl(30d)   ← stored as meal_photo_url
        - runVisionDraft(file)   → analyzePhoto() (Claude Sonnet, src/lib/coach.functions.ts:155)
                                    seeds desc with a short food description
  step "confirm":
    • user edits desc → submit
        ▼
logMeal()  (src/lib/shield.functions.ts:342)  — createServerFn, RLS-scoped
  INSERT shield_nutrition_logs {
    user_id, entry_date, meal_description, meal_photo_url,
    claude_score_status: "pending"
  }  → returns { id }
        ▼
supabase.functions.invoke("score-nutrition", { nutrition_log_id: id })
  (awaited so the request isn't aborted on modal unmount)
        ▼
score-nutrition edge fn  (supabase/functions/score-nutrition/index.ts)
  - authorizeCaller(req, supabase, row.user_id)   (audit #3 ownership)
  - fetch training row for same entry_date
  - Claude Haiku call #1 (scoring): protein_tier, carb_quality_score, timing_score
      → UPDATE shield_nutrition_logs SET protein_tier/carb_quality_score/timing_score,
        claude_score_status='scored'
      (claude_quality_score is a generated column = 0.4P + 0.35C + 0.25T)
  - Claude Haiku call #2 (macro estimation, only if meal_photo_url present):
      itemized {name, grams, calories, protein_g, carbs_g, fat_g}[]
      → UPDATE shield_nutrition_logs SET
        estimated_items, estimated_calories/protein_g/carbs_g/fat_g,
        calorie_estimate_status='estimated' | 'failed'
        ▼
MealHistoryList  (src/components/MealHistoryList.tsx)
  - getTodayMeals() reload every 5s while any row is pending
  - auto-retry rows stuck "pending" >60s once (silent)
  - manual retry button when claude_score_status='failed'
```

Webhooks: `shield_nutrition_logs_webhook` (DB trigger) also fires `shield_dispatch_calculate_score(user_id, entry_date)` → calculate-score edge fn. That's the readiness re-roll, parallel to scoring.

### 2. Where `score-nutrition` is invoked

| Site | File | Purpose |
| --- | --- | --- |
| Post-create | `LogModals.tsx:888` | After `logMeal` returns the new id (awaited) |
| Manual retry | `MealHistoryList.tsx:61` | Failed-state tap |
| Auto retry | `MealHistoryList.tsx:48` (calls `retryScore` silent) | Rows still pending >60 s |

No DB trigger / cron currently dispatches score-nutrition — it's only called from the client.

### 3. Where estimated kcal/P/C/F render

| Surface | File | Notes |
| --- | --- | --- |
| Meal row inline (history) | `MealHistoryList.tsx:147–151` | `{cal} kcal · {P}P · {C}C · {F}F` next to score |
| Meal detail sheet | `MealDetailModal.tsx:47–52` | 4-stat grid (kcal / protein / carbs / fat) |
| Per-item breakdown (collapsible) | `MealDetailModal.tsx:69–82`, `MealHistoryList.tsx:226–292` (`ItemBreakdown`) | `name`, `grams`, item-level kcal/P/C/F |
| Day totals + macro rings | `src/routes/nutrition.tsx` + `dashboard.tsx` via `getTodayMacroSummary` (`src/lib/macros.functions.ts`) | Sums only rows with `calorie_estimate_status='estimated'` |

Targets (target_calories etc.) come from `daily_macro_targets` via the active effective-dated row (macros.functions.ts:40–49).

### 4. Where itemized estimates are edited

One place: `ItemBreakdown` inside `MealHistoryList.tsx` (lines 226–303).
- Per-item grams text input
- Linear rescale of kcal/P/C/F by `newGrams / origGrams`
- "Save adjusted portions" → `updateMealItems()` (`src/lib/shield.functions.ts:458`) — sums items, writes `estimated_items` + recomputes totals, sets `calorie_estimate_status='estimated'`. Does NOT re-run scoring.

`MealDetailModal` shows the breakdown read-only (no edits).

There is currently **no** UI to: add an item, remove an item, rename an item, or edit per-item macros independent of grams.

### 5. Where Shield readiness consumes meal quality

`supabase/functions/calculate-score/index.ts`:
- Pulls rows: `select entry_date, claude_quality_score, deleted` (line 350)
- For each day: averages non-null `claude_quality_score` across that day's meals → `mealQuality` (lines 207–210)
- Nutrition pillar composition (path-dependent, downstream of `scoreDay`):
  - manual-path users: 70% meal quality / 30% hydration
  - device-path users: meal quality only (HRV/RHR carry hydration signal)
- Estimated macros (kcal/P/C/F) are **not** read by calculate-score — they only feed the macro summary / rings.

### 6. Missing types / tables / RPCs / edge fns to make this stable

Already present:
- Table `shield_nutrition_logs` (estimated_*, estimated_items jsonb, calorie_estimate_status, claude_*, deleted)
- Table `daily_macro_targets`, RPC `apply_onboarding_macros`, `apply_weekly_macro_review`
- Edge fns: `score-nutrition`, `calculate-score`, `calculate-macros`, `calculate-macros-weekly`, `parse-device-upload`
- Server fns: `logMeal`, `updateMeal`, `updateMealItems`, `softDeleteMeal`, `getTodayMeals`, `getTodayMacroSummary`
- DB trigger → `shield_dispatch_calculate_score` (internal-secret dispatch)

Gaps / risks (no fixes yet — listed for the next plan):

1. **No server-side dispatch of `score-nutrition`** — invocation lives only in the client. If the user closes the app between `logMeal` and the awaited `invoke`, the row stays `claude_score_status='pending'` until they reopen MealHistoryList. **Proposed**: DB trigger on `shield_nutrition_logs` AFTER INSERT that fires a new `public.shield_dispatch_score_nutrition(_id, _user_id)` (mirror of existing dispatchers), gated by the same internal-secret. Would require:
   - new RPC `public.shield_dispatch_score_nutrition`
   - extend `score-nutrition` to accept `{nutrition_log_id}` from internal caller (already does), keep ownership check
   - keep client-side invoke as redundant fast-path

2. **No item-level editing primitives beyond grams** — `MealItem` type and `updateMealItems` accept arbitrary arrays, but UI only rescales by grams. No type/RPC changes needed; presentational-only fix in `MealHistoryList.ItemBreakdown` (add/remove/rename row, free-edit macros without grams rescale).

3. **`calorie_estimate_status` has no `manual` value** — when a user edits items, status is force-set to `estimated`, indistinguishable from AI estimate. **Proposed**: add `'manual_edited'` (or similar) to the status enum/check constraint so downstream consumers can tell user-corrected rows from AI-only rows; requires a small migration and an updated value in `updateMealItems`.

4. **`updateMeal` clears macros but does not re-invoke `score-nutrition`** — after an edit the row sits `pending` until something else triggers a retry. Today MealHistoryList's auto-retry loop catches it after 60 s. **Proposed**: have the edit path explicitly invoke `score-nutrition` like the create path does (no new tables; one-line addition in `LogModals.tsx` submit handler).

5. **No type export for `calorie_estimate_status` values** — both client and edge fn use string literals (`"pending"`, `"estimated"`, `"failed"`). Low risk, but a shared union type in `src/lib/shield.functions.ts` would prevent drift.

6. **No persistent meal-edit audit** — re-edits overwrite `estimated_items`; the prior AI estimate is lost. Not required for the current UX, but worth flagging.

7. **`MealDetailModal` is mounted on `nutrition.tsx` only** — `MealHistoryList` does not open it (rows expand inline). If we want one canonical detail view, either drop the modal or wire it from the history list. No backend changes needed.

---

### Proposed file-level changes (when approved, not now)

- `supabase/migrations/<ts>_dispatch_score_nutrition.sql` — new SQL function + AFTER INSERT trigger on `shield_nutrition_logs` (mirrors `shield_dispatch_calculate_score`).
- `supabase/functions/score-nutrition/index.ts` — no shape change; verify it accepts internal-secret dispatch with just `nutrition_log_id`.
- `supabase/migrations/<ts>_calorie_status_manual_edited.sql` — extend allowed values for `calorie_estimate_status`.
- `src/lib/shield.functions.ts` — export `CalorieEstimateStatus` union; in `updateMealItems` set status to `'manual_edited'`.
- `src/components/LogModals.tsx` — in edit branch of meal submit, also `invoke("score-nutrition", ...)`.
- `src/components/MealHistoryList.tsx` — (optional, presentational) richer item editor: add/remove/rename, edit macros without grams rescale.
- No new pages. No visual restyling. No removed functionality.
