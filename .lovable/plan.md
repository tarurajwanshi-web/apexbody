# Part 2 — Goal-weight brake + phase guard + UI string

Three files. Phase logic sits ABOVE the F1 goal-branch as a pre-step; the deficit math, floors, E2/E3/E6, and RPC are untouched.

## File 1 — `supabase/functions/_shared/macro-calculation.ts`

1. Extend the `Profile` type with:
   - `nutrition_phase: string | null`
   - `phase_started_at: string | null`
   - `resume_goal_json: any`

2. **Goal-weight brake** — replace the existing `reached_target_at` block (~L386–392, inside the "Goal-reached detection" comment) with:

   ```ts
   const crossedGoal = direction !== "maintain" && p.target_weight_kg != null &&
     Math.abs(current_weight_kg - Number(p.target_weight_kg)) <= 1.0;
   if (p.nutrition_phase === "active_goal" && crossedGoal) {
     try {
       await supa.from("nutrition_phase_history").insert({
         user_id, phase: "maintain", reason: "goal_reached",
         entry_date: week_start_date, entry_weight_kg: current_weight_kg,
         entry_target_calories: Math.ceil(blended_tdee),
         notes: `Reached target ${p.target_weight_kg}kg.`,
       });
       await supa.from("nutrition_phase_history")
         .update({ exit_date: week_start_date, exit_weight_kg: current_weight_kg })
         .eq("user_id", user_id).eq("phase", "active_goal").is("exit_date", null);
     } catch (_) { /* history non-critical, never block macro write */ }
     await supa.from("profiles").update({
       nutrition_phase: "maintain", phase_started_at: week_start_date,
       resume_goal_json: {
         goal: p.goal, target_rate_pct: p.target_rate_pct,
         target_kcal_delta: p.target_kcal_delta, target_weight_kg: p.target_weight_kg,
       },
       reached_target_at: new Date().toISOString(),
     }).eq("user_id", user_id);
     direction = "maintain";
     flagReason = flagReason ?? "target_reached";
   }
   ```

   Note: current `direction` is `const` (L110). Change to `let` so the brake and the phase guard below can reassign it. Keep the legacy standalone `reached_target_at` write only for the `nutrition_phase !== "active_goal"` path so existing users without a phase set still get their `reached_target_at` timestamp (preserves current behaviour). Concretely: only run the legacy update when the new brake did NOT fire.

3. **Maintain-phase guard** — immediately before the F1 goal-branch (`if (goal === "fat_loss")`, ~L290):

   ```ts
   const phaseForcesMaintain = p.nutrition_phase === "maintain";
   if (phaseForcesMaintain) direction = "maintain";
   ```

   Wrap the existing goal-branch:

   ```ts
   let raw_target_calories: number;
   if (phaseForcesMaintain) {
     raw_target_calories = expenditure;
   } else if (goal === "fat_loss") {
     /* unchanged */
   } else if (goal === "muscle_gain" || goal === "strength" || goal === "recomposition") {
     /* unchanged */
   } else {
     raw_target_calories = expenditure;
   }
   ```

   Do not touch: deficit formula, protein/fat guards, `trainingLoadIndex` cap (E2), abnormal-swing damp (E3), rate clamp (E6), floors, ceilings, band controller, RPC call, or the review upsert.

## File 2 — profile selects in both wrapper functions

Append `, nutrition_phase, phase_started_at, resume_goal_json` to the `profiles` select string in:
- `supabase/functions/calculate-macros-weekly/index.ts`
- `supabase/functions/trigger-weekly-macro-review/index.ts`

## File 3 — `src/routes/nutrition.tsx` (honest UI string)

Heads-up on the referenced L315 select: that block is inside `refreshDiag` (debug-only) and its result is not what feeds the render. `goalText` derives from `macros?.goal` (L402), not from a profile fetch. To keep the UI change honest and self-contained, I will:

1. Add `nutrition_phase, reached_target_at` to the diag select at L315 as requested (keeps diag panel truthful).
2. Add a small primary profile fetch alongside the existing data loads so the component can read `nutrition_phase`. Concretely: on the same `useEffect` that hydrates macros/meals/hydration, fetch `supabase.from("profiles").select("nutrition_phase, reached_target_at").eq("user_id", uid).maybeSingle()` once and store `phase` in local state (`const [phase, setPhase] = useState<string | null>(null);`). No new server function; no other component changes.
3. Replace the goal-framing line at L504–508 with:

   ```tsx
   <p className="mx-5 mt-5 text-[12px] text-text-secondary leading-snug">
     {phase === "maintain"
       ? <>You've reached your goal weight. Holding at <span className="text-text-primary font-medium">maintenance</span> to lock in your result — your next phase options are coming soon.</>
       : goalText
         ? <>Based on your <span className="text-text-primary font-medium">{goalText}</span> goal and your stats, here's your daily target.</>
         : <>Finish onboarding to calculate your personalized daily target.</>}
   </p>
   ```

   Plain text, no emoji, no markdown. No other UI changes.

## Post-build

- Redeploy `calculate-macros-weekly` and `trigger-weekly-macro-review` (File 1's shared change requires rebundle; File 2 forces it).
- File 3 ships with the frontend build.

## Verification checklist

- `direction` is `let`, reassigned only by brake and phase guard.
- Brake fires only when `nutrition_phase === "active_goal"` AND within 1.0kg of `target_weight_kg`; history insert wrapped in try/catch so failure never blocks the macro write.
- Legacy `reached_target_at`-only update path preserved for users without `nutrition_phase = "active_goal"`.
- Phase guard sets `raw_target_calories = expenditure` and forces `direction = "maintain"` so the maintenance ceiling (`blended_tdee * 1.05`) applies; no deficit math runs.
- Both wrapper functions select the three new columns.
- `phase === "maintain"` string renders without markdown.

## Confirm before Build

The added primary profile fetch in `nutrition.tsx` (item 3.2 above) is a small deviation from the literal instruction, which pointed at the diag select. Confirm you want the fetch added (recommended) — otherwise `phase` has no source in the render path and the new string can never render.
