import { createFileRoute, Link } from "@tanstack/react-router";
import { ChevronLeft } from "lucide-react";

export const Route = createFileRoute("/privacy")({
  head: () => ({ meta: [{ title: "Privacy Policy — APEX" }] }),
  component: () => (
    <LegalShell
      title="Privacy Policy"
      body="[Placeholder — final legal copy pending] APEX collects only the data you provide (profile, recovery, training, nutrition photos) to personalize your coaching. We do not sell personal data. You may delete your account and data at any time."
    />
  ),
});

export function LegalShell({ title, body }: { title: string; body: string }) {
  return (
    <div className="min-h-screen bg-bg-1 pb-32">
      <header
        className="flex items-center justify-between px-5"
        style={{ paddingTop: "calc(env(safe-area-inset-top, 0px) + 16px)" }}
      >
        <Link to="/settings" className="text-text-secondary"><ChevronLeft size={24} /></Link>
        <span className="text-[11px] uppercase tracking-wider text-text-tertiary">Legal</span>
        <span className="w-6" />
      </header>
      <main className="px-5 mt-6 max-w-[480px] mx-auto">
        <h1 className="text-2xl font-bold">{title}</h1>
        <p className="mt-4 text-[14px] text-text-secondary leading-relaxed whitespace-pre-wrap">{body}</p>
        <p className="mt-8 text-[11px] text-text-tertiary">Placeholder text — final policy to be supplied.</p>
      </main>
    </div>
  );
}
