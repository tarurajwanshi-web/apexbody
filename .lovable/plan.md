# APEX Round 2 — Section-by-Section Plan

Following your own recommendation: ship and confirm one section at a time, not all at once. Section 6 is the priority per your note.

## Diagnosis of Section 6 (why the old body data screen is still live)

The new `BodyMeasurementModal` exists in `src/components/LogModals.tsx` and *is* wired into one place: `src/components/BottomNav.tsx` (opened from the floating `+` / quick-launcher).

But the screen you're still seeing is **onboarding Step 6** in `src/routes/_authenticated/onboarding.tsx` — the inline `BodyStep` component with the legacy "DEXA scan / Measurements" tab UI, writing legacy `measurement_*` / `dexa_*` columns on the `profiles` table. That step was never converted to the new flow, and the new `body_measurement_events` table is never written to from onboarding.

So "old screen still live" is accurate, and the fix is:
1. Replace onboarding Step 6's inline `BodyStep` with the new Step A / Step B flow (same UX as `BodyMeasurementModal`).
2. Write to `body_measurement_events` on submit (per-entry dated row), not only to `profiles`.
3. Audit every other entry point (Settings, profile edit, Log tab) and confirm each routes to the new flow.
4. Verify by submitting twice → two rows in `body_measurement_events`.

That's the actual Section 6 work. Round 1's claim was true for the modal but missed onboarding, which is the entry point users actually hit.

## Order I will ship this round (one section per turn, you confirm before next)

Per your "section-by-section, not all at once" instruction, here's the order. I will stop after each and wait for your "ok" before the next:

1. **Section 6 — Body data Step A/B everywhere (priority).** Replace onboarding Step 6 with the Step A/B flow, wire to `body_measurement_events`, audit all entry points, verify two submits → two rows.
2. **Section 2 — Nav cleanup.** Remove the "A —" segment from BottomNav, rename "More" → "Log" (opens the existing quick-launcher with Recovery / Meal / Body), delete the floating `+`, reposition the floating "A" (FloatingCoach) to bottom-right.
3. **Section 1 — Food photo reveal sequence.** Change `MealDetailModal` / capture flow to show **description + totals first**, with confirm/edit, then expand itemized breakdown only after confirm. Keep existing estimation + persistence. Confirm Fuel dashboard reads from the same saved per-entry records (already dated, already queryable across a range — no schema change).
4. **Section 7 — "Redo Program" button in Settings.** Rename, narrow inputs to Goal / Days / Equipment, slide-to-confirm, regenerate plan via existing `generate-plan` function, land on Training tab. Leave all history untouched.
5. **Section 3 — Onboarding "About Me" 5-field consolidation.** Merge Name / Age / Sex / Height (compound ft+in under Imperial, cm under Metric) / Weight (kg/lb) into one step, with toggles that convert existing values.
6. **Section 4 — Duolingo-style loading screen.** Build the rotating-fact loader for plan generation (~20–30s). I will draft the fact list from the APEX evidence base already in the codebase and **surface it for your human review before shipping** — per your accuracy requirement, I will not let AI-drafted facts ship silently.
7. **Section 5 — Settings footer copy.** Replace the trademark block with the shorter version exactly as specified.

## Why this order

- 6 first because it's explicitly the priority and a data-integrity item.
- 2 next because it changes nav, which Section 1's flow depends on for "where Fuel reads from."
- 1, 7 are user-facing flow changes that benefit from a stable nav.
- 3, 4, 5 are scoped and low-risk; 4 needs your fact-list review before it can be considered done.

## What I will NOT do

- Ship all sections in one turn.
- Touch food estimation logic, gram accuracy, or the DB schema for nutrition/hydration (Section 1 explicitly says these are unchanged).
- Ship AI-drafted facts in Section 4 without your review.
- Touch the GPT/Claude switching logic (deferred per Round 1 founder instruction).

---

**Approve this plan and I'll start with Section 6.** If you want a different order (e.g. Section 1 first), tell me before I begin.
