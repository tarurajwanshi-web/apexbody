
# Critical Block Verification Report — Read-Only Evidence

No code or DB changes were made. This is evidence only. **One critical finding at the end (§5): the deployed `calculate-macros-weekly` is currently open to the public.**

---

## 1. `internal_secrets` table — definition & access control

### 1a. CREATE TABLE (from migration `20260621231446_…`)

```sql
CREATE TABLE IF NOT EXISTS public.internal_secrets (
  name text PRIMARY KEY,
  value text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.internal_secrets TO service_role;
ALTER TABLE public.internal_secrets ENABLE ROW LEVEL SECURITY;

INSERT INTO public.internal_secrets (name, value)
VALUES ('dispatch_secret', encode(gen_random_bytes(32), 'hex'))
ON CONFLICT (name) DO NOTHING;
```

Columns confirmed via `information_schema.columns`:
- `name text NOT NULL` (PK)
- `value text NOT NULL`
- `created_at timestamptz NOT NULL`

### 1b. RLS status

`pg_class.relrowsecurity = true`, `relforcerowsecurity = false`. RLS is **enabled**.

### 1c. Every policy (verbatim, from migration `20260621231501_…` + `pg_policies`)

```sql
CREATE POLICY "deny all to non-service-role"
  ON public.internal_secrets
  FOR ALL
  TO anon, authenticated
  USING (false)
  WITH CHECK (false);
```

`pg_policies` row:
```
tablename=internal_secrets
policyname="deny all to non-service-role"
roles={anon,authenticated}
cmd=ALL  qual=false  with_check=false
```

### 1d. Every GRANT/REVOKE

Only:
```sql
GRANT ALL ON public.internal_secrets TO service_role;
```
No GRANT to `anon`, `authenticated`, or `PUBLIC`. No REVOKE issued (none needed — default privileges in `public` schema were never granted to those roles).

### 1e. `information_schema.role_table_grants` result

```sql
SELECT grantee, privilege_type
FROM information_schema.role_table_grants
WHERE table_schema='public' AND table_name='internal_secrets';
```
Result: **empty set** (0 rows). The `GRANT … TO service_role` is recorded in `pg_class.relacl` but `service_role` is a Supabase-owned role that `information_schema` filters out for the querying user. The grant is in place — see 1d for the migration text.

### 1f. `pg_policies` result

Single row, shown verbatim in 1c.

### 1g. Direct answers

- **Can anon/authenticated read it under any policy?** No. The only policy on the table is `USING (false) WITH CHECK (false)` for `anon, authenticated`. There is no SELECT policy that ever returns true for those roles, and no permissive policy exists. There is also no SECURITY DEFINER function that returns rows to non-service-role callers — only `shield_dispatch_*` and the edge functions read `internal_secrets`, and `shield_dispatch_*` are `EXECUTE` REVOKEd from `PUBLIC, anon, authenticated` (migration `20260621231501_…` line 2–3).
- **Does it appear in pg_dump?** Yes — it's a regular table in the `public` schema with no special exclusion. Database backups will contain the row. The secret value is therefore only as private as the backup pipeline. (This is the same posture as any data row; not a separate hardening claim.)
- **Why a table instead of Vault / project secret?** Honest answer: it was a shortcut. Supabase Vault was not used and no project-level secret was added. A table was chosen because (a) `pg_net` from a `SECURITY DEFINER` PL/pgSQL function can read it with no extra plumbing, and (b) the dispatch SQL functions were already written that way in earlier code. A proper implementation would either (i) store the secret in Supabase Vault and read it via `vault.decrypted_secrets`, or (ii) store it as an edge-function secret and let the dispatch function pass a salted HMAC instead of the raw secret. Neither was done. Flag this as a real follow-up, not "by design."

---

## 2. `authorizeCaller` — full source

File: `supabase/functions/_shared/authorize.ts` (verbatim, no omissions):

```ts
// Audit #3: shared authorization helper for service-role edge functions.
//
// Accepts either:
//   (a) `x-internal-secret` header matching `public.internal_secrets.dispatch_secret`
//       — used by DB-trigger dispatch functions and the weekly cron.
//   (b) `Authorization: Bearer <jwt>` whose authenticated user.id equals the
//       supplied `body_user_id` — used by signed-in users calling a function
//       that operates on their own data.
//
// Rejects unauthenticated calls and cross-user attempts. Result must be
// checked by the caller before any privileged work is performed.

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

let _cachedInternalSecret: string | null = null;

export type AuthzResult =
  | { ok: true; userId: string | null /* null = internal-secret path */ }
  | { ok: false; status: number; error: string };

export async function authorizeCaller(
  req: Request,
  supa: SupabaseClient,
  body_user_id?: string,
): Promise<AuthzResult> {
  const internalSecret = req.headers.get("x-internal-secret");
  if (internalSecret) {
    if (!_cachedInternalSecret) {
      const { data } = await supa
        .from("internal_secrets")
        .select("value")
        .eq("name", "dispatch_secret")
        .maybeSingle();
      _cachedInternalSecret = (data as { value?: string } | null)?.value ?? null;
    }
    if (_cachedInternalSecret && internalSecret === _cachedInternalSecret) {
      return { ok: true, userId: null };
    }
    return { ok: false, status: 401, error: "invalid internal secret" };
  }

  const authHeader = req.headers.get("authorization") || req.headers.get("Authorization");
  if (!authHeader || !authHeader.toLowerCase().startsWith("bearer ")) {
    return { ok: false, status: 401, error: "unauthorized: missing bearer token or internal secret" };
  }
  const token = authHeader.slice(7).trim();
  const { data: userData, error } = await supa.auth.getUser(token);
  if (error || !userData?.user) {
    return { ok: false, status: 401, error: "unauthorized: invalid token" };
  }
  if (body_user_id && body_user_id !== userData.user.id) {
    return { ok: false, status: 403, error: "forbidden: user_id does not match authenticated caller" };
  }
  return { ok: true, userId: userData.user.id };
}

export const corsAllowHeaders =
  "authorization, x-client-info, apikey, content-type, x-internal-secret";
```

### Branch-by-branch answers

- **JWT validation:** `supa.auth.getUser(token)` — service-role Supabase client verifies the access token against the project's Auth signing keys. `error || !userData?.user` → 401.
- **user_id ↔ auth.uid() match:** `if (body_user_id && body_user_id !== userData.user.id) return 403`. Caller must pass `body_user_id` from the edge function; if omitted, no ownership check happens (see §3 caveats).
- **Row ownership for `score-nutrition`:** Performed in the function (not the helper). The function `SELECT`s the `shield_nutrition_logs` row by id (service-role read, bypasses RLS), then calls `authorizeCaller(req, supabase, row.user_id)`. Helper enforces `row.user_id === jwt.user.id`. See `score-nutrition/index.ts` lines 55–76.
- **Row ownership for `parse-device-upload`:** Same pattern. Function loads the upload row by `upload_id` or `(user_id, entry_date)`, then `authorizeCaller(req, supabase, row.user_id)`. See `parse-device-upload/index.ts` lines 44–76.
- **Internal-secret check:** First branch in helper. Reads `internal_secrets` via the service-role client, caches in a module-level variable, compares with simple `===` (no constant-time comparison — minor concern, but the dispatch_secret is a 256-bit random hex, so practical timing-attack feasibility is negligible).
- **Both JWT and internal-secret present:** Internal-secret branch wins (it's checked first and either returns ok or returns 401 — control never falls through to the JWT branch). This means a request with a valid JWT but a *wrong* internal-secret header is **rejected**, not promoted to the JWT path. Reasonable, but worth noting.
- **Neither present:** `internalSecret` is null → falls into JWT branch → `authHeader` is null/empty → returns `{ ok:false, status: 401, error: "unauthorized: missing bearer token or internal secret" }`.

### `calculate-macros-weekly` specifically: is there an internal-secret-only enforcement?

**No.** The function uses the same generic `authorizeCaller`. The relevant lines are at `calculate-macros-weekly/index.ts` 484–503:

```ts
let body: { user_id?: string; force_recalculate?: boolean } = {};
try { body = await req.json(); } catch { /* empty body OK for cron */ }
...
const authz = await authorizeCaller(req, supa, body.user_id);
if (!authz.ok) { return new Response(... status: authz.status ...); }
```

So a request with a valid user JWT (and no internal-secret header) and either (a) no `user_id` in the body or (b) a `user_id` matching the caller's `auth.uid()` will pass `authorizeCaller` and proceed.

Per the spec ("internal-secret ONLY, no JWT fallback"), this is **non-compliant**. The Mode-A-fallback concern is real. The fix is a one-liner gate at the top of this function that requires the `x-internal-secret` header before delegating to `authorizeCaller`, or a second helper that omits the JWT branch.

---

## 3. Per-function auth mode (with code citations)

| Function | Expected | Actual | Citation |
|---|---|---|---|
| `calculate-macros` | JWT-with-ownership only | JWT-with-ownership **OR** internal-secret (helper accepts both) | `calculate-macros/index.ts` ~line 81: `const authz = await authorizeCaller(req, supa, user_id);` then `if (!authz.ok) return ...` |
| `generate-plan` | JWT-with-ownership only | JWT-with-ownership **OR** internal-secret | `generate-plan/index.ts` lines 73–79 |
| `score-nutrition` | JWT-with-ownership only | JWT-with-ownership **OR** internal-secret | `score-nutrition/index.ts` lines 68–76 |
| `parse-device-upload` | both | both ✅ | `parse-device-upload/index.ts` lines 71–76 |
| `calculate-score` | both | both (helper accepts both) | `calculate-score/index.ts` imports helper; gate lives near the request entry |
| `calculate-macros-weekly` | internal-secret ONLY | both ❌ — see §2 last subsection | `calculate-macros-weekly/index.ts` lines 484–503 |

**Caveat for the three "JWT-with-ownership only" rows:** the helper still accepts an internal-secret header on those functions. In practice nothing dispatches to them via internal-secret, but defense-in-depth says the helper should not silently accept it. Pragmatically low-risk (the secret is server-side only), but worth tightening if you want strict spec compliance.

---

## 4. Updated DB dispatch SQL + cron

### `shield_dispatch_calculate_score` (current `pg_proc` body)

```sql
CREATE OR REPLACE FUNCTION public.shield_dispatch_calculate_score(_user_id uuid, _entry_date date)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE _secret text;
BEGIN
  BEGIN
    SELECT value INTO _secret FROM public.internal_secrets WHERE name = 'dispatch_secret';
    PERFORM net.http_post(
      url := 'https://toixlzfmxtmtypmupcuc.supabase.co/functions/v1/calculate-score',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-internal-secret', COALESCE(_secret, '')
      ),
      body := jsonb_build_object('user_id', _user_id, 'entry_date', _entry_date)
    );
  EXCEPTION WHEN OTHERS THEN NULL;
  END;
END;
$function$;
```

### `shield_dispatch_parse_device_upload`

```sql
CREATE OR REPLACE FUNCTION public.shield_dispatch_parse_device_upload(_upload_id uuid, _user_id uuid, _entry_date date)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE _secret text;
BEGIN
  BEGIN
    SELECT value INTO _secret FROM public.internal_secrets WHERE name = 'dispatch_secret';
    PERFORM net.http_post(
      url := 'https://toixlzfmxtmtypmupcuc.supabase.co/functions/v1/parse-device-upload',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-internal-secret', COALESCE(_secret, '')
      ),
      body := jsonb_build_object('upload_id', _upload_id, 'user_id', _user_id, 'entry_date', _entry_date)
    );
  EXCEPTION WHEN OTHERS THEN NULL;
  END;
END;
$function$;
```

### Cron entry (from `cron.job`)

```
jobid   = 3
jobname = adaptive-macros-weekly
schedule = '0 13 * * 1'
active  = false
command =
  SELECT net.http_post(
    url := 'https://toixlzfmxtmtypmupcuc.supabase.co/functions/v1/calculate-macros-weekly',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-internal-secret', (SELECT value FROM public.internal_secrets WHERE name = 'dispatch_secret')
    ),
    body := '{}'::jsonb
  );
```

In all three, the secret is sourced from `public.internal_secrets` at call time, not hardcoded. The dispatch funcs additionally swallow `net.http_post` errors via the inner `BEGIN/EXCEPTION WHEN OTHERS THEN NULL` — that's intentional so a failing HTTP post doesn't roll back the user's row write, but it does mean dispatch failures are silent. Not a security issue, but worth knowing.

Confirmed `internal_secrets` does contain a `dispatch_secret` row (64-char hex value present; not shown here).

---

## 5. Functional confirmation — **CRITICAL FINDING**

Tested against the live deployed `calculate-macros-weekly` via raw `curl` (no preview-session injection):

### Case A — valid JWT, no internal-secret header (expected 401)

Using `Authorization: Bearer invalid.jwt.token` (deliberately-bad JWT):
```
HTTP 200
{"ok":true,"processed":1,"summary":{"skipped":1},
 "results":[{"user_id":"340c0116-…","status":"skipped"}]}
```

### Case B — no JWT, no internal-secret header (expected 401)

```bash
curl -X POST .../functions/v1/calculate-macros-weekly -d '{}'
```
```
HTTP 200
{"ok":true,"processed":1,"summary":{"skipped":1},
 "results":[{"user_id":"340c0116-…","status":"skipped"}]}
```

### Case C — correct internal-secret header (expected 200)

Not run, because A and B already prove the gate is not enforced — running C would only re-confirm a positive case.

### Diagnosis

The deployed function is responding to fully-unauthenticated requests with a real, executed result against actual user profiles. There are two non-exclusive causes:

1. **The new code has not been deployed.** The audit-fix edits to `calculate-macros-weekly/index.ts` exist in the repo but the running edge function appears to be a pre-fix build. Edge function logs show only `booted (time: 25ms)` entries — no `error` or `unauthorized` log lines from `authorizeCaller`, consistent with the older code path being live. A deploy is required before any of the §2/§3 analysis applies to the running system.

2. **Even after deploy, the Mode-A-fallback gap in §2 remains.** Once redeployed, Cases A and B will return 401 (the helper rejects both). Case A with a *valid* user JWT (matching `body.user_id` or with `body.user_id` omitted) will still return 200 — that is the spec violation called out in §2 / §3, and it needs the internal-secret-only gate added before the cron is enabled.

**Net:** the cron being `active=false` is currently the only thing protecting this endpoint from being driven by anyone with the URL. Do not flip the cron on until (a) the function is redeployed and (b) the internal-secret-only gate is added.

---

## Recommended follow-ups (not implemented)

1. Redeploy `calculate-macros-weekly` and re-run Cases A/B/C.
2. Add an internal-secret-only gate to `calculate-macros-weekly` (reject if `x-internal-secret` header is absent, before calling `authorizeCaller`).
3. Optionally tighten `calculate-macros`, `generate-plan`, `score-nutrition` to reject the internal-secret branch (spec calls for JWT-only on these three).
4. Move `dispatch_secret` out of a regular table — either Supabase Vault or an edge-function secret — to remove it from pg_dump scope.
5. Replace the `===` secret comparison with a constant-time compare (low priority given a 256-bit random hex).

Awaiting your go-ahead on which of these to implement.
