// Builds the project's cover image (the hero shown in the Rakathon project gallery, 1600x900).
//
// Usage, from the repository root, after `uv run mocks/build.py`:
//   npm i --prefix /tmp/cover-deps playwright@1.64.0 && npx --prefix /tmp/cover-deps playwright install chromium
//   COVER_DEPS=/tmp/cover-deps node scripts/cover/build.mjs
//
// It screenshots the built page (mocks/v3.html, embedded synthetic data, no network), lays the shots out in
// cover.html and renders docs/submission/cover.jpg (1600x900) and cover@2x.png. Real screenshots instead of a
// generated picture keep the UI on the cover the UI the jury will see.
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Playwright lives outside the repo (no package.json at the root); ESM ignores NODE_PATH, so load it from there.
const { chromium } = createRequire(resolve(process.env.COVER_DEPS || "/tmp/cover-deps", "node_modules") + "/")("playwright");
const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "../..");
const page = `file://${root}/mocks/v3.html`;
const shots = resolve(here, "shots");
const out = resolve(root, "docs/submission");
mkdirSync(shots, { recursive: true });
mkdirSync(out, { recursive: true });

const browser = await chromium.launch();
// The app at a laptop width, captured at 2x so the shots stay sharp when the cover scales them down.
const p = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
const open = async hash => { await p.goto(page + hash); await p.waitForTimeout(1000); };

await open("#patient/10/overview");
await p.screenshot({ path: `${shots}/overview.png` });

// The source view: the first reference in the brief opens the original page with the quote boxed.
await p.click(".ref");
await p.waitForTimeout(1500);
await p.screenshot({ path: `${shots}/source.png` });

// S01 has four lab draws; the platelet row shows the trend chart under the table.
await open("#patient/S01/overview");
await p.click('[data-tab="labs"]');
await p.waitForTimeout(600);
await p.evaluate(() => [...document.querySelectorAll("[data-labsel], button")].find(x => /Trombocyty/.test(x.textContent))?.click());
await p.waitForTimeout(600);
await p.evaluate(() => window.scrollBy(0, 700));
await p.waitForTimeout(300);
await p.screenshot({ path: `${shots}/labs.png` });

// Further views for the cover variants and the landing page: the list, the calendar, and case 10's tabs with the
// tab row scrolled to the top so the tab's content fills the shot.
await open("#patients");
await p.screenshot({ path: `${shots}/patients.png` });
await open("#calendar");
await p.screenshot({ path: `${shots}/calendar.png` });
for (const tab of ["overview", "alerts", "next", "dev", "documents"]) {
  await open("#patient/10/overview");
  await p.click(`[data-tab="${tab}"]`);
  await p.waitForTimeout(700);
  await p.evaluate(() => { const t = document.querySelector(".tabs"); window.scrollTo(0, t.getBoundingClientRect().top + window.scrollY - 24); });
  await p.waitForTimeout(300);
  await p.screenshot({ path: `${shots}/tab-${tab}.png` });
}

// The retrospective deviations table with long cells clamped to a few lines ending in "…", so one long column does
// not leave the rest of the row empty; shot as the table's card alone.
await open("#patient/10/overview");
await p.click('[data-tab="dev"]');
await p.waitForTimeout(700);
await p.evaluate(() => {
  for (const td of document.querySelectorAll(".findings-table td")) {
    const box = document.createElement("div");
    box.style.cssText = "display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:5;overflow:hidden";
    box.append(...td.childNodes); td.append(box);
  }
});
await (await p.$(".findings-table")).evaluate(t => t.closest("section").scrollIntoView());
await p.waitForTimeout(300);
await (await p.$(".findings-table")).evaluate(t => t.closest("section").style.margin = "0");
const devCard = await p.$("section:has(.findings-table)");
await devCard.screenshot({ path: `${shots}/dev-clamped.png` });

// One cover per variant: "a" is the gallery cover (docs/submission/cover.jpg), the others are alternatives to compare.
const variants = (process.env.COVER_VARIANTS || "a,b,c,d,f").split(",");
const cover = await browser.newPage({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 2 });
for (const v of variants) {
  await cover.goto(`file://${here}/cover.html?v=${v}`);
  await cover.waitForTimeout(1500); // web fonts
  const name = v === "a" ? "cover" : `variants/cover-${v}`;
  mkdirSync(`${out}/variants`, { recursive: true });
  await cover.screenshot({ path: `${out}/${name}@2x.png` });
  execFileSync("sips", ["-s", "format", "jpeg", "-s", "formatOptions", "88", "-z", "900", "1600", `${out}/${name}@2x.png`, "--out", `${out}/${name}.jpg`], { stdio: "ignore" });
}
// The landing page's link preview (og:image): cover "a" without the event line in the header.
await cover.goto(`file://${here}/cover.html?v=a&site=1`);
await cover.waitForTimeout(1500);
await cover.screenshot({ path: `${out}/og@2x.png` });
execFileSync("sips", ["-s", "format", "jpeg", "-s", "formatOptions", "88", "-z", "900", "1600", `${out}/og@2x.png`, "--out", `${out}/og.jpg`], { stdio: "ignore" });
await browser.close();
console.log(`wrote covers for variants ${variants.join(", ")} in ${out}`);
