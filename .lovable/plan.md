# APEX Shield — Project State Audit

Read-only snapshot. No files were modified.

## 1. Routes / Screens

| File | URL | Gate | Description |
|---|---|---|---|
| `src/routes/__root.tsx` | — (root layout) | n/a | HTML shell, error + 404 boundaries, providers |
| `src/routes/index.tsx` | `/` | Public | Splash / landing screen |
| `src/routes/disclaimer.tsx` | `/disclaimer` | Public | Legal disclaimer screen |
| `src/routes/onboarding.tsx` | `/onboarding` | Public | 7-step onboarding flow (writes `profiles.input_path_preference` at step 7) |
| `src/routes/meet-coach.tsx` | `/meet-coach` | Public | Coach intro screen |
| `src/routes/home.tsx` | `/home` | Public | **Legacy mock home** (rings, mock metrics) |
| `src/routes/workouts.tsx` | `/workouts` | Public | **Legacy mock** workouts screen |
| `src/routes/nutrition.tsx` | `/nutrition` | Public | **Legacy mock** nutrition screen |
| `src/routes/coach.tsx` | `/coach` | Public | Coach chat / insight screen (uses mock metrics) |
| `src/routes/settings.tsx` | `/settings` | Public | Settings screen |
| `src/routes/_authenticated/route.tsx` | (pathless layout) | n/a | `ssr:false` gate, redirects unauthenticated users to `/` |
| `src/routes/_authenticated/dashboard.tsx` | `/dashboard` | **Authenticated** | Real Shield dashboard: readiness score, pillar breakdown, AI insight, log CTAs, today's meals |

Note: `BottomNav` links only to `/home`, `/workouts`, `/nutrition`, `/coach`. There is no nav link into `/dashboard` from the legacy screens.

## 2. Database Tables (schema `public`)

All tables have RLS enabled. Policy pattern is the same across every Shield table: `SELECT/INSERT/UPDATE/DELETE` restricted to `auth.uid() = user_id`, role `authenticated`.

### `profiles`
Columns: `id uuid`, `user_id uuid`, `input_path_preference text`, `created_at timestamptz`, `updated_at timestamptz`
Policies: own-row SELECT / INSERT / UPDATE / DELETE.

### `readiness_scores`
Columns: `id`, `user_id`, `score_date date`, `final_score numeric`, `confidence_level text`, `confidence_reason text`, `input_path text`, `pillar_breakdown jsonb`, `fatigue_adjustment numeric`, `nudge_message text`, `engine_version text`, `created_at`.
Policies: own-row SELECT / INSERT / UPDATE / DELETE.

### `shield_manual_inputs`
Columns: `id`, `user_id`, `entry_date date`, `recovery_self_rating smallint`, `sleep_hours numeric`, `mood_emoji text`, `created_at`.
Policies: own-row CRUD.

### `shield_device_uploads`
Columns: `id`, `user_id`, `entry_date date`, `device_source text`, `screenshot_url text`, `parsed_hrv numeric`, `parsed_rhr numeric`, `parsed_sleep_hours numeric`, `parsed_sleep_stages jsonb`, `parse_status text`, `created_at`.
Policies: own-row CRUD.

### `shield_nutrition_logs`
Columns: `id`, `user_id`, `entry_date date`, `meal_description text`, `meal_photo_url text`, `claude_score_status text`, `protein_tier smallint`, `carb_quality_score smallint`, `timing_score smallint`, `claude_quality_score smallint` (GENERATED from the three dimensions), `deleted boolean`, `created_at`, `updated_at`.
Policies: own-row CRUD; SELECT additionally filters `deleted = false`.

### `shield_training_logs`
Columns: `id`, `user_id`, `entry_date date`, `strain_value numeric`, `session_notes text`, `created_at`.
Policies: own-row CRUD.

### Triggers / Webhooks — IMPORTANT FINDING
`information_schema.triggers` returns **zero rows** for schema `public`. The webhook *functions* (`shield_nutrition_logs_webhook`, `shield_manual_inputs_webhook`, `shield_training_logs_webhook`, `shield_device_uploads_webhook`, dispatcher `shield_dispatch_calculate_score`) exist, but **no triggers are attached** to the tables. That means the deterministic engine is NOT auto-recomputed on insert/update. Only the meal flow's explicit `supabase.functions.invoke("score-nutrition", ...)` runs today.

## 3. Edge Functions

| Name | Trigger | External calls | Input | Output |
|---|---|---|---|---|
| `score-nutrition` | Manual `supabase.functions.invoke` from `MealLogModal` after meal insert/update | Anthropic Claude (`claude-haiku-4-5-20251001`) via `ANTHROPIC_API_KEY`; reads/updates `shield_nutrition_logs`; reads same-day `shield_training_logs` for timing context | `{ nutrition_log_id: uuid }` | `{ row, scores: { protein_tier, carb_quality_score, timing_score, claude_quality_score }, reasoning }`; on failure sets `claude_score_status='failed'` |
| `calculate-score` | Intended to be called by DB webhook (`shield_dispatch_calculate_score`) — **currently uncalled in practice** because no triggers are attached. Can also be invoked manually. | No LLM. Reads `shield_manual_inputs`, `shield_device_uploads`, `shield_nutrition_logs`, `shield_training_logs` for last 3 days; upserts `readiness_scores` | `{ user_id: uuid, entry_date: date }` | Upserted `readiness_scores` row with `final_score`, `pillar_breakdown`, `confidence_level`, `nudge_message`, `engine_version='v6.1'` |

## 4. Storage

One bucket: **`shield-uploads`** (private, `public=false`).

Policies on `storage.objects` (role `authenticated`):
- SELECT / INSERT / UPDATE / DELETE restricted to objects whose first path segment equals `auth.uid()::text` and `bucket_id='shield-uploads'`.

Used for `recovery/` (Whoop/Oura/Garmin screenshots) and `meals/` (meal photos) under each user's UID folder.

## 5. Orphaned / Unused / Legacy

**Legacy mock screens still wired into navigation** — these predate the Shield engine and read from `src/lib/mock.ts`. They are linked by `BottomNav`, so they're reachable, but they don't reflect real data:
- `src/routes/home.tsx` — mock rings, `todayMetrics`, `aiInsightRotation`
- `src/routes/workouts.tsx` — `todaySession`, `chips`
- `src/routes/nutrition.tsx` — `todayMeals`, `macroTargets`, `macroToday`
- `src/routes/coach.tsx` — `todayMetrics`, `todaySession`, `macroTargets`, `macroToday`

**`src/lib/mock.ts`** — the source of all the legacy mock data (including the `81` hardcoded score, "Body Fat" style placeholders). Still imported by the four legacy screens above; should be removed when those screens are rebuilt against the Shield tables.

**`BottomNav` has no `/dashboard` entry** — the only real-data screen (`/dashboard`) is unreachable via in-app nav. Users currently land on it only via direct URL or post-onboarding redirect.

**No components are fully orphaned.** Every file under `src/components/` is imported somewhere:
- `AIOrb.tsx` → `home`, `nutrition`, `index`
- `BottomNav.tsx` → `home`, `workouts`, `nutrition`, `coach`, `settings`
- `RingChart.tsx` → `home`, `nutrition`
- `LogModals.tsx` → `_authenticated/dashboard`, `MealHistoryList`
- `MealHistoryList.tsx` → `_authenticated/dashboard`

**Other observations** (not requested as fixes, just flagged):
- Webhook triggers missing — see §2 finding above.
- `src/routes/index.tsx` and `home.tsx` both exist; `/` and `/home` are distinct screens, easy to confuse.
- Hydration warnings from `data-gr-c-s-check-loaded` / `data-gr-ext-installed` come from the user's Grammarly browser extension, not the app.
