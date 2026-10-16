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
  // retrospective deviations: severity and assessment only for doctors, never prefilled, stored with who and when
  await c('[data-tab="dev"]'); await over("dev");
  const nr = await page.locator("[data-retroitem]").count();
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
  ok(await page.locator(".missstrip li").count() >= 1 && !/\d/.test(await text(".missstrip .label")) && await page.locator('[data-act="gaps"][aria-expanded="false"]').count() === 1, `${width} missing-document alerts shown in the brief without a click`);
  // oncology summary: nivolumab row says 2 cycles, therapy dates say "zahájení léčby", the CT note says time without date
  ok((await text("main")).includes("2 cykly (2. cyklus 17.4.2023)") && await page.locator('.orow.cpt .dt[data-tip="zahájení léčby"]').count() >= 3
    && await page.evaluate(() => EXTRA.onco_compact_v3.lines.some(l => /čas \(9\.20 hod\.\), datum ne/.test(l.note_cs || ""))), `${width} oncology summary: cycle count, therapy start tooltip, CT time note`);
  // guideline layer: ČOS categories sort as "neuvedeno" and are labelled as evidence and consensus; order note visible
  await c('[data-tab="next"]');
  ok(await page.evaluate(() => STMTS().filter(x => /ČOS/.test(x.evidence)).every(x => tiersOf(x).join() === "3")) && (await text(".stmts-onc")).includes("(důkazy a shoda)")
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
await browser.close();
console.log(errs.length ? "\n" + errs.join("\n") : "\nall checks passed, no errors");
process.exit(errs.length ? 1 : 0);
