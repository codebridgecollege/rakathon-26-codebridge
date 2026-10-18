import { defineConfig, devices } from "@playwright/test";
import { BASE_URLS } from "./servers";

// The suite drives the app the way a user does, against running Workers (local `wrangler dev` or a deployed demo).
// Every test starts from a freshly reset demo (fixtures.ts), so each Playwright worker has a Worker of its own
// (servers.ts): one Worker runs the tests one at a time, N Workers (run-parallel.mjs) run N at a time.
const parallel = BASE_URLS.length > 1;

export default defineConfig({
  testDir: "./specs",
  globalSetup: "./global-setup.ts",
  // One Playwright worker per Worker: more would reset a database under a running test.
  workers: BASE_URLS.length,
  // With several Workers single tests are spread over them, not whole files, so a long file does not decide the run
  // time. Each test resets its own Worker first and so depends on no earlier test.
  fullyParallel: parallel,
  forbidOnly: !!process.env.CI,
  // No retries: a test that passes only on a second try is a flake to fix, not to hide.
  retries: 0,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  // CI reads the list in the log; the HTML report and the traces of failed tests are uploaded as an artifact.
  reporter: [[process.env.CI ? "line" : "list"], ["html", { open: "never", outputFolder: "playwright-report" }]],
  outputDir: "test-results",
  use: {
    // The first Worker; fixtures.ts gives each Playwright worker its own one.
    baseURL: BASE_URLS[0],
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
