import { defineConfig, devices } from "@playwright/test";

// The suite drives the app the way a user does, against a running Worker (local `wrangler dev` or a deployed demo).
// Every test starts from a freshly reset demo (fixtures.ts), so the tests share one server and must run one at a time.
const baseURL = process.env.E2E_BASE_URL ?? "http://localhost:8787";
// Routes open relative to the base URL (fixtures.ts). Without the trailing slash, ".../legacy" would resolve to the app
// at "/" and the suite would silently test the wrong app.
if (new URL(baseURL).pathname !== "/" && !baseURL.endsWith("/")) throw new Error(`E2E_BASE_URL ${baseURL} needs a trailing slash (for example http://localhost:8787/legacy/).`);

export default defineConfig({
  testDir: "./specs",
  globalSetup: "./global-setup.ts",
  // One shared demo database: parallel workers would reset it under each other.
  workers: 1,
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  // No retries: a test that passes only on a second try is a flake to fix, not to hide.
  retries: 0,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: [["list"], ["html", { open: "never", outputFolder: "playwright-report" }]],
  outputDir: "test-results",
  use: {
    baseURL,
    // The app is Czech; dates and number formats follow the browser locale in a few places.
    locale: "cs-CZ",
    timezoneId: "Europe/Prague",
    viewport: { width: 1440, height: 900 },
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    acceptDownloads: true,
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } } },
  ],
});
