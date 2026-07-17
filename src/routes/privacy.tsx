import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { ChevronLeft } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/privacy")({
  head: () => ({ meta: [{ title: "Privacy Policy — APEX" }] }),
  component: () => <LegalPage title="Privacy Policy" src="/APEX_Privacy_Policy.md" />,
});

export function LegalPage({ title, src }: { title: string; src: string }) {
  const [body, setBody] = useState<string | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    fetch(src)
      .then((r) => (r.ok ? r.text() : Promise.reject()))
      .then(setBody)
      .catch(() => setError(true));
  }, [src]);
  return (
    <LegalShell title={title}>
      {error ? (
        <p className="text-text-secondary text-[14px]">Unable to load policy.</p>
      ) : body === null ? (
        <p className="text-text-tertiary text-[14px]">Loading…</p>
      ) : (
        <article className="legal-prose">
          <ReactMarkdown>{body}</ReactMarkdown>
        </article>
      )}
    </LegalShell>
  );
}

export function LegalShell({ title, children }: { title: string; children: ReactNode }) {
  const router = useRouter();
  const [fallback, setFallback] = useState<"/" | "/disclaimer" | "/settings">("/");

  useEffect(() => {
    (async () => {
      const { data } = await supabase.auth.getUser();
      if (!data.user) { setFallback("/"); return; }
      const { data: prof } = await supabase
        .from("profiles")
        .select("disclaimer_accepted_at, profile_completed_at")
        .eq("user_id", data.user.id)
        .maybeSingle();
      if (!prof || !prof.disclaimer_accepted_at) setFallback("/disclaimer");
      else setFallback("/settings");
    })();
  }, []);

  const onBack = () => {
    // Router history has more than the current entry when the user arrived via navigation.
    // Otherwise (direct URL open), fall back based on auth state.
    try {
      if (typeof window !== "undefined" && window.history.length > 1) {
        router.history.back();
        return;
      }
    } catch { /* no-op */ }
    // Deterministic fallback
    window.location.replace(fallback);
  };

  return (
    <div className="min-h-screen pb-32">
      <header
        className="flex items-center justify-between px-5"
        style={{ paddingTop: "calc(env(safe-area-inset-top, 0px) + 16px)" }}
      >
        <button onClick={onBack} className="text-text-secondary" aria-label="Back">
          <ChevronLeft size={24} />
        </button>
        <span className="text-[11px] uppercase tracking-wider text-text-tertiary">Legal</span>
        <Link to={fallback === "/" ? "/" : fallback} className="w-6" />
      </header>
      <main className="px-5 mt-6 max-w-[640px] mx-auto">
        <h1 className="text-2xl font-bold mb-6">{title}</h1>
        {children}
      </main>
    </div>
  );
}
