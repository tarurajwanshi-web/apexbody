## Notes on the spec

Two small things I'll adjust to keep the endpoint correct:

1. **No `requireJWT` helper exists.** `_shared/authorize.ts` exports `authorizeCaller(req, supa)` which already handles the JWT path and returns `{ ok: true, userId }`. I'll use it directly (no internal-secret accepted, since we want JWT-only) by treating a missing/internal-secret request as 401. Cleanest: call `authorizeCaller` and reject if `userId` is null (means internal-secret path was used).
2. **"Is it Monday?" check in the spec is a no-op.** `userLocalMonday()` always returns the Monday date for the user's current week, so `dayOfWeek` derived from it is always 1. To actually gate on Monday I'll compute today's day-of-week in the user's tz via `Intl.DateTimeFormat({ timeZone: tz, weekday: 'short' })` and compare. Returning `not_monday` only when it really isn't Monday.
3. **HTTP 204 with a body is invalid.** I'll return `200 { status: "not_monday" }` instead of 204-with-body.
4. **`experience_level` is in the spec SELECT** but not in the shared `Profile` type. I'll omit it (consistent with the calculate-macros-weekly refactor we just shipped).

## Plan

Create `supabase/functions/trigger-weekly-macro-review/index.ts`:

- CORS preflight handler.
- Service-role `createClient` (needed so `calculateMacrosForUser` can write via the RPC).
- Auth: call `authorizeCaller(req, supa)`; require `userId` (reject internal-secret-only callers with 401).
- Fetch profile by `user_id` with the same SELECT as the cron shell.
- Compute user-local day-of-week via `Intl.DateTimeFormat`. If not Monday → return `200 { status: "not_monday" }`.
- Compute `userLocalMonday(tz)` and check `nutrition_weekly_reviews` for `(user_id, week_start_date)`. If found → return `200 { status: "already_computed", review_id, decision, applied_target_id }`.
- Otherwise call `calculateMacrosForUser(user_id, profile, supa)`; on success return `200 { status: "computed", user_id, decision, applied_target_id }`.
- Catch `review_exists:` thrown by the shared engine and convert to the `already_computed` shape (race condition safety).
- Other errors → `500 { error }` with `console.error`.

No DB migrations, no cron registration, no client wiring (that's a separate task). Only this one new file.

Confirm and I'll build.