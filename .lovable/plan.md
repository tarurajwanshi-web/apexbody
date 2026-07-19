# B6.3 — Deterministic Set-Count Filler

## Problem
Real Sonnet plans now write (B6.2b) but under-prescribe volume — roughly half of target per muscle. Ceilings hold; targets exist; the clamp only trims down. Nothing fills up to the engine's `target_sets`. Fix deterministically — engine computes, LLM expresses.

## Scope
- **NEW**: `fillPlanToTargets` in `supabase/functions/_shared/training-rules.ts` (mirror of `clampPlanToCeilings`).
- **EDIT**: `supabase/functions/generate-plan/index.ts` — invoke filler immediately before the existing clamp at ~line 475.

No other files. No new LLM calls. No schema changes.

## `fillPlanToTargets(plan, targetByMuscle, ceilingByMuscle)`

Mirror-image of the clamp; reuses the same `sumsByMuscle` walk pattern and role-priority helpers.

### Per-role caps and priority
- **Set cap per exercise** (`maxSetsForRole`):
  - `primary`, `power`, `secondary` → 6
  - `accessory` → 5
  - `isolation`, `core` → 4
- **Growth priority** (inverse of clamp — highest first):
  - `primary`/`power` → 3
  - `secondary` → 2
  - `accessory` → 1
  - `isolation`/`core` → 0

### Loop (guard 200, same as clamp)
1. Compute `sumsByMuscle()`.
2. Find muscle with largest positive deficit: `target_sets - currentSum`. Apply tolerance — skip if `currentSum >= target_sets - 1`.
3. If none → break.
4. For that muscle, pick the best exercise to add ONE set to:
   - Skip exercises already at their role cap.
   - Skip if adding one set would breach `ceilingByMuscle[muscle]`.
   - Tiebreak: highest growth priority; then lowest current sets (spread across compounds before piling on one).
5. If no legal exercise → record `"<muscle>: under target by N, no legal fill (cap/ceiling)"` and mark that muscle done for this pass.
6. Otherwise `ex.sets += 1`; log `"<muscle>: +1 set to <name> (<role>, day <n>) → <sets> sets"`.

Returns `{ plan, fills: string[] }`.

### Termination
- Fills strictly increase set counts and each muscle either reaches target-tolerance or is marked done.
- Ceiling is never exceeded — filler is monotone up, clamp is monotone down. Fill-then-clamp terminates and clamp should be a no-op on correct output.

## Call site — `generate-plan/index.ts` (~line 475)

Insert immediately BEFORE the existing `clampPlanToCeilings(plan, ceilings)` call, inside the same `if (hasLandmarks)` block, using landmarks already assembled there:

```ts
const targets: Record<string, number> = {};
const ceilings: Record<string, number> = {};
for (const [m, v] of Object.entries(landmarksByMuscle)) {
  targets[m] = v.target_sets;
  ceilings[m] = v.fuel_adjusted_mrv;
}
const filled = fillPlanToTargets(plan, targets, ceilings);
plan = filled.plan;
if (filled.fills.length) {
  console.log(`[generate-plan] filled ${user_id}: ${filled.fills.length} add(s)`, filled.fills);
}
// existing clamp call unchanged — safety net, should be a no-op on correct fill
const clamped = clampPlanToCeilings(plan, ceilings);
```

Also add `fillPlanToTargets` to the existing import from `_shared/training-rules.ts` at the top of the file.

## Ordering rationale
Filler respects ceiling → clamp finds nothing to trim (belt-and-braces). Clamp-then-fill would oscillate; fill-then-clamp is monotonic.

## Verification
1. After deploy, regenerate for `1f83792a-5b77-4c6a-aafe-858f21380f14`.
2. Wait ~3min for the B6.2b background Sonnet upgrade.
3. Run the per-muscle adherence query.

**PASS criteria**:
- Muscles within ±2 of `target_sets` (or logged as ceiling/cap-blocked shortfall).
- Zero ceiling breaches.
- `total_sets` moves from ~44 toward ~90–110.
- No single exercise exceeds its per-role cap (spot-check: no 6-set isolation lifts).
- Edge logs show the `[generate-plan] filled …` line with the fill list.

## Out of scope (deferred)
- Compound-first session sequencing.
- Onboarding delivery race fix.
- Phenotype priority-weight hooks.
- B7 day-1 ring dispatch.
