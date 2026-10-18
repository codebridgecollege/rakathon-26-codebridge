// The Workers the suite runs against. Every test resets the demo database of its Worker first (fixtures.ts), so two
// tests may run at the same time only on two Workers with their own databases:
// - E2E_BASE_URLS, a comma-separated list (set by run-parallel.mjs): one Playwright worker per Worker, each test on
//   the Worker of its Playwright worker's slot (testInfo.parallelIndex), so a reset never touches another test's data;
// - otherwise E2E_BASE_URL (default http://localhost:8787): one Worker, one test at a time.
const list = process.env.E2E_BASE_URLS ? process.env.E2E_BASE_URLS.split(",").map((s) => s.trim()).filter(Boolean) : [process.env.E2E_BASE_URL ?? "http://localhost:8787"];

// The app lives at the root of its Worker and routes open relative to it, so a base URL is an origin.
for (const u of list) {
  if (new URL(u).pathname !== "/") throw new Error(`base URL ${u} must be an origin without a path (for example http://localhost:8787).`);
}
if (new Set(list.map((u) => new URL(u).origin)).size !== list.length) throw new Error("E2E_BASE_URLS lists a Worker twice; two slots would reset one database.");

export const BASE_URLS: readonly string[] = list.map((u) => new URL(u).origin + "/");
