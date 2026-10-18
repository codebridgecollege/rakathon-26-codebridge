// Builds the project's cover image (the hero shown in the Rakathon project gallery, 1600x900).
//
// Usage, from the repository root, with a local Worker on the seeded demo (e2e/README.md, "Run it") and the browser
// suite's Playwright installed (npm --prefix e2e ci && npm --prefix e2e run install-browsers):
//   node scripts/cover/build.mjs
// Environment: COVER_BASE_URL (default http://localhost:8787), COVER_VARIANTS (default a,b,c,d,f). macOS only: the
// JPEGs are written with sips.
//
// It screenshots the app (synthetic demo data), lays the shots out in cover.html and renders docs/submission/cover.jpg
// (1600x900) and cover@2x.png. Real screenshots instead of a generated picture keep the UI on the cover the UI the
// jury will see.
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "../..");
// Playwright comes from the browser suite's install, so the cover adds no dependency of its own.
const { chromium } = createRequire(resolve(root, "e2e/package.json"))("@playwright/test");
const base = process.env.COVER_BASE_URL || "http://localhost:8787";
const shots = resolve(here, "shots");
const out = resolve(root, "docs/submission");
mkdirSync(shots, { recursive: true });
mkdirSync(out, { recursive: true });

const browser = await chromium.launch();
// The app at a laptop width, captured at 2x so the shots stay sharp when the cover scales them down.
const p = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2, locale: "cs-CZ", timezoneId: "Europe/Prague" });
const main = p.getByRole("main");
// Each view is a route of the app; the wait lets images and charts settle before the shot.
const open = async (route) => { await p.goto(new URL(route, base).href); await main.waitFor(); await p.waitForTimeout(1000); };
// Scrolls the tab row to the top so the tab's content fills the shot.
const tabsToTop = () => p.evaluate(() => { const t = document.querySelector("[role=tablist]"); window.scrollTo(0, t.getBoundingClientRect().top + window.scrollY - 24); });

await open("/patient/10/overview");
await p.screenshot({ path: `${shots}/overview.png` });

// The source view: the first reference in the brief opens the original page with the quote boxed.
await main.getByRole("button", { name: "[1]", exact: true }).click();
await p.getByRole("dialog", { name: "Původní dokument" }).waitFor();
await p.waitForTimeout(1500);
await p.screenshot({ path: `${shots}/source.png` });

// S01 has four lab draws; the platelet row shows the trend chart under the table.
await open("/patient/S01/labs");
await main.getByRole("row", { name: /^Trombocyty B_PLT/ }).getByRole("cell", { name: /^Trombocyty B_PLT/ }).click();
await main.getByRole("img", { name: "Vývoj v čase, Trombocyty" }).waitFor();
await p.waitForTimeout(600);
await p.evaluate(() => window.scrollBy(0, 700));
await p.waitForTimeout(300);
await p.screenshot({ path: `${shots}/labs.png` });

// Further views for the cover variants and the landing page: the list, the calendar, and case 10's tabs.
await open("/patients");
await p.screenshot({ path: `${shots}/patients.png` });
await open("/calendar");
await p.screenshot({ path: `${shots}/calendar.png` });
for (const tab of ["overview", "alerts", "next", "dev", "documents"]) {
  await open(`/patient/10/${tab}`);
  await tabsToTop();
  await p.waitForTimeout(300);
  await p.screenshot({ path: `${shots}/tab-${tab}.png` });
}

// The retrospective deviations table with long cells clamped to a few lines ending in "...", so one long column does
// not leave the rest of the row empty; shot as the table's card alone.
await open("/patient/10/dev");
const table = main.getByRole("table").first();
await table.evaluate((t) => {
  for (const td of t.querySelectorAll("td")) {
    const box = document.createElement("div");
    box.style.cssText = "display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:5;overflow:hidden";
    box.append(...td.childNodes); td.append(box);
  }
  const card = t.closest("section");
  card.scrollIntoView();
  card.style.margin = "0";
});
await p.waitForTimeout(300);
await table.locator("xpath=ancestor::section[1]").screenshot({ path: `${shots}/dev-clamped.png` });

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
