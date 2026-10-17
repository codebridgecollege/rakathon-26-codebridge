// Clicks through mock v3 in Chromium and checks the behaviour the reviews asked for.
// Usage: node mocks/src/test/v3.mjs  (needs the global playwright package and its Chromium)
import { createRequire } from "module";
import fs from "fs";
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
  const imageLoadedTop = () => page.waitForFunction(() => { const i = document.querySelector(".drawer .pgimg img"); return i && i.complete && i.naturalWidth > 0; }, null, { timeout: 5000 }).then(() => true, () => false);
  await page.goto(file); await over("db");
  // Excel-style filter
  await c('[data-colopen="status"]'); await over("filter");
  await page.locator('[data-colv="status"][value="Naplánován"]').uncheck();
  const n = await page.locator("tbody tr.click").count(); await c('[data-colclose]'); await c('[data-act="clearcolf"]');
  ok(n < 8 && (await page.locator("tbody tr.click").count()) === 8, `${width} column filter narrows and clears (page of 8)`);
  await c('[data-act="dball"]'); ok((await page.locator("tbody tr.click").count()) === 11, `${width} show all lists every patient`); await c('[data-act="dbpaged"]');
  // calendar
  await c('[data-nav="calendar"]'); await over("calendar"); await c(".slotbtn.taken"); await over("calendar card");
  ok(await page.locator("#minicard").count() === 1, `${width} calendar card opens`);
  await c('[data-wk="1"]'); await page.goBack(); await page.waitForTimeout(120);
  ok((await page.evaluate(() => location.hash)).startsWith("#calendar/2026-10-19"), `${width} back restores calendar week`);
  // URL access is logged
  await go("#patient/10/overview"); await over("overview");
  ok(await page.evaluate(() => S.access.some(a => a.pid === "10_pacient.pdf")), `${width} opening by URL is logged`);
  // FHIR export: a Bundle where every fact and observation of the assistant has a Provenance, and the export is logged
  await c('[data-act="fhirdlg"]');
  ok(await page.evaluate(() => { const b = S.overlay.bundle, t = new Set(b.entry.filter(e => e.resource.resourceType === "Provenance").flatMap(e => e.resource.target.map(x => x.reference)));
    return b.resourceType === "Bundle" && b.entry.filter(e => ["Observation", "Procedure", "MedicationStatement", "Condition", "DetectedIssue", "Flag", "Patient"].includes(e.resource.resourceType)).every(e => t.has(e.fullUrl)); }), `${width} FHIR export: every fact has a Provenance`);
  ok(await page.evaluate(() => S.access.some(a => a.what.includes("FHIR"))), `${width} FHIR export is logged`);
  await c('[data-close="1"] >> nth=-1');
  for (const t of ["anamnesis", "documents", "labs", "alerts"]) { await c(`[data-tab="${t}"]`); await over(t); }
  await c('[data-tab="documents"]'); await c('[data-colopen="dread"]'); await page.locator('[data-colv="dread"][value="Špatně čitelné"]').uncheck(); await c('[data-colclose]');
  ok((await page.locator("main tbody tr").count()) < 13, `${width} documents filter by readability`); await c('[data-act="cleardcolf"]');
  ok((await page.locator(".tabs").evaluate(el => el.previousElementSibling?.textContent || "")).includes("Otázka pro MDT"), `${width} brief block sits above the tabs`);
  await c('[data-act="gaps"]'); ok((await page.locator("main").textContent()).includes("osteoplastická"), `${width} gaps toggle opens`); await c('[data-act="gaps"]');
  // round 24: case 10 has one undated panel, so no trend and no invented series
  await c('[data-tab="labs"]'); ok((await text("main")).includes("Hodnoty z dokumentu") && await page.locator("[data-labmode]").count() === 0 && await page.locator("svg.chart, th.dtc").count() === 0
    && await page.evaluate(() => !("labs_series_synthetic" in EXTRA)), `${width} case 10 labs: document values only, no trend toggle, no synthetic series`);
  // round 24: synthetic patient S01, marked as synthetic in the database and the header; its trend comes from four documented draws
  await go("#patients"); await c('[data-act="dball"]');
  ok(await page.locator('tr[data-open="S01_pacient.pdf"] .syntag').count() === 1 && (await text('tr[data-open="S01_pacient.pdf"]')).includes("NO-S01")
    && await page.locator('tr[data-open="S01_pacient.pdf"] [data-sched]').count() === 1, `${width} S01 listed as "syntetický pacient", unscheduled with Naplánovat`);
  await c('[data-act="dbpaged"]');
  await go("#patient/S01/labs"); await over("S01 labs");
  ok(await page.locator("main .phead .syntag").count() === 1 && (await text("main .question")).includes("lomustin") && await page.locator("main .question .qlbl").count() === 0, `${width} S01 header marked synthetic, explicit question shown`);
  ok(await page.locator("main th.dtc").count() === 4 && await page.locator("main svg.chart").count() === 1 && await page.locator("main .synth").count() === 0 && !(await text("main")).includes("syntetická data")
    && (await page.locator('tr[data-labsel="B_PLT"] .labv').allTextContents()).join("|") === "268|54 ↓|131 ↓|97 ↓", `${width} S01 trend shows 4 draws from documents, no synthetic banner`);
  await page.locator('tr[data-labsel="B_PLT"] .labv').nth(1).click(); await page.waitForTimeout(150);
  ok(await page.evaluate(() => S.overlay?.kind === "source" && S.overlay.file === "S01_pacient.pdf" && S.overlay.page === 5 && S.overlay.cite.quote === "B_PLT: 54 10^9/l [150 ... 400]")
    && await imageLoadedTop() && await page.locator(".drawer .hbox").count() >= 1, `${width} S01 trend cell opens page 5 with its quote highlighted`);
  await c(".drawer [data-close]");
  await c('[data-tab="documents"]'); await over("S01 documents");
  ok(await page.locator("main tbody tr").count() === 6, `${width} S01 documents listed`);
  await c('[data-act="gaps"]');
  ok(await page.locator(".gapsbtn.warn").count() === 1 && (await text("main")).includes("PET/CT s 18F-FET") && await page.evaluate(() => hasMissing(P("S01_pacient.pdf")) === true), `${width} S01 missing documents signalled and listed`);
  await c('[data-act="gaps"]');
  // edit on patient 2 must not appear in patient 10's history
  // unprocessed case: no Upozornění button; an amber signal says the missing-document check has not run
  await go("#patient/2");
  ok(await page.locator(".gapsbtn").count() === 0 && (await text(".unchecked")).includes("Chybějící podklady nezkontrolovány (případ nezpracován)")
    && await page.locator(".unchecked").evaluate(el => getComputedStyle(el).backgroundColor === getComputedStyle(document.documentElement).getPropertyValue("--missing").trim() || getComputedStyle(el).backgroundColor !== "rgba(0, 0, 0, 0)")
    && await page.evaluate(() => hasMissing(P("2_pacient.pdf")) === null && hasMissing(P("10_pacient.pdf")) === true), `${width} unprocessed case shows the amber "nezkontrolovány" signal; hasMissing reads the patient`);
  await go("#patient/2"); await c('[data-edit$="|q"]'); await page.fill("#edtext", "Otázka pro pacienta 2"); await c('[data-act="saveedit"]');
  await go("#patient/10/overview"); ok(!(await page.locator("main").textContent()).includes("Otázka pro pacienta 2"), `${width} edits stay with their patient`);
  // edit a drug, check marker in report, revert keeps history
  await c('[data-tab="anamnesis"]'); await page.evaluate(() => document.querySelector('[data-edit$="|fa:0:note"]').click());
  await page.fill("#edtext", "navýšeno na 10 mg"); await c('[data-act="saveedit"]');
  // round 20: the report picks and preview live in a dialog opened from the header button, not in the discussion card
  const rep = async () => { await c('[data-act="reportdlg"]'); const t = await text(".modal #report"); await c(".modal [data-close]"); return t; };
  ok(await page.locator("details.mdtcard:not([open])").count() === 1, `${width} discussion card collapsed outside a session without a draft`);
  await c("details.mdtcard > summary");
  ok(await page.locator("details.mdtcard #report, details.mdtcard [data-pickrep]").count() === 0, `${width} no report section in the MDT discussion card`);
  await c('[data-act="reportdlg"]'); await over("report dialog");
  ok(await page.locator(".modal #report").count() === 1 && await page.locator(".modal [data-pickrep]").count() === 6 && await page.locator('.modal [data-act="download"]').count() === 1
    && await page.locator(".modal details:not([open]) #report").count() === 1, `${width} header button opens the report dialog: picks, collapsed preview, Stáhnout`);
  ok((await text("#report")).includes("navýšeno na 10 mg [upraveno lékařem]"), `${width} edit marked in report`);
  ok(!(await text("#report")).includes("[]") && (await text("#report")).includes("[1]"), `${width} report source markers carry numbers`);
  ok((await text("#report")).includes("Alergologická anamnéza: neuvedeno v dostupné dokumentaci"), `${width} empty allergy section printed`);
  ok((await text("#report")).includes("při diagnóze") || (await text("#report")).includes("ne aktuální"), `${width} TNM labelled as stage at diagnosis in report`);
  ok(!(await page.locator("main").textContent()).includes("Shrnutí (30 až 60 s)"), `${width} no 30-60 s summary`);
  await page.locator('[data-pickrep="clinical_finding"]').check(); ok((await text("#report")).includes("Klinický nález"), `${width} ticked field added to the report`);
  await page.locator('[data-pickrep="clinical_finding"]').uncheck(); ok(!(await text("#report")).includes("Klinický nález"), `${width} unticked field left out of the report`);
  await c(".modal [data-close]");
  // approval: needs a written conclusion; one button, the approving doctor named; non-doctors see it disabled
  ok(await page.locator('[data-act="approve"]').isDisabled(), `${width} approve disabled without a written conclusion`);
  await page.fill("#concl", "Test závěr"); await page.waitForTimeout(80);
  ok(!(await page.locator('[data-act="approve"]').isDisabled()) && (await text('[data-act="approve"]')).trim() === "Schválit závěr MDT" && (await text(".approver")).includes("schvaluje za tým: MUDr. Svobodová"), `${width} one approve button with "schvaluje za tým"`);
  await page.selectOption("#user", "Bc. Marková (koordinátorka MDT)");
  ok(await page.locator('[data-act="approve"]').isDisabled() && (await text(".approver")).includes("schvaluje lékař"), `${width} coordinator sees approve disabled, "schvaluje lékař"`);
  await page.selectOption("#user", "MUDr. Svobodová");
  // approving adds the approving doctor to the day's attendance instead of blocking
  ok(!(await page.evaluate(() => presentList(attDay(P("10_pacient.pdf"))).includes("MUDr. Svobodová"))), `${width} approver not yet present`);
  await c('[data-act="approve"]');
  ok(await page.evaluate(() => presentList(attDay(P("10_pacient.pdf"))).includes("MUDr. Svobodová") && S.protos["10_pacient.pdf"].attSnap.includes("MUDr. Svobodová") && S.access.some(a => a.what.startsWith("doplněn(a) mezi přítomné"))), `${width} approval adds the approving doctor to attendance and logs it`);
  ok((await text("details.mdtcard")).includes("MUDr. Svobodová") && (await text("details.mdtcard")).includes("Schválil(a) za tým"), `${width} attendance and approver shown in the card`);
  ok((await text(".concl")).includes("Platný závěr č. 1") && (await rep()).includes("MUDr. Svobodová,"), `${width} approved conclusion shown as valid with approver`);
  ok(await page.evaluate(() => P("10_pacient.pdf").status === "done" && P("10_pacient.pdf").statusHist.at(-1).how.includes("schválení")), `${width} approval sets Projednán automatically, in the status history`);
  await c('[data-act="reportdlg"]');
  ok(await page.locator(".modal [data-pickrep]:not([disabled])").count() === 0, `${width} report picks disabled after approval`); await c(".modal [data-close]");
  const frozen = await rep();
  // attendance change on another case of the same day must not change the approved report
  await go("#patient/2"); await c("details.mdtcard > summary"); await c('details.mdtcard [data-attonly]'); await page.selectOption('.modal [data-att="Neurochirurgie"]', "MUDr. Novák"); await c('.modal [data-close]');
  await go("#patient/10/overview"); ok((await rep()) === frozen, `${width} approved report frozen after attendance change`);
  await go("#patient/10/anamnesis"); await page.evaluate(() => document.querySelector('[data-edit$="|fa:1:line"]').click()); await page.fill("#edtext", "ZMENA"); await c('[data-act="saveedit"]');
  ok(!(await rep()).includes("ZMENA"), `${width} approved report frozen after edit`);
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
  // ---- feedback round 19 ----
  await page.selectOption("#user", "MUDr. Svobodová");
  // the logo opens the patient database
  await go("#calendar/2026-10-19"); await c(".top .brand");
  ok((await page.evaluate(() => location.hash)) === "#patients", `${width} logo opens the patient database`);
  // drag a booked slot back onto "Nenaplánovaní": the card lights up as a drop target and the slot is freed
  await go("#calendar/2026-10-19");
  const moved = await page.evaluate(() => S.patients.find(p => p.slot && p.slot.day === "2026-10-22" && p.slot.time === "14:10").file);
  const hl = await page.evaluate(() => {
    const dt = new DataTransfer(), src = document.querySelector('[data-slot="2026-10-22 14:10"]'), zone = document.querySelector("[data-unschedzone]");
    src.dispatchEvent(new DragEvent("dragstart", { bubbles: true, dataTransfer: dt }));
    zone.dispatchEvent(new DragEvent("dragover", { bubbles: true, cancelable: true, dataTransfer: dt }));
    const lit = zone.classList.contains("drop");
    zone.dispatchEvent(new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: dt }));
    return lit;
  });
  ok(hl && await page.evaluate(f => P(f).slot === null, moved), `${width} dragging a slot onto Nenaplánovaní unschedules it (drop target highlighted)`);
  // booking outside the seminar hours: the default range includes an hour after the seminar, the slot is marked
  ok(await page.locator('[data-free="2026-10-22 16:50"].oot').count() === 1 && await page.locator('[data-free="2026-10-22 14:30"].oot').count() === 0, `${width} out-of-hours slots shown after the seminar, seminar slots unchanged`);
  await c(`[data-pick="${moved}"]`); await c('[data-free="2026-10-22 16:30"]'); await over("calendar out of hours");
  ok(await page.evaluate(f => P(f).slot?.time === "16:30", moved) && await page.locator('[data-slot="2026-10-22 16:30"] .ootm').count() === 1, `${width} booking outside seminar hours works and shows a marker`);
  // compact oncology summary: the row date is not repeated in the text, a letter pin sits next to every date, no colour bands
  await go("#patient/10/overview"); await over("overview r19");
  const dup = await page.evaluate(() => EXTRA.onco_compact_v3.lines.filter(l => !l.row_date_in_text_because && l.date_sort && l.text_cs.includes(l.date_sort.split("-").reverse().map(Number).join("."))).length);
  const nrows = await page.locator(".orow.cpt").count();
  ok(dup === 0 && nrows === await page.evaluate(() => EXTRA.onco_compact_v3.lines.length) && await page.locator(".orow.cpt .dt .lpin").count() === nrows && await page.locator(".orow.cat").count() === 0, `${width} compact summary rows: no duplicated row date, letter pin by each date, no colour bands`);
  ok(await page.locator(".stc .edl").first().evaluate(el => getComputedStyle(el).textDecorationLine) === "none", `${width} editable status text not underlined at rest`);
  // alerts: no counts in the toggle, the tab or the headings
  const alertTexts = [await text(".gapsbtn"), await text('[data-tab="alerts"]')];
  await c('[data-tab="alerts"]'); alertTexts.push(...await page.locator("main section.card").last().locator("h2, h3, h4").allTextContents());
  ok(alertTexts.every(t => !/\d/.test(t)), `${width} alert labels carry no counts`);
  // prospective guideline statements sorted by strength tier, no country groups
  await c('[data-tab="next"]'); await over("next");
  const tiers = await page.evaluate(() => [".stmts-onc", ".stmts-other"].map(sel => [...document.querySelectorAll(`${sel} li[data-tier]`)].map(li => +li.dataset.tier)));
  ok(tiers[0].length > 3 && tiers.every(t => t.every((v, i) => !i || t[i - 1] <= v)) && !(await page.locator("main").textContent()).includes("Evropa ("), `${width} prospective statements sorted by strength tier, not by country`);
  // round 21: the layer is open without an outer toggle; entries show quote + one tier chip and open to Proč, sources, citation
  const nst = await page.evaluate(() => STMTS().length);
  ok(await page.locator("details.gl, [data-guideopen]").count() === 0 && await page.locator(".gll:not(.lit) > li.gle").count() === nst
    && await page.locator(".gll:not(.lit) .gle details[open]").count() === 0
    && await page.locator(".gll:not(.lit) .gle summary").evaluateAll(xs => xs.every(x => x.querySelectorAll(".chip").length === 1 && x.querySelector(".chip.tier") && x.querySelector("q.glq"))),
    `${width} guideline entries collapsed, headline is the quote with one tier chip, no outer toggle`);
  ok(await page.locator(".gl > .ordernote").count() === 1 && (await text(".ordernote")).includes("ne pořadí možností pro tohoto pacienta")
    && await page.locator(".ordernote").evaluate(el => el.getBoundingClientRect().top < document.querySelector(".gll").getBoundingClientRect().top), `${width} ordering sentence visible above the entries`);
  await c(".stmts-onc .gle summary"); await over("next entry open");
  const ent = page.locator(".stmts-onc .gle details[open]").first();
  ok(await ent.count() === 1 && (await ent.locator(".glwhy").textContent()).startsWith("Proč:") && await ent.locator(".glfacts [data-src]").count() >= 1
    && await ent.locator(".glmeta").evaluate(el => getComputedStyle(el).fontStyle === "italic" && /původní označení/.test(el.textContent) && /s\. \d+|abstrakt/.test(el.textContent))
    && await ent.locator('.glmeta [data-guide]').textContent() === "otevřít v doporučení", `${width} opened entry shows Proč with clickable sources and an italic citation with the original grade`);
  await ent.locator(".glfacts [data-src]").first().click(); await page.waitForTimeout(150);
  ok(await page.locator(".drawer, #overlay .scrim").count() >= 1, `${width} a fact source opens the documentation`);
  await page.keyboard.press("Escape"); await page.evaluate(() => { S.overlay = null; renderOverlay(); });
  ok(await page.locator(".stmts-onc .gle details[open]").count() === 1, `${width} opened entry stays open after re-render`);
  ok(await page.locator(".gll.lit > li.gle").count() === await page.evaluate(() => (GUIDE.literature || []).length) && (await text(".gll.lit")).includes("literatura, ne doporučení")
    && (await page.locator("h4.glh").allTextContents()).some(t => t.includes("Literatura z PubMed · není doporučení")), `${width} literature is its own section, same entries, labelled not a recommendation`);
  // the MDT's deviations table now sits in this tab, below the recommendations
  ok(await page.locator(".devt").count() === 0, `${width} proposed management contains no deviations table`);
  // quote clamping: only long quotes without a condition word are clamped; a visually cut quote says so
  const clamp = await page.locator(".gll .gle details:not([open]) q.glq").evaluateAll(qs => qs.map(q => ({ t: q.textContent, cls: q.classList.contains("clamp"),
    cut: q.scrollHeight > q.clientHeight + 1, lc: getComputedStyle(q).webkitLineClamp, note: q.parentElement.querySelector(".clampnote") })).map(x => ({ ...x, noteShown: !!x.note && getComputedStyle(x.note).display !== "none" })));
  ok(clamp.length > 0 && clamp.filter(x => x.cut).every(x => x.cls && x.noteShown) && clamp.filter(x => !x.cut).every(x => !x.noteShown)
    && clamp.filter(x => /(^|[^\p{L}])(provided|unless|if|except|pokud|při|kromě)(?![\p{L}])/iu.test(x.t)).every(x => !x.cls && !x.cut && (x.lc === "none" || !x.lc))
    && (width > 500 || clamp.some(x => x.cut)), `${width} only condition-free long quotes are clamped, and a cut quote shows "(citace zkrácena, rozbalte)"`);
  ok(await page.evaluate(() => !clampable("Radiotherapy should be considered only if the patient has a good performance status and limited extracranial disease, " + "x".repeat(120))
    && !clampable("Léčba je vhodná pokud ".padEnd(200, "a")) && clampable("Ideally, therapeutic decisions should be discussed at a dedicated board ".padEnd(200, "b"))
    && !clampable("short quote")), `${width} clampable() rejects condition words (if, pokud) and short quotes`);
  // prospective deviations: a choice and a reason survive a tab switch and print in the report
  await c('[data-tab="dev"]');
  const dev0 = await page.locator(".devt [data-dev]").first().getAttribute("data-dev");
  await page.locator(`.devt [data-dev="${dev0}"]`).selectOption("deviates"); await page.waitForTimeout(80);
  await page.locator(`.devt [data-devwhy="${dev0}"]`).fill("Pacient odmítá ozáření"); await page.waitForTimeout(80);
  await c('[data-tab="next"]'); await c('[data-tab="dev"]');
  ok(await page.locator(`.devt [data-dev="${dev0}"]`).inputValue() === "deviates" && await page.locator(`.devt [data-devwhy="${dev0}"]`).inputValue() === "Pacient odmítá ozáření",
    `${width} deviation choice and reason survive a tab switch`);
  { const r = await rep(); ok(r.includes("Odchylky od doporučení") && r.includes("záměrná odchylka") && r.includes("Pacient odmítá ozáření"), `${width} filled deviation printed in the report`); }
  await page.locator(`.devt [data-dev="${dev0}"]`).selectOption(""); await page.waitForTimeout(80);
  // retrospective deviations: severity and assessment only for doctors, never prefilled, stored with who and when
  await c('[data-tab="dev"]'); await over("dev");
  const nr = await page.locator("[data-retroitem]").count();
  // round 21: only the retrospective list; each quote is the historic edition's text, from the edition valid at the decision
  ok((await text('[data-tab="dev"]')) === "Retrospektivní odchylky" && await page.locator(".devt").count() === 1 && (await text("main")).includes("Odchylky aktuálního postupu MDT"), `${width} deviations tab separates current-plan assessment from historical review`);
  const hist = await page.evaluate(() => PAST().map(x => ({ id: x.id, quote: x.quote, year: x.edition?.year, from: x.edition?.valid_from, to: x.edition?.valid_to, url: x.edition?.pdf_url, page: x.pdf_page, date: x.decision_date })));
  const histFile = JSON.parse(fs.readFileSync(path.resolve(here, "../data/guidelines-case-10-past-historic.json"), "utf8")).items;
  const shown = await page.locator("[data-retroitem]").evaluateAll(els => els.map(el => ({ id: el.dataset.retroitem, q: el.querySelector("q.pastq")?.textContent, t: el.textContent, href: el.querySelector("a[href*='#page=']")?.getAttribute("href") })));
  ok(histFile.length === nr && histFile.every(it => { const h = hist.find(x => x.id === it.id), d = shown.find(x => x.id === it.id);
    return h && d && d.q === it.quote && h.year === it.edition.year && it.edition.valid_from <= it.decision_date && (!it.edition.valid_to || it.decision_date <= it.edition.valid_to)
      && d.t.includes(`vydání ${it.edition.year}`) && d.t.includes("platné od ") && d.href === `${it.edition.pdf_url}#page=${it.pdf_page}`; }),
    `${width} retrospective quotes equal the historic file, show the valid edition's year and range, and open its PDF at the page`);
  ok(!(await text("main")).includes("aktuálního vydání") && !(await text("main")).includes("platilo i v době") && (await text("main")).includes("nebyly ověřeny"), `${width} edition note says the edition valid at the time is used, amendments caveat shown`);
  ok(await page.evaluate(() => { const x = { ...PAST()[0], status: "not_found", quote: "" }; return pastPassage(x).includes("vydání platné v době rozhodnutí pasáž neobsahuje") && !pastPassage({ id: "x", status: "not_checked" }).includes("<q"); }), `${width} no passage in the valid edition is said so, never filled from a later edition`);
  ok(nr === 8 && await page.locator('select[data-retro][data-rf="sev"]').count() === nr && await page.locator(".retro[class*=sev-]").count() === 0
    && (await page.locator("select[data-retro]").evaluateAll(xs => xs.every(x => x.value === ""))), `${width} retrospective deviations listed, severity empty until a doctor picks it`);
  const rid = await page.locator("[data-retroitem]").first().getAttribute("data-retroitem");
  await page.selectOption(`select[data-retro="${rid}"][data-rf="sev"]`, "major");
  ok(await page.evaluate(id => { const r = S.retro["10_pacient.pdf"][id]; return r.sev === "major" && r.sevBy === "MUDr. Svobodová" && !!r.sevWhen; }, rid)
    && await page.locator(`[data-retroitem="${rid}"].sev-major`).count() === 1, `${width} doctor's severity stored with who and when, colour shown`);
  await page.selectOption("#user", "Bc. Marková (koordinátorka MDT)");
  ok(await page.locator("select[data-retro]").count() === 0 && (await text(`[data-retroitem="${rid}"]`)).includes("závažná"), `${width} coordinator sees severity (Czech label) but cannot set it`);
  // severity changes are an append-only history: the latest shows, earlier ones behind "změněno N×"
  await page.selectOption("#user", "MUDr. Svobodová");
  await page.selectOption(`select[data-retro="${rid}"][data-rf="sev"]`, "minor");
  ok(await page.evaluate(id => { const h = S.retro["10_pacient.pdf"][id].hist.sev; return h.length === 2 && h[0].v === "major" && h[1].v === "minor" && h.every(x => x.by && x.when); }, rid)
    && (await text(`[data-retroitem="${rid}"]`)).includes("změněno 1×") && await page.locator(`[data-retroitem="${rid}"].sev-minor`).count() === 1, `${width} severity history kept, latest shown with změněno 1×`);
  ok(await page.locator(`select[data-retro="${rid}"][data-rf="sev"] option`).allTextContents().then(o => o.join("|") === "-|závažná|středně závažná|méně závažná"), `${width} severity options in Czech`);
  // the excision of a suspected naevus is labelled as such, so the passage reads as context
  ok((await text('[data-retroitem="past-skin-metastasectomy"]')).includes("Excize suspektního névu brady vlevo (histologicky kožní metastáza)"), `${width} skin excision retitled as naevus excision`);
  await page.selectOption("#user", "Bc. Marková (koordinátorka MDT)");
  // approved conclusion -> assistant drafts tasks -> coordinator confirms in "Úlohy po MDT" -> digest e-mail without patient data
  await page.selectOption("#user", "MUDr. Svobodová"); await go("#patient/10/overview");
  if (await page.locator('[data-act="newversion"]').count()) await c('[data-act="newversion"]');
  await page.fill("#concl", "Stereotaktická radioterapie ložiska v mozečku, kontrolní MR mozku za 3 měsíce, kontrola na onkologii za 4 týdny."); await page.waitForTimeout(80);
  const before = await page.evaluate(() => S.tasks.length);
  await c('[data-act="approve"]');
  ok(await page.locator(".suggbox [data-suggitem]").count() === 3 && await page.evaluate(n => S.tasks.length === n, before)
    && (await text(".suggbox")).includes("Návrh asistenta"), `${width} approval drafts 3 suggested tasks, none becomes a task by itself`);
  await page.selectOption("#user", "Bc. Marková (koordinátorka MDT)"); await c('[data-nav="tasks"]'); await c('[data-scope="mdt"]'); await over("tasks mdt");
  ok((await text('[data-tgrp="10_pacient.pdf"]')).includes("NO-010") && await page.locator('[data-tgrp="10_pacient.pdf"] [data-suggrow]').count() === 3 && await page.locator("[data-tgrp]").count() >= 3, `${width} coordinator sees tasks grouped by patient with drafts`);
  ok(await page.locator('[data-tgrp="10_pacient.pdf"] [data-suggok]').count() === 0 && (await text('[data-tgrp="10_pacient.pdf"]')).includes("čeká na potvrzení lékařem"), `${width} coordinator sees drafts read-only, waiting for a doctor`);
  await page.evaluate(() => confirmSugg(S.sugg.find(x => x.state === "draft").id, true));
  ok(await page.evaluate(n => S.tasks.length === n, before), `${width} coordinator cannot confirm a draft`);
  // due dates: a single interval is computed by calendar month and labelled; no default date
  ok((await text('[data-tgrp="10_pacient.pdf"]')).includes("vypočteno ze závěru") && await page.evaluate(() => S.sugg.filter(x => x.pid === "10_pacient.pdf").map(x => x.due).join() === ",2027-01-16,2026-11-13"), `${width} due dates computed only from "za N", months by calendar`);
  await page.selectOption("#user", "MUDr. Svobodová");
  await c('[data-tgrp="10_pacient.pdf"] [data-suggok]');
  ok(await page.evaluate(n => S.tasks.length === n + 1 && S.tasks.at(-1).confirmedBy === "MUDr. Svobodová" && S.tasks.at(-1).dueSrc === "none", before), `${width} a doctor confirms a draft, it becomes a task with who confirmed it and keeps its due label`);
  ok((await text('[data-tgrp="10_pacient.pdf"]')).includes("termín doplní člověk"), `${width} confirmed task without a stated date shows "termín doplní člověk"`);
  await page.selectOption("#user", "Bc. Marková (koordinátorka MDT)");
  await c('[data-act="maildigest"]');
  const mail = await page.evaluate(() => S.mails[0]);
  const leaks = await page.evaluate(body => S.patients.flatMap(p => [p.name, p.name.split(" ").slice(-1)[0], p.diagnosis, p.id, p.mkn10]).filter(x => x && body.includes(x)), mail.body);
  ok(mail.kind === "digest" && /^\d+ úloh[ay]? (čeká|čekají) na vyřízení\nhttps:\/\/\S+$/.test(mail.body) && !leaks.length, `${width} digest e-mail holds only the count and the link`);
  // task drafter: negated clauses give no task; a date, month/year or range keeps its wording and leaves the date empty
  const neg = await page.evaluate(() => suggestTasks("Radioterapie není indikována. Stereotaktická radioterapie nedoporučena. Bez nutnosti doplnit vyšetření.").length);
  const dues = await page.evaluate(() => ["Kontrolní CT 1/2027", "Kontrola za 2-3 měsíce", "Kontrolní MR 9.1.2027", "Kontrola za 1 měsíc", "Odeslat k nefrektomii", "Odeslat k neurochirurgovi"].map(c => suggestTasks(c)[0]));
  ok(neg === 0, `${width} negated clauses draft no tasks`);
  ok(dues[0].due === "" && dues[0].timing === "1/2027" && dues[1].due === "" && dues[1].timing === "za 2-3 měsíce" && dues[2].due === "" && dues[2].timing === "9.1.2027"
    && dues[3].due === "2026-11-16" && dues[3].dueSrc === "computed" && dues[4]?.dueSrc === "none" && dues[5]?.dueSrc === "none", `${width} due dates: stated timing kept verbatim, only a single interval computed, words starting with ne- not read as negation`);
  // calendar: booking and freeing are logged; a discussed case keeps its slot
  await page.selectOption("#user", "MUDr. Svobodová");
  ok(await page.evaluate(() => S.access.some(a => a.what.startsWith("naplánoval(a) na MDT")) && S.access.some(a => a.what.startsWith("uvolnil(a) termín MDT"))), `${width} scheduling and unscheduling logged`);
  await go("#calendar/2026-10-19"); await over("calendar done");
  ok(await page.evaluate(() => P("10_pacient.pdf").status) === "done" && await page.locator('[data-slot="2026-10-22 14:00"][data-drag]').count() === 0, `${width} discussed case's slot not draggable`);
  await c('[data-slot="2026-10-22 14:00"]');
  ok(await page.locator("#minicard [data-unsched]").count() === 0 && (await text("#minicard")).includes("nelze ho uvolnit"), `${width} discussed case cannot be unscheduled, reason shown`);
  await page.evaluate(() => unschedule("10_pacient.pdf"));
  ok(await page.evaluate(() => !!P("10_pacient.pdf").slot), `${width} unschedule guard keeps a discussed case's slot`);
  // brief: missing-document alerts visible without a click, no counts
  await go("#patient/10/overview");
  ok(await page.locator(".missstrip, .misslist").count() === 0 && await page.locator('[data-act="gaps"][aria-expanded="false"].warn').count() === 1
    && (await text(".gapsbtn")).includes("chybí podklady") && !/\d/.test(await text(".gapsbtn"))
    && await page.locator(".gapsbtn").evaluate(el => getComputedStyle(el).backgroundColor !== getComputedStyle(document.body).backgroundColor && getComputedStyle(el).backgroundColor !== "rgba(0, 0, 0, 0)"), `${width} no inline missing list; the Upozornění button is a filled warning when documents are missing`);
  // oncology summary: nivolumab row says 2 cycles, therapy dates say "zahájení léčby", the CT note says time without date
  ok((await text("main")).includes("2 cykly (2. cyklus 17.4.2023)") && await page.locator('.orow.cpt .dt[data-tip="zahájení léčby"]').count() >= 3
    && await page.evaluate(() => EXTRA.onco_compact_v3.lines.some(l => /čas \(9\.20 hod\.\), datum ne/.test(l.note_cs || ""))), `${width} oncology summary: cycle count, therapy start tooltip, CT time note`);
  // guideline layer: ČOS categories sort as "neuvedeno" and are labelled as evidence and consensus; order note visible
  await c('[data-tab="next"]');
  ok(await page.evaluate(() => STMTS().filter(x => /ČOS/.test(x.evidence)).every(x => tiersOf(x).join() === "3" && origGrade(x).includes("důkazy a shoda")))
    && await page.locator(".ordernote").evaluate(el => parseFloat(getComputedStyle(el).fontSize) >= 14 && el.textContent.includes("ne pořadí možností pro tohoto pacienta")), `${width} ČOS categories not read as strength, order note in normal text`);
  // ---- feedback round 20 ----
  // new patient form: only name, surname, birth number and consent required; inline Czech messages
  await page.selectOption("#user", "MUDr. Svobodová"); await go("#patients"); await c('[data-act="newpatient"]');
  ok((await text(".modal")).includes("nepovinné, asistent ji sestaví z dokumentace") && !(await text(".modal")).includes("Anamnéza *"), `${width} anamnesis optional with hint`);
  await page.fill("#nf5", "Nemocnice Test"); await c('[data-act="newnext"]'); await over("new patient errors");
  ok(await page.locator(".modal .ferr").count() === 4 && (await text(".modal")).includes("Vyplňte jméno.") && (await text(".modal")).includes("Bez souhlasu") && await page.inputValue("#nf5") === "Nemocnice Test"
    && await page.locator('#nf0[aria-invalid="true"]').count() === 1, `${width} empty required fields get inline messages, typed values kept`);
  await page.fill("#nf0", "Jana"); await page.fill("#nf1", "Testová"); await page.fill("#nf2", "12345"); await page.check("#nfg"); await c('[data-act="newnext"]');
  ok(await page.locator(".modal .ferr").count() === 1 && (await text(".modal .ferr")).includes("ve tvaru"), `${width} malformed birth number rejected`);
  await page.fill("#nf2", "456123/7890"); await c('[data-act="newnext"]');
  ok((await text(".stepper .on")).includes("Dokumenty"), `${width} optional fields left empty, form continues`);
  await c(".modal [data-close]");
  // status menu: allowed moves for doctors and the coordinator, history for everyone, admin read-only
  const un = await page.evaluate(() => S.patients.find(p => !p.slot && p.status === "new").file);
  await page.evaluate(f => openPatient(f), un); await c(".phead [data-stmenu]"); await over("status menu");
  const moves = await page.locator(".stpop [data-setst]").evaluateAll(xs => xs.map(x => x.dataset.setst).join());
  ok(moves === "ready,attention,closed", `${width} status menu offers Připraven, Vyžaduje pozornost, Uzavřít (got ${moves})`);
  await c('.stpop [data-setst="closed"]');
  ok(await page.evaluate(f => { const p = P(f); return p.status === "closed" && p.statusHist.at(-1).by === "MUDr. Svobodová" && p.statusHist.at(-1).how === "ručně" && S.access.some(a => a.pid === f && a.what.includes("Nový -> Uzavřen")); }, un), `${width} manual close stored with who and when, logged`);
  await go("#calendar/2026-10-19");
  ok(!(await text("[data-unschedzone]")).includes(await page.evaluate(f => surnameFirst(P(f)), un)), `${width} closed case not in Nenaplánovaní`);
  await go("#patients"); await c('[data-act="dball"]');
  ok(await page.locator(`tr.closed[data-open="${un}"]`).count() === 1, `${width} closed case greyed in the database`); await c('[data-act="dbpaged"]');
  await page.selectOption("#user", "Ing. Kovář (správce systému)"); await page.evaluate(f => openPatient(f), un); await c(".phead [data-stmenu]");
  ok(await page.locator(".stpop [data-setst]").count() === 0 && (await text(".stpop")).includes("Nový -> Uzavřen"), `${width} admin sees the status history read-only`);
  await page.selectOption("#user", "Bc. Marková (koordinátorka MDT)"); if (!(await page.locator(".stpop").count())) await c(".phead [data-stmenu]");
  await c('.stpop [data-setst="new"]');
  ok(await page.evaluate(f => P(f).status === "new" && P(f).statusHist.length === 2, un), `${width} coordinator reopens a closed case to its previous status, history appended`);
  // after approval the card offers "Uzavřít případ"; the discussed slot stays locked once closed
  await page.selectOption("#user", "MUDr. Svobodová"); await go("#patient/10/overview");
  ok(await page.locator(".phead [data-stmenu]").evaluate(el => el.textContent.includes("Projednán")), `${width} header shows Projednán`);
  await c(".phead [data-stmenu]");
  ok(await page.locator(".stpop [data-setst]").evaluateAll(xs => xs.map(x => x.dataset.setst).join()) === "closed", `${width} a discussed case can only be closed from the menu`); await c(".phead [data-stmenu]");
  ok(await page.locator('details.mdtcard [data-act="closecase"]').count() === 1, `${width} card after approval shows Uzavřít případ`); await over("card approved");
  await c('[data-act="closecase"]');
  ok(await page.evaluate(() => P("10_pacient.pdf").status === "closed" && slotLocked(P("10_pacient.pdf"))) && await page.locator('[data-act="closecase"]').count() === 0, `${width} case closed from the card, slot stays locked`);
  // "Další diagnózy" line is italic
  ok(await page.locator(".otherdx").evaluate(el => getComputedStyle(el).fontStyle === "italic"), `${width} other diagnoses line italic`);
  await page.close();
}
// round 20 review: typing in the conclusion never re-renders the field; closed cases, slots and duplicate birth numbers
{
  const page = await browser.newPage({ viewport: { width: 400, height: 900 }, hasTouch: true, isMobile: true });
  page.on("pageerror", e => errs.push(`review: ${e.message}`));
  const go = async h => { await page.evaluate(x => { location.hash = x; }, h); await page.waitForTimeout(120); };
  const text = sel => page.locator(sel).first().textContent();
  const toastText = () => page.evaluate(() => [...document.querySelectorAll(".toast")].map(t => t.textContent).join(" | "));
  await page.goto(file + "#patient/10/overview"); await page.waitForTimeout(150);
  // IME composition (phone keyboards, Czech dead keys): the composed text is stored once, not appended to the preedit
  await page.evaluate(() => { window.__ta = document.getElementById("concl"); });
  await page.locator("#concl").click();
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Input.imeSetComposition", { text: "Ste", selectionStart: 3, selectionEnd: 3 });
  await cdp.send("Input.imeSetComposition", { text: "Stereo", selectionStart: 6, selectionEnd: 6 });
  await cdp.send("Input.insertText", { text: "Stereotaxe" });
  await cdp.send("Input.insertText", { text: " mozku" });
  ok(await page.evaluate(() => S.protos["10_pacient.pdf"].concl === "Stereotaxe mozku" && document.getElementById("concl").value === "Stereotaxe mozku"), "review IME composition stores \"Stereotaxe mozku\"");
  ok(await page.evaluate(() => document.getElementById("concl") === window.__ta && document.activeElement === window.__ta), "review conclusion field is the same element after composing");
  // plain typing: same element, approve enabled, draft note and card chip updated in place
  await go("#patient/2/overview");
  await page.evaluate(() => { window.__ta = document.getElementById("concl"); });
  ok(await page.locator('[data-act="approve"]').isDisabled() && await page.locator("#concldraft").isHidden(), "review approve disabled and no draft note before typing");
  await page.locator("#concl").click(); await page.keyboard.type("Kontrola za 3 měsíce");
  ok(await page.evaluate(() => document.getElementById("concl") === window.__ta && S.protos["2_pacient.pdf"].concl === "Kontrola za 3 měsíce"), "review typing does not replace the conclusion textarea");
  ok(!(await page.locator('[data-act="approve"]').isDisabled()) && await page.locator("#concldraft").isVisible() && (await text("#mdtchip")).includes("Koncept"), "review approve, draft note and chip follow the field in place");
  // a value set without an input event (dictation) is read by the change event and by approve itself
  await page.evaluate(() => { const t = document.getElementById("concl"); t.value = "Diktovaný závěr"; t.dispatchEvent(new Event("change", { bubbles: true })); });
  ok(await page.evaluate(() => S.protos["2_pacient.pdf"].concl === "Diktovaný závěr"), "review change event stores the conclusion");
  await page.evaluate(() => { document.getElementById("concl").value = "Stereotaxe, kontrola MR za 3 měsíce"; });
  const slot2 = await page.evaluate(() => ({ ...P("2_pacient.pdf").slot }));
  await page.locator('[data-act="approve"]').click();
  ok(await page.evaluate(s => { const d = S.decisions.filter(x => x.pid === "2_pacient.pdf").at(-1); return d.text === "Stereotaxe, kontrola MR za 3 měsíce" && d.slot.day === s.day && d.slot.time === s.time; }, slot2), "review approve reads the field and stores the decision's slot");
  // the approved slot can never be moved or freed, also after "Nový závěr"
  await page.locator('[data-act="newversion"]').click();
  ok(await page.evaluate(() => P("2_pacient.pdf").status === "scheduled" && slotLocked(P("2_pacient.pdf"))), "review slot stays locked after Nový závěr");
  await page.evaluate(() => { unschedule("2_pacient.pdf"); scheduleAt("2_pacient.pdf", "2026-10-29 14:00"); });
  ok(await page.evaluate(s => { const p = P("2_pacient.pdf"); return p.slot.day === s.day && p.slot.time === s.time; }, slot2), "review locked slot cannot be freed or moved");
  await go("#patient/2/overview");
  // closing keeps a slot a decision was made on; the closed case hides the conclusion controls
  await page.locator("#concl").fill("Nový koncept");
  await page.locator(".phead [data-stmenu]").click(); await page.locator('.stpop [data-setst="closed"]').click();
  ok(await page.evaluate(s => { const p = P("2_pacient.pdf"); return p.status === "closed" && p.slot?.day === s.day && p.slot?.time === s.time; }, slot2) && (await toastText()).includes("Případ uzavřen") && !(await toastText()).includes("uvolněn"), "review closing keeps a slot that belongs to a decision");
  ok(await page.locator("#concl").count() === 0 && await page.locator('[data-act="approve"]').count() === 0 && await page.locator('[data-act="newversion"]').count() === 0
    && (await text("main")).includes("Případ je uzavřen; znovu ho otevřete v menu stavu"), "review closed case hides conclusion field, approve and Nový závěr");
  const nDec = await page.evaluate(() => S.decisions.length);
  await page.evaluate(() => { action("approve"); action("newversion"); });
  ok(await page.evaluate(n => P("2_pacient.pdf").status === "closed" && S.decisions.length === n && S.protos["2_pacient.pdf"].concl === "Nový koncept", nDec), "review approve and Nový závěr do nothing on a closed case");
  // closing a case whose slot has no decision frees it, logged and said in the toast
  await go("#patient/9/overview");
  const was9 = await page.evaluate(() => slotText(P("9_pacient.pdf")));
  await page.locator(".phead [data-stmenu]").click(); await page.locator('.stpop [data-setst="closed"]').click();
  ok(await page.evaluate(w => P("9_pacient.pdf").slot === null && S.access.some(a => a.pid === "9_pacient.pdf" && a.what.includes("uvolnil(a) termín MDT při uzavření případu") && a.what.includes(w)), was9) && (await toastText()).includes(`termín ${was9} uvolněn`), "review closing without a decision frees the slot, logged and in the toast");
  await page.locator(".phead [data-stmenu]").click();
  ok(await page.locator(".stpop [data-setst]").evaluateAll(xs => xs.map(x => x.dataset.setst).join()) === "new", "review a case closed from Naplánován without a slot reopens as Nový");
  await page.locator(".phead [data-stmenu]").first().click();
  // new patient: duplicate birth number needs an explicit choice; empty workplace stays empty
  const fillNew = async rc => { await page.evaluate(() => action("newpatient")); await page.fill("#nf0", "Jan"); await page.fill("#nf1", "Test"); await page.fill("#nf2", rc); await page.check("#nfg"); await page.locator('[data-act="newnext"]').click(); };
  await page.evaluate(() => action("newpatient"));
  ok((await text(".modal")).includes("kontroluje se jen formát"), "review birth number hint says only the format is checked");
  await fillNew("800101/1234");
  ok((await text(".stepper .on")).includes("Dokumenty") && await page.locator(".modal .fwarn").count() === 0, "review no duplicate warning for a new birth number");
  await page.evaluate(() => { S.overlay.step = 2; S.overlay.progress = 4; action("newdone"); });
  const made = await page.evaluate(() => S.patients.at(-1));
  ok(made.dept === null, "review empty Odesílající pracoviště stored as null");
  await page.evaluate(f => openPatient(f), made.file);
  ok(await page.locator('.phead .gapq[title="neuvedeno v dostupné dokumentaci"]').count() >= 1 && !(await text(".phead")).includes("Klinická onkologie"), "review empty workplace shown as - with the gap tooltip");
  await fillNew("8001011234");
  ok((await text(".stepper .on")).includes("Žádost") && (await text(".modal .fwarn")).includes(made.id) && await page.locator('.modal [data-act="newdupok"]').count() === 1, "review duplicate birth number (slash ignored) warns with a link and stops");
  await page.locator('.modal [data-act="opendup"]').click();
  ok(await page.evaluate(f => S.pid === f && !S.overlay, made.file), "review warning link opens the existing case");
  await fillNew("800101/1234");
  await page.locator('.modal [data-act="newdupok"]').click();
  ok((await text(".stepper .on")).includes("Dokumenty"), "review Přesto vytvořit nový záznam continues the form");
  await page.evaluate(() => { S.overlay.step = 2; S.overlay.progress = 4; action("newdone"); });
  ok(await page.evaluate(() => S.access.some(a => a.what.includes("přestože rodné číslo už v databázi je"))), "review deliberate duplicate logged");
  await page.close();
}
// Round 22: the assistant drafts the MDT question when the referral has none (team decision 2026-10-17).
for (const width of [1280, 400]) {
  const page = await browser.newPage({ viewport: { width, height: 900 } });
  page.on("pageerror", e => errs.push(`${width}: ${e.message}`));
  const go = async h => { await page.evaluate(x => { location.hash = x; }, h); await page.waitForTimeout(120); };
  const qbox = () => page.locator("main .question").first().textContent();
  await page.goto(file);
  await go("#patient/18");
  let t = await qbox();
  ok(t.includes("Jde o nádor míchy") && !t.includes("Návrh otázky") && !t.includes("Vychází z") && await page.locator("main .question .qlbl, main .question .qbasis, main .question .edbtn").count() === 0,
    `${width} question is concise, without draft annotation, source list or pencil`);
  ok(await page.evaluate(() => qState(P(S.pid)).mode === "draft" && P(S.pid).basis.length === 3), `${width} draft provenance retained in the data`);
  await go("#patient/9"); t = await qbox();
  ok(t.includes("Je indikována neurochirurgická intervence") && !t.includes("návrh, ověřte"), `${width} document-purpose question has no visible annotation`);
  for (const [nr, f] of [["2", "2_pacient.pdf"], ["13", "13_pacient.pdf"]]) {
    await go(`#patient/${nr}`); const exp = await page.evaluate(x => P(x).question, f); t = await qbox();
    ok(exp && t.includes(exp) && await page.locator('main [data-act="confirmq"]').count() === 0, `${width} explicit question ${nr} unchanged`);
  }
  await go("#patient/10/overview");
  ok((await page.locator('main h2').allTextContents()).includes('Stručný souhrn') && (await page.locator('main .question p.rq1').textContent()) === 'Jaký postup doporučuje neurochirurgický seminář?', `${width} short summary renamed and question shown without repeated context`);
  await go("#patient/18");
  await page.evaluate(() => { S.user = COORD; render(); });
  ok(await page.locator('main [data-act="confirmq"]').count() === 0, `${width} coordinator cannot confirm`);
  await page.evaluate(() => { S.user = "MUDr. Novák"; render(); });
  await page.locator('main [data-act="confirmq"]').click();
  ok(await page.locator('main [data-act="confirmq"]').count() === 0 && await page.evaluate(() => S.qConfirm["18_pacient.pdf"]?.by === "MUDr. Novák" && S.access.some(a => a.what.includes("potvrdil(a) návrh otázky"))), `${width} confirmation kept and logged without a visible label`);
  const rep = async () => { await page.locator('[data-act="reportdlg"]').first().click(); const r = await page.locator(".modal #report").first().textContent(); await page.locator(".modal [data-close]").first().click(); return r; };
  ok((await rep()).includes("potvrdil(a) MUDr. Novák"), `${width} report retains confirmation provenance`);
  await go("#patient/11"); t = await rep();
  ok(t.includes("Souhlasí radiolog") && t.includes("neověřeno lékařem"), `${width} report retains unconfirmed question provenance`);
  await go("#calendar/2026-10-19"); await page.evaluate(() => { S.calPop = "11_pacient.pdf"; render(); });
  t = await page.locator("#minicard .question").textContent();
  ok(t.includes("Souhlasí radiolog") && !t.includes("Návrh otázky"), `${width} calendar question uses the same concise display`);
  // Jelen Otakar: surname Jelen, first name Otakar; a calm note with its source instead of an identity alarm
  await page.evaluate(() => { S.view = "patients"; S.dbAll = true; S.calPop = null; render(); });
  const row = await page.locator('tr[data-open="17_pacient.pdf"]').textContent();
  ok(row.includes("Jelen Otakar") && !/ověřit identitu/i.test(row), `${width} r22 Jelen Otakar in the database without the identity tag`);
  await go("#patient/17");
  const head = await page.locator(".phead").textContent();
  ok(head.includes("Jelen Otakar") && !/ověřit identitu/i.test(head) && head.includes("jméno a příjmení ve formuláři prohozené") && await page.locator(".phead .namenote [data-src]").count() === 1
    && await page.evaluate(() => P("17_pacient.pdf").status !== "attention"), `${width} r22 Jelen Otakar header with the neutral name note and its source`);
  await go("#patient/11");
  t = await qbox();
  ok(t.includes("Je indikováno operační řešení, nebo sledování?") && !t.includes("radiochirurg") && !t.includes("Vychází z"), `${width} question wording unchanged without source expansion`);
  ok((await rep()).includes("Vychází z: „Drobný meningeom F parafalcinně sin“ (11_pacient.pdf, s. 2)"), `${width} report retains source passages`);
  await page.evaluate(() => { S.user = "MUDr. Novák"; render(); }); await page.locator('main [data-act="confirmq"]').click();
  ok(await page.evaluate(() => { const e = S.editLog.filter(x => x.pid === "11_pacient.pdf").at(-1); return e.confirmed === true && !("text" in e); }), `${width} confirmation remains distinct from a text edit`);
  await page.evaluate(() => { S.user = ADMIN; S.view = "admin"; render(); });
  t = await page.locator("main").textContent();
  ok(t.includes("potvrdil(a) návrh otázky"), `${width} confirmation retained in the audit log`);
  // uploads in "Projednání na MDT": doctors and the coordinator only, never on a closed or approved case
  const upz = async (user) => { await page.evaluate(u => { S.user = u; S.view = "patient"; S.pid = "11_pacient.pdf"; S.mdtOpen["11_pacient.pdf"] = true; ensureProto(P("11_pacient.pdf")).mode = "docs"; render(); }, user); return page.locator("main [data-upzone]").count(); };
  ok(await upz("MUDr. Novák") === 1 && await upz(await page.evaluate(() => COORD)) === 1 && await upz(await page.evaluate(() => ADMIN)) === 0, `${width} r24 upload zone for doctors and the coordinator only`);
  await page.evaluate(() => { const pr = ensureProto(P("11_pacient.pdf")); pr.uploads = [{ name: "x.pdf", size: 10, who: "MUDr. Novák", when: "10:00" }]; S.user = ADMIN; addUploads([{ name: "y.pdf", size: 5 }]); });
  ok(await page.evaluate(() => ensureProto(P("11_pacient.pdf")).uploads.length === 1), `${width} r24 addUploads refuses a non-clinical user`);
  await page.evaluate(() => { P("11_pacient.pdf").status = "closed"; });
  ok(await upz("MUDr. Novák") === 0 && await page.locator("main [data-delup]").count() === 0 && await page.evaluate(() => { S.user = "MUDr. Novák"; addUploads([{ name: "z.pdf", size: 5 }]); return ensureProto(P("11_pacient.pdf")).uploads.length === 1; }),
    `${width} r24 no upload or removal on a closed case`);
  await page.evaluate(() => { P("11_pacient.pdf").status = "scheduled"; ensureProto(P("11_pacient.pdf")).state = "approved"; });
  ok(await upz("MUDr. Novák") === 0 && await page.locator("main [data-delup]").count() === 0, `${width} r24 no upload or removal after approval`);
  await page.close();
}
// round 23: department staff, entered as title + surname and kept only in this browser
for (const width of [1280, 400]) {
  const page = await browser.newPage({ viewport: { width, height: 900 } });
  page.on("pageerror", e => errs.push(`${width}: ${e.message}`));
  const over = async name => { const w = await page.evaluate(() => document.documentElement.scrollWidth); if (w > width + 1) errs.push(`${width}: overflow on ${name} (${w})`); };
  const c = async sel => { const el = page.locator(sel).first(); if (!(await el.count())) { errs.push(`${width}: missing ${sel}`); return; } await el.click(); };
  const go = async h => { await page.evaluate(x => { location.hash = x; }, h); await page.waitForTimeout(120); };
  const text = sel => page.locator(sel).first().textContent();
  await page.goto(file);
  // round 23: department staff entered as title + surname, kept only in this browser
  const chg = async (sel, v) => { const l = page.locator(sel).first(); await l.fill(v); await l.evaluate(el => el.dispatchEvent(new Event("change", { bubbles: true }))); await page.waitForTimeout(60); };
  const pickerHas = n => page.evaluate(x => [...document.querySelectorAll("#user option")].some(o => o.value === x), n);
  await page.evaluate(() => { S.user = DOCTORS[0]; render(); }); await c('[data-nav="staff"]'); await over("staff read-only");
  ok((await text("main")).includes("Personál pracoviště") && await page.locator("main [data-staff], main [data-act=staffreset]").count() === 0 && (await text("main")).includes("lékař ho jen čte"), `${width} r23 doctors see the staff list read-only`);
  ok(await pickerHas("MUDr. Šimek") && await page.evaluate(() => JSON.stringify(DEPTS.find(([d]) => d === "Radiologie")[1]) === '["MUDr. Šimek","MUDr. Veselá"]'), `${width} r23 default radiologists are the fictional MUDr. Šimek and MUDr. Veselá`);
  await page.selectOption("#user", "Bc. Marková (koordinátorka MDT)"); await over("staff edit");
  ok((await text("main")).includes("Jména se ukládají jen v tomto prohlížeči; v reálné aplikaci personál spravuje nastavení pracoviště nemocnice.") && await page.locator('main [data-act="staffreset"]').count() === 1
    && await page.locator("main [data-staffadd]").count() === 6, `${width} r23 coordinator edits: browser-only note, reset button, add row per department`);
  for (const [f, v] of [["pre", "doc. MUDr."], ["sur", "Testová"], ["post", "Ph.D."], ["fn", "primářka"]]) await page.fill(`[data-newin="d4"][data-sf="${f}"]`, v);
  await c('[data-staffadd="d4"]');
  ok(await page.evaluate(() => DEPTS.find(([d]) => d === "Radiologie")[1].includes("doc. MUDr. Testová, Ph.D.") && DOCTORS.includes("doc. MUDr. Testová, Ph.D.")
    && S.access.some(a => a.what === "přidal(a) do personálu: Radiologie, doc. MUDr. Testová, Ph.D." && a.who === COORD && !a.pid)) && await pickerHas("doc. MUDr. Testová, Ph.D.")
    && (await page.locator('#user option[value="doc. MUDr. Testová, Ph.D."]').getAttribute("title")) === "primářka, Radiologie", `${width} r23 added person in DEPTS and the user picker (function as tooltip), change logged without a patient`);
  await c('[data-staffadd="d4"]'); ok(await page.evaluate(() => DEPTS[3][1].length === 3), `${width} r23 a person without a surname is not added`);
  await chg('[data-staff="d4p2"][data-sf="sur"]', "Šimek");
  ok(await page.evaluate(() => DEPTS[3][1].includes("MUDr. Veselá") && DEPTS[3][1].filter(n => n === "MUDr. Šimek").length === 1) && await page.inputValue('[data-staff="d4p2"][data-sf="sur"]') === "Veselá", `${width} r23 a duplicate name is refused and the field restored`);
  await chg('[data-staff="p1"][data-sf="sur"]', "Zkoušková");
  ok(await page.evaluate(() => DEPTS[3][1].includes("doc. MUDr. Zkoušková, Ph.D.") && !DEPTS[3][1].includes("doc. MUDr. Testová, Ph.D.") && S.access.some(a => a.what.includes("doc. MUDr. Testová, Ph.D. -> doc. MUDr. Zkoušková, Ph.D.")))
    && await pickerHas("doc. MUDr. Zkoušková, Ph.D.") && !(await pickerHas("doc. MUDr. Testová, Ph.D.")), `${width} r23 rename shows in DEPTS and the picker, logged`);
  await chg('[data-staff="p1"][data-sf="sur"]', ""); ok(await page.evaluate(() => DEPTS[3][1].includes("doc. MUDr. Zkoušková, Ph.D.")), `${width} r23 emptying a surname is refused`);
  await page.reload(); await page.waitForTimeout(150);
  ok(await page.evaluate(() => DEPTS[3][1].includes("doc. MUDr. Zkoušková, Ph.D.") && USERS.includes("doc. MUDr. Zkoušková, Ph.D.") && !!localStorage.getItem("mdt-staff-v1")), `${width} r23 staff list survives a reload (localStorage)`);
  // the attendance grid offers the new person; extra rows say "vyberte…" and have their own remove button
  await go("#patient/13"); await c("details.mdtcard > summary"); await c("details.mdtcard [data-attonly]");
  ok(await page.locator('.modal [data-att="Radiologie"] option', { hasText: "doc. MUDr. Zkoušková, Ph.D." }).count() === 1, `${width} r23 attendance grid lists the added person`);
  await page.selectOption('.modal [data-att="Radiologie"]', "doc. MUDr. Zkoušková, Ph.D."); await c('.modal [data-addatt="Radiologie"]');
  ok(await page.locator('.modal [data-att="Radiologie"][data-k="1"] option').first().textContent() === "vyberte…" && !(await text(".modal")).includes("odebrat")
    && await page.locator('.modal [data-delatt="Radiologie"][data-k="1"]').count() === 1, `${width} r23 extra attendance row: placeholder "vyberte…" and a separate ✕`);
  await page.selectOption('.modal [data-att="Radiologie"][data-k="1"]', "MUDr. Veselá"); await page.selectOption('.modal [data-att="Radiologie"][data-k="1"]', "");
  ok(await page.locator('.modal [data-att="Radiologie"][data-k="1"]').count() === 1, `${width} r23 choosing "vyberte…" keeps the row`);
  await c('.modal [data-delatt="Radiologie"][data-k="1"]'); await over("attendance dialog");
  ok(await page.locator('.modal [data-att="Radiologie"][data-k="1"]').count() === 0 && await page.evaluate(() => presentList(attDay(P("13_pacient.pdf"))).includes("doc. MUDr. Zkoušková, Ph.D.")), `${width} r23 ✕ removes the extra row; the selection stays`);
  await c(".modal [data-close]");
  // the new doctor approves a conclusion; after removal the decision and its attendance keep the name
  await page.selectOption("#user", "doc. MUDr. Zkoušková, Ph.D."); await go("#patient/13");
  await page.fill("#concl", "Závěr r23"); await page.waitForTimeout(80); await c('[data-act="approve"]');
  await page.selectOption("#user", "Bc. Marková (koordinátorka MDT)"); await c('[data-nav="staff"]'); await c('[data-staffdel="p1"]');
  ok(await page.evaluate(() => !DEPTS[3][1].includes("doc. MUDr. Zkoušková, Ph.D.") && !USERS.includes("doc. MUDr. Zkoušková, Ph.D.") && S.access.some(a => a.what === "odebral(a) z personálu: Radiologie, doc. MUDr. Zkoušková, Ph.D.")
    && !presentList(attDay(P("13_pacient.pdf"))).includes("doc. MUDr. Zkoušková, Ph.D.")) && !(await pickerHas("doc. MUDr. Zkoušková, Ph.D.")), `${width} r23 removed person leaves DEPTS, the picker and open attendance`);
  await go("#patient/13");
  ok((await text(".concl")).includes("schválil(a) doc. MUDr. Zkoušková, Ph.D.") && (await text("details.mdtcard")).includes("doc. MUDr. Zkoušková, Ph.D.")
    && await page.evaluate(() => S.decisions.at(-1).by === "doc. MUDr. Zkoušková, Ph.D." && S.decisions.at(-1).attSnap.includes("doc. MUDr. Zkoušková, Ph.D.")), `${width} r23 a removed person still shows in the earlier decision and its attendance`);
  // a renamed coordinator keeps the role and the open tasks
  await c('[data-nav="staff"]'); await chg('[data-staff="coord"][data-sf="sur"]', "Marková-Nová");
  ok(await page.evaluate(() => COORD === "Bc. Marková-Nová" && S.user === COORD && S.tasks.filter(t => !t.done).every(t => t.who !== "Bc. Marková")), `${width} r23 renaming the coordinator keeps the role and moves open tasks`);
  // add a department; reset restores the fictional defaults and clears the stored list
  await page.fill("#newdept", "Nukleární medicína"); await c('[data-act="staffadddept"]');
  ok(await page.evaluate(() => DEPTS.some(([d]) => d === "Nukleární medicína") && Object.keys(attFor("2026-10-22")).includes("Nukleární medicína")), `${width} r23 added department shows in the attendance grid`);
  await c('[data-act="staffreset"]');
  ok(await page.evaluate(() => isDefaultStaff() && COORD === "Bc. Marková" && DEPTS.length === 6 && localStorage.getItem("mdt-staff-v1") === null && S.access.some(a => a.what.startsWith("obnovil(a) výchozí personál"))), `${width} r23 reset restores the fictional defaults`);
  await page.reload(); await page.waitForTimeout(150);
  ok(await page.evaluate(() => isDefaultStaff() && S.user === "MUDr. Svobodová"), `${width} r23 defaults after reload`);
  await page.close();
}
await browser.close();
console.log(errs.length ? "\n" + errs.join("\n") : "\nall checks passed, no errors");
process.exit(errs.length ? 1 : 0);

