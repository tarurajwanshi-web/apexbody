import { useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";

/**
 * Inline "Updated Xm ago" / "Refreshing..." stamp.
 * Pass `refreshing` (boolean) and `lastUpdatedAt` (epoch ms or null).
 */
export function RefreshStamp({
  refreshing,
  lastUpdatedAt,
  className = "",
}: {
  refreshing: boolean;
  lastUpdatedAt: number | null;
  className?: string;
}) {
  // Re-render every 30s so "ago" stays current.
  const [, tick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => tick((n) => n + 1), 30_000);
    return () => clearInterval(id);
  }, []);

  const label = refreshing
    ? "Refreshing…"
    : lastUpdatedAt
    ? `Updated ${formatAgo(Date.now() - lastUpdatedAt)}`
    : "Not yet synced";

  return (
    <div
      className={`inline-flex items-center gap-1.5 text-[11px] text-text-tertiary ${className}`}
      aria-live="polite"
    >
      <RefreshCw size={11} className={refreshing ? "animate-spin" : ""} />
      <span>{label}</span>
    </div>
  );
}

function formatAgo(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  if (s < 45) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  return `${d}d ago`;
}
