## Goal

Fix `src/routes/nutrition.tsx` so the review card reads real data from `nutrition_weekly_reviews` and can apply the adjustment via the existing `apply_weekly_macro_review` RPC. Scope: this file only.

## Changes to `src/routes/nutrition.tsx`

### 1. Imports (lines 21-29)

Drop `getMacroAdjustmentReview` and `MacroAdjustmentReview` from the `@/lib/macros.functions` import. Keep the rest.

### 2. State + server-fn refs

- Remove `const [macroReview, setMacroReview] = useState<MacroAdjustmentReview | null>(null);` (line 85).
- Remove `const fetchMacroReview = useServerFn(getMacroAdjustmentReview);` (line 104).
- Add:
  ```ts
  type WeeklyReviewRow = {
    id: string;
    decision: "reduce" | "increase" | "capped" | "hold";
    confidence_tier: "high" | "medium" | "low" | null;
    flag_reason: string | null;
    new_target_calories: number;
    old_target_calories: number;
    adjustment_kcal: number;
    applied_target_id: string | null;
    applied_at: string | null;
    week_start_date: string;
    week_end_date: string;
    days_logged: number;
    weigh_in_count: number;
    training_load_index: number | null;
    bmr: number;
    target_protein_g: number;
    target_carbs_g: number;
    target_fat_g: number;
    blended_tdee: number;
    new_observed_tdee: number | null;
    old_observed_tdee: number | null;
    raw_target_calories: number;
    adherence_pct: number;
    eligible: boolean;
    abnormal_week: boolean;
    timezone_used: string;
  };
  const [weeklyReview, setWeeklyReview] = useState<WeeklyReviewRow | null>(null);
  const [applyingReview, setApplyingReview] = useState(false);
  ```

### 3. `reloadNutritionSnapshot` (lines 130-149)

Replace the `fetchMacroReview()...` Promise.allSettled entry with a direct Supabase query selecting:

```
id, decision, confidence_tier, flag_reason,
new_target_calories, old_target_calories, adjustment_kcal,
applied_target_id, applied_at, week_start_date, week_end_date,
days_logged, weigh_in_count, training_load_index,
bmr, target_protein_g, target_carbs_g, target_fat_g,
blended_tdee, new_observed_tdee, old_observed_tdee,
raw_target_calories, adherence_pct, eligible, abnormal_week, timezone_used
```

Filtered by `user_id = auth uid`, `applied_target_id IS NULL`, `decision IN ('reduce','increase','capped')`, ordered by `week_start_date desc`, `limit(1).maybeSingle()`. Result piped into `setWeeklyReview`.

### 4. Apply handler

```ts
const handleApplyReview = async () => {
  if (!weeklyReview || applyingReview) return;
  setApplyingReview(true);
  try {
    const { data: u } = await supabase.auth.getUser();
    const uid = u.user?.id;
    if (!uid) throw new Error("not_signed_in");
    const today = getLocalDateISO(userTz);
    const { error } = await supabase.rpc("apply_weekly_macro_review", {
      p_review_id: weeklyReview.id,
      p_user_id: uid,
      p_week_start_date: weeklyReview.week_start_date,
      p_week_end_date: weeklyReview.week_end_date,
      p_effective_start_date: today,
      p_weigh_in_count: weeklyReview.weigh_in_count,
      p_days_logged: weeklyReview.days_logged,
      p_adherence_pct: weeklyReview.adherence_pct,
      p_eligible: weeklyReview.eligible,
      p_confidence_tier: weeklyReview.confidence_tier,
      p_abnormal_week: weeklyReview.abnormal_week,
      p_old_target_calories: weeklyReview.old_target_calories,
      p_old_observed_tdee: weeklyReview.old_observed_tdee ?? 0,
      p_new_observed_tdee: weeklyReview.new_observed_tdee ?? 0,
      p_blended_tdee: weeklyReview.blended_tdee,
      p_raw_target_calories: weeklyReview.raw_target_calories,
      p_new_target_calories: weeklyReview.new_target_calories,
      p_adjustment_kcal: weeklyReview.adjustment_kcal,
      p_decision: weeklyReview.decision,
      p_flag_reason: weeklyReview.flag_reason ?? "",
      p_timezone_used: weeklyReview.timezone_used,
      p_bmr: weeklyReview.bmr,
      p_target_protein_g: weeklyReview.target_protein_g,
      p_target_carbs_g: weeklyReview.target_carbs_g,
      p_target_fat_g: weeklyReview.target_fat_g,
    });
    if (error) throw error;
  } catch (e) {
    console.error("[apply-weekly-review]", e);
  } finally {
    setApplyingReview(false);
    await reloadNutritionSnapshot();
  }
};
```

Note: the review row's existing review record will conflict with the RPC's `INSERT INTO nutrition_weekly_reviews` (PK collision on `p_review_id`). Flag — see Open question below.

### 5. JSX usage

- Line 541: `<MacroReviewCard review={macroReview} />` → `<WeeklyReviewCard review={weeklyReview} applying={applyingReview} onApply={handleApplyReview} />`.
- Line 1224 (inside `WeeklyGraphSheet`): `<MacroReviewCard review={macroReview} compact />` → `<WeeklyReviewCard review={review} applying={applying} onApply={onApply} compact />`.
- `WeeklyGraphSheet` props (lines 1108-1114, 604-609): rename `macroReview: MacroAdjustmentReview | null` → `review: WeeklyReviewRow | null`, add `applying: boolean`, `onApply: () => void`. Caller passes `review={weeklyReview} applying={applyingReview} onApply={handleApplyReview}`.

### 6. Replace `MacroReviewCard` with `WeeklyReviewCard` (lines 1468-1542)

New component:

- Returns `null` when `review` is null.
- Container matches current card styling (`rounded-2xl bg-bg-2 border border-white/5 p-4`, `mx-5 mt-4` unless `compact`).
- Header row: "Next target review" + week range via `formatRangeLabel`.
- Body:
  - Decision line (Reduce / Increase / Capped) + confidence tier chip.
  - `{old_target_calories} kcal → {new_target_calories} kcal` (tabular-nums).
  - `{adjustment_kcal > 0 ? '+' : ''}{adjustment_kcal} kcal` line.
  - Friendly flag line for `flag_reason` (mapping: `floor_aware_low_adherence` → "Low adherence at calorie floor", `low_adherence` → "Low adherence last week", `low_adherence_muscle_gain` → "Eat closer to target before adjusting", `refeed_candidate` → "Refeed candidate — consider a recovery week", `deficit_capped_for_safety` → "Capped for safety", `abnormal_week` → "Abnormal week — held", else show raw string).
- Footer: `Apply` button. Disabled when `applying`, `confidence_tier === 'low'`, or `abnormal_week`. Shows spinner while applying.
- Token discipline: only `text-[10/12/14/16/18/20]`, no `font-bold|semibold|extrabold|black`, no `rounded-3xl` (lint:ui rules).

### 7. ProgressRow

Confirmed: only consumed by `MacroReviewCard` (lines 1493-1494) and defined at 1544. Delete it together with `MacroReviewCard`.

## Open question (does not block plan, surface during build)

The DB RPC `apply_weekly_macro_review` does an `INSERT` into `nutrition_weekly_reviews` with `p_review_id`. Since the row already exists (the engine wrote it), the RPC will fail with a unique-key violation on `id`. The clean client-side approach is to pass a **new** `p_review_id = crypto.randomUUID()` and let the RPC insert a new "applied" review row, but that leaves the original row un-applied and still surfacing in the SELECT (because its `applied_target_id` stays null). 

Recommendation during implementation: pass `p_review_id = crypto.randomUUID()`, and immediately after a successful RPC also `UPDATE nutrition_weekly_reviews SET applied_target_id = <returned id>, applied_at = now() WHERE id = weeklyReview.id` so the original row drops out of the pending query. This is the minimum client-side path that works against the existing RPC without a schema change. I'll implement that unless you say otherwise.

## Out of scope

- `src/lib/macros.functions.ts` cleanup (leave broken fn in place; another caller search is a separate task).
- Visual baselines — `bun run test:visual:update` after the change if the card renders differently.  

  In the `handleApplyReview` function, after the successful RPC call, add the follow-up UPDATE:
  ts
  ```ts
  await supabase
    .from("nutrition_weekly_reviews")
    .update({ applied_target_id: data, applied_at: new Date().toISOString() })
    .eq("id", weeklyReview.id);
  ```
  Note that `apply_weekly_macro_review` returns the new `daily_macro_targets` UUID — capture it from `data` in the RPC response to use in the UPDATE.
  So the RPC call becomes:
  ts
  ```ts
  const { data: newTargetId, error } = await supabase.rpc("apply_weekly_macro_review", {
    p_review_id: crypto.randomUUID(),
    // ... rest of params
  });
  if (error) throw error;
  // Mark original review row as applied
  await supabase
    .from("nutrition_weekly_reviews")
    .update({ applied_target_id: newTargetId, applied_at: new Date().toISOString() })
    .eq("id", weeklyReview.id);
  ```
  Everything else in the plan is approved as written. Build it.