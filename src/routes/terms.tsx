import { createFileRoute } from "@tanstack/react-router";
import { LegalShell } from "./privacy";

export const Route = createFileRoute("/terms")({
  head: () => ({ meta: [{ title: "Terms of Service — APEX" }] }),
  component: () => (
    <LegalShell
      title="Terms of Service"
      body="[Placeholder — final legal copy pending] APEX is a performance coaching tool provided for educational use only and is not a substitute for medical advice. By using APEX you agree not to misuse the service and to accept the AI-generated guidance as informational, not prescriptive."
    />
  ),
});
