## Change
In `supabase/functions/calculate-macros-weekly/index.ts`, update the `safeFloorMap` inside `processUser` so the `fat_loss` and `recomposition` floors respect a biological-sex minimum.

```ts
const sex_floor = p.biological_sex === "male" ? 1500
                 : p.biological_sex === "female" ? 1200
                 : 1350; // neutral fallback when null/unknown
const weight_floor = (p.measurement_weight_kg ?? current_weight_kg ?? 70) * 10;

const safeFloorMap: Record<string, number> = {
  fat_loss: Math.max(weight_floor, sex_floor),
  muscle_gain: blended_tdee * 0.95,
  recomposition: Math.max(blended_tdee * 0.95, sex_floor),
  strength: blended_tdee * 0.95,
  athletic_performance: blended_tdee * 0.95,
};
```

Rationale per request: `fat_loss` floor = `max(weight_kg * 10, sex_floor)`. For `recomposition` the existing floor is `blended_tdee * 0.95` (not a weight-based number); applying `Math.max(weight_kg*10, sex_floor)` there would frequently lower the floor below the TDEE-based one, so I keep `blended_tdee * 0.95` and add `sex_floor` as an additional minimum — that preserves the clinical floor without weakening the existing one. Confirm if you'd rather literally replace recomposition's floor with `Math.max(weight_kg*10, sex_floor)`.

`safeCeilingMap`, decision tree, training-load logic, and the INSERT remain unchanged.

## Verification
Re-deploy `calculate-macros-weekly`. Invoke with `{ user_id, force_recalculate: true }` for a fat-loss user whose `blended_tdee * 0.80 * trainingLoadIndex` falls under the sex floor → expect `decision = "capped"`, `flag_reason = "deficit_capped_for_safety"`, `new_target_calories ≥ sex_floor`.
