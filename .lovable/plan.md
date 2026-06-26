# Onboarding Full Rewrite — Plan

**Scope:** one file only — `src/routes/_authenticated/onboarding.tsx`. Full replacement, no patching. Schema already has `experience_level` and `eating_pattern` columns on `profiles` (verified). `coaching_time` deliberately not collected — push notifications are not built yet.

## New 8-step flow

1. About you — name, age, biological_sex (unchanged UI)
2. **Experience** (NEW) — beginner / intermediate / advanced (tap cards)
3. Goal (unchanged)
4. Training days (unchanged)
5. Equipment (unchanged)
6. **Eating pattern** (NEW) — standard / intermittent / plant_based / flexible (2×2 grid)
7. **Body data** (redesigned, single flow, no path picker)
8. Review + submit

Progress bar: `step / 8`. Label: "Step N of 8".

## Step 7 redesign

- Required: Weight (UnitField kg/lb), Height (UnitField cm/in), Body fat % via **sex-linked slider** (range + descriptions from `BF_RANGE` / `BF_DESCRIPTIONS` tables in the spec; default per sex on mount).
- Slider UI: big 32px % number, colour-coded label (blue/green/secondary/amber by bucket), italic 12px cue, ACE footnote.
- Collapsed-by-default sections:
  - "I have a body scan result" → reveals optional Lean mass (kg) input.
  - "Add measurements" → reveals waist / hip / arm / thigh (all optional).
- Full-width "Skip for now" button (`bg-bg-2` card style).
- `bodyDataType` derived on submit: `dexa` if lean mass filled, `measurements` if weight+height+BF filled, `null` if skipped.

## Step 8 review

Card with rows for every captured field. Body data row reflects state (DEXA / Visual estimate / "Not provided — macro targets will be estimated" in `text-amber-400`). CTA label flips to "Continue without body data" when skipped.

## Submit payload

Upsert to `profiles` on `user_id` with all fields per spec, including new `experience_level` and `eating_pattern`. Omit `coaching_time`.

Engine bootstrap branching:
- Has body data → `Promise.allSettled([calculate-macros, generate-plan])`
- Skipped → only `generate-plan`
- `logBodyMeasurement` still guarded by `bodyDataType !== null`.

Then `navigate({ to: "/dashboard" })`.

## Draft type

Replace existing `Draft` with the typed shape from the spec (adds `experienceLevel`, `eatingPattern`; `bodyDataType` becomes derived, not user-chosen; keeps `dexaBf`, `dexaLean`, circumferences, weight, height).

## Validation

Per-step `canContinue` switch exactly as specified (step 7: skipped OR weight+height present; slider always has a default).

## Reset mode

- Still starts at step 3 (goal).
- Add `useEffect` (gated on `isReset`) to prefetch `experience_level`, `eating_pattern`, `goal`, `equipment_access`, `training_day_codes` from `profiles` and `patch()` them into the draft so submit doesn't null them out.
- Reset payload additions: `experience_level`, `eating_pattern`.

## Preserved as-is (do not touch)

`BuildingPlanScreen`, `UnitField`, `UnitToggle`, `Field`, `logBodyMeasurement`, route definition, `validateSearch`, `getBrowserTimezone`, `isReset` mode entry logic, all design tokens (`SELECTED_STYLE`, `gradient-brand`, `bg-bg-1/2`, `rounded-2xl`).

## Out of scope

No other file changes. No schema changes (columns exist). No edge function edits. No router changes.

## Post-build verification

Run the spec's SQL against `profiles` for rows with `profile_completed_at > now() - interval '1 hour'` and confirm `experience_level` + `eating_pattern` are non-null. (`coaching_time` will remain null by design.)
