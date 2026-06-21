// Audit #3: shared authorization helper for service-role edge functions.
//
// Accepts either:
//   (a) `x-internal-secret` header matching the dispatch_secret stored in
//       Supabase Vault — used by DB-trigger dispatch functions and the
//       weekly cron. Read via the `public.get_dispatch_secret()` RPC
//       (SECURITY DEFINER, service_role only).
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

/** Constant-time string equality. Returns false fast on length mismatch
 *  (length itself is not a secret here). */
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

export async function authorizeCaller(
  req: Request,
  supa: SupabaseClient,
  body_user_id?: string,
): Promise<AuthzResult> {
  const internalSecret = req.headers.get("x-internal-secret");
  if (internalSecret) {
    const expected = await loadInternalSecret(supa);
    if (expected && constantTimeEqual(internalSecret, expected)) {
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

/** Internal-secret-only gate. Rejects ANY request that does not present a
 *  valid `x-internal-secret` header — no JWT fallback. Use on functions
 *  that should only ever be invoked by DB triggers or pg_cron, not by users.
 */
export async function requireInternalSecret(
  req: Request,
  supa: SupabaseClient,
): Promise<AuthzResult> {
  const internalSecret = req.headers.get("x-internal-secret");
  if (!internalSecret) {
    return { ok: false, status: 401, error: "unauthorized: x-internal-secret header required" };
  }
  const expected = await loadInternalSecret(supa);
  if (expected && constantTimeEqual(internalSecret, expected)) {
    return { ok: true, userId: null };
  }
  return { ok: false, status: 401, error: "invalid internal secret" };
}

export const corsAllowHeaders =
  "authorization, x-client-info, apikey, content-type, x-internal-secret";
