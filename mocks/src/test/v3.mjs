// Clicks through mock v3 in Chromium and checks the behaviour the reviews asked for.
// Usage: node mocks/src/test/v3.mjs  (needs the global playwright package and its Chromium)
import { createRequire } from "module";
import path from "path";
import { fileURLToPath } from "url";
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_PATH || "/opt/node22/lib/node_modules/playwright");
const here = path.dirname(fileURLToPath(import.meta.url));
const file = "file://" + path.resolve(here, "../../v3.html");
const browser = await chromium.launch();
const errs = [], ok = (cond, msg) => { if (!cond) errs.push("FAIL " + msg); else console.log("ok  " + msg); };
for (const width of [1280, 400]) {
  const page = await browser.newPage({ viewport: { width, height: 900 } });
  page.on("pageerror", e => errs.push(`${width}: ${e.message}`));
  const over = async name => { const w = await page.evaluate(() => document.documentElement.scrollWidth); if (w > width + 1) errs.push(`${width}: overflow on ${name} (${w})`); };
  const c = async sel => { const el = page.locator(sel).first(); if (!(await el.count())) { errs.push(`${width}: missing ${sel}`); return; } await el.click(); };
  const go = async h => { await page.evaluate(x => { location.hash = x; }, h); await page.waitForTimeout(120); };
  const text = sel => page.locator(sel).first().textContent();
  await page.goto(file); await over("db");
  // Excel-style filter
  await c('[data-colopen="status"]'); await over("filter");
  await page.locator('[data-colv="status"][value="Naplánován"]').uncheck();
  const n = await page.locator("tbody tr.click").count(); await c('[data-colclose]'); await c('[data-act="clearcolf"]');
  ok(n < 8 && (await page.locator("tbody tr.click").count()) === 8, `${width} column filter narrows and clears (page of 8)`);
  await c('[data-act="dball"]'); ok((await page.locator("tbody tr.click").count()) === 10, `${width} show all lists every patient`); await c('[data-act="dbpaged"]');
  // calendar
  await c('[data-nav="calendar"]'); await over("calendar"); await c(".slotbtn.taken"); await over("calendar card");
  ok(await page.locator("#minicard").count() === 1, `${width} calendar card opens`);
  await c('[data-wk="1"]'); await page.goBack(); await page.waitForTimeout(120);
  ok((await page.evaluate(() => location.hash)).startsWith("#calendar/2026-10-19"), `${width} back restores calendar week`);
  // URL access is logged
  await go("#patient/10/overview"); await over("overview");
  ok(await page.evaluate(() => S.access.some(a => a.pid === "10_pacient.pdf")), `${width} opening by URL is logged`);
  for (const t of ["anamnesis", "documents", "labs", "alerts"]) { await c(`[data-tab="${t}"]`); await over(t); }
  await c('[data-tab="documents"]'); await c('[data-colopen="dread"]'); await page.locator('[data-colv="dread"][value="Špatně čitelné"]').uncheck(); await c('[data-colclose]');
  ok((await page.locator("main tbody tr").count()) < 13, `${width} documents filter by readability`); await c('[data-act="cleardcolf"]');
  ok((await page.locator(".tabs").evaluate(el => el.previousElementSibling?.textContent || "")).includes("Důvod a otázka pro MDT"), `${width} brief block sits above the tabs`);
  await c('[data-act="gaps"]'); ok((await page.locator("main").textContent()).includes("osteoplastická"), `${width} gaps toggle opens`); await c('[data-act="gaps"]');
  await c('[data-tab="labs"]'); ok((await text('[data-labmode][aria-pressed="true"]')).includes("z dokumentu"), `${width} labs open on document values`);
  await c('[data-labmode="series"]'); ok((await page.locator("svg.chart").textContent()).includes("syntetická data"), `${width} synthetic chart labelled inside the SVG`);
  // edit on patient 2 must not appear in patient 10's history
  await go("#patient/2"); await c('[data-edit$="|q"]'); await page.fill("#edtext", "Otázka pro pacienta 2"); await c('[data-act="saveedit"]');
  await go("#patient/10/overview"); ok(!(await page.locator("main").textContent()).includes("Otázka pro pacienta 2"), `${width} edits stay with their patient`);
  // edit a drug, check marker in report, revert keeps history
  await c('[data-tab="anamnesis"]'); await page.evaluate(() => document.querySelector('[data-edit$="|fa:0:note"]').click());
  await page.fill("#edtext", "navýšeno na 10 mg"); await c('[data-act="saveedit"]');
  await c('[data-go="protocol"]'); await over("protocol");
  ok((await text("#report")).includes("navýšeno na 10 mg [upraveno lékařem]"), `${width} edit marked in report`);
  ok((await text("#report")).includes("Alergologická anamnéza: neuvedeno v dostupné dokumentaci"), `${width} empty allergy section printed`);
  ok((await text("#report")).includes("při diagnóze") || (await text("#report")).includes("ne aktuální"), `${width} TNM labelled as stage at diagnosis in report`);
  // approve, then change attendance and edit again: approved report must not change
  await page.selectOption('[data-att="Klinická onkologie"]', "MUDr. Svobodová");
  await go("#patient/10/overview"); await page.fill("#concl", "Test závěr"); await go("#protocol/10"); await c('[data-act="approve"]');
  const frozen = await text("#report");
  await go("#patient/2"); await go("#protocol/2"); await page.selectOption('[data-att="Neurochirurgie"]', "MUDr. Novák");
  await go("#protocol/10"); ok((await text("#report")) === frozen, `${width} approved report frozen after attendance change`);
  await go("#patient/10/anamnesis"); await page.evaluate(() => document.querySelector('[data-edit$="|fa:1:line"]').click()); await page.fill("#edtext", "ZMENA"); await c('[data-act="saveedit"]');
  await go("#protocol/10"); ok(!(await text("#report")).includes("ZMENA"), `${width} approved report frozen after edit`);
  await go("#patient/10/anamnesis"); await page.evaluate(() => document.querySelector('[data-edit$="|fa:1:line"]').click()); await c('[data-act="revertedit"]');
  ok(await page.evaluate(() => S.editLog.some(e => e.reverted)), `${width} revert kept in the edit log`);
  // source drawer, presentation, admin
  await c('[data-tab="overview"]'); await page.evaluate(() => document.querySelector(".srcl").click()); await c('[data-page="4"]');
  ok(await page.locator(".drawer .unr").count() >= 1, `${width} unreadable OCR characters marked`); await over("drawer"); await c(".drawer [data-close]");
  await c('[data-go="present"]'); await over("present"); await c('[data-brief="detailed"]'); await over("present detailed");
  await page.selectOption("#user", "Ing. Kovář (správce systému)"); await c('[data-nav="admin"]'); await over("admin");
  ok(await page.locator("tbody tr").count() > 3, `${width} admin sees the access log`);
  ok((await page.locator("main").textContent()).includes("vráceno na původní"), `${width} admin sees the edit log`);
  await page.close();
}
await browser.close();
console.log(errs.length ? "\n" + errs.join("\n") : "\nall checks passed, no errors");
process.exit(errs.length ? 1 : 0);
