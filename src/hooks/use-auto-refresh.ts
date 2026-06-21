import { useEffect, useRef } from "react";

/**
 * Calls `onRefresh` whenever the tab becomes visible AND more than `minIntervalMs`
 * have elapsed since the last refresh (tracked via the `lastUpdatedAt` value the
 * caller passes in — typically a state set after each successful fetch).
 * Used to silently re-fetch data when the user returns to the PWA from their
 * home screen / app switcher.
 */
export function useAutoRefreshOnVisible(
  onRefresh: () => void,
  lastUpdatedAt: number | null,
  minIntervalMs = 60_000,
) {
  const lastRef = useRef(lastUpdatedAt);
  useEffect(() => { lastRef.current = lastUpdatedAt; }, [lastUpdatedAt]);

  useEffect(() => {
    const handler = () => {
      if (typeof document === "undefined") return;
      if (document.visibilityState !== "visible") return;
      const last = lastRef.current ?? 0;
      if (Date.now() - last < minIntervalMs) return;
      onRefresh();
    };
    document.addEventListener("visibilitychange", handler);
    return () => document.removeEventListener("visibilitychange", handler);
  }, [onRefresh, minIntervalMs]);
}
