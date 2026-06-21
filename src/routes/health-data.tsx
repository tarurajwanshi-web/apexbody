import { createFileRoute } from "@tanstack/react-router";
import { LegalPage } from "./privacy";

export const Route = createFileRoute("/health-data")({
  head: () => ({ meta: [{ title: "Health Data Policy — APEX" }] }),
  component: () => <LegalPage title="Health Data Policy" src="/APEX_Health_Data_Policy.md" />,
});
