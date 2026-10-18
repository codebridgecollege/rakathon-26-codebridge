// Size budget of the built app (FRONTEND.md, "As implemented (step 13)"). Run after `nuxt generate`: it reads Nuxt's
// client manifest, follows the static imports of the entry and of the screen the app opens on (the patient list), and
// adds up the gzip size of every JavaScript and CSS file the browser must load before that screen is drawn, plus
// index.html. It fails when that first load exceeds the budget, so a library that should load only when used (jsPDF
// and its fonts, the QR code, a chart) cannot slip into the first load unnoticed.
//
// Usage: node scripts/size-budget.mjs [--json]
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { gzipSync } from "node:zlib";

// The limit in bytes after gzip, for index.html plus the first screen's JS and CSS. Measured 2026-10-18 at 176 kB;
// the limit leaves about 25 kB for growth while catching any vendored
// library (jsPDF alone is 132 kB gzip, its fonts 173 kB). Raise it only with a reason in the commit.
const BUDGET_FIRST_LOAD = 200_000;
// Libraries that must never be part of the first load, each found by a string of its own code, so a static import
// that merges the library into a first-load chunk is caught too (the chunk's name would no longer tell). jsPDF and its
// fonts are imported as ?url files and loaded by a script element, so they could only reach the first load by a
// changed import; their marker strings come from inside the vendored files.
const LAZY = [
  ["the QR library", "bad maskPattern:"],
  ["jsPDF", "jsPDF.API"],
  ["the PDF fonts", "{\"normal\": \"AAEAAAAS"],
];

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, "..");
const pub = path.join(root, ".output/public");
// Nuxt writes its build directory to .nuxt or, for a production build, to node_modules/.cache/nuxt/.nuxt; an older
// build may have left the other one behind. The manifest that names index.html's entry file is this build's.
const indexHtml = readFileSync(path.join(pub, "index.html"), "utf8");
const entryFile = /"#entry":"\/_nuxt\/([^"]+)"/.exec(indexHtml)?.[1];
let manifest;
for (const dir of ["node_modules/.cache/nuxt/.nuxt", ".nuxt", "../node_modules/.cache/nuxt/.nuxt"]) {
  const file = path.join(root, dir, "dist/server/client.manifest.mjs");
  if (!existsSync(file)) continue;
  const m = (await import(pathToFileURL(file).href)).default;
  if (Object.values(m).some((e) => e.isEntry && e.file === entryFile)) manifest = m;
}
if (!manifest) throw new Error("no client manifest matches .output/public/index.html; run nuxt generate first");

const gz = (file) => gzipSync(readFileSync(path.join(pub, "_nuxt", file)), { level: 9 }).length;

// The files a manifest entry needs before it runs: itself, its CSS, and its static imports, transitively. Dynamic
// imports are left out: they load only when the code asks for them.
function closure(key, seen = new Map()) {
  const e = manifest[key];
  if (!e || seen.has(key)) return seen;
  seen.set(key, e);
  for (const imp of e.imports ?? []) closure(imp, seen);
  return seen;
}

function filesOf(keys) {
  const files = new Set();
  for (const key of keys)
    for (const [, e] of closure(key)) {
      files.add(e.file);
      for (const css of e.css ?? []) files.add(css);
    }
  return files;
}

const entryKey = Object.keys(manifest).find((k) => manifest[k].isEntry);
const screenKey = Object.keys(manifest).find((k) => k.endsWith("pages/patients.vue"));
if (!entryKey || !screenKey) throw new Error("the client manifest has no entry or no pages/patients.vue");

const first = filesOf([entryKey, screenKey]);
const html = gzipSync(indexHtml, { level: 9 }).length;
let js = 0;
let css = 0;
for (const f of first) (f.endsWith(".css") ? (css += gz(f)) : (js += gz(f)));
const total = html + js + css;

const firstText = [...first].filter((f) => f.endsWith(".js")).map((f) => readFileSync(path.join(pub, "_nuxt", f), "utf8")).join("\n");
const leaked = LAZY.filter(([, marker]) => firstText.includes(marker)).map(([name]) => name);
// A marker that no built file contains would make the check pass forever; each must exist in some lazy file.
const allText = readdirSync(path.join(pub, "_nuxt")).filter((f) => f.endsWith(".js")).map((f) => readFileSync(path.join(pub, "_nuxt", f), "utf8")).join("\n");
const stale = LAZY.filter(([, marker]) => !allText.includes(marker)).map(([name]) => name);
if (stale.length) throw new Error(`size budget: no built file contains the marker of ${stale.join(", ")}; update LAZY`);

// For the report: the other screens and the lazy libraries, each on its own (gzip, not counting shared chunks twice).
const extra = {};
for (const [name, re] of [
  ["patient detail", /pages\/patient\/\[nr\]/],
  ["calendar", /pages\/calendar\//],
  ["jsPDF", /jspdf\.umd/],
  ["PDF fonts", /pdf-fonts/],
]) {
  const key = Object.keys(manifest).find((k) => re.test(k));
  if (!key) continue;
  let n = 0;
  for (const f of filesOf([key])) if (!first.has(f)) n += gz(f);
  extra[name] = n;
}

const kb = (n) => `${(n / 1000).toFixed(1)} kB`;
const result = { html, js, css, total, budget: BUDGET_FIRST_LOAD, files: first.size, extra, leaked };
if (process.argv.includes("--json")) console.log(JSON.stringify(result, null, 2));
else {
  console.log(`first load (index.html + entry + patient list), gzip: ${kb(total)} of ${kb(BUDGET_FIRST_LOAD)}`);
  console.log(`  index.html ${kb(html)}, JS ${kb(js)}, CSS ${kb(css)}, ${first.size} files`);
  for (const [name, n] of Object.entries(extra)) console.log(`  loaded later: ${name} ${kb(n)}`);
}
if (leaked.length) {
  console.error(`size budget: a library meant to load only when used is in the first load: ${leaked.join(", ")}`);
  process.exit(1);
}
if (total > BUDGET_FIRST_LOAD) {
  console.error(`size budget: first load ${kb(total)} exceeds ${kb(BUDGET_FIRST_LOAD)}`);
  process.exit(1);
}
