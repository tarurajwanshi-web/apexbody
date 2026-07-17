## Step 8 rebuild — goal-differentiated pace, evidence-based rates

Single file: `src/routes/_authenticated/onboarding.tsx`. No schema changes, no engine changes. Contract with `macro-calculation.ts` preserved: `target_rate_pct` is the only value written, signed by goal, nullable for athletic performance.

### 1. Replace the global `PACES` constant with per-goal rate tables

```ts
type PaceId = "steady" | "standard" | "aggressive";

// pct is the |%/week| magnitude. Sign applied at submit from GOAL_DIRECTION.
const PACES_FAT_LOSS: PaceItem[] = [
  { id: "steady",     label: "Steady",     pct: 0.35, blurb: "0.35%/week — sustainable, protects lean mass" },
  { id: "standard",   label: "Standard",   pct: 0.5,  blurb: "0.5%/week — recommended for most" },
  { id: "aggressive", label: "Aggressive", pct: 0.75, blurb: "0.75%/week — lean users, short cuts only" },
];
const PACES_MUSCLE_GAIN = [ 0.25 / 0.4 / 0.6, "Steady / Standard / Aggressive", copy per spec ];
const PACES_STRENGTH    = [ 0.15 / 0.25 / 0.4, "Recover-eat / Standard / Push harder" ];
const PACES_RECOMP      = [ { id, label, kcalDelta: 100 / 250 / 400, blurb } ]; // magnitude, not %
```

Recomp items carry `kcalDelta` (kcal/day below TDEE), not `pct`. Convert at submit:  
`target_rate_pct = -((kcalDelta * 7) / 7700) / currentWeightKg` → small negative (~-0.0013 to -0.005).

### 2. `TargetStep` — branch by goal

- `fat_loss` / `muscle_gain` / `strength`: current layout (target weight input + three pills), but pace list comes from the goal-specific table. Sub-copy per spec.
- `recomposition`:
  - Title: "How aggressive should the recomp be?" Sub: "Recomp works best in a small deficit while training hard."
  - Target weight input **prefilled to current weight and editable** (users maintaining scale weight).
  - Three magnitude pills: Mild 100 / Moderate 250 / Focused 400 kcal/day.
  - Below the selected pill: "Track for 8+ weeks to see change" (patience copy, replaces time-to-goal).
- `athletic_performance`:
  - Title: "What's your competition weight?" Target weight input only.
  - **No pace pills.** Single info card: "Maintain your competition weight — We'll match your calories to your training load. Your targets will move up on heavy days and down on rest days."

### 3. Real-time guardrail block under the selected pill

Rendered for fat_loss / muscle_gain / strength (skipped for recomp and athletic):

- **Time-to-goal:** `weeks = ceil(|target - current| / (current * pct))` → `"~{weeks} weeks to reach {targetWeight}{unit}"`.
- **Calorie floor warning:** compute est. target calories via Mifflin-St Jeor + 1.55 activity, subtract kcal delta implied by the pill (`pct * currentKg * 7700 / 7` for fat_loss). Floor: 1500 M / 1200 F. If below → `--warn` line "This would put you below {floor} kcal. We'll cap at the floor and the timeline extends." **Does not block selection.**
- **Long-cut nudge (fat_loss only, weeks > 20):** italic secondary text "Long cuts are hard to sustain. Consider a Steady pace with a diet break every 8–12 weeks."

Recomp shows only the patience line. Athletic shows nothing (no pills).

BMI unrealistic-target check: keep the existing `targetError` red messages for now (spec says "silent for engine, no onboarding warning" — but the current code already hard-blocks BMI < 18.5 / ≥ 35 via `canContinue`. Keeping the current behavior avoids regressing safety; the "silent guardrail via engine_audit_log" is out of scope for this file). Flagging as follow-up.

### 4. Submit logic (`submit` function, ~line 205)

Replace the current `chosenPace` line:

```ts
let targetRatePct: number | null;
if (goal === "athletic_performance") {
  targetRatePct = null;
} else if (goal === "recomposition") {
  const item = PACES_RECOMP.find(p => p.id === draft.pace) ?? PACES_RECOMP[1]; // Moderate default
  const weeklyKg = (item.kcalDelta * 7) / 7700;
  targetRatePct = -(weeklyKg / Number(draft.weightKg)); // small negative
} else {
  const table = tableFor(goal);
  const item = table.find(p => p.id === draft.pace) ?? table[1]; // Standard default
  const sign = GOAL_DIRECTION[goal] === "lose" ? -1 : 1;
  targetRatePct = sign * (item.pct / 100);
}
```

Ensures target_rate_pct is never null for fat_loss/muscle_gain/strength/recomp even if the user skips (Standard/Moderate default persisted). `athletic_performance` writes null intentionally.

### 5. `canContinue` for step 8

- `athletic_performance`: only requires valid target weight.
- `recomposition`: target weight defaults to current, so valid by construction; require a pace pill selected? → No, allow Moderate default (matches spec "engines never see null"). Same rule for the other three goals — pace optional, defaulted at submit. Keeps flow fast.
- Existing BMI/direction validation retained.

### 6. Review row (line 854)

`Pace` row copy adapts:
- fat_loss / muscle_gain / strength: `{Label} · {pct}%/week`
- recomp: `{Label} · ~{kcalDelta} kcal/day below TDEE`
- athletic: `Match training load`

### Verification (per spec)

Manual walkthroughs after build:
1. 90→80kg fat loss, Aggressive → shows ~15 weeks, no floor warning.
2. 55→50kg female, Aggressive → floor warning fires, selection still allowed.
3. Muscle gain user → three pills 0.25 / 0.4 / 0.6, submit writes positive target_rate_pct.
4. Strength user → 0.15 / 0.25 / 0.4 surplus pills, positive rate.
5. Recomp user, 70kg, Moderate → target_rate_pct ≈ -0.00325; patience copy shown.
6. Athletic → no pills, single maintenance card, submit writes null.
7. Every pill selection updates time-to-goal / warning inline.

### Out of scope (flagged, not done here)

- New `recomp_kcal_delta` column (spec explicitly says defer — we reuse target_rate_pct as designed).
- Silent BMI guardrail via `engine_audit_log` (keep current visible BMI blocks; engine-side silent logging is a follow-up).
- Any macro-calculation.ts / edge function changes.