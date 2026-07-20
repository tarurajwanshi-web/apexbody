# Fix: macro delta collapses to zero for every non-maintenance goal

## Root cause (confirmed)

- `onboarding.tsx` `computeTargetRatePct` returns `sign × (pct/100)` — a signed fraction (e.g. `-0.005`).
- `calculate-macros/index.ts` treats `target_rate_pct` as a raw percent: it re-applies the sign via `direction` and divides by 100 again (`clampedRate / 100`). Net effect: sign cancels, magnitude divided by 100 → ~0 kcal delta → maintenance.
- Recomposition is worse: `direction === "maintain"` skips the delta block entirely, so its kcal-based deficit never lands.

## Fix — two files only

### File 1 — `src/routes/_authenticated/onboarding.tsx`

Replace `computeTargetRatePct` (~L108–124) with:

```ts
function computeNutritionTargets(draft: Draft): {
  target_rate_pct: number | null;
  target_kcal_delta: number | null;
}
```

Per-goal returns:


| Goal                       | `target_rate_pct`                                                | `target_kcal_delta`                                                                       |
| -------------------------- | ---------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| `fat_loss`                 | raw positive `item.pct` from `PACES_FAT_LOSS` (no sign, no /100) | `null`                                                                                    |
| `muscle_gain` / `strength` | `null`                                                           | by `experienceLevel`: beginner 350, intermediate 250, advanced 150; null → 250 (positive) |
| `recomposition`            | `null`                                                           | `-item.kcalDelta` from `PACES_RECOMP` (mild 100 / moderate 250 / focused 400 → negative)  |
| `athletic_performance`     | `null`                                                           | `null`                                                                                    |


Pace tables (`PACES_FAT_LOSS`, `PACES_MUSCLE_GAIN`, `PACES_STRENGTH`, `PACES_RECOMP`) stay as-is — muscle_gain/strength pace picks continue to drive UI copy but no longer feed the macro delta directly.

In submit (~L246–260): call `computeNutritionTargets(draft)` once; write both `target_rate_pct` and `target_kcal_delta` into `commonBody`.

### File 2 — `supabase/functions/calculate-macros/index.ts`

Replace direction-based validation (~L66–82) with goal-based:

- `fat_loss` → require `target_rate_pct != null && > 0`, else 422. Keep target_weight + BMI-below-18.5 checks.
- `muscle_gain` / `strength` → require `target_kcal_delta != null && > 0`, else 422. Target-weight + BMI-≥35 checks apply **only if** `target_weight_kg` is present (not hard-required).
- `recomposition` → require `target_kcal_delta != null && < 0`, else 422. No target_weight gate.
- `athletic_performance` → maintenance, no gate.

Replace delta block (~L99–105) with:

```ts
let deltaKcal = 0;
if (goal === "fat_loss") {
  const ceiling = rateCeilingFor(goal)!;
  const clampedRate = Math.min(Number(p.target_rate_pct), ceiling);
  const magnitude = (clampedRate / 100) * weight_kg * 7700 / 7;
  deltaKcal = -magnitude;
} else if (goal === "muscle_gain" || goal === "strength" || goal === "recomposition") {
  deltaKcal = Number(p.target_kcal_delta);
}
```

Drive branching off `p.goal` (string), not `direction`, so recomposition receives its negative delta despite being `maintain`.

## Unchanged

BMR (Mifflin / Katch-McArdle), TDEE, activity multiplier, protein per kg, fat floor, carb remainder, `apply_onboarding_macros` RPC, `weight_trend_state` seeding, `Math.max(1200, …)` floor.

## Notes

- `profiles.target_kcal_delta` must already be a writable column for this to persist. If it isn't in the schema, this plan needs a migration added before Build — flagging so you can confirm before I execute.
- No changes to weekly reconciliation (`calculate-macros-weekly`) in this batch; it operates on stored targets and is unaffected by the onboarding fix.

&nbsp;

Approved — build it as planned. One prerequisite is already handled: the `[profiles.target](http://profiles.target)_kcal_delta` column exists, so the writes in File 1 will persist.

Proceed with both files exactly as specced. Confirm on completion:

- File 1: `computeNutritionTargets` returns the per-goal rate/delta per the table, and submit writes both `target_rate_pct` and `target_kcal_delta` into `commonBody`.
- File 2: validation is goal-based (fat_loss requires rate > 0; muscle_gain/strength require delta > 0; recomposition requires delta < 0 with no target_weight gate), and the delta block branches off `p.goal`, not `direction`, so recomposition receives its negative delta.

Everything under "Unchanged" stays untouched.