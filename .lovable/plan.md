# P0 Apple PWA Delete Debug Plan

## What I already found (DB facts, not theory)

Two users exist:

| auth_user_id (masked) | provider | email | timezone | active logs | latest_entry |
|---|---|---|---|---|---|
| `15f6216f…7089d3` | **apple** | `452wy9zrhg@privaterelay.appleid.com` | **NULL** | 9 | 2026-06-22 |
| `340c0116…3b925c` | google | `taru…@gmail.com` | NULL | 0 | — |

The Apple user owns the 1,638 kcal meal:

- **id**: `9f46cba5-4fbe-4ebd-b43e-b544e0d3dd78`
- **entry_date**: `2026-06-22`
- **deleted**: `false`
- **kcal/P/C/F**: 1638 / 78 / 145 / 80
- **calorie_estimate_status**: `estimated`, **claude_score_status**: `scored`
- created_at: `2026-06-22 08:52:32 UTC`

The previous "no 1,638 kcal meal" verdict checked the wrong session (the dev/Google account, not the Apple PWA). The row is live and undeleted.

Key smell: `profiles.timezone` is **NULL** for the Apple user. The Fuel page derives `selectedDate` from browser/profile timezone; with NULL profile tz, if there's any code path that falls back to UTC or to a different "today", the visible row id and the `getTodayMeals(selectedDate)` query can drift, and delete can target a date that doesn't match.

## Plan (debug only, no new features)

### Step 1 — Add a dev-only diagnostics panel on `/nutrition`
A small, visually-unobtrusive collapsible block, rendered only when `import.meta.env.DEV` **or** `?diag=1` is in the URL (so we can flip it on in the published Apple PWA without shipping it to all users). Shows:

- build timestamp + short git SHA (from a Vite `define`)
- `VITE_SUPABASE_PROJECT_ID`
- `auth.uid()` and provider (from `supabase.auth.getUser()`)
- `profile.id`, `profile.timezone`
- `Intl.DateTimeFormat().resolvedOptions().timeZone`
- `selectedDate` (the prop driving the page)
- "user local today" computed the same way the rest of the app computes it
- visible meal ids + calories rendered in `UnifiedTimeline`
- ids returned by `getTodayMeals(selectedDate)`
- a one-shot diagnostic server fn that does `select id, entry_date, deleted, estimated_calories from shield_nutrition_logs where user_id = auth.uid() and entry_date = $selectedDate and deleted is not true` and returns the raw rows so we can compare DB ↔ UI

No styling work, no design, no business logic changes.

### Step 2 — Instrument the delete path (already partially in place)
Confirm/extend the existing `[meal-delete] …` console group to also log: `auth.uid`, `selectedDate`, the meal's `entry_date`, and the full `softDeleteMeal` response (already done) **plus** a post-delete admin re-read of the row via a new dev-only server fn `debugReadMealById(id)` that returns `{id, deleted, user_id, entry_date}` so we can see the DB truth without relying on the RLS-filtered client read.

### Step 3 — Apple PWA repro
Have the user open the saved-to-home-screen app at `/nutrition?diag=1`, screenshot the panel, attempt delete on the 1,638 kcal row, then screenshot again after reload. Read the screenshots + console output.

### Step 4 — Root-cause branch (fix only what the diagnostics prove)

| Symptom from Step 3 | Fix |
|---|---|
| Visible meal id ≠ any id in `getTodayMeals` result | UI source-of-truth bug — fix the prop wiring in `UnifiedTimeline` |
| `selectedDate` ≠ row's `entry_date` (e.g. PWA selectedDate is `2026-06-21` while row is `2026-06-22`) | Timezone/date fix in `src/lib/dates.ts` + persist browser tz to `profiles.timezone` on app load if NULL |
| `auth.uid()` ≠ `15f6216f…` | Auth/session linkage — Apple PWA is signed in as a different account |
| `VITE_SUPABASE_PROJECT_ID` ≠ `toixlzfmxtmtypmupcuc` | Wrong environment build shipped to PWA |
| `softDeleteMeal` returns `deleted:true` but reload still shows row | PWA service-worker / cache — bust the cache; verify `reloadNutritionSnapshot` actually refetches in PWA |
| `softDeleteMeal` throws / non-200 | RLS / server update bug — inspect response in logs |

### Step 5 — Verify
After fix, repeat the Apple PWA flow: delete must remove the row, Daily Fuel must drop by 1,638 kcal, hard refresh / app reopen must keep it hidden, and the post-delete admin re-read must show `deleted:true`.

### Out of scope (explicitly not touched)
Serving selector, add-item editor, scoring, typography, keyboard, Coach, training, graphs, redesigns.

## Files that will change
- `src/routes/nutrition.tsx` — add `?diag=1` diagnostics panel (dev-only) and wire post-delete admin re-read log
- `src/lib/shield.functions.ts` — add `debugReadMealById` (admin client, dev-only, gated by `requireSupabaseAuth` + same-user check) and `debugListTodayMeals`
- `vite.config.ts` — `define` for build SHA/timestamp
- Possibly `src/lib/dates.ts` and one onboarding/profile write site if Step 4 proves the timezone branch

No new product features, no UI redesign, no schema changes.
