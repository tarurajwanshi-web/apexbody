import { test, expect } from "@playwright/test";
import {
  restoreSession,
  assertCanonicalBackground,
  assertNoStrayAccent,
} from "./_helpers";

test.describe("Dashboard", () => {
  test("matches baseline + invariants", async ({ page, baseURL }) => {
    await restoreSession(page, baseURL!);
    await page.goto("/dashboard", { waitUntil: "networkidle" });

    await assertCanonicalBackground(page);
    await assertNoStrayAccent(page);

    await expect(page).toHaveScreenshot("dashboard.png", { fullPage: false });
  });
});
