# P0 Deployment Audit Plan

## What I already know without code changes

| Item | Finding |
|---|---|
| Project published? | **No.** `Published URL: (not published)` per project metadata. Everything the user has been testing is on the **preview** URL. |
| Service worker | **None.** `grep -rn "serviceWorker\|registerSW\|vite-plugin-pwa\|workbox"` returns empty. No SW cache to bust. |
| PWA manifest | Exists at `public/manifest.webmanifest`, `display: standalone`, `start_url: /dashboard`, scope `/`. **No `version` field, no app-version hint, no update prompt.** |
| Preview URL host | `id-preview--23b7cc0e-cc45-480f-a556-d51abcb48d02.lovable.app` (and a secondary `preview--apex-performance-pro.lovable.app` appears in auth logs). |
| Supabase project ref expected by code | `toixlzfmxtmtypmupcuc` (from `.env` `VITE_SUPABASE_URL`). |
| Two DB users | Apple `15f6216f…89d3` (9 active logs, 2,375 kcal today incl. the 1,638 row). Google `340c0116…925c` (0 logs). Same `Asia/Dubai` tz. Same Supabase project. |
| My own diag bug | `DIAG_BUILD_STAMP = new Date().toISOString()` is **module-load time**, not build time. On an iOS PWA serving cached JS this still reports "now" — useless for detecting staleness. Must be replaced with a Vite-injected build-time constant. |

## Why the user still sees old behavior — top hypotheses (ranked)

1. **iOS PWA pinned to a stale JS bundle.** Without a service worker, iOS WebKit's HTTP cache + WKWebView's launch cache can keep an installed PWA on the JS chunks captured at install time. iOS does not auto-update an installed PWA from a fresh `index.html` until WebKit decides to revalidate; with `start_url: /dashboard` the launch never hits `/`. There is no update prompt, no version bump, no kill-switch.
2. **PWA installed against the preview URL, which serves the latest preview build — but only on a full network revalidation.** Same effect as #1, plus `id-preview--…` URLs can change semantics between sessions.
3. **QA done against wrong user session.** Previous turn confirmed this happened — Google session has 0 rows; "no 1,638 kcal meal" was a session-mismatch verdict, not a code bug.
4. **Source-only fixes that never reached the bundle the PWA is running.** Cannot be confirmed from code alone — needs the runtime diagnostic JSON from the actual PWA.

## Audit plan (small surgical work + user-supplied evidence)

### Phase 1 — Make the build stamp truthful (small, audit-only)
- Add a Vite `define` in `vite.config.ts`: `__APP_BUILD_TIMESTAMP__` = `JSON.stringify(new Date().toISOString())` at config-eval time.
- Replace `DIAG_BUILD_STAMP = new Date().toISOString()` in `src/routes/nutrition.tsx` with the injected constant.
- Add `import.meta.env.MODE` and `DEV` flags to the diag payload so we can tell prod-build vs dev-server.

This is the only code change in this audit. It is not a feature — it's an instrumentation correction so every claim below can be evidence-based.

### Phase 2 — Collect runtime evidence (user action)
User opens `/nutrition?diag=1` and taps **copy** on:
1. Desktop browser (Lovable preview iframe)
2. Desktop browser (preview URL opened directly, no iframe)
3. Mobile Safari (preview URL)
4. **iOS PWA** (Add to Home Screen, then launch from icon)

For each, the JSON now contains: real build timestamp, runtime label, userAgent, `VITE_SUPABASE_URL`, `auth.uid`, provider, profile tz, `selectedDate`, `todayISO`, visible meal ids, DB rows for selectedDate. Comparing the **build timestamp** across the four payloads tells us, definitively, whether they are running the same bundle.

### Phase 3 — Mechanical checklist (source-code side)
For each claimed change since morning, I'll list its source-code presence with exact file:line evidence (no shipping verdict — that comes from Phase 2):

- `softDeleteMeal` verifies `deleted=true` via admin client → `src/lib/shield.functions.ts:687-713`
- `restoreMeal` verifies `deleted=false` → `:715-739`
- `debugReadMealById`, `debugListMealsForDate` (today's adds) → `:745+`
- `handleDelete` optimistic + reload + admin re-read log → `src/routes/nutrition.tsx:117-156`
- `reloadNutritionSnapshot` single source of truth → `:90-106`
- `UnifiedTimeline` receives `meals` prop (no internal fetch) → confirmed earlier
- `MealHistoryList` deleted → previous turn
- `useUserTimezone` + auto-persist browser tz when NULL → `src/lib/dates.ts:107-148`
- `resolveUserTimezoneWithHint` for write-time client hint → `:186-205`
- Coach Day-X-of-7 copy / `ApexStreakStrip` / Macro Review copy ("Macro adjustment locked" vs "Target review locked") — will grep and report

### Phase 4 — Cross-reference and verdict
Produce the requested table:

| Claimed fix | Source present? | Browser build? | PWA build? | Working live? | Evidence | Status |

Status set from build-timestamp comparison + visible-meal-id comparison across the four payloads.

### Phase 5 — Cache busting (only if Phase 2 proves PWA is on a stale bundle)
No service worker exists, so the fix is one of:
- Tell the user to delete and reinstall the PWA (iOS HTTP cache + launch cache aren't user-clearable without that).
- Or **publish** the app to a stable URL (`apex-performance-pro.lovable.app`) and have the user reinstall the PWA from the published URL — Lovable's published HTML has revalidation-friendly headers, so subsequent updates land without reinstall. The preview URL does not have those same guarantees.
- Optionally add `id` to the manifest so future install/scope changes don't compound.

Adding a service worker is **out of scope** per the no-new-features rule and per the PWA skill (don't add SW unless user asks for offline). The fix path is reinstall + publish, not SW.

## Files that will change in this audit
- `vite.config.ts` — add `__APP_BUILD_TIMESTAMP__` define
- `src/routes/nutrition.tsx` — use the injected constant; add `MODE`/`DEV` to diag

Nothing else. No new product features, no UI changes, no schema changes.

## Output the user will receive at the end
1. Masked all-user DB summary (already produced).
2. The four runtime diag JSON blobs side-by-side.
3. Filled audit table with PASS / FAIL / SOURCE ONLY, NOT DEPLOYED / PWA CACHE STALE / WRONG USER/SESSION / WRONG SUPABASE PROJECT / NEEDS LIVE REPRO.
4. Root-cause statement.
5. Exact next action (reinstall PWA, publish, or code fix).
