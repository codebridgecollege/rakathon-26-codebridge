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
  // the report preview sits in the "Projednání na MDT" card of the patient view
  ok(await page.locator("details.mdtcard:not([open])").count() === 1, `${width} discussion card collapsed outside a session without a draft`);
  await c("details.mdtcard > summary");
  ok(await page.locator("details.mdtcard #report").count() === 1, `${width} report preview inside the MDT discussion card`);
  ok((await text("#report")).includes("navýšeno na 10 mg [upraveno lékařem]"), `${width} edit marked in report`);
  ok((await text("#report")).includes("Alergologická anamnéza: neuvedeno v dostupné dokumentaci"), `${width} empty allergy section printed`);
  ok((await text("#report")).includes("při diagnóze") || (await text("#report")).includes("ne aktuální"), `${width} TNM labelled as stage at diagnosis in report`);
  ok(!(await page.locator("main").textContent()).includes("Shrnutí (30 až 60 s)"), `${width} no 30-60 s summary`);
  await page.locator('[data-pickrep="clinical_finding"]').check(); ok((await text("#report")).includes("Klinický nález"), `${width} ticked field added to the report`);
  await page.locator('[data-pickrep="clinical_finding"]').uncheck(); ok(!(await text("#report")).includes("Klinický nález"), `${width} unticked field left out of the report`);
  // approval needs a written conclusion and the approver marked present
  await page.fill("#concl", "Test závěr"); await page.waitForTimeout(80);
  ok(await page.locator('[data-act="approve"]').isDisabled(), `${width} approve disabled until the doctor is marked present`);
  await c('details.mdtcard [data-attonly]'); await page.selectOption('.modal [data-att="Klinická onkologie"]', "MUDr. Svobodová"); await c('.modal [data-close]');
  ok((await text("details.mdtcard")).includes("MUDr. Svobodová"), `${width} attendance shown compactly in the card`);
  await c('[data-act="approve"]');
  ok((await text(".concl")).includes("Platný závěr č. 1") && (await text("#report")).includes("MUDr. Svobodová,"), `${width} approved conclusion shown as valid with approver`);
  const frozen = await text("#report");
  // attendance change on another case of the same day must not change the approved report
  await go("#patient/2"); await c("details.mdtcard > summary"); await c('details.mdtcard [data-attonly]'); await page.selectOption('.modal [data-att="Neurochirurgie"]', "MUDr. Novák"); await c('.modal [data-close]');
  await go("#patient/10/overview"); ok((await text("#report")) === frozen, `${width} approved report frozen after attendance change`);
  await go("#patient/10/anamnesis"); await page.evaluate(() => document.querySelector('[data-edit$="|fa:1:line"]').click()); await page.fill("#edtext", "ZMENA"); await c('[data-act="saveedit"]');
  ok(!(await text("#report")).includes("ZMENA"), `${width} approved report frozen after edit`);
  // a new conclusion supersedes the approved one without erasing it
  await c('[data-act="newversion"]');
  ok((await text(".concl")).includes("Platný závěr č. 1") && await page.locator("#concl").count() === 1, `${width} new draft shown below the valid conclusion`);
  await go("#patient/10/anamnesis"); await page.evaluate(() => document.querySelector('[data-edit$="|fa:1:line"]').click()); await c('[data-act="revertedit"]');
  ok(await page.evaluate(() => S.editLog.some(e => e.reverted)), `${width} revert kept in the edit log`);
  // source drawer, MDT session, admin
  // source view (ported from v4): page image with the cited passage highlighted, transcription in a second tab
  const imageLoaded = () => page.waitForFunction(() => { const i = document.querySelector(".drawer .pgimg img"); return i && i.complete && i.naturalWidth > 0; }, null, { timeout: 5000 }).then(() => true, () => false);
  const pgw = () => page.evaluate(() => document.querySelector(".drawer .pgimg").getBoundingClientRect().width);
  await c('[data-tab="overview"]'); await page.evaluate(() => document.querySelector(".srcl").click());
  ok(await imageLoaded(), `${width} source view loads the page image`);
  ok(await page.locator(".drawer .hbox").count() >= 1, `${width} cited passage highlighted on the image`);
  ok(await page.locator(".drawer .vbox").count() >= 1, `${width} verify tokens outlined on the image`);
  await over("drawer image");
  { const w0 = await pgw(); await c('.zoomctl [data-zoomstep="1"]'); const w1 = await pgw(); await c('.zoomctl [data-zoomstep="-1"]');
    ok(w1 > w0 && (await pgw()) < w1, `${width} zoom in and out change the page size`); await c('.zoomctl [data-zoom="fit"]'); }
  await c('[data-vtab="text"]'); ok(await page.locator(".drawer .ptext mark#hit").count() === 1, `${width} cited passage highlighted in the transcription`);
  // doubtful readings (characters the two OCR engines read differently) are marked for verification in the transcription
  await c('[data-page="4"]');
  ok(await page.locator(".drawer .ptext .vf").count() >= 1 && await page.locator(".drawer .ptext mark").count() === 0, `${width} doubtful OCR characters marked on page 4, no highlight on another page`);
  await over("drawer text"); await c('[data-vtab="image"]'); ok(await imageLoaded(), `${width} page switcher loads page 4`);
  await page.locator("[data-redact]").check();
  ok(await imageLoaded() && (await page.locator(".drawer .pgimg img").getAttribute("src")).includes(".redacted.png"), `${width} redacted page shown on request`);
  await page.locator("[data-redact]").uncheck();
  ok(await page.evaluate(() => S.access.some(a => a.what === "zobrazil(a) zdroj s. 4")), `${width} viewed page logged`);
  await c(".drawer [data-close]");
  // MDT session: started from the calendar day, the session bar lists the day's cases, a pill switches the case
  await go("#protocol/10"); ok((await page.evaluate(() => location.hash)) === "#patient/10/overview", `${width} #protocol redirects to the patient view`);
  await go("#present/10"); ok((await page.evaluate(() => location.hash)) === "#patient/10/overview", `${width} #present redirects to the patient view`);
  ok(await page.locator('[data-go], [data-present]').count() === 0, `${width} no presentation or protocol buttons`);
  await c('[data-nav="calendar"]'); await c('[data-startday="2026-10-22"]'); await over("start dialog");
  ok(await page.locator(".modal [data-startgo]").count() === 1 && await page.locator(".modal [data-att]").count() >= 6, `${width} start dialog with agenda and attendance`);
  await c(".modal [data-startgo]"); await over("session");
  ok(await page.locator(".sesbar .agenda button").count() >= 5, `${width} session bar shows the day's patients`);
  ok((await text('.sesbar [aria-current="true"]')).includes("14:00"), `${width} session opens the first case`);
  ok(await page.locator("details.mdtcard.live[open]").count() === 1, `${width} discussion card open in session`);
  await c('[data-tab="labs"]');
  await page.locator(".sesbar .agenda button").nth(1).click(); await page.waitForTimeout(80); await over("session switch");
  ok((await text('.sesbar [aria-current="true"]')).includes("14:10") && !(await page.evaluate(() => location.hash)).startsWith("#patient/10"), `${width} pill switches patient`);
  await c('.sesbar [data-startday]'); ok(await page.locator('.modal [data-startgo]').count() === 0 && (await text(".modal")).includes("Hotovo"), `${width} attendance dialog in session shows Hotovo`); await c('.modal [data-close]');
  await page.locator(".sesbar .agenda button").first().click(); await page.waitForTimeout(80);
  ok((await page.evaluate(() => location.hash)) === "#patient/10/labs", `${width} switching keeps the tab`);
  await c('[data-act="endsession"]'); ok(await page.locator(".sesbar").count() === 0, `${width} Ukončit MDT hides the session bar`);
  await page.selectOption("#user", "Ing. Kovář (správce systému)"); await c('[data-nav="admin"]'); await over("admin");
  ok(await page.locator("tbody tr").count() > 3, `${width} admin sees the access log`);
  ok((await page.locator("main").textContent()).includes("vráceno na původní"), `${width} admin sees the edit log`);
  await page.close();
}
await browser.close();
console.log(errs.length ? "\n" + errs.join("\n") : "\nall checks passed, no errors");
process.exit(errs.length ? 1 : 0);
