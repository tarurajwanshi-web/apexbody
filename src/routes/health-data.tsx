import { createFileRoute } from "@tanstack/react-router";
import { LegalShell } from "./privacy";

export const Route = createFileRoute("/health-data")({
  head: () => ({ meta: [{ title: "Health Data Policy — APEX" }] }),
  component: () => (
    <LegalShell
      title="Health Data Policy"
      body="[Placeholder — final legal copy pending] Health-related data you provide (recovery, HRV, sleep, body composition) is used solely to compute your personalized scores and coaching. It is stored in encrypted form and never shared with third parties without your explicit consent."
    />
  ),
});
