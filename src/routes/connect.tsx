import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { ChevronLeft, Copy, Check, ExternalLink } from "lucide-react";

export const Route = createFileRoute("/connect")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Connect APEX to ChatGPT & Claude" },
      {
        name: "description",
        content:
          "Connect APEX to ChatGPT or Claude so your AI assistant can read your recent workouts, readiness, and body measurements.",
      },
    ],
  }),
  component: ConnectPage,
});

function ConnectPage() {
  const [mcpUrl, setMcpUrl] = useState("");
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    setMcpUrl(new URL("/mcp", window.location.origin).toString());
  }, []);

  async function copyUrl() {
    if (!mcpUrl) return;
    try {
      await navigator.clipboard.writeText(mcpUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // ignore — user can select and copy manually
    }
  }

  return (
    <div className="min-h-screen bg-bg-0 pb-16 text-white">
      <header className="flex items-center gap-3 px-4 py-4">
        <Link to="/settings" className="text-text-secondary" aria-label="Back to settings">
          <ChevronLeft size={24} />
        </Link>
        <h1 className="text-lg font-semibold">Connect to AI assistants</h1>
      </header>

      <div className="px-5 pt-2">
        <p className="text-sm text-text-secondary leading-relaxed">
          Give ChatGPT or Claude access to APEX. Your assistant will be able to
          read your recent workouts, readiness, and body measurements — and log
          new body weight entries — while acting as you.
        </p>

        <div className="mt-6 rounded-2xl bg-bg-1 border border-white/10 p-4">
          <p className="text-[11px] uppercase tracking-wider text-text-tertiary mb-2">
            APEX MCP URL
          </p>
          <div className="flex items-center gap-2">
            <code className="flex-1 text-sm break-all font-mono text-white">
              {mcpUrl || "…"}
            </code>
            <button
              onClick={copyUrl}
              disabled={!mcpUrl}
              aria-label="Copy MCP URL"
              className="flex items-center gap-1.5 rounded-xl bg-white text-black px-3 py-2 text-xs font-semibold disabled:opacity-60"
            >
              {copied ? <Check size={14} /> : <Copy size={14} />}
              {copied ? "Copied" : "Copy"}
            </button>
          </div>
        </div>

        <ClientBlock
          title="ChatGPT"
          steps={[
            <>
              Open{" "}
              <ExternalA href="https://chatgpt.com/#settings/Connectors/Advanced">
                ChatGPT Settings → Connectors → Advanced
              </ExternalA>{" "}
              and enable Developer mode. Read the risk notice shown there before
              turning it on.
            </>,
            <>In the chat composer's "+" menu, turn on Developer mode.</>,
            <>Click "Add sources", then "Connect more".</>,
            <>Name the connector "APEX" and paste the MCP URL above.</>,
            <>
              Approve the sign-in prompt with your APEX account, then ask
              ChatGPT to use APEX (e.g. "summarise my last week of training").
            </>,
          ]}
        />

        <ClientBlock
          title="Claude"
          steps={[
            <>
              Open{" "}
              <ExternalA href="https://claude.ai/customize/connectors?modal=add-custom-connector">
                Claude → Add custom connector
              </ExternalA>
              .
            </>,
            <>Name the connector "APEX" and paste the MCP URL above.</>,
            <>
              Approve the sign-in prompt with your APEX account. Enable the
              connector from the chat composer, then ask Claude to use APEX.
            </>,
          ]}
        />

        <p className="mt-8 text-[11px] text-text-tertiary leading-relaxed">
          The assistant only sees your own data and can only take the actions
          APEX exposes. You can disconnect the connector from ChatGPT or Claude
          at any time.
        </p>
      </div>
    </div>
  );
}

function ClientBlock({ title, steps }: { title: string; steps: React.ReactNode[] }) {
  return (
    <section className="mt-8">
      <h2 className="text-sm font-semibold uppercase tracking-wider text-text-tertiary mb-3">
        {title}
      </h2>
      <ol className="space-y-3">
        {steps.map((step, i) => (
          <li key={i} className="flex gap-3">
            <span className="flex-shrink-0 w-6 h-6 rounded-full bg-bg-2 border border-white/10 text-[11px] font-semibold flex items-center justify-center text-text-secondary">
              {i + 1}
            </span>
            <div className="text-sm text-white/90 leading-relaxed pt-0.5">{step}</div>
          </li>
        ))}
      </ol>
    </section>
  );
}

function ExternalA({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer noopener"
      className="inline-flex items-center gap-1 text-text-accent underline underline-offset-2"
    >
      {children}
      <ExternalLink size={12} />
    </a>
  );
}
