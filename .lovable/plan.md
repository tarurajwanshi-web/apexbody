
# BATCH A2 — Five independent bug fixes

Verified findings up front:

- **A2.1** — `training_day_codes` is stored as lowercase 3-letter strings (`["mon","tue","fri","sat"]`). Verified against a real row. `generate-plan` never reads it; `buildFallbackPlan` even-spreads days via `Math.round((i*7)/daysCount)`; Sonnet's prompt only pins `day/date/day_name`, not which days are rest.
- **A2.2** — `calculate-macros` does NOT error with no measurements — it falls back to age 30, 170 cm, 70 kg, male. That's still a defaulted target, not the user's target. Better than nothing but worth surfacing in the plan.
- **A2.3** — Debug button confirmed at `src/routes/_authenticated/dashboard.tsx` calling `test-seed-10-users`.
- **A2.4** — `VolumeNudge` tiers today: `gap>=4` (behind), `gap>=1` (short), `gap<=0` (on track). No neutral tier and no Shield attribution.
- **A2.5** — No-meals branch upserts `"No meals logged today. Log something to get your daily coaching note. 📱"`. Cron-driven (`isUserLocalHour(tz, coachingHour)`), with `existing && !force` idempotency skip on the same-day row.

## A2.1 — Pin training days from `training_day_codes`

**In `supabase/functions/generate-plan/index.ts`:**

1. Extend the profile select to include `training_day_codes`.
2. Read `profile.training_day_codes` as `string[]`. Normalise (lowercase, trim); accept the canonical set `mon|tue|wed|thu|fri|sat|sun`.
3. Build a deterministic `restMask: boolean[7]` aligned to the `calendar` array already computed in the function. Mapping: for each entry `calendar[i]`, take `day_name` (e.g. "Monday") → lowercase 3-letter code → training if code ∈ `training_day_codes` else rest. Store `restMask[i] = !isTrain`.
4. **Reconcile count vs codes** (defensive — DB shows some rows with `training_days_per_week=3` and empty `training_day_codes`):
   - If `training_day_codes` is empty/invalid/mismatched length vs `training_days_per_week`, fall through to current even-spread behavior (no change) — do NOT block generation.
   - If codes provided but count mismatch (e.g. codes has 4, `training_days_per_week=3`), trust the codes (they were the last direct user choice) and log a warning.
5. Pass `restMask` into the prompt:
   - Extend the `calendar` JSON block to include `rest_flag` per day, and add a hard constraint line: `"REST_MASK (hard): the rest flag per day is fixed by the user's chosen training days. Do not move rest days. calendar[i].rest_flag is authoritative."`
6. Pass `restMask` into `buildFallbackPlan` and `validateGeneratedPlan`:
   - `buildFallbackPlan(envelope, planStartISO, timezone, days, restMask?)` — when provided, iterate `i in 0..6`; rest iff `restMask[i]`; otherwise consume the next `patterns[pIdx]` slot. Preserves current behavior when `restMask` is undefined.
   - `validateGeneratedPlan(plan, envelope, planStartISO, restMask?)` — when provided, add a rule: for each i, `days[i].rest === restMask[i]`. Violation surfaces in the existing reprompt loop.
7. No schema change. No Shield/scoring change. Signature additions are optional params so `training-rules.ts` callers not passing `restMask` still work.

## A2.2 — Skip-body-data onboarding still needs a macro target

**In `src/routes/_authenticated/onboarding.tsx`:**

1. In the `else` branch (skip-body-data), add `supabase.functions.invoke("calculate-macros", { body: { user_id: userId } })` in parallel with `generate-plan`, mirroring the `hasBody` branch.
2. **Caveat to surface in UI copy on that step**: the produced target is based on defaults (170 cm / 70 kg / 30 y / male) until the user later provides body data. The skip-body screen already exists — add a single line under the CTA: "You can update this any time in Settings — until then we'll use a starting estimate." (No copy change to the confirmation toast.)
3. No change to `calculate-macros` itself — its default-fallback behavior is intentional and already used by the hasBody path when a field is missing.

## A2.3 — Gate debug seeder to dev

**In `src/routes/_authenticated/dashboard.tsx` around line 401–409:**

Wrap the "Seed 10 Edge Cases (90 days)" button in `import.meta.env.DEV && ( … )`. Do not delete. No other changes.

## A2.4 — VolumeNudge middle tier + Shield attribution

**In `src/routes/workouts.tsx` `VolumeNudge`:**

1. Determine "first training day of the week that has elapsed" = smallest `i <= todayIdx` where `!days[i].rest`. Compute `elapsedTrainingDays = number of non-rest days in [0..todayIdx]`.
2. Compute `shieldCut` = whether today's plan already has a Shield-driven volume reduction. Two signals available in this component's props path: (a) `plan.plan_data.volume_gate_alert` (already returned by generate-plan), (b) the top-level workouts.tsx already has `volumeChoice` in scope for the effective-plan reducer. We pass a boolean `hadShieldCut = volumeChoice === "recovery" || volumeChoice === "reduce"` via a new prop from the parent (single-line change where `<VolumeNudge …/>` renders at line 267).
3. New tiers:
   - `gap >= 4` → current "behind" copy, unchanged.
   - `gap >= 1 && (elapsedTrainingDays <= 1)` → **neutral early**: "You're `{gap}` set{gap===1?"":"s"} into the week's plan — plenty of runway. `{nextDayLabel}` is next."
   - `gap >= 1 && hadShieldCut` → **neutral Shield-attributed**: "You're `{gap}` set{gap===1?"":"s"} short — today's session was reduced for recovery, so that's expected."
   - `gap >= 1` (else) → existing "short of plan" copy.
   - `gap <= 0` → existing "on track" copy.
4. Tier order in code: shield-attributed check before early-week check so Shield attribution wins when both apply.

## A2.5 — Coaching feed no-meals streak

**In `supabase/functions/generate-daily-scorecard/index.ts`, no-meals branch (line ~152):**

1. Before writing, query the user's `daily_coaching_cards` where `card_type='daily_scorecard'` and `card_date < today`, ordered `card_date DESC LIMIT 7`. Walk back day-by-day: count consecutive rows whose `content` begins with the no-meals sentinel prefix (`"No meals logged"`). That gives `noMealStreak` (number of prior consecutive no-log days).
2. Tone selection:
   - `noMealStreak <= 1` (day 1 or 2): current copy.
   - `noMealStreak === 2 || 3` (day 3–4): softer: `"Still no meals logged this week — no pressure, just log your next one whenever works."`
   - `noMealStreak >= 4` (day 5+): write only every 3rd day. If `noMealStreak % 3 !== 0`, `continue` without upsert (leaves the day without a scorecard card, which is fine — feed shows other cards). When it does write, use: `"We'll be here when you're ready to log again."`
3. Idempotency preserved: the `existing && !force` guard at line 125 already prevents duplicate writes on retriggers within the same day. Skipping the upsert on days that fail the mod-3 gate is compatible — the guard only fires when a row already exists.
4. No cron/schedule change. No column/schema change. `card_type` and upsert conflict target unchanged.

## Files touched

- `supabase/functions/generate-plan/index.ts` (A2.1)
- `supabase/functions/_shared/training-rules.ts` (A2.1 — optional param added to `buildFallbackPlan` and `validateGeneratedPlan`)
- `supabase/functions/generate-daily-scorecard/index.ts` (A2.5)
- `src/routes/_authenticated/onboarding.tsx` (A2.2)
- `src/routes/_authenticated/dashboard.tsx` (A2.3)
- `src/routes/workouts.tsx` (A2.4)

## Out of scope

- No schema migration, no RLS change, no new tables, no Shield/scoring changes.
- Not touching `calculate-macros` defaults (A2.2 caveat is copy only).
- Not changing cron frequency for `generate-daily-scorecard` (A2.5 varies write frequency at the write site, not at the trigger).
- No changes to `plan_data` shape returned to the UI.

## Acceptance

- A2.1: user with `training_day_codes=['mon','tue','fri','sat']` and `training_days_per_week=4` gets a plan where Mon/Tue/Fri/Sat are training and Wed/Thu/Sun are rest, from both Sonnet output (validator rejects otherwise → reprompt) and fallback. User with empty `training_day_codes` sees no behavior change vs today.
- A2.2: onboarding skip-body path leaves the user with an active `daily_macro_targets` row (source=`onboarding`, defaulted anthropometrics).
- A2.3: seeder button hidden on preview + published; visible on `bun run dev`.
- A2.4: on Day 1 with 1–3 set gap, message reads as neutral/early; on a Shield-cut day the message attributes the gap; otherwise unchanged from today.
- A2.5: after 3+ consecutive no-log days the coaching card copy softens; after 5+ consecutive days the card is written at most every 3rd day.
