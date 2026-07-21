## V3 recomp phasing — stop the indefinite slow-cut

Product call: recomposition cycles 10 weeks at `target_kcal_delta` (negative) then 4 weeks at maintenance (delta 0), looping. Uses the already-computed `consecutiveDeficitWeeks`. No new state, no new columns.

### File 1: `supabase/functions/_shared/macro-calculation.ts`

**Step A — Hoist `consecutiveDeficitWeeks` computation above the F1 goal branch.**

Move lines 365–373 (the `priorDeficitRows` query + counting loop) to sit immediately before line 288 (`const expenditure = blended_tdee * trainingLoadIndex;`). Delete the original block at 365–373. The `refeedCandidate` block at 374–378 stays in place — it still reads `consecutiveDeficitWeeks` fine from the hoisted declaration.

Confirmed: `consecutiveDeficitWeeks` will be declared exactly once, above L288. `refeedCandidate` and the recomp branch both read it.

**Step B — Phase the recomp deficit in the F1 goal branch (L298–299).**

Replace:
```ts
} else if (goal === "muscle_gain" || goal === "strength" || goal === "recomposition") {
  raw_target_calories = expenditure + Number(p.target_kcal_delta ?? 0);
}
```

With:
```ts
} else if (goal === "muscle_gain" || goal === "strength" || goal === "recomposition") {
  if (goal === "recomposition") {
    // Phase the deficit: 10 weeks on, 4 weeks maintenance, to stay net weight-neutral.
    const cyclePos = consecutiveDeficitWeeks % 14;
    const inMaintenancePhase = cyclePos >= 10;
    raw_target_calories = inMaintenancePhase ? expenditure : expenditure + Number(p.target_kcal_delta ?? 0);
    if (inMaintenancePhase) flagReason = flagReason ?? "recomp_maintenance_phase";
  } else {
    raw_target_calories = expenditure + Number(p.target_kcal_delta ?? 0);
  }
}
```

Note on the prompt's `!flagReasonSwing` guard: `flagReasonSwing` is only assigned inside the EMA block earlier and would already be captured by the merge at L393 (`flagReason ?? flagReasonSwing`). Using `flagReason ?? "recomp_maintenance_phase"` here preserves precedence — a more specific flag (abnormal_week, low_adherence, etc.) still wins, and the deferred swing flag still surfaces via the final merge if nothing more specific set flagReason.

No other logic changes. Decision logic, floor/ceiling caps, protein/fat/carb split, modifier overrides, RPC — all untouched.

### File 2: new migration — expand CHECK constraint

Add `'recomp_maintenance_phase'` to `nutrition_weekly_reviews_flag_chk`. Same drop-and-recreate pattern as the last flag migration. Full existing allow-list preserved:

```sql
ALTER TABLE public.nutrition_weekly_reviews DROP CONSTRAINT IF EXISTS nutrition_weekly_reviews_flag_chk;
ALTER TABLE public.nutrition_weekly_reviews ADD CONSTRAINT nutrition_weekly_reviews_flag_chk
  CHECK (flag_reason IS NULL OR flag_reason = ANY (ARRAY[
    'insufficient_data','abnormal_week','deficit_capped_for_safety','missing_required_profile_data',
    'low_adherence_muscle_gain','refeed_candidate','floor_aware_low_adherence','low_adherence',
    'at_safe_minimum_not_deficit','abnormal_weight_swing','stale_weight_used',
    'deficit_caution_override','fuel_more_override','target_reached','invalid_goal_value',
    'missing_target_rate','recomp_maintenance_phase'
  ]));
```

(I'll confirm the exact current allow-list from the previous migration before submitting, and include every value already present — the list above is my current best read; the migration will mirror the DB's current constraint exactly plus the one new value.)

### Deploy

Redeploy `calculate-macros-weekly` and `trigger-weekly-macro-review` (bump the redeploy comment date in each). Do NOT redeploy `calculate-macros` — onboarding runs before any weekly review exists, so `consecutiveDeficitWeeks` is always 0 and the recomp phasing is a no-op there anyway.

### Verification

- Recomp user with `consecutiveDeficitWeeks` in [0..9] → `raw_target_calories = expenditure + target_kcal_delta` (deficit applied), no `recomp_maintenance_phase` flag.
- Recomp user with `consecutiveDeficitWeeks` in [10..13] → `raw_target_calories = expenditure` (maintenance), flag set (unless a higher-priority flag already set).
- Recomp user at week 14 → `cyclePos = 0`, back into deficit.
- `muscle_gain` / `strength` → unchanged, always adds delta.
- `fat_loss`, `maintain`, other → unchanged.
