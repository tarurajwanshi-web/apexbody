import { test, expect } from "@playwright/test";
import {
  restoreSession,
  assertCanonicalBackground,
  assertNoStrayAccent,
} from "./_helpers";

test.describe("Nutrition", () => {
  test("matches baseline + invariants", async ({ page, baseURL }) => {
    await restoreSession(page, baseURL!);
    await page.goto("/nutrition", { waitUntil: "networkidle" });

    await assertCanonicalBackground(page);
    // Critical guard: Nutrition was the offender for purple helper copy.
    await assertNoStrayAccent(page);

    await expect(page).toHaveScreenshot("nutrition.png", { fullPage: false });
  });
});
