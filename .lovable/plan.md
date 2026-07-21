# Restore goal-based deficit/surplus in weekly macro engine

## Root cause (confirmed)

`macro-calculation.ts` L255 computes `raw_target_calories = blended_tdee * trainingLoadIndex` and no longer applies the goal's rate/delta. Every weekly review lands at maintenance × load index, regardless of `fat_loss` rate or `muscle_gain`/`recomposition` kcal delta. The two HTTP shells that feed this engine (`calculate-macros-weekly`, `trigger-weekly-macro-review`) also don't select `target_kcal_delta` (and `trigger-weekly-macro-review` omits `target_weight_kg` and `target_rate_pct` too), so even after the fix the engine would still see nulls.

Onboarding endpoint (`calculate-macros/index.ts`) is already correct — not touching it.

## Edits

### File 1 — `supabase/functions/_shared/macro-calculation.ts`

Add `target_kcal_delta: number | null` to the `Profile` type (after `target_rate_pct`).

Replace line 255:

```ts
const raw_target_calories = blended_tdee * trainingLoadIndex; // direction math replaces the old goalMultiplier
```

with:

```ts
const expenditure = blended_tdee * trainingLoadIndex;
let raw_target_calories: number;
if (goal === "fat_loss") {
  const rate = Number(p.target_rate_pct ?? 0);
  if (rate <= 0) {
    raw_target_calories = expenditure; // no rate on file → hold at maintenance, never fake a deficit
  } else {
    const weekly_deficit_kcal = (rate / 100) * current_weight_kg * 7700 / 7;
    raw_target_calories = expenditure - weekly_deficit_kcal;
  }
} else if (goal === "muscle_gain" || goal === "strength" || goal === "recomposition") {
  raw_target_calories = expenditure + Number(p.target_kcal_delta ?? 0);
} else {
  raw_target_calories = expenditure; // athletic_performance, maintenance, unmatched → maintenance
}
```

Nothing else in the file changes (decision logic, floor/ceiling caps, protein/fat/carbs, modifier overrides, RPC call all untouched).

### File 2 — `supabase/functions/calculate-macros-weekly/index.ts`

Append `, target_kcal_delta` to the profile `select` string (currently ends `...target_rate_pct, reached_target_at`).

### File 3 — `supabase/functions/trigger-weekly-macro-review/index.ts`

Append `, target_weight_kg, target_rate_pct, target_kcal_delta` to the profile `select` string.

## Post-Build

- Redeploy `calculate-macros-weekly` and `trigger-weekly-macro-review`. Do NOT redeploy `calculate-macros`.
- Verify on a real non-dummy user's next weekly review: `raw_target_calories` for `fat_loss` sits clearly below `blended_tdee`; `muscle_gain`/`strength` above by the delta; `recomposition` below by |delta|.

## Diff will be shown before switching to Build.  
  
Yes — approve. This matches the corrected fix exactly.

Two small watch-items when the diff comes back, not blockers:

1. **File 2 (`calculate-macros-weekly`) select ends `...target_rate_pct, reached_target_at**` — Lovable's plan says append `, target_kcal_delta`. Make sure it lands *inside* the select string, not after `reached_target_at` as a stray token. If it appends to the very end that's fine (`...reached_target_at, target_kcal_delta`), just confirm it's a valid comma-separated column in the string when you see the diff.
2. `**current_weight_kg` must be in scope at L255.** The fat_loss branch uses it. It was in the original file above that line, so it should be — but glance at the diff to confirm the variable is defined before the new block, since Lovable is inserting, not just replacing.