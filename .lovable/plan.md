# Plan: Rewrite `supabase/functions/score-nutrition/index.ts`

Single-file change. No DB migrations, no changes to `_shared/authorize.ts`. The trigger `shield_nutrition_logs_score_dispatch_webhook` and dispatcher `shield_dispatch_score_nutrition` already POST `{ nutrition_log_id }` with `x-internal-secret` — this rewrite finally matches that contract.

## New control flow

1. **CORS / auth**
   - Use `corsAllowHeaders` from `_shared/authorize.ts` (includes `x-internal-secret`).
   - Parse body → require `nutrition_log_id`.
   - Service-role Supabase client.
   - `authorizeCaller(req, supa)` — no `body_user_id` (we don't know it yet). Accepts internal secret OR user JWT.

2. **Load meal** from `shield_nutrition_logs` by id. Select:
   `user_id, entry_date, meal_photo_url, meal_time, meal_slot, meal_description, confirmed_items, calorie_estimate_status, claude_score_status, estimated_calories, estimated_protein_g, estimated_carbs_g, estimated_fat_g`.
   - If JWT path: enforce `meal.user_id === authResult.userId`, else 403.
   - **Idempotency**: if `claude_score_status === 'scored'`, return `{ ok: true, skipped: true }` immediately.

3. **Load context** in parallel:
   - `profiles` (`measurement_weight_kg, goal, biological_sex`) by `user_id`.
   - Active `daily_macro_targets` row: `effective_start_date <= entry_date` AND (`effective_end_date IS NULL` OR `> entry_date`), order desc, limit 1. Select `target_calories, target_protein_g, target_carbs_g, target_fat_g`.
   - If no target row, fall back to sensible defaults (`target_protein_g=120, carbs=200, fat=70, calories=2000`) and continue — do not fail.

4. **GPT-4o-mini vision call** (`gpt-4o-mini`, `response_format: json_object`, `max_tokens: 1500`).
   - System prompt: same nutritionist framing as today, JSON-only output, but schema extended to ensure `food_sources: string[]` (already present) is filled with specific items (e.g. `"oats"`, `"chicken breast"`, `"white rice"`, `"berries"`).
   - User message includes:
     - Image part: `meal.meal_photo_url` (use the storage URL directly when `https://`; otherwise wrap as data URL only if it already looks like base64 — but the schema stores a URL, so just pass URL).
     - Text part: `meal_description` + JSON-stringified `confirmed_items` so the model anchors to what the user already confirmed.
   - If photo URL missing, call text-only with description + confirmed_items.
   - On non-2xx or JSON parse failure → mark meal `claude_score_status='failed'` and return 502.

5. **Compute sub-scores** (pure functions in this file):

   - **`protein_tier` (0–100)**
     - `per_meal_target = target_protein_g / 3`
     - `ratio = protein_g / per_meal_target`
     - `ratio >= 1 && ratio <= 1.2` → `90`
     - `ratio < 1` → `Math.round(90 * ratio)` (floor 0)
     - `ratio > 1.2` → `Math.max(60, Math.round(90 - (ratio - 1.2) * 50))` (slight penalty, floor 60)

   - **`carb_quality_score` (0–100)**
     - Keyword scan over lowercased `food_sources.join(" ")`:
       - high-quality tokens: `oat, oats, quinoa, brown rice, whole grain, whole-wheat, lentil, bean, chickpea, legume, sweet potato, fruit, berry, vegetable, broccoli, spinach, kale, barley, farro`
       - refined/penalty tokens: `white bread, white rice, soda, candy, cookie, cake, pastry, donut, sugar, syrup, juice, chips`
     - Base = 60. `+8` per high token (cap +30). `-10` per refined token (cap -30).
     - Fiber/sugar modifier: if `fiber_g > 0 && sugar_g >= 0`, `ratio = fiber_g / Math.max(sugar_g, 1)`; `+10` if `ratio >= 0.5`, `-10` if `ratio < 0.1 && sugar_g > 15`.
     - Clamp `0..100`.

   - **`timing_score` (0–100)**
     - Parse hour from `meal_time` (HH:MM[:SS]); fall back to slot midpoints.
     - Mapping by `meal_slot`:
       - `breakfast`: in `[6,10]` → 90; else linear falloff: `90 - 15 * hoursOutsideWindow` (floor 40).
       - `lunch`: `[11,15]` → 90.
       - `dinner`: `[17,21]` → 85.
       - `snack` / other / null: flat `75`.
     - Clamp `0..100`.

6. **Writes** (sequential, both required):

   a. Update `shield_nutrition_logs` where `id = nutrition_log_id`:
      - Always: `protein_tier`, `carb_quality_score`, `timing_score`, `claude_score_status = 'scored'`, `claude_scored_at = now()` (if column exists; ignore if PostgREST complains).
      - Only if `calorie_estimate_status !== 'manual_edited'`: also set `estimated_calories`, `estimated_protein_g`, `estimated_carbs_g`, `estimated_fat_g` from analysis (round to ints / 1 dp).
      - **Never** touch `claude_quality_score` (GENERATED ALWAYS).

   b. Insert into `nutrition_meal_full_analysis` with the existing shape (`meal_id = nutrition_log_id`, `user_id`, `entry_date`, `meal_time`, all macros + micronutrients + text fields + `food_sources` + `full_haiku_output: analysis`). If a row already exists for this `meal_id`, upsert on `meal_id`.

7. **Dispatch readiness recompute**
   - After both writes succeed, fire-and-forget `fetch` to `${SUPABASE_URL}/functions/v1/calculate-score` with `x-internal-secret` header (read from `get_dispatch_secret` RPC) and body `{ user_id: meal.user_id, entry_date: meal.entry_date }`. Wrap in try/catch — never fail the response on dispatch error.

8. **Response** (200):
   ```json
   {
     "ok": true,
     "food_description": "oats + berries + greek yogurt",
     "scores": { "protein_tier": 82, "carb_quality": 78, "timing": 90 },
     "macros": { "protein_g": 32, "carbs_g": 58, "fat_g": 9 }
   }
   ```

9. **Failure handling**
   - Any thrown error after the meal row is loaded → best-effort `UPDATE shield_nutrition_logs SET claude_score_status='failed' WHERE id = nutrition_log_id` then return 500 with `{ error }`. This prevents the trigger from looping (trigger only fires when status flips to `pending`).
   - Pre-load errors (bad body, auth fail) return 400/401 without touching the row.

## What is not changing

- `_shared/authorize.ts`
- DB triggers / dispatcher functions
- `nutrition_meal_full_analysis` schema
- `shield_nutrition_logs` schema (relies on `claude_quality_score` GENERATED column already being in place)
- Any other edge function
