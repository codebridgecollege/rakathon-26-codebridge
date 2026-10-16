// Saves the FHIR export of a case from the built mock, so fhir/validate.sh can check it.
// Usage: PLAYWRIGHT_PATH=<node_modules/playwright-core> node fhir/export.mjs [patient number] [out file]
import fs from "node:fs";
import path from "node:path";
const { chromium } = await import(path.join(process.env.PLAYWRIGHT_PATH, "index.mjs"));
const nr = process.argv[2] || "10", out = process.argv[3] || `fhir/examples/case-${nr}-bundle.json`;
const page = path.resolve("mocks/v3.html");
const b = await chromium.launch({ channel: "chrome" });
const p = await b.newPage();
const errors = [];
p.on("pageerror", e => errors.push(e.message));
await p.goto(`file://${page}#patient/${nr}/overview`);
await p.click('[data-act="fhirdlg"]');
const bundle = await p.evaluate(() => S.overlay.bundle);
await b.close();
if (errors.length) { console.error(errors.join("\n")); process.exit(1); }
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, JSON.stringify(bundle, null, 2) + "\n");
console.log(`wrote ${out}: ${bundle.entry.length} entries`);
