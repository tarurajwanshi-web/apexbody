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
