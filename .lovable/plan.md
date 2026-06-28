
# Plan: Fuelling Adequacy Evaluation + Gemini → OpenAI Migration

## Part 1 — Fuelling Adequacy Evaluation

### 1a. New table `user_fuelling_evaluations` (migration)
Columns:
- `id uuid pk default gen_random_uuid()`
- `user_id uuid not null references auth.users(id) on delete cascade`
- `evaluation_date date not null`
- `total_sets int`, `avg_rir numeric`
- `calories_consumed numeric`, `calories_target numeric`, `shortfall numeric`
- `bmr numeric`, `training_cost numeric`
- `severity text check in ('underfuelled','marginal','adequate')`
- `severity_score int` (1/2/3)
- `message text`, `action text`, `mini_explanation text`
- `created_at timestamptz default now()`
- Unique `(user_id, evaluation_date)`

Standard grants (authenticated select own, service_role all), RLS enabled, policy `user_id = auth.uid()` for SELECT.

### 1b. New Edge Function `supabase/functions/evaluate-fuelling/index.ts`
- Service-role client, CORS headers.
- Iterates all users (or accepts `{ user_id }` for targeted runs).
- For each user, resolves "yesterday" in their local timezone (from `profiles.timezone`), so cron can run hourly and only act at local 6am.
- Queries yesterday's `workout_set_logs` (sum sets where `completed=true`, avg `rir`), `shield_nutrition_logs` (sum kcal + macros), active `daily_macro_targets` (BMR), `profiles` (goal, experience).
- Computes top-20% volume tier from trailing 30-day total sets across all users (cached per run).
- Filter: skip if `total_sets < 15` or user not in top 20%.
- Decision tree as spec'd → severity / message / action.
- If `severity_score >= 2`: call OpenAI (`gpt-5-mini` via Lovable Gateway) for `{explanation, protocol}` JSON.
- Upsert into `user_fuelling_evaluations` on `(user_id, evaluation_date)`.

### 1c. Cron registration
`cron.schedule` every hour calling the function with empty body; function handles per-user 6am-local gating.

### 1d. `src/lib/fuelling.functions.ts` (NEW)
`getFuellingAdequacy` server fn with `requireSupabaseAuth`:
- Selects most recent `user_fuelling_evaluations` row for user where `severity_score >= 2` AND `evaluation_date >= today - 2`.
- Returns row or `null`.

### 1e. `src/components/dashboard/FuellingAdequacyCard.tsx` (NEW)
- `useSuspenseQuery` with 6h staleTime.
- Returns `null` when no row.
- Renders card with title, metric line, message (red for underfuelled, yellow for marginal), italic mini_explanation, bold action — APEX tokens, sanitized text via `cleanCardText`.

### 1f. `src/routes/_authenticated/dashboard.tsx`
- Import + mount `<Suspense fallback={null}><FuellingAdequacyCard /></Suspense>` after `HydrationCorrelationCard` (if present) else after `PatternMemoryCard`.

## Part 2 — Migrate Gemini AI calls to OpenAI

Audit and switch every Edge Function currently calling `google/gemini-*` (Lovable AI Gateway) to OpenAI equivalents:

| Current | Replacement |
|---|---|
| `google/gemini-3-flash-preview` | `openai/gpt-5-mini` |
| `google/gemini-3-flash-preview` (heavy reasoning) | `openai/gpt-5` |
| `google/gemini-3.1-flash-lite` / `gemini-2.5-flash-lite` | `openai/gpt-5-nano` |

Files to scan and update (known callers):
- `supabase/functions/generate-weekly-pattern/index.ts` (pattern explanation) → `openai/gpt-5-mini`
- Any other `gemini-*` reference under `supabase/functions/**`

For each:
1. Swap the `model` string.
2. Keep Lovable Gateway base URL + `LOVABLE_API_KEY` header (still OpenAI-compatible).
3. Drop Gemini-only fields (e.g., `response_mime_type`); use OpenAI `response_format: { type: "json_object" }` where JSON is required.
4. Verify token/param shape per OpenAI chat API.

Out of scope: `score-nutrition` already uses `gpt-4o-mini` — leave; Claude-based functions (`generate-daily-coach-note`, etc.) — leave.

## Technical notes
- Top-20% threshold computed via a single SQL `percentile_cont(0.8)` over 30-day per-user set totals.
- Use `Intl.DateTimeFormat` with the user's timezone to derive their local hour for the 6am gate.
- All new Supabase access via service role inside the function; client surface read-only with RLS.
- No client-side schema changes beyond the new table.

## Verification
- `supabase--migration` for table.
- Deploy function, hit `supabase--curl_edge_functions` with a known high-volume test user to confirm row insert + mini explanation.
- `supabase--read_query` to confirm severity rows visible.
- Dashboard render check via preview.
