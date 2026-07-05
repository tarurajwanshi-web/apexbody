import { createFileRoute, redirect } from "@tanstack/react-router";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";

// The Supabase JS client's OAuth authorization-server helpers are beta and not
// yet in the shipped type surface. Cast through a narrow local type for the
// three methods we call here.
type OAuthClient = { name?: string | null };
type OAuthAuthorizationDetails = {
  client?: OAuthClient | null;
  redirect_url?: string | null;
  redirect_to?: string | null;
};
type OAuthDecisionResult = {
  redirect_url?: string | null;
  redirect_to?: string | null;
};
type OAuthNamespace = {
  getAuthorizationDetails(id: string): Promise<{
    data: OAuthAuthorizationDetails | null;
    error: { message: string } | null;
  }>;
  approveAuthorization(id: string): Promise<{
    data: OAuthDecisionResult | null;
    error: { message: string } | null;
  }>;
  denyAuthorization(id: string): Promise<{
    data: OAuthDecisionResult | null;
    error: { message: string } | null;
  }>;
};
function oauthApi(): OAuthNamespace {
  return (supabase.auth as unknown as { oauth: OAuthNamespace }).oauth;
}

export const Route = createFileRoute("/.lovable/oauth/consent")({
  // Browser-only: the Supabase client reads its session from localStorage,
  // absent on the SSR pass.
  ssr: false,
  validateSearch: (s: Record<string, unknown>) => ({
    authorization_id: typeof s.authorization_id === "string" ? s.authorization_id : "",
  }),
  beforeLoad: async ({ search, location }) => {
    if (!search.authorization_id) throw new Error("Missing authorization_id");
    const { data } = await supabase.auth.getSession();
    if (!data.session) {
      const next = location.pathname + location.searchStr;
      throw redirect({ href: `/?next=${encodeURIComponent(next)}` });
    }
  },
  loader: async ({ location }) => {
    const authorizationId = new URLSearchParams(location.search).get("authorization_id")!;
    const { data, error } = await oauthApi().getAuthorizationDetails(authorizationId);
    if (error) throw new Error(error.message);
    // Already-approved client: provider resolves immediately — bounce.
    const immediate = data?.redirect_url ?? data?.redirect_to;
    if (immediate && !data?.client) throw redirect({ href: immediate });
    return data;
  },
  component: Consent,
  errorComponent: ({ error }) => (
    <main className="min-h-screen flex items-center justify-center bg-bg-0 px-6 text-white">
      <div className="max-w-md text-center">
        <h1 className="text-xl font-bold mb-3">Could not load this authorization request</h1>
        <p className="text-sm text-text-secondary">
          {String((error as Error)?.message ?? error)}
        </p>
      </div>
    </main>
  ),
});

function Consent() {
  const details = Route.useLoaderData();
  const { authorization_id } = Route.useSearch();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function decide(approve: boolean) {
    setBusy(true);
    setError(null);
    const api = oauthApi();
    const { data, error } = approve
      ? await api.approveAuthorization(authorization_id)
      : await api.denyAuthorization(authorization_id);
    if (error) {
      setBusy(false);
      setError(error.message);
      return;
    }
    const target = data?.redirect_url ?? data?.redirect_to;
    if (!target) {
      setBusy(false);
      setError("No redirect returned by the authorization server.");
      return;
    }
    window.location.href = target;
  }

  const clientName = details?.client?.name ?? "an app";

  return (
    <main className="min-h-screen flex items-center justify-center bg-bg-0 px-6 py-12 text-white">
      <div className="w-full max-w-sm">
        <h1 className="text-2xl font-bold mb-3">Connect {clientName} to APEX</h1>
        <p className="text-sm text-text-secondary mb-8 leading-relaxed">
          This lets {clientName} read your recent workouts, readiness, and body
          measurements, and log new body weight entries — acting as you under
          your account's permissions.
        </p>
        {error && (
          <p role="alert" className="mb-4 text-sm text-red-400">
            {error}
          </p>
        )}
        <button
          disabled={busy}
          onClick={() => decide(true)}
          className="w-full rounded-2xl bg-white text-black py-3.5 text-sm font-semibold disabled:opacity-60 mb-3"
        >
          {busy ? "Working…" : "Approve"}
        </button>
        <button
          disabled={busy}
          onClick={() => decide(false)}
          className="w-full rounded-2xl bg-bg-2 border border-white/10 py-3.5 text-sm font-semibold disabled:opacity-60"
        >
          Deny
        </button>
      </div>
    </main>
  );
}
