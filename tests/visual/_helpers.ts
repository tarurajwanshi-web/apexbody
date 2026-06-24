import { expect, type Page } from "@playwright/test";

const CANONICAL_BG = "rgb(10, 14, 26)"; // #0A0E1A
const ACCENT_PURPLE = "rgb(167, 139, 250)"; // #A78BFA

/**
 * Restores the Lovable-injected Supabase session into localStorage so the
 * authenticated routes render real data. Skips silently when the harness
 * didn't inject a session (CI without managed auth) — the test still asserts
 * DOM invariants on whatever the route renders (login redirect, etc.).
 */
export async function restoreSession(page: Page, origin: string) {
  const storageKey = process.env.LOVABLE_BROWSER_SUPABASE_STORAGE_KEY;
  const sessionJson = process.env.LOVABLE_BROWSER_SUPABASE_SESSION_JSON;
  if (!storageKey || !sessionJson) return;
  await page.goto(origin);
  await page.evaluate(
    ([k, v]) => window.localStorage.setItem(k, v),
    [storageKey, sessionJson] as const,
  );
}

/** Body background must match the canonical app surface on every tab. */
export async function assertCanonicalBackground(page: Page) {
  const bg = await page.evaluate(
    () => getComputedStyle(document.body).backgroundColor,
  );
  expect(bg, "body background should be #0A0E1A").toBe(CANONICAL_BG);
}

/**
 * No helper / descriptive text should render in the AI accent purple. Scoped
 * to `p` and `a` elements with the small helper text-size (12px) to avoid
 * false positives on legitimate AI badges.
 */
export async function assertNoStrayAccent(page: Page) {
  const offenders = await page.$$eval(
    "p, a, span",
    (els, accent) =>
      els
        .filter((el) => {
          const cs = getComputedStyle(el as HTMLElement);
          const size = parseFloat(cs.fontSize);
          return cs.color === accent && size <= 13;
        })
        .map((el) => (el as HTMLElement).outerHTML.slice(0, 120)),
    ACCENT_PURPLE,
  );
  expect(offenders, "no helper-text element should use the AI accent purple").toEqual([]);
}

/** Top padding on a header must clear at least 16px even when env() = 0. */
export async function assertHeaderSafeArea(page: Page, selector: string) {
  const pad = await page.$eval(selector, (el) =>
    parseFloat(getComputedStyle(el as HTMLElement).paddingTop),
  );
  expect(pad, `${selector} padding-top should be ≥16px`).toBeGreaterThanOrEqual(16);
}
