## Verification Report (read-only) — and a critical follow-up

All requested source/SQL is shown below verbatim. One **new bug** was found while gathering it (the disabled cron command). Live tests #3 and #4 are deferred to build mode because they would mutate data and need to run after the bug is fixed.

---

### 1. Shared auth helper — `supabase/functions/_shared/authorize.ts`

```ts
let _cachedInternalSecret: string | null = null;

export function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function loadInternalSecret(supa: SupabaseClient): Promise<string | null> {
  if (_cachedInternalSecret) return _cachedInternalSecret;
  const { data, error } = await supa.rpc("get_dispatch_secret");
  if (error || typeof data !== "string" || !data) return null;
  _cachedInternalSecret = data;
  return _cachedInternalSecret;
}

export async function authorizeCaller(req, supa, body_user_id?) {
  const internalSecret = req.headers.get("x-internal-secret");
  if (internalSecret) {
    const expected = await loadInternalSecret(supa);
    if (expected && constantTimeEqual(internalSecret, expected)) return { ok: true, userId: null };
    return { ok: false, status: 401, error: "invalid internal secret" };
  }
  const authHeader = req.headers.get("authorization") || req.headers.get("Authorization");
  if (!authHeader || !authHeader.toLowerCase().startsWith("bearer ")) {
    return { ok: false, status: 401, error: "unauthorized: missing bearer token or internal secret" };
  }
  const token = authHeader.slice(7).trim();
  const { data: userData, error } = await supa.auth.getUser(token);
  if (error || !userData?.user) return { ok: false, status: 401, error: "unauthorized: invalid token" };
  if (body_user_id && body_user_id !== userData.user.id) {
    return { ok: false, status: 403, error: "forbidden: user_id does not match authenticated caller" };
  }
  return { ok: true, userId: userData.user.id };
}

export async function requireInternalSecret(req, supa) {
  const internalSecret = req.headers.get("x-internal-secret");
  if (!internalSecret) return { ok: false, status: 401, error: "unauthorized: x-internal-secret header required" };
  const expected = await loadInternalSecret(supa);
  if (expected && constantTimeEqual(internalSecret, expected)) return { ok: true, userId: null };
  return { ok: false, status: 401, error: "invalid internal secret" };
}
```

---

### 2. SQL — dispatch functions, get_dispatch_secret, cron

**`get_dispatch_secret()`** — SECURITY DEFINER, `search_path = vault, public`:
```sql
CREATE OR REPLACE FUNCTION public.get_dispatch_secret()
 RETURNS text LANGUAGE sql STABLE SECURITY DEFINER
 SET search_path TO 'vault', 'public'
AS $$ SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name='dispatch_secret' LIMIT 1; $$;
```
Grants (`pg_proc.proacl`): `{postgres=X/postgres, service_role=X/postgres, sandbox_exec=X/postgres}` — **no PUBLIC, no anon, no authenticated**. ✅

**`shield_dispatch_calculate_score`** and **`shield_dispatch_parse_device_upload`** — both SECURITY DEFINER, `search_path = public, extensions, vault`, both read from `vault.decrypted_secrets` and POST with `x-internal-secret` header (full bodies retrieved verbatim from `pg_get_functiondef`). Grants on both: `{postgres, service_role, sandbox_exec}` only — `PUBLIC/anon/authenticated` revoked. ✅

**Cron job (`adaptive-macros-weekly`, `0 13 * * 1`, `active=false`):**
```sql
SELECT net.http_post(
  url := 'https://toixlzfmxtmtypmupcuc.supabase.co/functions/v1/calculate-macros-weekly',
  headers := jsonb_build_object(
    'Content-Type', 'application/json',
    'x-internal-secret', (SELECT value FROM public.internal_secrets WHERE name = 'dispatch_secret')
  ),
  body := '{}'::jsonb
);
```

### 🚨 Critical finding — cron command is broken

The cron command still queries `public.internal_secrets`, which the latest migration **dropped**. If enabled today, `net.http_post` would be called with `x-internal-secret` = `NULL` (since the subselect errors), and `requireInternalSecret` would correctly reject every call with 401. The cron would silently do nothing.

This must be fixed **before** any live positive-path test of #3 is meaningful.

---

### 3. & 4. Live tests — deferred

- **#3** (positive internal dispatch): cannot run truthfully until the cron command above is rewritten to use `vault.decrypted_secrets` (matching the dispatch trigger functions).
- **#4** (cross-user 403): requires invoking each function with (a) no auth, (b) the preview user's JWT against their own row, (c) the preview user's JWT against another user's row. Each call may write to `daily_macro_targets` / `weekly_plans` / scoring tables, so it needs build mode.

---

### Proposed build-mode work

1. **Fix the cron command** via migration:
   ```sql
   SELECT cron.alter_job(
     job_id := (SELECT jobid FROM cron.job WHERE jobname='adaptive-macros-weekly'),
     command := $cmd$
       SELECT net.http_post(
         url := 'https://toixlzfmxtmtypmupcuc.supabase.co/functions/v1/calculate-macros-weekly',
         headers := jsonb_build_object(
           'Content-Type','application/json',
           'x-internal-secret', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name='dispatch_secret')
         ),
         body := '{}'::jsonb
       );
     $cmd$
   );
   ```
   Leave `active=false`.

2. **Run #3 positive test:** invoke `calculate-macros-weekly` once via `net.http_post` from a SQL call (same path the cron uses), then read `nutrition_weekly_reviews` / edge logs to confirm it reached the handler and returned 200. Cron stays disabled.

3. **Run #4 ownership tests** for each of the 5 functions via `supabase--curl_edge_functions`:
   - no auth → expect 401
   - preview user's JWT, own user_id / own row → expect 200
   - preview user's JWT, other user_id / other row → expect 403
   Use a throwaway second user_id (random UUID) for the cross-user case so we don't need a second real session — `authorizeCaller` rejects on the JWT/body mismatch before any DB write.

4. Paste exact status codes + response bodies and stop.

No other audit items will be touched.