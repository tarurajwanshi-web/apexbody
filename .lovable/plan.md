## Fix — decouple `latestModifier` from the review window

### Root cause

`macro-calculation.ts` uses one readiness fetch (lines 255–261) for two different purposes:

1. `avgReadiness` — the mean of `final_score` **across the reviewed week** (correct: it's an aggregate stat about that week).
2. `latestModifier` — the "most recent" `nutrition_modifier` (should be latest at compute time, but currently comes from `readinessDays[0]` of the same week-scoped query).

Because the fetch is bounded by `.gte("score_date", week_start_date).lt("score_date", window_end_exclusive)`, `latestModifier` is really "latest within the reviewed week," not "latest overall." When the review runs after the week has ended (typical Monday-cron case), newer readiness rows are ignored.

Verified for test user `00000000-0000-0000-0001-000000000006`, review window `2026-06-22 → 2026-06-28`:
- Windowed fetch returns rows up to `2026-06-26` → `latestModifier = null` (all in-window rows have null modifier)
- Real latest at compute time is `2026-07-01` with `nutrition_modifier = fuel_more`

### Change

Add a second, unbounded readiness fetch dedicated to `latestModifier`. Keep the existing windowed fetch for `avgReadiness` unchanged — that aggregate must stay week-scoped.

In `supabase/functions/_shared/macro-calculation.ts`, after the existing readiness block (~line 270), add:

```ts
// Most recent modifier at compute time (unbounded by review window).
// Same-day directive semantics: matches generate-plan's usage and the E1 spec.
const { data: latestModifierRow } = await supa
  .from("readiness_scores")
  .select("nutrition_modifier, score_date")
  .eq("user_id", user_id)
  .order("score_date", { ascending: false })
  .limit(1)
  .maybeSingle();

const latestModifier = (latestModifierRow?.nutrition_modifier ?? null) as NutritionModifier | null;
```

Then delete the two lines currently assigning `latestReadiness` / `latestModifier` from the windowed set (lines 268–270).

`avgReadiness` computation and the `if (avgReadiness < 45 && trainingLoadIndex > 1.0)` block stay exactly as they are.

### Verify

After deploy, delete the current test row `f68b3eb1…` for the synthetic user and re-run `calculate-macros-weekly` with `force_recalculate: true`. Expected new row:

- `applied_modifier`: `fuel_more` (from `2026-07-01` readiness)
- Base decision for goal `strength` at `weightTrendPerWeek ≈ 0` and `trainingLoadIndex 0.75` → strength branch (line 380): `weightTrendPerWeek < 0.2` so decision = `trainingLoadIndex > 1.1 ? "increase" : "hold"` → `hold`
- E1 override (line 440): `fuel_more` + base `hold` + goal `strength` (≠ fat_loss) + `trend_delta_kg 0 < 0.5` → decision flips to `increase`, `modifierOverrode = true`
- Expected recorded values: `decision: increase`, `modifier_overrode_decision: true`, `applied_modifier: fuel_more`, `weight_trend_kg_per_week: 0.00`, `new_target_calories > 2060`

If the actual write doesn't match this, I'll report the mismatch rather than paper over it.

### Not in this change

- No new column, no migration (`applied_modifier` column already exists from the last batch).
- `avgReadiness` remains week-scoped — intentional.
- No change to `deficit_caution` / `fuel_more` threshold values, TDEE blending, or weight-trend branches.
- No change to `generate-plan` — it already fetches most-recent modifier the intended way; that behavior is what this fix is aligning to.
- Not touching the separate `force_recalculate` upsert gap (still requires manual delete of the current week's row to re-run). That's a distinct engine limitation; flag but don't fix here.
