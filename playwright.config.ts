import { defineConfig, devices } from "@playwright/test";

/**
 * Visual regression config. Tests are colocated under `tests/visual/` and
 * exercise the three primary tabs (Dashboard, Coach, Nutrition) across an
 * iPhone-class and a Pixel-class viewport.
 *
 * Run locally:
 *   bun run dev          # in one terminal
 *   bun run test:visual  # in another (uses BASE_URL=http://localhost:8080)
 *
 * On the first run, generate baselines with:
 *   bun run test:visual -- --update-snapshots
 */
export default defineConfig({
  testDir: "./tests/visual",
  fullyParallel: false,
  retries: 0,
  reporter: [["list"]],
  use: {
    baseURL: process.env.BASE_URL ?? "http://localhost:8080",
    headless: true,
    ignoreHTTPSErrors: true,
  },
  expect: {
    toHaveScreenshot: {
      maxDiffPixelRatio: 0.01,
      animations: "disabled",
    },
  },
  projects: [
    {
      name: "iphone-14",
      use: { ...devices["iPhone 14"] },
    },
    {
      name: "pixel-7",
      use: { ...devices["Pixel 7"] },
    },
  ],
});
