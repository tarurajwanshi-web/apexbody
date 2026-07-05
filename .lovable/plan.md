Two changes to src/routes/_authenticated/onboarding.tsx. Do not touch Shield,

generate-plan, or calculate-macros logic — this is onboarding UI only, the

backend already accepts these fields.

═══════════════════════════════════════

CHANGE 1 — Body-fat becomes genuinely optional, no silent default

═══════════════════════════════════════

Delete the useEffect in BodyStep that seeds dexaBf with range.default.

dexaBf starts "" and stays "" until the user drags the slider.

Add bodyFatSkipped: boolean (default false) to Draft/EMPTY, plumb into

BodyStep as a prop with a setter via patch.

Render the body-fat slider block only when !bodyFatSkipped. When skipped,

show a neutral card: "Skipped — you can add this anytime from the Nutrition

tab for a slightly more accurate calorie target." with an "Add it now

instead" link that flips bodyFatSkipped back to false.

When shown but dexaBf === "", render a neutral "not set" state — no numeric

label, no colored description — until the user first drags the slider.

Add a "Skip — I don't know" underlined text link beneath the slider (only

when !bodyFatSkipped) that sets bodyFatSkipped=true and clears dexaBf.

Weight and height stay mandatory — unchanged.

Submit payload (both isReset and fresh branches): if bodyFatSkipped ||

draft.dexaBf === "", send dexa_body_fat_pct: null. Apply the same rule to

the logBodyMeasurement call's body_fat_pct.

═══════════════════════════════════════

CHANGE 2 — New "Target & Pace" step (step 8, before Review)

═══════════════════════════════════════

TOTAL: 8 → 9. Draft/EMPTY: add targetWeight: string, targetRatePct: string

(both "").

Add these module-level lookups exactly as specified:

  const GOAL_DIRECTION: Record<Goal, "lose" | "gain" | "maintain"> = {

    fat_loss: "lose", muscle_gain: "gain", strength: "gain",

    recomposition: "maintain", athletic_performance: "maintain",

  };

  const RATE_CEILING: Record<Goal, number> = {

    fat_loss: 1.5, muscle_gain: 0.5, strength: 0.35,

    recomposition: 0.4, athletic_performance: 0.4,

  };

  const RATE_ZONES: Record<Goal, { max: number; label: string; blurb: string }[]> = {

    fat_loss: [

      { max: 0.5, label: "Sustainable", blurb: "Protects lean mass, easiest to stick to." },

      { max: 1.0, label: "Moderate", blurb: "Faster, still evidence-supported for most people." },

      { max: 1.5, label: "Aggressive", blurb: "Faster results, higher risk of losing muscle alongside fat." },

    ],

    muscle_gain: [

      { max: 0.15, label: "Sustainable", blurb: "Minimizes fat gain while building muscle." },

      { max: 0.25, label: "Moderate", blurb: "Standard lean-gain pace." },

      { max: 0.5, label: "Aggressive", blurb: "Faster scale movement, more of it will be fat, not muscle." },

    ],

    strength: [

      { max: 0.15, label: "Sustainable", blurb: "Small surplus, supports strength adaptation." },

      { max: 0.25, label: "Moderate", blurb: "Standard pace for a strength-focused gain." },

      { max: 0.35, label: "Aggressive", blurb: "Faster gain, more of it will be fat." },

    ],

    recomposition: [

      { max: 0.15, label: "Gentle", blurb: "Wide tolerance — we rarely adjust unless you drift." },

      { max: 0.3, label: "Moderate", blurb: "Standard correction if your weight moves off target." },

      { max: 0.4, label: "Tight", blurb: "We correct quickly — best if you want to hold a precise number." },

    ],

    athletic_performance: [

      { max: 0.15, label: "Gentle", blurb: "Wide tolerance — we rarely adjust unless you drift." },

      { max: 0.3, label: "Moderate", blurb: "Standard correction if your weight moves off target." },

      { max: 0.4, label: "Tight", blurb: "We correct quickly — best if you want to hold a precise number." },

    ],

  };

  function getZone(goal: Goal, value: number) {

    const zones = RATE_ZONES[goal];

    return zones.find((z) => value <= z.max) ?? zones[zones.length - 1];

  }

Add TargetRateStep component. It receives goal, currentWeight, height,

targetWeight, ratePct, onTargetWeight, onRatePct as props (height is new —

pass draft.height from the parent, already collected in the Body step).

  function TargetRateStep({

    goal, currentWeight, height, targetWeight, ratePct, onTargetWeight, onRatePct,

  }: {

    goal: Goal; currentWeight: string; height: string; targetWeight: string; ratePct: string;

    onTargetWeight: (v: string) => void; onRatePct: (v: string) => void;

  }) {

    const direction = GOAL_DIRECTION[goal];

    const ceiling = RATE_CEILING[goal];

    useEffect(() => {

      if (direction === "maintain" && !targetWeight && currentWeight) {

        onTargetWeight(currentWeight);

      }

      if (!ratePct) {

        onRatePct(String(RATE_ZONES[goal][0].max / 2));

      }

      // eslint-disable-next-line react-hooks/exhaustive-deps

    }, [goal]);

    const rateNum = Number(ratePct) || 0;

    const zone = getZone(goal, rateNum);

    const cw = Number(currentWeight) || 0;

    const tw = Number(targetWeight) || 0;

    const heightM = Number(height) / 100;

    const bmiAtTarget = heightM > 0 && tw > 0 ? tw / (heightM * heightM) : 0;

    let directionError: string | null = null;

    if (direction === "lose" && tw > 0 && tw >= cw) directionError = "Target weight should be below your current weight.";

    if (direction === "gain" && tw > 0 && tw <= cw) directionError = "Target weight should be above your current weight.";

    if (direction === "lose" && bmiAtTarget > 0 && bmiAtTarget < 18.5) {

      directionError = "This target weight is below a healthy BMI for your height.";

    }

    const headline = direction === "lose" ? "How much would you like to lose, and how fast?"

      : direction === "gain" ? "How much would you like to gain, and how fast?"

      : "Let's lock in your maintenance target";

    return (

      <>

        <StepHeader title={headline} />

        <label className="flex items-center justify-between rounded-2xl bg-bg-2 border border-white/5 px-4 py-3 mb-4">

          <span className="text-sm text-text-secondary">Target weight</span>

          <span className="flex items-center gap-1">

            <input

              type="text" inputMode="decimal"

              value={targetWeight}

              onChange={(e) => onTargetWeight([e.target](http://e.target).value.replace(/[^\d.]/g, ""))}

              className="w-24 bg-transparent text-right text-sm font-semibold focus:outline-none"

              style={{ fontSize: 16 }}

            />

            <span className="text-xs text-text-tertiary">kg</span>

          </span>

        </label>

        {directionError && <p className="text-xs text-danger px-1 -mt-2 mb-3">{directionError}</p>}

        <p className="text-[11px] uppercase tracking-wider text-text-tertiary mb-2">

          {direction === "maintain" ? "Correction tightness" : "Pace"}

        </p>

        <input

          type="range" min={0} max={ceiling} step={0.05}

          value={rateNum}

          onChange={(e) => onRatePct([e.target](http://e.target).value)}

          className="w-full accent-violet-400"

        />

        <div className="mt-3 rounded-2xl bg-bg-2 border border-white/5 p-4 text-center">

          <p className="text-sm font-semibold text-white">{zone.label} — {rateNum.toFixed(2)}%/week</p>

          <p className="text-xs text-text-tertiary mt-1">{zone.blurb}</p>

        </div>

      </>

    );

  }

Wire in:

  {step === 8 && <TargetRateStep goal={draft.goal!} currentWeight={draft.weight}

    height={draft.height} targetWeight={draft.targetWeight} ratePct={draft.targetRatePct}

    onTargetWeight={(v) => patch({ targetWeight: v })}

    onRatePct={(v) => patch({ targetRatePct: v })} />}

Move Review to {step === 9 && <ReviewStep ... />}.

canContinue — keep cases 1–7, add case 8, bump old case 8 to case 9:

  case 8: {

    const cw = Number(draft.weight) || 0;

    const tw = Number(draft.targetWeight) || 0;

    const direction = GOAL_DIRECTION[draft.goal!];

    if (!draft.targetWeight || !draft.targetRatePct) return false;

    if (direction === "lose" && tw >= cw) return false;

    if (direction === "gain" && tw <= cw) return false;

    if (direction === "lose") {

      const heightM = Number(draft.height) / 100;

      const bmi = heightM > 0 ? tw / (heightM * heightM) : 0;

      if (bmi > 0 && bmi < 18.5) return false;

    }

    return true;

  }

Submit payload (both isReset and fresh branches): add

  target_weight_kg: Number(draft.targetWeight),

  target_rate_pct: Number(draft.targetRatePct),

Reset-mode hydration .select(): add target_weight_kg, target_rate_pct;

patch into targetWeight/targetRatePct as strings (empty string if null).

ReviewStep: add two rows — "Target weight" → `${draft.targetWeight} kg`,

"Pace" → getZone(draft.goal!, Number(draft.targetRatePct)).label.

═══════════════════════════════════════

VERIFICATION — confirm all of these before reporting done

═══════════════════════════════════════

1. Fat-loss goal: step 7 body-fat shows neutral "not set" state; "Skip — I

   don't know" shows the skipped card; "Add it now instead" restores slider.

2. Step 8, fat_loss (lose-direction): headline "How much would you like to

   lose…"; typing a target weight ≥ current shows the direction error;

   typing a target weight that computes BMI < 18.5 shows the BMI error and

   blocks Continue; slider max = 1.5; zone label correctly shows Sustainable

   (0–0.5), Moderate (0.5–1.0), AND Aggressive (1.0–1.5) — confirm Moderate

   is actually reachable, not skipped.

3. Muscle_gain goal: confirm dragging to exactly 0.2%/week shows "Moderate",

   not "Sustainable" — this zone must be reachable.

4. Recomposition (maintain-direction): headline "Let's lock in your

   maintenance target"; target weight auto-fills from current weight;

   slider max = 0.4; labels read Gentle/Moderate/Tight.

5. Progress bar shows "Step 9 of 9" on Review. Submit with body-fat skipped

   → confirm dexa_body_fat_pct: null and both target fields present in the

   network request payload.

6. Reset mode (?reset=true): confirms targetWeight/targetRatePct hydrate

   from the existing profile row.

Report back explicitly on items 2 and 3 (the BMI block and the muscle_gain

Moderate zone) since those are safety/logic-critical, not cosmetic.