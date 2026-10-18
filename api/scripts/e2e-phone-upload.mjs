// End-to-end check of "Nahrát z telefonu" (issue #10, docs/design/PHONE-UPLOAD.md) against a running Worker (local
// `wrangler dev` or the deployed demo), in real browsers with the committed synthetic files only:
// 1. the desktop (Chromium, desktop viewport) starts "Nový pacient" from the sample FHIR referral and opens the QR
//    dialog on the step "Dokumenty";
// 2. a phone (Chromium emulating an Android phone) opens /u from the code and uploads the seven S02 PDFs;
// 3. the desktop shows them in the intake list, "Zpracovat" attaches the prepared data and the patient is added;
// 4. a second phone (WebKit emulating an iPhone) sends a photo to the new case's "Projednání na MDT" panel;
// 5. after "Hotovo" the phone's link has ended; neither page showed an error.
// With --reset it runs reset-demo before (S02 can be added once per seeded state) and after, so the shared demo is clean.
// Usage: PLAYWRIGHT_PATH=<dir>/node_modules/playwright node api/scripts/e2e-phone-upload.mjs http://localhost:8799 [--reset]
// It prints counts and states only, never page text, identity or the token.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const require = createRequire(import.meta.url);
const { chromium, webkit, devices } = require(process.env.PLAYWRIGHT_PATH || "playwright");
const base = (process.argv[2] || "http://localhost:8799").replace(/\/$/, "");
const reset = process.argv.includes("--reset");
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const up = path.join(root, "samples/S02_pacient/upload");
const pdfs = readdirSync(up).filter((f) => f.endsWith(".pdf")).sort().map((f) => path.join(up, f));
assert.equal(pdfs.length, 7, "the seven S02 PDFs");
// Error wording the demo must never show (the one allowed phone message is the ended link, checked separately).
const NO_ERROR = /nepodařilo|odmítnut|Server neodpov|chyba|selhal|Neplatn/i;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, ms = 30000, what = "condition") {
  const t0 = Date.now();
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() - t0 > ms) throw new Error(`timed out waiting for ${what}`);
    await sleep(250);
  }
}

async function resetDemo() {
  const h = await (await fetch(base + "/api/health")).json();
  const r = await fetch(base + "/api/admin/reset-demo", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Demo-User": "admin", Origin: base, "X-Data-Epoch": String(h.demo.data_epoch) },
    body: JSON.stringify({ confirm: "OBNOVIT" }),
  });
  assert.equal(r.status, 200, "reset-demo");
  console.log("reset-demo: done");
}
// The S02 patient can be added once per seeded state, so a rerun starts from a reset demo.
if (reset) await resetDemo();

const desktopBrowser = await chromium.launch();
const desktop = await desktopBrowser.newPage({ viewport: { width: 1440, height: 900 } });
const pageErrors = [];
desktop.on("pageerror", (e) => pageErrors.push(`desktop: ${e.message}`));
await desktop.goto(base + "/");
await desktop.waitForFunction(() => typeof DATA !== "undefined" && DATA.mode === "api" && !/Načítám…/.test(document.getElementById("app").innerHTML), null, { timeout: 30000 });
await desktop.evaluate(() => { window.__toasts = []; const o = window.toast; window.toast = (m) => { window.__toasts.push(m); o(m); }; });
const ev = (fn, arg) => desktop.evaluate(fn, arg);

// 1. Nový pacient from the sample referral, then step "Dokumenty".
await ev(() => action("newpatient"));
await desktop.click('[data-act="fhiropen"]');
await desktop.click('[data-act="fhirsample"]');
await desktop.click('[data-act="fhirimport"]');
await desktop.waitForFunction(() => document.getElementById("nf1")?.value);
await desktop.check("#nfg");
await desktop.click('[data-act="newnext"]');
await desktop.waitForFunction(() => S.overlay?.step === 1 && S.overlay.caseId);
const caseId = await ev(() => S.overlay.caseId);
console.log(`intake opened: ${caseId}`);
await desktop.click('[data-act="phoneup-intake"]');
await desktop.waitForSelector("#phoneup .phoneqr svg");
const url = await ev(() => S.phone.url);
assert.ok(url.startsWith(base + "/u#"), "the QR code points at /u with the token after #");
// The drawn code is the code of that URL.
assert.ok(await ev((u) => { const d = document.createElement("div"); d.innerHTML = phoneQr(u); return document.querySelector("#phoneup .phoneqr").innerHTML === d.innerHTML; }, url), "the QR code encodes the session URL");
assert.ok(!(await desktop.textContent("#phoneup")).includes(url.split("#")[1]), "the token is not shown as text");

// 2. An Android phone opens the page and sends the seven PDFs.
const android = await chromium.launch();
const phoneCtx = await android.newContext({ ...devices["Pixel 7"] });
const phone = await phoneCtx.newPage();
phone.on("pageerror", (e) => pageErrors.push(`android: ${e.message}`));
const phoneRequests = [];
phone.on("request", (r) => phoneRequests.push(r.url()));
await phone.goto(url);
await phone.waitForSelector("#case:not(:empty)");
assert.equal(await phone.textContent("#case"), caseId);
assert.equal(new URL(phone.url()).hash, "", "the token leaves the address bar");
const box = await phone.locator(".pick").boundingBox();
assert.ok(box.height >= 56 && box.width >= 300, `a large touch target (${Math.round(box.width)}x${Math.round(box.height)})`);
assert.ok(await phone.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), "no sideways scroll on the phone");
await phone.setInputFiles("#file", pdfs);
await phone.waitForFunction((n) => document.querySelectorAll("#list .st.ok").length === n, pdfs.length, { timeout: 60000 });
assert.doesNotMatch(await phone.textContent("main"), NO_ERROR);
assert.ok(phoneRequests.every((u) => !u.includes("#") && !/u#|token/.test(u.split("?")[1] || "")), "the token never goes into a URL");
assert.ok(phoneRequests.every((u) => new URL(u).origin === new URL(base).origin), "the phone page loads nothing from another host");
console.log(`phone (Android): ${pdfs.length} files sent`);

// 3. The desktop lists them, processes the intake and adds the patient.
await until(() => ev(() => S.overlay?.files?.filter((f) => f.doc?.source === "phone").length), 10000, "the phone's files on the desktop").then(async () =>
  until(async () => (await ev(() => S.overlay.files.filter((f) => f.doc?.source === "phone").length)) === 7, 10000, "all seven files"));
assert.match(await desktop.textContent("#phoneup"), /Přijato z telefonu \(7\)/);
assert.match(await desktop.textContent("#overlay"), /z telefonu/);
await desktop.click('#phoneup .btn.primary[data-phoneclose]');
await desktop.waitForFunction(() => !S.phone);
await desktop.click('[data-act="newnext"]');
await desktop.waitForFunction(() => /Hotovo\./.test(document.getElementById("overlay").innerHTML), null, { timeout: 30000 });
const verdict = await desktop.textContent("#overlay");
assert.match(verdict, /Zpracováno 7 dokumentů/, "the prepared data attach to the phone's files");
await desktop.click('[data-act="newdone"]');
await desktop.waitForFunction(() => !S.overlay && S.view === "patient", null, { timeout: 30000 });
console.log("intake completed: prepared data attached to the phone's files");

// The ended session refuses the phone with the one allowed message.
const tiny = pdfs[0];
await phone.setInputFiles("#file", [tiny]);
await phone.waitForSelector("#ended:not([hidden])", { timeout: 20000 });
console.log("phone after Hotovo: the link has ended");

// 4. An iPhone (WebKit) sends a photo to the new case's "Projednání na MDT" panel.
await ev(() => { S.mdtOpen[S.pid] = true; curProto().mode = "docs"; render(); });
await desktop.click('[data-act="phoneup-discussion"]');
await desktop.waitForSelector("#phoneup .phoneqr svg");
const url2 = await ev(() => S.phone.url);
const ios = await webkit.launch();
const iphone = await (await ios.newContext({ ...devices["iPhone 13"] })).newPage();
iphone.on("pageerror", (e) => pageErrors.push(`iphone: ${e.message}`));
await iphone.goto(url2);
await iphone.waitForSelector("#case:not(:empty)");
// A camera photo: a tiny PNG named as iOS names camera shots, sent twice to check the second keeps its own name.
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=", "base64");
await iphone.setInputFiles("#file", [{ name: "image.png", mimeType: "image/png", buffer: png }]);
await iphone.setInputFiles("#file", [{ name: "image.png", mimeType: "image/png", buffer: Buffer.concat([png, Buffer.from([0])]) }]);
await iphone.waitForFunction(() => document.querySelectorAll("#list .st.ok").length === 2, null, { timeout: 30000 });
await until(async () => (await ev(() => (S.phone?.docs || []).length)) === 2, 10000, "the photos on the desktop");
const panel = await desktop.textContent("#app");
assert.match(panel, /image\.png/);
assert.match(panel, /image \(2\)\.png/);
assert.match(panel, /z telefonu/);
await desktop.click('#phoneup .btn.primary[data-phoneclose]');
console.log("phone (iPhone): 2 photos listed in the discussion panel");

// 5. No error anywhere.
const toasts = await ev(() => window.__toasts);
assert.ok(!toasts.some((t) => NO_ERROR.test(t)), "no error toast on the desktop");
assert.deepEqual(pageErrors, []);
await Promise.all([desktopBrowser.close(), android.close(), ios.close()]);

if (reset) await resetDemo();
console.log("e2e phone upload: passed");
