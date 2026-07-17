## Part 1 — Split Step 6 into three screens (6 → 8 steps)

**File:** `src/routes/_authenticated/onboarding.tsx`

1. Change `const TOTAL = 6` to `const TOTAL = 8`. Progress bar denominator and label ("Step X of 8") update automatically since both derive from `TOTAL`.
2. Retire the existing compound `FuelPlanStep` component. Replace the `step === 6` branch with three new single-focus step components rendered at `step === 6`, `7`, and `8`. Keep `AboutYouStep`, `ExperienceStep`, `GoalStep`, `DaysStep`, `EquipmentStep` unchanged.
3. New step components (reusing existing `StepHeader`, `FieldLabel`, `InputBox`, unit-toggle, and card primitives already in the file):

   - **Step 6 — BodyBasicsStep** (`"Your body basics"` / `"We'll refine this from your weekly check-ins."`)
     - Weight field (kg/lb unit toggle, numeric input, writes `weightKg` canonical kg).
     - Height field (cm/ft-in unit toggle, ft+in dual input or cm single input, writes `heightCm`).
     - Nothing else.

   - **Step 7 — EatingPatternStep** (`"How do you eat, {name}?"` / `"So we can time your meals right."`)
     - 2×2 grid of the existing `EATING_PATTERNS` cards, same card style as `GoalStep`.
     - Helper below grid: `"You can change this any time in Settings."`
     - Nothing else.

   - **Step 8 — TargetStep** (`"Your target"` + goal-specific sub-copy)
     - Sub varies by `draft.goal`:
       - `fat_loss` → `"How much would you like to lose, and how fast?"`
       - `muscle_gain` / `strength` → `"How much would you like to gain, and how fast?"`
       - `recomposition` → `"Where do you want to land?"`
       - `athletic_performance` → `"What's your target weight for competition?"`
     - Target-weight numeric input; unit matches Step 6's `weightUnit` (read-only display, no toggle here).
     - `"How fast?"` label + three vertical pill buttons from existing `PACES` array (Steady / Standard / Aggressive with rate + descriptor).
     - Writes `targetWeightKg` and `pace`.

4. Split the `canContinue` case-6 logic into three cases:
   - `case 6`: `weightValid && heightValid`.
   - `case 7`: `!!draft.eatingPattern`.
   - `case 8`: target-weight + goal-direction + BMI safety checks currently living in case 6.

5. `next()` now bumps to `TOTAL + 1 = 9` (Review). `isReview = step > TOTAL`. `displayStep` and progress fill (`displayStep / TOTAL * 100 = 12.5% increments`) both update automatically.

6. Review copy: change `"All set"` → `"Ready, {name}?"` in `ReviewStep`, keep button `"Build my plan"`. Submission payload, engine columns, and `logBodyMeasurement` call are unchanged — every field currently written still writes.

7. Reset-mode: `minStep = isReset ? 3 : 1` unchanged. Reset users still walk from Step 3 through the new Step 8 + Review.

**Viewport check:** With one decision per screen (Body basics = 2 fields; Eating pattern = 4 cards; Target = 1 field + 3 pills), every step fits iPhone SE (667pt) between the sticky header and the fixed footer button. No scroll.

## Part 2 — Amber gradient token, applied globally

**File:** `src/styles.css`

1. Add token in `:root`:
   ```css
   --amber-gradient: linear-gradient(135deg, #F5A524 0%, #FFC97A 100%);
   ```
2. Update `@utility gradient-brand` body to reference `var(--amber-gradient)` so any consumer of `gradient-brand` inherits the fix.

**Retrofits (all in `src/routes/_authenticated/onboarding.tsx` unless noted):**

- **Continue and Build my plan buttons** — replace inline `linear-gradient(...)` with `var(--amber-gradient)`. Text color stays `#0A0B12`, weight 500. (Already correct dark text; just swap the background token.)
- **Progress bar fill** — swap the inline `linear-gradient(90deg, ...)` for `var(--amber-gradient)` (135deg is fine on a 4px-tall bar; keeps one token).
- **Weight kg/lb and height cm/ft-in segmented toggles** — selected pill background becomes `var(--amber-gradient)` with text `#0A0B12` weight 500. Unselected pill unchanged (bg-2 / text-secondary).
- **Day-of-week selected circles** (`DaysStep`) — selected circle fill becomes `var(--amber-gradient)`, text `#0A0B12`.
- **Pace pill selected state** (new `TargetStep`) — gradient inner wash + amber-500 hairline border, not solid fill. Pattern:
  ```
  background: linear-gradient(135deg, rgba(245,165,36,0.10), rgba(255,201,122,0.04));
  border: 1px solid var(--amber-500);
  ```
- **Selected card border-glow** — `CARD_ACTIVE` keeps its `1px amber-500` border but adds an inner wash:
  ```
  background: linear-gradient(135deg, rgba(245,165,36,0.04), rgba(255,201,122,0.02));
  ```
  Applies automatically to Experience, Goal, Equipment, Eating-pattern cards since they all consume `CARD_ACTIVE`.

**Auth screen ring arc** (`src/routes/index.tsx`) and **ambient body gradient** — verify the arc references the same gradient stops; do not touch the ambient body radial gradients (per Part 3 instructions).

**Left flat (reserved for < 20×20 accents):** ring endpoint dot, small dividers, PR badges (future), semantic warning inline text/icons.

## Part 3 — Explicitly untouched

- `src/styles.css` `html, body` background — the amber-top / teal-bottom-left radial stack stays exactly as-is.
- Every edge function, engine, migration, and profile column written on submit.
- `logBodyMeasurement` call and its arguments.
- Reset-mode `minStep = 3` behaviour.

## Part 4 — Verification checklist (post-build)

1. iPhone SE 667pt height: steps 1–8 + Review each fit without vertical scroll.
2. Header shows `"Step 1 of 8"` … `"Step 8 of 8"`, `"Review"`.
3. Progress bar fills in 12.5% increments and uses `--amber-gradient`.
4. kg/lb and cm/ft-in toggles: selected pill visibly gradient (top-left brighter, bottom-right warmer), text near-black weight 500.
5. Continue and Build my plan buttons: gradient background, near-black text.
6. Selected goal/experience/equipment/eating cards show subtle inner amber wash + amber hairline border; unselected cards unchanged.
7. Selected pace pill uses gradient wash + amber hairline border (not solid fill).
8. Ambient body background unchanged.
9. On submit, `profiles` row still contains `measurement_weight_kg`, `measurement_height_cm`, `target_weight_kg`, `target_rate_pct`, `eating_pattern`, `training_day_codes`, `equipment_access`, `goal`, `experience_level`, `biological_sex`, `age`, `name`, `input_path_preference`, `body_data_type`, `profile_completed_at`, `plan_unlock_date`, `timezone`.

No engine, migration, or edge-function changes.
