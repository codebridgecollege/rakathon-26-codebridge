// Checks mock v3's uploads and "Nový pacient" in API mode (step 6, docs/research/backend-steps/step-6.md "As implemented") in jsdom against
// a fake server that follows the upload contract: the "Projednání" upload panel sends each file as its own raw request
// and lists every file as "Nahráno" as before the server (a prepared document is stored, any other file only listed),
// keeps a file the server did not take in the browser, never shows an upload error, shows the wrong-patient alert and
// removes an upload. Embedded mode keeps the browser-only list (covered by v3.mjs).
// Usage: JSDOM_PATH=/path/to/node_modules/jsdom node mocks/src/test/uploads-intake.mjs  (jsdom 24)
// Rebuild the page first: uv run mocks/build.py
import { createRequire } from "module";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { TextEncoder, TextDecoder } from "node:util";
import { webcrypto } from "node:crypto";

const require = createRequire(import.meta.url);
const { JSDOM, VirtualConsole } = require(process.env.JSDOM_PATH || "jsdom");
const html = readFileSync(new URL("../../v3.html", import.meta.url), "utf8");
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function open({ url = "file:///repo/mocks/v3.html", fetchImpl } = {}) {
  const errors = [];
  const vc = new VirtualConsole();
  vc.on("jsdomError", e => { if (!/Not implemented/.test(e.message)) errors.push(e.message); });
  const dom = new JSDOM(html, {
    url, runScripts: "dangerously", pretendToBeVisual: true, virtualConsole: vc,
    beforeParse(w) {
      w.TextEncoder = TextEncoder; w.TextDecoder = TextDecoder;
      if (!w.structuredClone) w.structuredClone = structuredClone;
      if (!w.crypto?.randomUUID) Object.defineProperty(w, "crypto", { value: webcrypto });
      if (!w.CSS?.escape) w.CSS = { escape: v => String(v).replace(/[^a-zA-Z0-9_-]/g, c => "\\" + c) };
      w.scrollTo = () => {}; w.Element.prototype.scrollIntoView = function () {};
      w.fetch = async (u, o) => { if (fetchImpl) return fetchImpl(String(u), o || {}, w); throw new TypeError("offline"); };
    },
  });
  const w = dom.window;
  for (let i = 0; i < 50 && /Načítám…/.test(w.document.getElementById("app").innerHTML); i++) await sleep(50);
  w.eval(`toast = (o => m => { (window.__toasts = window.__toasts || []).push(m); o(m); })(toast)`);
  return { w, ev: s => w.eval(s), evj: s => JSON.parse(w.eval(`JSON.stringify(${s})`) ?? "null"), errors };
}

const harvest = await open();
const H = JSON.parse(harvest.ev(`JSON.stringify({ patients: S.patients.map(p => ({ ...p, processing: p.full ? "full" : SYN.some(s => s.file === p.file) ? "partial" : "none" })),
  staff: defaultStaff(), user: S.user, userId: userIdOf(S.user), c10: { case: CASE, extra: EXTRA }, syn: SYN })`));
const json = (status, body) => ({ ok: status < 400, status, headers: { get: () => "application/json" }, json: async () => structuredClone(body) });

// The fake decides by file name what the real server decides by hash; the page only shows the answer. A name starting
// "offline" fails as a network error does.
const NO_UPLOAD_ERROR = /nepodařilo|odmítnuto|Ve sdílené ukázce|Server neodpov|nenahrál/;
function fakeServer() {
  const st = { epoch: 3, writes: [], docs: {}, seq: 0 };
  const roles = Object.fromEntries([...H.staff.depts.flatMap(d => d.people.map(x => [x.id, "doctor"])), ["coord", "coordinator"], ["admin", "admin"]]);
  const err = (status, code, message_cs) => json(status, { error: { code, message_cs } });
  const impl = async (u, o) => {
    const url = new URL(u, "http://localhost/"), path = url.pathname, method = (o.method || "GET").toUpperCase();
    const hd = o.headers || {};
    const body = o.body && typeof o.body === "string" ? JSON.parse(o.body) : o.body ?? null;
    if (method !== "GET") st.writes.push({ method, path, body, headers: hd });
    if (path === "/api/health") return json(200, { service: "codebridge-mdt", features: { data: true }, limits: {}, demo: { data_epoch: st.epoch, reset_at: null, seed_version: "test", reset_enabled: true } });
    if (path === "/api/me") return json(200, { user: { id: H.userId, name: H.user, role: "doctor" }, auth_mode: "demo" });
    if (path === "/api/staff") return json(200, { ...H.staff, admin: { id: "admin", pre: "Ing.", sur: "Kovář", post: "", fn: "" }, roles, seq: 0 });
    if (path === "/api/patients") return json(200, { patients: H.patients, total: H.patients.length, page: 0 });
    if (path.startsWith("/api/tasks")) return json(200, { tasks: [] });
    if (path === "/api/workflow") return json(200, { data_epoch: st.epoch, cases: {}, att: {}, sessions: [], mails: [] });
    let m = path.match(/^\/api\/cases\/([^/]+)\/extraction$/);
    if (m && decodeURIComponent(m[1]) === "NO-S02") {
      st.extractionLoads = (st.extractionLoads || 0) + 1;
      const syn = structuredClone(H.syn.find(x => x.intake_demo));
      syn.documents = syn.documents.map((d, i) => ({ ...d, file: `up-${i + 1}.pdf`, orig_pages: d.pages, pages: [1] }));
      return json(200, { data: { syn } });
    }
    if (m) { const p = H.patients.find(r => r.id === decodeURIComponent(m[1])), syn = H.syn.find(s => s.file === p?.file); return json(200, { data: p.file === "10_pacient.pdf" ? H.c10 : syn ? { syn } : null }); }
    if (/^\/api\/cases\/[^/]+\/guidance$/.test(path)) return json(200, { guidelines: [], statements: [], pages: [], literature: [], queries: [], not_retrieved: [] });
    if (method === "GET" && /^\/api\/cases\/[^/]+$/.test(path)) return json(200, {});
    if (path === "/api/audit/events") return json(200, { data: {}, data_epoch: st.epoch });
    if ((m = path.match(/^\/api\/cases\/([^/]+)\/documents$/))) {
      const id = decodeURIComponent(m[1]), list = st.docs[id] = st.docs[id] || [];
      if (method === "GET") return json(200, { case_id: id, processing_level: "none", documents: [{ id: "seed", origin: "seed" }, ...list] });
      assert.equal(hd["X-Data-Epoch"], String(st.epoch), "an upload carries the data epoch");
      assert.ok(body && typeof body === "object" && typeof body.size === "number" && body.name, "the body is the file itself, not JSON");
      const name = decodeURIComponent(hd["X-File-Name"]);
      if (/^offline/.test(name)) throw new TypeError("Failed to fetch");
      const fixture = /^0\d-/.test(name);
      const d = { id: `up-${++st.seq}`, origin: "upload", name, size: body.size, state: "stored", state_cs: "nezpracováno", type_cs: fixture ? "Laboratorní výsledky" : null,
        fixture, content_stored: fixture, identity: !fixture ? null : /histologie/.test(name) ? "conflicts" : "matches", identity_cs: /histologie/.test(name) ? "Dokument patří jinému pacientovi: jméno nebo rodné číslo se neshoduje." : null,
        uploaded_by: H.user, uploaded_at: new Date().toISOString() };
      list.push(d);
      return json(201, { data: { document: d }, data_epoch: st.epoch, state: {} });
    }
    if (path === "/api/fhir/referral" && method === "POST") {
      st.fhir = body;
      return json(200, { data: { fields: { nf0: "Věra", nf1: "Lipenská", nf2: "585614/4019", nfq: "Adjuvance?" }, found: ["Patient", "ServiceRequest"], missing_cs: ["telefon"], referral_sha256: "a".repeat(64) }, data_epoch: st.epoch });
    }
    if (path === "/api/cases" && method === "POST") { st.created = body; st.docs["NO-S02"] = []; return json(200, { data: { case_id: "NO-S02", file: "S02_pacient.pdf", intake: true }, data_epoch: st.epoch, state: {} }); }
    if ((m = path.match(/^\/api\/cases\/([^/]+)\/intake$/))) {
      const list = st.docs[decodeURIComponent(m[1])] || [];
      if (method === "DELETE") { st.discarded = (st.discarded || 0) + 1; return json(200, { data: { discarded: m[1] }, data_epoch: st.epoch, state: {} }); }
      const ready = list.length === 2;
      return json(200, { case_id: m[1], ready, fixture_id: "S02", expected: 2, present: list.length, missing_cs: ready ? [] : ["Histologie"],
        reason_cs: ready ? "Připojí se předem připravená data ukázkového pacienta: 2 dokumenty (2 s.), hledané podle otisku souborů." : "Chybí ještě 1 z 2 dokumentů ukázkového pacienta; záznam zůstane bez zpracovaných dokumentů.", documents: list });
    }
    if ((m = path.match(/^\/api\/cases\/([^/]+)\/intake\/complete$/)) && method === "POST") {
      const row = { ...H.patients.find(r => r.file === "S01_pacient.pdf"), id: "NO-S02", file: "S02_pacient.pdf", name: "Věra Lipenská", processing: "partial", status: "new", slot: null };
      st.completed = true;
      H.patients.push(row);
      return json(200, { data: { case_id: "NO-S02", attached: true, run_id: "prep-1", reason_cs: "x", documents: 2 }, data_epoch: st.epoch, state: { patient: row } });
    }
    if ((m = path.match(/^\/api\/documents\/([^/]+)$/)) && method === "DELETE") {
      for (const k of Object.keys(st.docs)) st.docs[k] = st.docs[k].filter(d => d.id !== m[1]);
      return json(200, { data: { removed: m[1] }, data_epoch: st.epoch, state: {} });
    }
    return err(404, "not_found", "Nenalezeno.");
  };
  return { impl, st };
}
const apiOpen = async srv => {
  const r = await open({ url: "http://localhost/", fetchImpl: srv.impl });
  for (let i = 0; i < 40 && r.ev(`DATA.mode`) !== "api"; i++) await sleep(25);
  assert.equal(r.ev(`DATA.mode`), "api");
  return r;
};

// 1. The "Projednání" panel uploads each file on its own and lists every one as "Nahráno", with no error.
{
  const srv = fakeServer();
  const { w, ev, errors } = await apiOpen(srv);
  ev(`openPatient("S01_pacient.pdf")`); await sleep(100);
  ev(`curProto().mode = "docs"; render()`); await sleep(200);
  const files = ["04-laborator-2026-03-10.pdf", "vlastni-zprava.docx", "02-histologie-biopsie-2026-03-12.pdf", "offline-sken.jpg"].map(n => new w.File([new Uint8Array([37, 80, 68, 70, 45])], n, { type: /pdf$/.test(n) ? "application/pdf" : "application/octet-stream" }));
  w.addUploads(files);
  // The rows show at once, before any answer, as on the page without a server.
  assert.equal((w.document.getElementById("app").innerHTML.match(/>Nahráno</g) || []).length, 4, "every file is listed at once");
  await sleep(300);
  const ups = srv.st.writes.filter(x => /\/documents$/.test(x.path));
  assert.equal(ups.length, 4, "one request per file");
  assert.equal(ups[0].headers["Content-Type"], "application/pdf");
  const html = w.document.getElementById("app").innerHTML;
  for (const f of files) assert.ok(html.includes(f.name), `${f.name} is listed`);
  assert.equal((html.match(/>Nahráno</g) || []).length, 4, "every file shows as Nahráno, the one the server did not take too");
  assert.doesNotMatch(html, /nezpracováno|zpracování selhalo/, "no server state chip while the pipeline is off");
  assert.doesNotMatch(html, NO_UPLOAD_ERROR, "no upload error on the page");
  assert.doesNotMatch(html, /Přečíst bez AI/, "no pipeline button while features.pipeline is off");
  assert.match(html, /Dokument patří jinému pacientovi/, "the wrong-patient alert is shown");
  assert.equal(srv.st.writes.filter(x => /audit\/events/.test(x.path)).length, 0, "the server logs uploads itself; no view event");
  assert.ok(w.__toasts.some(t => t === "Nahráno: 4 soubory"));
  assert.ok(!w.__toasts.some(t => NO_UPLOAD_ERROR.test(t)), "no upload error in a toast");
  // The case itself signals a document with another patient's identity, not only the upload list.
  assert.match(w.document.getElementById("app").innerHTML, /Možná jiný pacient/);
  w.document.querySelector("[data-delupapi]").click();
  await sleep(150);
  assert.ok(srv.st.writes.some(x => x.method === "DELETE" && x.path === "/api/documents/up-1"));
  assert.doesNotMatch(w.document.getElementById("app").innerHTML, /04-laborator-2026-03-10\.pdf/);
  // A row kept in the browser only is removed in the browser.
  const local = [...w.document.querySelectorAll("[data-delupapi]")].find(b => /offline/.test(b.getAttribute("aria-label")));
  local.click(); await sleep(50);
  assert.doesNotMatch(w.document.getElementById("app").innerHTML, /offline-sken/);
  assert.deepEqual(errors, []);
}

// 2. "Nový pacient" in API mode: FHIR on the server, the intake opened at "Pokračovat", uploads to it listed as before the
// server, the pre-server animation closed by the server's verdict, and "Přidat do databáze" completing it; closing a
// second dialog discards its intake.
{
  const srv = fakeServer();
  const { w, ev, errors } = await apiOpen(srv);
  const act = a => w.document.querySelector(`[data-act="${a}"]`).click();
  ev(`action("newpatient")`); await sleep(20);
  act("fhiropen"); await sleep(20);
  w.document.getElementById("nffhir").value = JSON.stringify({ resourceType: "Bundle", entry: [] });
  act("fhirimport"); await sleep(100);
  assert.ok(srv.st.fhir, "the bundle went to the server");
  assert.equal(w.document.getElementById("nf1").value, "Lipenská", "the server's fields fill the form");
  assert.equal(srv.st.writes.filter(x => /audit\/events/.test(x.path)).length, 0, "the server logs the import itself");
  w.document.getElementById("nfg").checked = true;
  act("newnext"); await sleep(100);
  assert.equal(srv.st.created.intake, true);
  assert.equal(srv.st.created.referral_sha256, "a".repeat(64));
  assert.equal(srv.st.created.intake_fixture, undefined, "the page no longer claims a fixture");
  assert.equal(ev(`S.overlay.step`), 1);
  assert.equal(ev(`S.overlay.caseId`), "NO-S02");
  const mk = n => new w.File([new Uint8Array([37, 80, 68, 70, 45])], n, { type: "application/pdf" });
  ev(`newUploads`)([mk("01-ambulantni-zprava-2026-10-08.pdf")]);
  await sleep(150);
  assert.match(w.document.getElementById("overlay").innerHTML, /Ukázkový pacient: chybí ještě/, "the pre-server hint");
  ev(`newUploads`)([mk("04-laborator-2026-03-10.pdf"), mk("cizi.pdf")]);
  await sleep(200);
  const ov = w.document.getElementById("overlay").innerHTML;
  assert.equal((ov.match(/>Nahráno</g) || []).length, 3, "every file is listed as Nahráno");
  assert.doesNotMatch(ov, NO_UPLOAD_ERROR);
  assert.equal(srv.st.writes.filter(x => x.path === "/api/cases/NO-S02/documents").length, 3);
  // The fake attaches with exactly two fixture files; drop the extra one (the real server ignores listed extras).
  const extra = [...w.document.querySelectorAll("[data-delnew]")].find(b => /cizi/.test(b.getAttribute("aria-label")));
  extra.click(); await sleep(100);
  act("newnext"); await sleep(100);
  assert.match(w.document.getElementById("overlay").innerHTML, /Kontrola čitelnosti/, "the pre-server stages show");
  await sleep(2600);
  const v = w.document.getElementById("overlay").innerHTML;
  assert.match(v, /<b>Hotovo\.<\/b> Zpracováno/, "the pre-server closing sentence, from the server's verdict");
  assert.doesNotMatch(v, /neproběhlo|připraveno předem/);
  w.document.querySelector('[data-act="newdone"]').click();
  await sleep(300);
  assert.equal(srv.st.completed, true);
  assert.equal(ev(`S.pid`), "S02_pacient.pdf", "the new patient opens");
  assert.ok(srv.st.extractionLoads >= 1, "its data comes from the server, not the page's fixture");
  assert.equal(ev(`caseStore.byDocFile.get("up-1.pdf")`), "S02_pacient.pdf", "each uploaded file maps to its case");
  assert.equal(srv.st.discarded || 0, 0);
  // A second dialog closed after "Pokračovat" discards its intake on the server.
  ev(`action("newpatient")`); await sleep(20);
  act("fhiropen"); await sleep(20);
  w.document.getElementById("nffhir").value = "{}";
  act("fhirimport"); await sleep(100);
  w.document.getElementById("nfg").checked = true;
  ev(`S.overlay.dupOk = "5856144019"`);
  act("newnext"); await sleep(100);
  w.document.querySelector('[data-close="1"]').click(); await sleep(50);
  assert.equal(srv.st.discarded, 1);
  assert.deepEqual(errors, []);
}

console.log("Nový pacient in API mode: FHIR on the server, intake opened, uploads listed as before, the pre-server stages closed by the server's verdict, completion and discard passed.");
console.log("Uploads in API mode: one raw request per file, every file listed as Nahráno (also one the server did not take), no upload error, the wrong-patient alert and removal passed.");
