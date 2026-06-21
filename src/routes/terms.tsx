import { createFileRoute } from "@tanstack/react-router";
import { LegalPage } from "./privacy";

export const Route = createFileRoute("/terms")({
  head: () => ({ meta: [{ title: "Terms of Use — APEX" }] }),
  component: () => <LegalPage title="Terms of Use" src="/APEX_Terms_of_Use.md" />,
});
