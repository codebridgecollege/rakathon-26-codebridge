// Size budget of the built app (FRONTEND.md, "As implemented (step 13)"). Run after `nuxt generate`: it reads Nuxt's
// client manifest, follows the static imports of the entry and of the screen the app opens on (the patient list), and
// adds up the gzip size of every JavaScript and CSS file the browser must load before that screen is drawn, plus
// index.html. It fails when that first load exceeds the budget, so a library that should load only when used (jsPDF
// and its fonts, the QR code, a chart) cannot slip into the first load unnoticed.
//
// Usage: node scripts/size-budget.mjs [--json]
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { gzipSync } from "node:zlib";

// The limit in bytes after gzip, for index.html plus the first screen's JS and CSS. Measured 2026-10-18 at 176 kB
// (today's page is 712 kB gzip, 2.3 MB raw); the limit leaves about 25 kB for growth while catching any vendored
// library (jsPDF alone is 132 kB gzip, its fonts 173 kB). Raise it only with a reason in the commit.
const BUDGET_FIRST_LOAD = 200_000;
// Files that must never be part of the first load: jsPDF, its fonts and the QR code library.
const LAZY = [/jspdf/i, /pdf-fonts/i, /qrcode-generator/];

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

// Which source modules ended up in first-load chunks: a lazy library must not be among them.
const firstSources = [...closure(entryKey).keys(), ...closure(screenKey).keys()];
const leaked = LAZY.filter((re) => firstSources.some((s) => re.test(s)) || [...first].some((f) => re.test(f)));

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
const result = { html, js, css, total, budget: BUDGET_FIRST_LOAD, files: first.size, extra, leaked: leaked.map(String) };
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
