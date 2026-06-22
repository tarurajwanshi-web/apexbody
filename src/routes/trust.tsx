import { createFileRoute, Link } from "@tanstack/react-router";
import { ChevronLeft } from "lucide-react";
import type { ReactNode } from "react";

export const Route = createFileRoute("/trust")({
  head: () => ({
    meta: [
      { title: "Trust & Security — APEX" },
      { name: "description", content: "How APEX protects your data: authentication, encryption in transit, row-level access controls, and your privacy rights." },
    ],
  }),
  component: TrustPage,
});

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mt-8">
      <h2 className="text-[17px] font-semibold text-text-primary">{title}</h2>
      <div className="mt-2 space-y-2 text-[14px] leading-relaxed text-text-secondary">{children}</div>
    </section>
  );
}

function TrustPage() {
  return (
    <div className="mx-auto min-h-screen max-w-2xl bg-bg-1 px-5 pb-24 pt-6 text-text-primary">
      <Link to="/home" className="inline-flex items-center gap-1 text-[14px] text-text-secondary">
        <ChevronLeft className="size-4" /> Back
      </Link>
      <h1 className="mt-4 text-[24px] font-bold">Trust & Security</h1>
      <p className="mt-2 text-[14px] text-text-secondary">
        This page is maintained by the APEX team to answer common questions about how the app
        handles your data. It describes the controls that are enabled today. It is editable
        product content, not an independent certification or audit.
      </p>

      <Section title="Authentication">
        <p>Sign-in uses Apple, Google, or email. Sessions are managed by our backend identity provider and stored locally on your device.</p>
      </Section>

      <Section title="Data access & row-level controls">
        <p>
          User-owned tables (nutrition logs, training logs, hydration, readiness, body measurements,
          weekly plans, macro targets) are protected by row-level security. Each row is scoped to
          the owning user's id and is only readable or modifiable in the context of that user's
          authenticated session, or by trusted server-side jobs that compute scores and weekly
          adjustments on their behalf.
        </p>
      </Section>

      <Section title="Transport & storage">
        <p>
          All traffic between the app and the backend is served over HTTPS. Uploads (meal photos,
          body scans, device screenshots) are stored in private buckets that are not publicly
          listable; access is granted through short-lived signed URLs.
        </p>
      </Section>

      <Section title="Third-party processors">
        <p>
          APEX relies on a managed backend (database, authentication, storage), and on AI providers
          for meal scoring and coaching responses. Only the data required for that specific request
          is sent to those providers.
        </p>
      </Section>

      <Section title="Retention & deletion">
        <p>
          You can delete individual entries (meals, hydration, weigh-ins) from the app. To request
          full account deletion or a data export, contact the email listed in our Privacy Policy.
        </p>
      </Section>

      <Section title="Reporting a security issue">
        <p>
          If you believe you have found a vulnerability, please contact the team using the address
          in our Privacy Policy. Include steps to reproduce. Please do not exploit the issue or
          access other users' data.
        </p>
      </Section>

      <Section title="Related">
        <p>
          <Link to="/privacy" className="underline">Privacy Policy</Link>{" · "}
          <Link to="/terms" className="underline">Terms of Use</Link>{" · "}
          <Link to="/health-data" className="underline">Health Data Policy</Link>
        </p>
      </Section>
    </div>
  );
}
