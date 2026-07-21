## Weekly macro engine hardening (E1–E7)

Single file: `supabase/functions/_shared/macro-calculation.ts`. Then rebundle/redeploy `calculate-macros-weekly` and `trigger-weekly-macro-review` (NOT `calculate-macros`). F1 goal-deficit block, decision logic, floor/ceiling caps, protein/fat/carbs split rules, modifier overrides, and the RPC call are not touched beyond the specific edits below.

### Pre-flight note on E4

`_shared/macro-calculation.ts` contains a `recomputeMacros(targetCalories, weightKg, goal)` helper (L43–55) that is the only place protein/fat/carbs are split from bodyweight in this file. **It is currently unreferenced** — the weekly review path doesn't recompute protein/fat (the RPC keeps active values and recomputes carbs). The `calculate-macros` onboarding function has its own duplicated split which is out of scope per your instructions.

Applying E4 to `recomputeMacros` here fixes the intended split for when the weekly path adopts it and keeps the ruleset in one place. Flagging so you know it will not visibly change any weekly review output today. If you meant to also update `calculate-macros/index.ts` L127–131, say so and I'll add it.

### Edits (all in `supabase/functions/_shared/macro-calculation.ts`)

**E1 — force overwrite in `directInsertReview**` (~L361). Change `.insert({...})` to `.upsert({...}, { onConflict: "user_id,week_start_date" })`. Nothing else in the call changes.

**E2 — cap `trainingLoadIndex` for cutting goals.** `direction` is assigned at L93 (well above L193 where the clamp lives), so add immediately after the existing `Math.max(0.7, Math.min(1.3, …))` line:

```ts
if (direction === "lose" || goal === "recomposition") {
  trainingLoadIndex = Math.min(trainingLoadIndex, 1.0);
}
```

Note: `goal` is currently declared at L255 (below L193). To keep the cap where you asked, I'll hoist the `goal` const to just above the training-load section (right after the `direction` line), unchanged value: `const goal = p.goal || "recomposition";`. The later duplicate declaration inside the F1 block will be removed so we don't shadow.

**E3 — damp implausible weight swings.** Add `let flagReasonSwing: string | null = null;` near the top of `calculateMacrosForUser` alongside other `let` decls (near `let decision`, `let flagReason`). Inside `if (haveTrendData)`, immediately after `trend_delta_kg = trend - startTrend;`:

```ts
const implied_weekly_kg = Math.abs(trend_delta_kg);
if (implied_weekly_kg > 1.2) {
  trend_delta_kg = trend_delta_kg * 0.15;
  flagReasonSwing = "abnormal_weight_swing";
}
```

Just before `directInsertReview` is defined (so it runs before every insert path), add:

```ts
flagReason = flagReason ?? flagReasonSwing;
```

**E4 — protein anchored to BMI-25 reference; hard guard on protein+fat ≤ calories.** Rewrite the body of `recomputeMacros` to accept the height. Signature becomes `recomputeMacros(targetCalories, weightKg, goal, heightCm)`. Body:

```ts
const bmi25_ref_kg = 25 * Math.pow((Number(heightCm ?? 0) / 100), 2);
const protein_anchor_kg = bmi25_ref_kg > 0 ? Math.min(weightKg, bmi25_ref_kg) : weightKg;
let target_protein_g = protein_anchor_kg * proteinPerKg(goal);
const fatFloorFromKg = weightKg * 0.4;
const fatFromPct = (targetCalories * 0.25) / 9;
let target_fat_g = Math.max(fatFloorFromKg, fatFromPct);
// Guard: protein*4 + fat*9 must fit inside targetCalories
if (target_protein_g * 4 + target_fat_g * 9 > targetCalories) {
  const fat_floor_hard = weightKg * 0.35;
  target_fat_g = Math.max(
    fat_floor_hard,
    (targetCalories - target_protein_g * 4) / 9,
  );
  if (target_protein_g * 4 + target_fat_g * 9 > targetCalories) {
    target_protein_g = Math.max(0, (targetCalories - target_fat_g * 9) / 4);
  }
}
const target_carbs_g = Math.max(0, (targetCalories - target_protein_g * 4 - target_fat_g * 9) / 4);
return {
  target_protein_g: Math.round(target_protein_g),
  target_carbs_g: Math.round(target_carbs_g),
  target_fat_g: Math.round(target_fat_g),
};
```

(Helper stays unreferenced — see pre-flight note.)

**E5 — honest floor messaging.** In the capped branch (`if (raw_target_calories < floor) { … decision = "capped"; flagReason = "deficit_capped_for_safety"; }`), add — only when `direction === "lose"` — a follow-up:

```ts
flagReason = flagReason ?? "at_safe_minimum_not_deficit";
```

No math change. Since `flagReason` was just assigned `"deficit_capped_for_safety"`, the `??` is a no-op in that branch; to actually surface the honest message we override in the lose case:

```ts
if (raw_target_calories < floor) {
  new_target_calories = Math.ceil(floor);
  decision = "capped";
  flagReason = direction === "lose" ? "at_safe_minimum_not_deficit" : "deficit_capped_for_safety";
}
```

(Confirming this matches your intent — the previous string is replaced only for `lose`. If you want the old string preserved and the new one only when there is no prior flag, say so and I'll switch to a pure `??`.)

**E6 — clamp `target_rate_pct` in F1 fat_loss branch.** Replace `const rate = Number(p.target_rate_pct ?? 0);` inside the `goal === "fat_loss"` branch with:

```ts
const rate = Math.min(2.0, Math.max(0, Number(p.target_rate_pct ?? 0)));
```

No other logic change.

**E7 — stale-weight flag.** In the `current_weight_kg` fallback chain (L149–157), track a boolean:

```ts
let used_profile_weight_fallback = false;
```

declared alongside other lets. Set `used_profile_weight_fallback = true;` inside the `if (current_weight_kg == null && p.measurement_weight_kg != null)` branch. Just before the E3 flag merge line, add:

```ts
if (used_profile_weight_fallback) flagReason = flagReason ?? "stale_weight_used";
```

### Deploy

Redeploy only `calculate-macros-weekly` and `trigger-weekly-macro-review`. Confirm both return fresh deploy timestamps.

### Verification

- Force-recalc a real user twice for the same `week_start_date`: second run overwrites (no `review_insert_failed`).
- User with `fat_loss` + high strain: `trainingLoadIndex` in the persisted row is ≤ 1.0.
- Inject a 3 kg one-week swing: `weight_trend_kg_per_week` is damped ~85%, `flag_reason = "abnormal_weight_swing"` (unless a more specific reason preempted).
- `fat_loss` user hitting the floor: `flag_reason = "at_safe_minimum_not_deficit"`.
- User with `target_rate_pct = 5`: `raw_target_calories` computed as if rate were 2.
- User with no in-window weigh-in but a profile weight: `flag_reason = "stale_weight_used"`.

### Full diff will be posted for review before Build.

&nbsp;

# Accepted. For E5 use the ternary (`at_safe_minimum_not_deficit` for lose, `deficit_capped_for_safety` otherwise) — confirm nothing downstream keys on the old string for lose users first. Post the full diff before Build. On E2, show me that `goal` is declared exactly once after the hoist and the F1 block at L256 is otherwise unchanged.