# Diagnostic Findings (no code changed)

## 1. AI Insight reappears after "Got it" — Scenario A (dismiss persistence is broken)

**Root cause:** The dismissed state is written to `localStorage` on tap but is **never read back on mount**. So every time the Dashboard component remounts (which happens on tab navigation away and back, since `/dashboard` unmounts when you go to `/workouts`), `insightDismissed` is re-initialized to `false` and the card renders again.

**Specific code path — `src/routes/_authenticated/dashboard.tsx`:**

- Line 48: `const [insightDismissed, setInsightDismissed] = useState(false);` — always starts `false`, no lazy initializer reading localStorage.
- Lines 300–303 (the "Got it" button): writes `localStorage.setItem("apex_insight_dismissed_at", <today>)` and sets state to `true`. **Correct write side.**
- There is **no** `useEffect` / lazy initializer that does `localStorage.getItem("apex_insight_dismissed_at")` and compares to today's date. Grep for the key returns only the write site.

So Scenario B is ruled out — even if the insight text were varying daily, dismissal would still not persist across a remount.

(Secondary observation, not the bug you asked about: the insight itself is cached server-side per user per day via `getOrCreateDailyInsight` → `daily_ai_insights`, so the same text WILL come back across remounts within a day — but that's the expected design.)

**Fix scope (for follow-up Build prompt):** read `apex_insight_dismissed_at` on mount; if it equals today's date (YYYY-MM-DD), initialize `insightDismissed` to `true`.

---

## 2. Meal stuck on "scoring…" — pre-existing row with broken invocation, not a current bug

**Database state:** Exactly one stuck meal exists — `id 15fb46a6-...`, `entry_date 2026-06-21`, `created_at 07:32:50 UTC`. Its `meal_photo_url` is a **proper 30-day signed URL** (`/storage/v1/object/sign/shield-uploads/...?token=...`), i.e. the post-fix format. So this is **not** a stale raw-path row from before the signed-URL fix.

**Function status:** `score-nutrition` is deployed and works correctly. I invoked it directly via curl against `/functions/v1/score-nutrition` with `{nutrition_log_id: "15fb46a6-..."}` — it returned HTTP 200 with valid scores (protein 62 / carbs 48 / timing 70 / quality 59) and a macro estimate (820 kcal, 28P/95C/32F). After that call the row flipped to `claude_score_status='scored'` and `calorie_estimate_status='estimated'` with `estimated_calories=820` populated. Edge-function logs for `score-nutrition` were empty before this manual call, confirming **the function was never invoked for that meal from the client**.

**Why the client invocation never reached the function:** In `src/components/LogModals.tsx` line 306:

```ts
void supabase.functions.invoke("score-nutrition", { body: { nutrition_log_id: id } }).catch(() => {});
onSaved?.();
onClose();
```

This is fire-and-forget with `.catch(() => {})` swallowing every error, followed immediately by `onClose()` which unmounts the sheet. Plausible reasons for the silent miss on that one row:

1. The function may not have been deployed yet at 07:32 (it's deployed now — proved by curl).
2. The browser fetch was aborted by the immediate modal close / page state change before the request flushed.
3. Any transient network/auth error is fully swallowed, so the row is left in `pending` forever and nothing retries.

There is **no retry path** anywhere: nothing re-invokes `score-nutrition` on app reopen or on viewing the meal list. Once a meal misses its single fire-and-forget call, it stays stuck forever.

**Brand-new meal end-to-end:** Cannot fully verify without a fresh user upload, but the manual curl proves the entire scoring + macro-estimation path (Anthropic call, DB write, signed-URL image fetch) is healthy right now. Fresh meals logged from the UI from this point on should score successfully, **assuming** the client fetch is not aborted by the immediate `onClose()`.

**Fix scope (for follow-up Build prompt) — for your review, not implemented:**

- Stop swallowing errors silently — at minimum log them.
- Don't fire-and-forget through a modal that closes synchronously. Either `await` the invoke before `onClose()`, or move the invocation into a place whose lifetime outlives the modal (e.g. queue it via the parent / a useEffect on the new row, or call it from the row's pending-status polling code).
- Add a server-side or client-side retry: any meal that sits in `claude_score_status='pending'` for > N seconds should be re-invoked once (either by `MealHistoryList` when it polls, or by a small re-kick from the Dashboard mount).
- One-shot heal for the existing stuck row: re-invoke `score-nutrition` for `15fb46a6-...` (already done manually above — the row is now scored).

---

## Summary

| Issue | Scenario | Root cause | Action |
|---|---|---|---|
| Insight reappears | A | Dismiss state never re-hydrated from localStorage on mount | Add lazy read of `apex_insight_dismissed_at` |
| Meal stuck "scoring…" | Pre-existing row | Fire-and-forget client invoke silently failed; no retry path | Await/queue invoke, log errors, add retry on pending rows |

Awaiting your Build-mode prompt with the precise fix you want.
