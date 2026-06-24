import { test, expect } from "@playwright/test";
import {
  restoreSession,
  assertCanonicalBackground,
  assertNoStrayAccent,
  assertHeaderSafeArea,
} from "./_helpers";

test.describe("Coach", () => {
  test("matches baseline + invariants", async ({ page, baseURL }) => {
    await restoreSession(page, baseURL!);
    await page.goto("/coach", { waitUntil: "networkidle" });

    await assertCanonicalBackground(page);
    await assertNoStrayAccent(page);
    // Coach header must clear iOS notch / Android cutout.
    await assertHeaderSafeArea(page, "header");

    await expect(page).toHaveScreenshot("coach.png", { fullPage: false });
  });
});
