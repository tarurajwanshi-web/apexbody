## Goal

Create `supabase/functions/seed-synthetic-test-users/index.ts` — an edge function that seeds 50 synthetic users across 6 personas with 180 days of readiness, weight, workouts, and meals.

## Schema corrections vs. the spec

I cross-checked the spec against the live schema. A few columns differ — building the function as-pasted would fail at runtime. I'll fix these inline:

1. `**profiles**` — there is no `id` insert column for the user FK; the table uses `user_id`. Also `equipment` → `equipment_access`. So insert `{ user_id: userId, goal, training_days_per_week, equipment_access: "barbell,dumbbell,cable", experience_level, biological_sex, body_data_type }`.
2. `**body_measurements**` → table is `body_measurement_events`, and `measurement_source` → `source`. Payload: `{ user_id, entry_date, weight_kg, source: "scale" }`.
3. `**readiness_scores.pillar_breakdown**` — send as a JS object (jsonb column), not `JSON.stringify(...)`.
4. `**pre_session_checks.session_readiness**` is `smallint` — round `finalScore` before insert (already an int from the spec, just keep it).
5. Leave `shield_nutrition_logs`, `workout_set_logs`, `shield_training_logs` payloads as in the spec — they match.

Everything else (persona shapes, generators, loop structure, totals) stays exactly as written.

## File layout

Single file: `supabase/functions/seed-synthetic-test-users/index.ts`

Structure:

- imports + service-role client (spec verbatim)
- `serve()` handler (serve(async (req) => {
    // Handle CORS preflight
    if (req.method === "OPTIONS") {
      return new Response(null, {
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "POST, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type, Authorization",
        },
      });
    }
    try {
      console.log("[seed] Starting synthetic user generation...");
      const result = await seedTestUsers();
      return new Response(JSON.stringify(result), {
        status: 200,
        headers: {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*",
        },
      });
    } catch (error) {
      console.error("[seed] Error:", error);
      return new Response(JSON.stringify({ status: "error", message: error.message }), {
        status: 500,
        headers: {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*",
        },
      });
    }
  });)
- `seedTestUsers()` — 6-persona loop, aggregates totals (spec verbatim)
- `createSyntheticUser(persona, index)` — admin.createUser + profile insert (with schema fixes #1)
- `generatePersona180Days(userId, persona)` — 180-day loop containing all helpers (`computeBaseReadiness`, `shouldWorkoutToday`, `getExerciseForDay`, `getWorkingSets`, `computeRIR`, `computeTDEE`, `shouldLogMeals`) and the four insert blocks (readiness, body measurement, workouts+training log+pre_session_check, meals) with schema fixes #2–#4

No new tables, no migration, no client code changes. Function is unauthenticated and uses the service role key — intended for manual one-shot invocation only; not registered with cron.

## Invocation

After deploy, trigger once via:

```
curl -X POST https://<project>.supabase.co/functions/v1/seed-synthetic-test-users \
  -H "Authorization: Bearer <service-role-key>"
```

Expected response: `{ status, users_created: 50, meals_logged, workouts_logged, readiness_scores }`.  
  
✅ **APPROVE all three points.**

**Schema fixes #1–#4:** Correct. Use `user_id` (not `id`), `equipment_access`, `body_measurement_events`, `source`, pillar_breakdown as object.

**Batching/timeout:** Accept the runtime risk. If it times out mid-run, we have partial data but it's valid. **No need to add batching yet** — let's see if it completes. If it times out, I'll give you a chunked version.

**Dispatch concerns:** **Set** `claude_score_status: 'skipped'` on all `shield_nutrition_logs` inserts. This prevents 27k+ AI calls and the scoring dispatch trigger.

For `shield_training_logs` and `pre_session_checks`: those don't have dispatch webhooks (they feed into `calculate-score` cron, which runs Monday 1 PM UTC). **No need to skip those.**

