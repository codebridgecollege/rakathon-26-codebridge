// Clicks through mock v3 in Chromium and checks the behaviour the reviews asked for, the in-page server and
// client split, and the page-image source view.
// Usage: node mocks/src/test/v3.mjs  (PLAYWRIGHT_PATH=<path to playwright or playwright-core> if it is not the global package)
import { createRequire } from "module";
import path from "path";
import { fileURLToPath } from "url";
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_PATH || "/opt/node22/lib/node_modules/playwright");
const here = path.dirname(fileURLToPath(import.meta.url));
const file = "file://" + path.resolve(here, "../../v3.html");
const browser = await chromium.launch();
const ADMIN = "Ing. Kovář (správce systému)";
const errs = [], ok = (cond, msg) => { if (!cond) errs.push("FAIL " + msg); else console.log("ok  " + msg); };
for (const width of [1280, 400]) {
  const page = await browser.newPage({ viewport: { width, height: 900 } });
  page.on("pageerror", e => errs.push(`${width}: ${e.message}`));
  page.on("console", m => { if (m.type() === "error") errs.push(`${width}: console error: ${m.text()}`); });
  const over = async name => { const w = await page.evaluate(() => document.documentElement.scrollWidth); if (w > width + 1) errs.push(`${width}: overflow on ${name} (${w})`); };
  const c = async sel => { const el = page.locator(sel).first(); if (!(await el.count())) { errs.push(`${width}: missing ${sel}`); return; } await el.click(); await page.waitForTimeout(30); };
  const go = async h => { await page.evaluate(x => { location.hash = x; }, h); await page.waitForTimeout(120); };
  const text = sel => page.locator(sel).first().textContent();
  const audit = () => page.evaluate(u => api.get("/api/audit", { "X-User": u }), ADMIN);
  const imageLoaded = () => page.waitForFunction(() => { const i = document.querySelector(".drawer .pgimg img"); return i && i.complete && i.naturalWidth > 0; }, null, { timeout: 5000 }).then(() => true, () => false);
  await page.goto(file); await page.waitForTimeout(150); await over("db");

  // The client never touches the embedded data: no global names for it, only `api`, which checks the user and copies.
  ok(await page.evaluate(() => CASE === null && typeof OTHERS === "undefined" && typeof SERVER_PAGES === "undefined" && typeof api.get === "function"), `${width} client has no direct data access on the database screen`);
  ok(await page.evaluate(() => api.get("/api/audit", { "X-User": "MUDr. Novák" }).then(() => false, e => e.status === 403)), `${width} audit log refused to a doctor (403)`);
  ok(await page.evaluate(() => api.get("/api/patients/10").then(() => false, e => e.status === 401)), `${width} request without X-User refused (401)`);
  ok(await page.evaluate(() => api.post("/api/patients/10/edits", { key: "q", text: "x" }, { "X-User": "Bc. Marková (koordinátorka MDT)" }).then(() => false, e => e.status === 403)), `${width} coordinator cannot edit case data (403)`);
  ok(await page.evaluate(async () => { const a = await api.get("/api/patients", { "X-User": "MUDr. Novák" }); a[0].name = "X"; const b = await api.get("/api/patients", { "X-User": "MUDr. Novák" }); return b[0].name !== "X"; }), `${width} responses are copies; mutating one does not change the server`);
  ok(await page.evaluate(() => api.put("/api/patients/2/slot", { day: "2026-10-21", time: "14:00" }, { "X-User": "MUDr. Novák" }).then(() => false, e => e.status === 422)), `${width} slot outside a seminar refused (422)`);
  ok(await page.evaluate(() => api.put("/api/patients/2/slot", { day: "2026-10-22", time: "14:00" }, { "X-User": "MUDr. Novák" }).then(() => false, e => e.status === 409)), `${width} taken slot refused (409)`);

  // Excel-style filter
  await c('[data-colopen="status"]'); await over("filter");
  await page.locator('[data-colv="status"][value="Naplánován"]').uncheck();
  const n = await page.locator("tbody tr.click").count(); await c('[data-colclose]'); await c('[data-act="clearcolf"]');
  ok(n < 8 && (await page.locator("tbody tr.click").count()) === 8, `${width} column filter narrows and clears (page of 8)`);
  await c('[data-act="dball"]'); ok((await page.locator("tbody tr.click").count()) === 10, `${width} show all lists every patient`); await c('[data-act="dbpaged"]');
  // calendar
  await c('[data-nav="calendar"]'); await over("calendar"); await c(".slotbtn.taken"); await over("calendar card");
  ok(await page.locator("#minicard").count() === 1, `${width} calendar card opens`);
  await c('[data-wk="1"]'); await page.goBack(); await page.waitForTimeout(150);
  ok((await page.evaluate(() => location.hash)).startsWith("#calendar/2026-10-19"), `${width} back restores calendar week`);
  // scheduling goes through the server: move an unscheduled patient into a free slot, then free it
  await c('[data-calclose]'); await c('.tasklist [data-pick]'); await c('.slotbtn.free'); await page.waitForTimeout(50);
  ok(await page.locator("#minicard").count() === 1, `${width} scheduling into a free slot opens the patient card`);
  await c('[data-unsched]');
  // URL access is logged by the server
  await go("#patient/10/overview"); await over("overview");
  ok((await audit()).some(a => a.case_id === "NO-010" && /odkazem/.test(a.what)), `${width} opening by URL is logged by the server`);
  ok((await audit()).some(a => a.case_id === "NO-010" && a.what === "četl(a) obsah případu"), `${width} reading the case content is logged by the server itself`);
  for (const t of ["anamnesis", "documents", "labs", "alerts", "next", "dev"]) { await c(`[data-tab="${t}"]`); await over(t); }
  await c('[data-tab="documents"]'); await c('[data-colopen="dread"]'); await page.locator('[data-colv="dread"][value="Špatně čitelné"]').uncheck(); await c('[data-colclose]');
  ok((await page.locator("main tbody tr").count()) < 13, `${width} documents filter by readability`); await c('[data-act="cleardcolf"]');
  ok((await page.locator(".tabs").evaluate(el => el.previousElementSibling?.textContent || "")).includes("Důvod a otázka pro MDT"), `${width} brief block sits above the tabs`);
  // guideline layer: a server call, statements quoted with citation, the viewer marks the quote, the switch turns it off
  ok((await audit()).some(a => a.case_id === "NO-010" && /doporučené postupy/.test(a.what)), `${width} guidance read is logged by the server`);
  await c('[data-tab="next"]'); await page.evaluate(() => { const d = document.querySelector("details.gl"); if (d) d.open = true; });
  ok(await page.locator("details.gl li q").count() >= 3, `${width} guideline statements listed with quotes`);
  await page.evaluate(() => document.querySelector("details.gl [data-guide]").click()); await page.waitForTimeout(40);
  ok(await page.locator(".drawer mark#hit").count() === 1 && (await text(".drawer")).includes("Otevřít PDF online"), `${width} guideline viewer marks the quote and links the PDF`);
  await over("guideline viewer"); await c(".drawer [data-close]");
  await page.locator('[data-act-toggle="guide"]').first().uncheck(); await page.waitForTimeout(40);
  ok(await page.locator("details.gl li").count() === 0, `${width} switching the layer off hides it`);
  await page.locator('[data-act-toggle="guide"]').first().check(); await page.waitForTimeout(40);
  await c('[data-tab="overview"]');
  await c('[data-act="gaps"]'); ok((await page.locator("main").textContent()).includes("osteoplastická"), `${width} gaps toggle opens`); await c('[data-act="gaps"]');
  await c('[data-tab="labs"]'); ok((await text('[data-labmode][aria-pressed="true"]')).includes("z dokumentu"), `${width} labs open on document values`);
  await c('[data-labmode="series"]'); ok((await page.locator("svg.chart").textContent()).includes("syntetická data"), `${width} synthetic chart labelled inside the SVG`);
  // alert acknowledgement is stored on the server with who and when
  await c('[data-tab="alerts"]'); await page.evaluate(() => document.querySelector("[data-ack]").click()); await page.waitForTimeout(40);
  ok((await page.locator(".alert.ack").count()) >= 1 && (await text(".alert.ack")).includes("MUDr. Svobodová,"), `${width} alert acknowledged with who and when`);
  // edit on patient 2 must not appear in patient 10's history
  await go("#patient/2"); await c('[data-edit$="|q"]'); await page.fill("#edtext", "Otázka pro pacienta 2"); await c('[data-act="saveedit"]');
  ok((await page.locator("main").textContent()).includes("Otázka pro pacienta 2"), `${width} edit saved through the server`);
  ok(await page.locator(".doclist [data-src]").count() >= 1, `${width} an unstructured patient lists its document pages`);
  ok(!(await text("#report")).includes("Everolimus") && (await text("#report")).includes("není v maketě zpracovaná"), `${width} another patient's report holds none of patient 10's case content`);
  ok(await page.locator("details.mdtcard").count() === 1 && await page.locator('.phead [data-act="download"]').count() === 1, `${width} an unstructured patient gets the same discussion card and report button`);
  await go("#patient/10/overview"); ok(!(await page.locator("main").textContent()).includes("Otázka pro pacienta 2"), `${width} edits stay with their patient`);
  // edit a drug, check marker in report, revert keeps history
  await c('[data-tab="anamnesis"]'); await page.evaluate(() => document.querySelector('[data-edit$="|fa:0:note"]').click());
  await page.fill("#edtext", "navýšeno na 10 mg"); await c('[data-act="saveedit"]');
  // a deviation from a quoted recommendation, recorded in its tab
  await c('[data-tab="dev"]');
  ok(await page.locator("table.devt [data-dev]").count() >= 1, `${width} deviations table`);
  const devId = await page.locator("table.devt [data-dev]").first().getAttribute("data-dev");
  await page.locator("table.devt [data-dev]").first().selectOption("deviates"); await page.waitForTimeout(30);
  await page.fill(`[data-devwhy="${devId}"]`, "Pacient odmítl");
  // the report preview sits in the "Projednání na MDT" card of the patient view, right after the conclusion
  await c('[data-tab="overview"]');
  ok(await page.locator("details.mdtcard:not([open])").count() === 1, `${width} discussion card collapsed outside a session without a draft`);
  ok(await page.evaluate(() => { const c = document.querySelector(".concl"), m = document.querySelector("details.mdtcard"); return c && m && c.nextElementSibling === m; }), `${width} discussion card right after the conclusion box`);
  ok(await page.locator("#concl").count() === 1, `${width} one conclusion field`);
  ok(await page.locator('.phead [data-act="download"]').isVisible() && (await text('.phead [data-act="download"]')).includes("Stáhnout report (PDF)"), `${width} report download visible in the patient header`);
  await c("details.mdtcard > summary"); await over("discussion card");
  ok(await page.locator("details.mdtcard #report").count() === 1, `${width} report preview inside the MDT discussion card`);
  ok((await audit()).some(a => a.case_id === "NO-010" && a.what === "četl(a) záznam projednání na MDT"), `${width} reading the discussion record is logged`);
  ok((await text("#report")).includes("navýšeno na 10 mg [upraveno lékařem]"), `${width} edit marked in report`);
  ok((await text("#report")).includes("Alergologická anamnéza: neuvedeno v dostupné dokumentaci"), `${width} empty allergy section printed`);
  ok((await text("#report")).includes("při diagnóze") || (await text("#report")).includes("ne aktuální"), `${width} TNM labelled as stage at diagnosis in report`);
  ok(!(await page.locator("main").textContent()).includes("Shrnutí (30 až 60 s)"), `${width} no 30-60 s summary`);
  await page.locator('[data-pickrep="clinical_finding"]').check(); ok((await text("#report")).includes("Klinický nález"), `${width} ticked field added to the report`);
  await page.locator('[data-pickrep="clinical_finding"]').uncheck(); ok(!(await text("#report")).includes("Klinický nález"), `${width} unticked field left out of the report`);
  // approval needs a written conclusion and the approver marked present; then the report is frozen
  await c('[data-act="addstep"]'); await page.fill('[data-step="0"][data-f="text"]', "Objednat MR mozku");
  await page.fill("#concl", "Test závěr"); await page.waitForTimeout(80);
  ok(await page.locator('[data-act="approve"]').isDisabled(), `${width} approve disabled until the doctor is marked present`);
  await c('details.mdtcard [data-attonly]'); ok(await page.locator(".modal [data-startgo]").count() === 0, `${width} attendance dialog from the card only edits attendance`);
  await page.selectOption('.modal [data-att="Klinická onkologie"]', "MUDr. Svobodová"); await page.waitForTimeout(30); await c('.modal [data-close]');
  ok((await text("details.mdtcard")).includes("MUDr. Svobodová"), `${width} attendance shown compactly in the card`);
  await c('[data-act="approve"]'); await page.waitForTimeout(50);
  const frozen = await text("#report");
  ok(frozen.includes("Test závěr") && frozen.includes("MUDr. Svobodová"), `${width} frozen report attached to the decision`);
  ok((await text(".concl")).includes("Platný závěr č. 1") && (await text("#report")).includes("MUDr. Svobodová,"), `${width} approved conclusion shown as valid with approver`);
  ok((await page.evaluate(() => api.get("/api/tasks", { "X-User": "MUDr. Novák" }))).some(t => t.text === "Objednat MR mozku"), `${width} approval created the coordinator task on the server`);
  ok(await page.evaluate(async () => { const d = await api.get("/api/patients/10/decisions", { "X-User": "MUDr. Novák" }); return d.length === 1 && d[0].snap && d[0].snap.concl === "Test závěr" && !("reportSnap" in d[0]); }), `${width} decision stores a structured snapshot, no client HTML`);
  ok(await page.evaluate(async id => { const d = await api.get("/api/patients/10/decisions", { "X-User": "MUDr. Novák" }); return d[0].snap.dev?.[id]?.s === "deviates" && d[0].snap.dev[id].why === "Pacient odmítl"; }, devId) && frozen.includes("záměrná odchylka"), `${width} deviation and its reason frozen with the decision`);
  // attendance change on another case of the same day must not change the approved report
  await go("#patient/2"); await c("details.mdtcard > summary"); await c('details.mdtcard [data-attonly]');
  await page.selectOption('.modal [data-att="Neurochirurgie"]', "MUDr. Novák"); await page.waitForTimeout(30); await c('.modal [data-close]');
  await go("#patient/10/overview"); ok((await text("#report")) === frozen, `${width} approved report frozen after attendance change`);
  await go("#patient/10/anamnesis"); await page.evaluate(() => document.querySelector('[data-edit$="|fa:1:line"]').click()); await page.fill("#edtext", "ZMENA"); await c('[data-act="saveedit"]');
  ok(!(await text("#report")).includes("ZMENA"), `${width} approved report frozen after edit`);
  await go("#patient/10/next"); await page.locator('[data-act-toggle="guide"]').first().uncheck(); await page.waitForTimeout(40);
  ok((await text("#report")) === frozen, `${width} approved report frozen after the guideline layer is switched off`);
  await page.locator('[data-act-toggle="guide"]').first().check(); await page.waitForTimeout(40);
  await go("#patient/10/anamnesis"); await page.evaluate(() => document.querySelector('[data-edit$="|fa:1:line"]').click()); await c('[data-act="revertedit"]');
  ok((await page.evaluate(u => api.get("/api/edits", { "X-User": u }), ADMIN)).some(e => e.reverted), `${width} revert kept in the server's edit log`);
  await c('[data-tab="overview"]');
  ok((await page.locator(".concl.valid").count()) && (await page.locator(".concl.valid").textContent()).includes("Platný závěr č. 1"), `${width} approved conclusion shown in the brief block`);

  // source view: page image with the cited passage highlighted, transcription in a second tab
  const pgw = () => page.evaluate(() => document.querySelector(".drawer .pgimg").getBoundingClientRect().width);
  await page.evaluate(() => document.querySelector(".srcl").click()); await page.waitForTimeout(50);
  ok(await imageLoaded(), `${width} source view loads the page image`);
  ok(await page.locator(".drawer .hbox").count() >= 1, `${width} cited passage highlighted on the image`);
  ok(await page.locator(".drawer .vbox").count() >= 1, `${width} verify tokens outlined on the image`);
  ok((await text(".drawer .vbar")).includes("jazykový model, kontrola: Tesseract"), `${width} engine named`);
  await over("drawer image");
  ok(await page.evaluate(() => { const b = document.querySelector(".drawer .hbox").getBoundingClientRect(), i = document.querySelector(".drawer .pgimg").getBoundingClientRect(); return b.width > 4 && b.height > 4 && b.left >= i.left - 1 && b.right <= i.right + 1; }), `${width} highlight box is scaled inside the displayed image`);
  {
    ok(await page.locator(".zoomctl [data-zoomstep]").count() === 2 && await page.locator('.zoomctl [data-zoom="fit"]').isDisabled(), `${width} zoom controls in the viewer, reset disabled at fit width`);
    const w0 = await pgw();
    await c('.zoomctl [data-zoomstep="1"]'); const w1 = await pgw();
    await c('.zoomctl [data-zoomstep="1"]'); const w2 = await pgw();
    ok(w1 > w0 && w2 > w1, `${width} zoom in enlarges the page step by step (${Math.round(w0)} > ${Math.round(w1)} > ${Math.round(w2)})`);
    await c('.zoomctl [data-zoomstep="-1"]'); ok(Math.abs(await pgw() - w1) < 2, `${width} zoom out goes back one step`);
    await page.keyboard.press("+"); ok(Math.abs(await pgw() - w2) < 2, `${width} + key zooms in`);
    await over("drawer zoomed");
    await page.keyboard.press("0"); ok(Math.abs(await pgw() - w0) < 2, `${width} 0 key resets to fit width`);
    await c('.zoomctl [data-zoomstep="1"]'); await c('.zoomctl [data-zoom="fit"]'); ok(Math.abs(await pgw() - w0) < 2, `${width} reset button returns to fit width`);
  }
  await c('[data-vtab="text"]'); ok(await page.locator(".drawer .ptext mark#hit").count() === 1, `${width} cited passage highlighted in the transcription`);
  // doubtful readings (characters the two OCR engines read differently) are marked for verification in the transcription
  await c('[data-page="4"]');
  ok(await page.locator(".drawer .ptext .vf[title*='Tesseract četl']").count() >= 1 && await page.locator(".drawer .ptext mark").count() === 0, `${width} doubtful OCR characters marked on page 4, no highlight on another page`);
  await over("drawer text"); await c('[data-vtab="image"]'); ok(await imageLoaded(), `${width} page switcher loads page 4`);
  await page.locator("[data-redact]").check(); await page.waitForTimeout(30);
  ok(await imageLoaded() && (await page.locator(".drawer .pgimg img").getAttribute("src")).includes(".redacted.png") && (await text(".drawer .vbody")).includes("Ukázka místního začernění"), `${width} redacted page shown on request, labelled as a demonstration`);
  await page.locator("[data-redact]").uncheck();
  ok((await audit()).some(a => a.case_id === "NO-010" && a.what === "zobrazil(a) zdroj s. 4"), `${width} viewed page logged by the server`);
  await c('[data-page="2"]'); await page.locator("[data-redact]").check(); await page.waitForTimeout(30);
  ok((await text(".drawer .vbody")).includes("kontrola je neúplná"), `${width} a page with no redaction hits says the check is incomplete`);
  await page.locator("[data-redact]").uncheck();
  await c(".drawer [data-close]");
  // with the redacted view on, neither the quote nor the transcription is shown
  await page.evaluate(() => document.querySelector(".srcl").click()); await page.waitForTimeout(50);
  await page.locator("[data-redact]").check(); await page.waitForTimeout(30);
  ok(await page.locator(".drawer .vquote").count() === 0 && await page.locator('.drawer [data-vtab="text"]').count() === 0, `${width} redacted view hides the quote and the transcription`);
  await page.locator("[data-redact]").uncheck();
  await c('[data-zoomhit]'); ok(await page.evaluate(() => document.querySelector(".drawer .pgimg").getBoundingClientRect().width > 1100 && !!document.getElementById("hit")), `${width} zoom to the passage`);
  await c(".drawer [data-close]");
  // a quote that is not on the page: whole page, and the doctor is told so
  await page.evaluate(() => openSource({ file: "10_pacient.pdf", page: 1, quote: "xqzt wvkr plmn brtz" })); await page.waitForTimeout(50);
  ok((await text(".drawer")).includes("Citace nenalezena přesně, zobrazena celá stránka"), `${width} missing quote is reported, page shown whole`);
  ok(await page.locator(".drawer .hbox").count() === 0, `${width} no highlight for a missing quote`);
  await c(".drawer [data-close]");
  // a page the document does not have is reported, never replaced by another page
  await page.evaluate(() => openSource({ file: "10_pacient.pdf", page: 99, quote: "x" })); await page.waitForTimeout(50);
  ok(await page.locator(".drawer").count() === 0 && (await page.locator(".toast").allTextContents()).some(t => /není v maketě/.test(t)), `${width} missing page reported, no other page shown`);
  // patient 9 page 4 is empty
  await page.evaluate(() => openSource({ file: "9_pacient.pdf", page: 4 })); await page.waitForTimeout(50);
  ok((await text(".drawer")).includes("Prázdná stránka"), `${width} empty page labelled`);
  await c(".drawer [data-close]");

  // every page of all ten patients' documents opens from the patient's own screen
  if (width === 1280) {
    const list = await page.evaluate(() => api.get("/api/patients", { "X-User": "MUDr. Novák" }));
    let pages = 0, loaded = 0;
    for (const p of list) {
      await go(`#patient/${p.rid}`);
      const buttons = p.full ? [] : await page.locator(".doclist [data-src]").all();
      if (!p.full) ok(buttons.length === p.pages, `${p.id} lists its ${p.pages} document pages`);
      const n = p.full ? p.pages : buttons.length;
      for (let k = 1; k <= n; k++) {
        if (p.full) await page.evaluate(([f, k]) => openSource({ file: f, page: k }), [p.file, k]);
        else await buttons[k - 1].click();
        await page.waitForTimeout(30); pages++;
        if (await imageLoaded()) loaded++; else errs.push(`image did not load: ${p.file} p${k}`);
        await c(".drawer [data-close]");
      }
      if (!p.full && await page.locator("dd [data-src]").count()) {
        await c("dd [data-src]"); await page.waitForTimeout(30);
        ok(await imageLoaded(), `${p.id} diagnosis source opens its page`);
        await c(".drawer [data-close]");
      }
    }
    ok(pages === 20 && loaded === 20, `all 20 pages of the ten documents load (${loaded}/${pages})`);
    // every "ověřit" mark sits on whole words, at the offsets the index recorded
    const vbad = await page.evaluate(async () => {
      const H = { "X-User": "MUDr. Novák" }, bad = [];
      for (const p of await api.get("/api/patients", H)) for (let n = 1; n <= p.pages; n++) {
        const d = await api.get(`/api/documents/${p.file}/pages/${n}`, H);
        for (const v of d.verify) {
          if (!v.at) { bad.push(`${p.file} ${n} unplaced ${v.vision}`); continue; }
          const [s, e] = v.at, w = /[\p{L}\p{N}]/u;
          if (w.test(d.text[s - 1] || " ") || w.test(d.text[e] || " ")) bad.push(`${p.file} ${n} mid-word ${v.vision}`);
        }
      }
      return bad;
    });
    ok(vbad.length === 0, `all verify marks on whole words (${vbad.slice(0, 3).join("; ")})`);
    await go("#patient/10"); await page.evaluate(() => openSource({ file: "10_pacient.pdf", page: 4 })); await c('[data-vtab="text"]');
    ok(await page.evaluate(() => [...document.querySelectorAll(".drawer .vf")].every(el => !/\d\.$/.test(el.previousSibling?.textContent || ""))), `10 p4: the iRECIST "11" is not marked inside a date`);
    await page.evaluate(() => openSource({ file: "10_pacient.pdf", page: 2 })); await c('[data-vtab="text"]');
    ok(await page.locator(".drawer .vf[title*='jen jazykový model']").count() >= 1, `10 p2: text only the vision model read is marked`);
    await c('[data-vtab="image"]'); await c(".drawer [data-close]");
  }

  // MDT session: started from the calendar day, the session bar lists the day's cases, a pill switches the case
  const linkOpens = async () => (await audit()).filter(a => a.case_id === "NO-010" && a.what === "otevřel(a) případ (odkazem nebo historií prohlížeče)").length;
  await go("#patient/2"); const opens0 = await linkOpens();
  await go("#protocol/10"); ok((await page.evaluate(() => location.hash)) === "#patient/10/overview", `${width} #protocol redirects to the patient view`);
  ok(await linkOpens() === opens0 + 1, `${width} a redirected old link is logged as opening the case`);
  await go("#patient/2"); await go("#present/10"); ok((await page.evaluate(() => location.hash)) === "#patient/10/overview", `${width} #present redirects to the patient view`);
  ok(await page.locator('[data-go], [data-present], [data-brief]').count() === 0, `${width} no presentation or protocol buttons`);
  ok(await page.evaluate(u => api.post("/api/seminars/2026-10-22/session", {}, { "X-User": u }).then(() => false, e => e.status === 403), ADMIN), `${width} administrator cannot start an MDT (403)`);
  ok(await page.evaluate(() => api.post("/api/seminars/2026-10-21/session", {}, { "X-User": "MUDr. Novák" }).then(() => false, e => e.status === 422)), `${width} MDT on a day without a seminar refused (422)`);
  await c('[data-nav="calendar"]'); await c('[data-startday="2026-10-22"]'); await over("start dialog");
  ok(await page.locator(".modal [data-startgo]").count() === 1 && await page.locator(".modal [data-att]").count() >= 6 && await page.locator(".modal ol li").count() >= 5, `${width} start dialog with agenda and attendance`);
  await c(".modal [data-startgo]"); await page.waitForTimeout(50); await over("session");
  ok((await page.evaluate(() => api.get("/api/session", { "X-User": "MUDr. Novák" })))?.day === "2026-10-22", `${width} session started on the server`);
  ok(await page.locator(".sesbar .agenda button").count() >= 5, `${width} session bar shows the day's patients`);
  ok((await text('.sesbar [aria-current="true"]')).includes("14:00"), `${width} session opens the first case`);
  ok((await text('.sesbar [aria-current="true"]')).includes("✓"), `${width} an approved case is ticked in the session bar`);
  ok(await page.locator("details.mdtcard.live[open]").count() === 1, `${width} discussion card open and outlined in session`);
  ok(await page.locator(".phead [data-startfrom]").count() === 0, `${width} no Zahájit MDT in the header while the session runs`);
  // a new conclusion supersedes the approved one without erasing it
  await c('[data-act="newversion"]');
  ok((await text(".concl")).includes("Platný závěr č. 1") && await page.locator("#concl").count() === 1 && await page.evaluate(() => { const c = document.querySelector(".concl"); return c.textContent.indexOf("Platný závěr č. 1") < c.textContent.indexOf("Koncept nového závěru"); }), `${width} new draft shown below the valid conclusion`);
  await c('[data-tab="labs"]');
  await page.locator(".sesbar .agenda button").nth(1).click(); await page.waitForTimeout(80); await over("session switch");
  ok((await text('.sesbar [aria-current="true"]')).includes("14:10") && !(await page.evaluate(() => location.hash)).startsWith("#patient/10"), `${width} pill switches patient`);
  ok(await page.locator("details.mdtcard.live[open]").count() === 1, `${width} an unprocessed case in the session gets the open discussion card`);
  await c('.sesbar [data-startday]'); ok(await page.locator('.modal [data-startgo]').count() === 0 && (await text(".modal")).includes("Hotovo"), `${width} attendance dialog in session shows Hotovo`); await c('.modal [data-close]');
  await c('.sesbar [aria-label="Předchozí pacient"]'); await page.waitForTimeout(80);
  ok((await page.evaluate(() => location.hash)) === "#patient/10/labs", `${width} previous goes back and switching keeps the tab`);
  ok((await audit()).some(a => a.what === "zahájil(a) MDT 2026-10-22") && (await audit()).some(a => a.case_id === "NO-010" && a.what === "otevřel(a) první případ zahájeného MDT") && (await audit()).some(a => a.what === "otevřel(a) případ na MDT"), `${width} session start and navigation logged by the server`);
  await c('[data-act="endsession"]'); await page.waitForTimeout(50);
  ok(await page.locator(".sesbar").count() === 0 && (await page.evaluate(() => api.get("/api/session", { "X-User": "MUDr. Novák" }))) === null, `${width} Ukončit MDT ends the session on the server and hides the bar`);
  ok((await audit()).some(a => a.what === "ukončil(a) MDT 2026-10-22"), `${width} session end logged`);
  // started from a case header, the session opens on that case
  await go("#patient/9/overview"); await c(".phead [data-startfrom]"); await c(".modal [data-startgo]"); await page.waitForTimeout(50);
  ok((await page.evaluate(() => location.hash)).startsWith("#patient/9/") && (await text('.sesbar [aria-current="true"]')).includes("14:20") && await page.locator('.sesbar [aria-current="true"]').count() === 1, `${width} Zahájit MDT in the header opens the session on that case`);
  await c('[data-act="endsession"]');
  // the report download is logged by the server
  await page.evaluate(() => { window.open = () => null; }); await c('.phead [data-act="download"]'); await page.waitForTimeout(30);
  ok((await audit()).some(a => a.case_id === "NO-009" && /^stáhl\(a\) report/.test(a.what)), `${width} report download logged`);
  await page.selectOption("#user", ADMIN); await page.waitForTimeout(50); await c('[data-nav="admin"]'); await over("admin");
  ok(await page.locator("tbody tr").count() > 3, `${width} admin sees the access log`);
  ok((await page.locator("main").textContent()).includes("vráceno na původní"), `${width} admin sees the edit log`);
  await c('[data-nav="tasks"]'); await over("tasks");
  await page.close();
}
// Latency: every request waits 0-300 ms, so requests overtake each other as over a network. Type a conclusion
// and a task, approve at once, and check the server stored exactly what was typed, with no error toasts.
{
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  page.on("pageerror", e => errs.push(`latency: ${e.message}`));
  await page.goto(file + "?latency=300#patient/10/overview"); await page.waitForSelector("details.mdtcard > summary", { timeout: 5000 });
  await page.click("details.mdtcard > summary"); await page.click("details.mdtcard [data-attonly]");
  await page.waitForSelector('.modal [data-att="Klinická onkologie"]', { timeout: 5000 });
  await page.selectOption('.modal [data-att="Klinická onkologie"]', "MUDr. Svobodová");
  await page.waitForFunction(() => presentList().includes("MUDr. Svobodová"), null, { timeout: 5000 });
  await page.click(".modal [data-close]");
  await page.click('[data-act="editconcl"]'); await page.waitForSelector("#concl", { timeout: 5000 });
  await page.locator("#concl").pressSequentially("Kontrolní MR za 3 měsíce", { delay: 5 });
  await page.click('[data-act="addstep"]'); await page.waitForSelector('[data-step="0"][data-f="text"]');
  await page.locator('[data-step="0"][data-f="text"]').pressSequentially("Objednat MR mozku", { delay: 5 });
  await page.click('[data-act="approve"]'); await page.waitForTimeout(2500);
  const H = { "X-User": "MUDr. Novák" };
  const decs = await page.evaluate(h => api.get("/api/patients/10/decisions", h), H);
  const tasks = await page.evaluate(h => api.get("/api/tasks", h), H);
  const toasts = await page.locator(".toast").allTextContents();
  ok(decs.length === 1 && decs[0].text === "Kontrolní MR za 3 měsíce", `latency: approved conclusion is exactly what was typed (${decs[0]?.text})`);
  ok(tasks.some(t => t.text === "Objednat MR mozku") && !tasks.some(t => /^Objednat MR mozk?$|^Objednat MR m$/.test(t.text)), `latency: task stored complete`);
  ok(!toasts.some(t => /Protokol|Záznam projednání|nezdařil/.test(t)), `latency: no error toasts (${toasts.join(" | ")})`);
  await page.close();
}
await browser.close();
const passed = errs.length ? null : "all checks passed, no errors";
console.log(passed ? "\n" + passed : "\n" + errs.join("\n"));
process.exit(errs.length ? 1 : 0);
