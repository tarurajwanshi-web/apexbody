## Goal
Revert recomp phasing. Recomp returns to a simple standing delta (typically −100 kcal via `profiles.target_kcal_delta`). Delete the 10-on/4-off cycle and its flag.

## File
`supabase/functions/_shared/macro-calculation.ts` — single edit.

## Change 1 — Simplify gain/recomp branch (L311–320)

Before:
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

After:
```ts
} else if (goal === "muscle_gain" || goal === "strength" || goal === "recomposition") {
  raw_target_calories = expenditure + Number(p.target_kcal_delta ?? 0);
}
```

Deletes `cyclePos`, `inMaintenancePhase`, and the `recomp_maintenance_phase` flag assignment entirely.

## Change 2 — Move `consecutiveDeficitWeeks` computation back down

The phasing block was the only early consumer. After removal, the only remaining consumers are `refeedCandidate` (L389–391) and the `nutrition_metadata.consecutive_deficit_weeks` field (L419). Move the hoisted block (current L288–299: comment + `priorDeficitRows` query + counting loop) from above the goal branch to its original location — immediately above the `refeedCandidate` computation at ~L387–389, replacing the `// consecutiveDeficitWeeks computed above the goal branch (hoisted).` placeholder comment.

After the move:
- `consecutiveDeficitWeeks` is declared exactly once.
- No reference to it exists above its assignment (goal branch, floor/ceiling logic, Shield override, adherence guard — none touch it).
- `refeedCandidate` and the metadata field both still read the same value.

## Change 3 — Constraint

Leave `recomp_maintenance_phase` in `nutrition_weekly_reviews_flag_chk` as a harmless unused enum. No migration.

## Redeploys
- `calculate-macros-weekly`
- `trigger-weekly-macro-review`

(Bump the redeploy marker comment in each to force a rebundle of the shared module.)

## Verification after build
- `grep -n "cyclePos\|inMaintenancePhase\|recomp_maintenance_phase" supabase/functions/_shared/macro-calculation.ts` → no matches.
- `grep -n "consecutiveDeficitWeeks" …` → exactly one `let consecutiveDeficitWeeks = 0;` declaration; all reads appear on later lines.
