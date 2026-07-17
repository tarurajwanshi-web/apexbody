import { createFileRoute, useRouter } from "@tanstack/react-router";
import { ChevronLeft } from "lucide-react";

export const Route = createFileRoute("/_authenticated/settings/device")({
  head: () => ({ meta: [{ title: "Connect device — APEX" }] }),
  component: DevicePage,
});

function DevicePage() {
  const router = useRouter();
  return (
    <div className="min-h-screen pb-32" style={{ paddingTop: "calc(env(safe-area-inset-top, 0px) + 16px)" }}>
      <header className="flex items-center justify-between px-5">
        <button onClick={() => router.history.back()} className="text-text-secondary" aria-label="Back">
          <ChevronLeft size={24} />
        </button>
        <span className="text-label text-text-tertiary">Device</span>
        <span className="w-6" />
      </header>

      <main className="px-6 mt-24 max-w-[420px] mx-auto text-center">
        <h1 className="text-hero text-text-primary">Connect device</h1>
        <p className="mt-4 text-body text-text-secondary">
          Coming with the iOS app. For now, use the daily check-in to log recovery.
        </p>
      </main>
    </div>
  );
}
