// Saves the FHIR export of a case from the app, so fhir/validate.sh can check it. It clicks "Export FHIR" and
// "Stáhnout JSON" on a running Worker, as a user does, so the file is the one the app hands out.
// Usage, from the repository root, with a local Worker on the seeded demo (e2e/README.md) and the suite's Playwright:
//   node fhir/export.mjs [patient number] [out file]
// Environment: FHIR_BASE_URL (default http://localhost:8787).
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

// Playwright comes from the browser suite's install (npm --prefix e2e ci), so this script adds no dependency.
const { chromium } = createRequire(path.resolve("e2e/package.json"))("@playwright/test");
const nr = process.argv[2] || "10", out = process.argv[3] || `fhir/examples/case-${nr}-bundle.json`;
const base = process.env.FHIR_BASE_URL || "http://localhost:8787";
const b = await chromium.launch();
const p = await b.newPage({ locale: "cs-CZ", timezoneId: "Europe/Prague", acceptDownloads: true });
const errors = [];
p.on("pageerror", e => errors.push(e.message));
await p.goto(new URL(`/patient/${nr}/overview`, base).href);
await p.getByRole("main").getByRole("button", { name: "Export FHIR" }).click();
const download = p.waitForEvent("download");
await p.getByRole("dialog", { name: "Export FHIR" }).getByRole("button", { name: "Stáhnout JSON" }).click();
const json = JSON.parse(fs.readFileSync(await (await download).path(), "utf8"));
await b.close();
if (errors.length) { console.error(errors.join("\n")); process.exit(1); }
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, JSON.stringify(json, null, 2) + "\n");
console.log(`wrote ${out}: ${json.entry.length} entries`);
