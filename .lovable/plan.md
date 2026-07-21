## E4 fix — onboarding protein ceiling + lean anchor

Single file: `supabase/functions/calculate-macros/index.ts`. Replace the macro-split block at L127–132 with the lean-anchored version + hard guard so onboarding matches the shared `recomputeMacros` helper in `_shared/macro-calculation.ts`.

### Diff

`supabase/functions/calculate-macros/index.ts` L126–132:

```ts
// ── Protein / fat / carbs ────────────────────────────────────────────
const bmi25_ref_kg = 25 * Math.pow((Number(height_cm ?? 0) / 100), 2);
const protein_anchor_kg = bmi25_ref_kg > 0 ? Math.min(weight_kg, bmi25_ref_kg) : weight_kg;
let target_protein_g = protein_anchor_kg * proteinPerKg(p.goal);
const fatFloorFromKg = weight_kg * 0.4;
const fatFromPct = (target_calories * 0.25) / 9;
let target_fat_g = Math.max(fatFloorFromKg, fatFromPct);
if (target_protein_g * 4 + target_fat_g * 9 > target_calories) {
  const fat_floor_hard = weight_kg * 0.35;
  target_fat_g = Math.max(fat_floor_hard, (target_calories - target_protein_g * 4) / 9);
  if (target_protein_g * 4 + target_fat_g * 9 > target_calories) {
    target_protein_g = Math.max(0, (target_calories - target_fat_g * 9) / 4);
  }
}
const target_carbs_g = Math.max(0, (target_calories - target_protein_g * 4 - target_fat_g * 9) / 4);
```

The three `Math.round(...)` calls in the `row = {...}` block (L140–142) already round `target_protein_g`, `target_carbs_g`, `target_fat_g` — kept unchanged. `let` (not `const`) because the guard may reassign protein/fat.

### Scope confirmations

- `height_cm` in scope from L55.
- `weight_kg` in scope from L54.
- `proteinPerKg` imported/defined at L19.
- No other logic touched — BMR, TDEE, deltaKcal, `target_calories`, RPC call, weight_trend seed all unchanged.

### Deploy

Redeploy `calculate-macros` only. Confirm fresh deploy timestamp.

### Verification

- Obese user (e.g. 140kg @ 170cm, fat_loss): protein anchored to BMI-25 ref (~72kg × 2.2 = ~159g) not 140×2.2=308g; carbs ≥ 0.
- Normal-BMI user unchanged (protein_anchor_kg = weight_kg when bodyweight ≤ BMI-25 ref).
- Tight-deficit case where protein+fat would exceed calories: fat drops to 0.35×kg floor, then protein reduces, carbs floor at 0 (never negative).
