// Checks "Nahrát z telefonu" in mock v3 (issue #10, docs/design/PHONE-UPLOAD.md) in jsdom against a fake server that
// follows the upload-session contract: the button shows only in API mode and only where this user can upload, the
// dialog draws the QR code in the page (no network), never shows the token as text, polls the session, adds the phone's
// files to the existing upload list (or the intake's) marked "z telefonu", ends the session on "Hotovo" and Escape, and
// sits above the "Nový pacient" dialog without closing it. No error text appears anywhere.
// Usage: JSDOM_PATH=/path/to/node_modules/jsdom node mocks/src/test/phone-upload.mjs  (jsdom 24)
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
const TOKEN = "tok_" + "x".repeat(39);
const NO_ERROR = /nepodařilo|odmítnuto|Server neodpov|chyba|selhal/i;

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
  return { w, ev: s => w.eval(s), errors };
}

const harvest = await open();
const H = JSON.parse(harvest.ev(`JSON.stringify({ patients: S.patients.map(p => ({ ...p, processing: p.full ? "full" : SYN.some(s => s.file === p.file) ? "partial" : "none" })),
  staff: defaultStaff(), user: S.user, userId: userIdOf(S.user), c10: { case: CASE, extra: EXTRA }, syn: SYN })`));
const json = (status, body) => ({ ok: status < 400, status, headers: { get: () => "application/json" }, json: async () => structuredClone(body) });

function fakeServer() {
  const st = { epoch: 3, writes: [], sessions: {}, polls: 0 };
  const roles = Object.fromEntries([...H.staff.depts.flatMap(d => d.people.map(x => [x.id, "doctor"])), ["coord", "coordinator"], ["admin", "admin"]]);
  const ok = data => json(200, { data, data_epoch: st.epoch, state: {} });
  const impl = async (u, o) => {
    const url = new URL(u, "http://localhost/"), path = url.pathname, method = (o.method || "GET").toUpperCase();
    const body = o.body && typeof o.body === "string" ? JSON.parse(o.body) : null;
    if (method !== "GET") st.writes.push({ method, path, body });
    if (path === "/api/health") return json(200, { service: "codebridge-mdt", features: { data: true }, limits: {}, demo: { data_epoch: st.epoch, reset_at: null, seed_version: "test", reset_enabled: true } });
    if (path === "/api/me") return json(200, { user: { id: H.userId, name: H.user, role: "doctor" }, auth_mode: "demo" });
    if (path === "/api/staff") return json(200, { ...H.staff, admin: { id: "admin", pre: "Ing.", sur: "Kovář", post: "", fn: "" }, roles, seq: 0 });
    if (path === "/api/patients") return json(200, { patients: H.patients, total: H.patients.length, page: 0 });
    if (path.startsWith("/api/tasks")) return json(200, { tasks: [] });
    if (path === "/api/workflow") return json(200, { data_epoch: st.epoch, cases: {}, att: {}, sessions: [], mails: [] });
    let m = path.match(/^\/api\/cases\/([^/]+)\/extraction$/);
    if (m) { const p = H.patients.find(r => r.id === decodeURIComponent(m[1])), syn = H.syn.find(s => s.file === p?.file); return json(200, { data: p?.file === "10_pacient.pdf" ? H.c10 : syn ? { syn } : null }); }
    if (/^\/api\/cases\/[^/]+\/guidance$/.test(path)) return json(200, { guidelines: [], statements: [], pages: [], literature: [], queries: [], not_retrieved: [] });
    if (method === "GET" && /^\/api\/cases\/[^/]+$/.test(path)) return json(200, {});
    if (path === "/api/audit/events") return ok({});
    if ((m = path.match(/^\/api\/cases\/([^/]+)\/documents$/)) && method === "GET") return json(200, { case_id: m[1], processing_level: "none", documents: [] });
    if (path === "/api/cases" && method === "POST") return ok({ case_id: "NO-S02", file: "S02_pacient.pdf", intake: true });
    if ((m = path.match(/^\/api\/cases\/([^/]+)\/intake$/))) return method === "DELETE" ? ok({ discarded: m[1] }) : json(200, { case_id: m[1], ready: false, documents: [] });
    if (path === "/api/upload-sessions" && method === "POST") {
      const id = `us-${Object.keys(st.sessions).length + 1}`;
      st.sessions[id] = { id, case_id: body.case_id, target: body.target, state: "open", docs: [], expires_at: new Date(Date.now() + 15 * 60_000).toISOString() };
      return json(201, { data: { ...st.sessions[id], docs: undefined, token: TOKEN, file_count: 0, max_files: 30 }, data_epoch: st.epoch, state: {} });
    }
    if ((m = path.match(/^\/api\/upload-sessions\/([^/]+)$/))) {
      const s = st.sessions[m[1]];
      if (method === "DELETE") { s.state = "closed"; return ok({ id: s.id, state: "closed" }); }
      st.polls++;
      return json(200, { id: s.id, case_id: s.case_id, target: s.target, state: s.state, expires_at: s.expires_at, file_count: s.docs.length, max_files: 30, documents: s.docs });
    }
    return json(404, { error: { code: "not_found", message_cs: "Nenalezeno." } });
  };
  // What the phone's upload leaves on the server: a document row with source "phone", under the desktop user's name.
  const phoneSends = (sid, name, extra = {}) => st.sessions[sid].docs.push({ id: `up-p${st.sessions[sid].docs.length + 1}`, origin: "upload", name, size: 2048, state: "stored", state_cs: "nezpracováno", source: "phone", uploaded_by: H.user, uploaded_at: new Date().toISOString(), identity: null, ...extra });
  return { impl, st, phoneSends };
}
const apiOpen = async srv => {
  const r = await open({ url: "http://localhost/", fetchImpl: srv.impl });
  for (let i = 0; i < 40 && r.ev(`DATA.mode`) !== "api"; i++) await sleep(25);
  assert.equal(r.ev(`DATA.mode`), "api");
  return r;
};
const phoneLayer = w => w.document.getElementById("phoneup");

// 1. Embedded mode (Pages, a file): no phone button anywhere.
{
  const { w, ev, errors } = await open();
  ev(`openPatient("S01_pacient.pdf")`); await sleep(100);
  ev(`curProto().mode = "docs"; render()`); await sleep(50);
  assert.doesNotMatch(w.document.getElementById("app").innerHTML, /Nahrát z telefonu/, "no phone button in embedded mode");
  ev(`action("upload")`); await sleep(20);
  assert.doesNotMatch(w.document.getElementById("overlay").innerHTML, /Nahrát z telefonu/);
  assert.deepEqual(errors, []);
}

// 2. "Projednání na MDT", panel "Dokumenty": QR dialog, polling, files join the upload list marked "z telefonu", Hotovo ends it.
{
  const srv = fakeServer();
  const { w, ev, errors } = await apiOpen(srv);
  ev(`openPatient("S01_pacient.pdf")`); await sleep(100);
  ev(`curProto().mode = "docs"; render()`); await sleep(150);
  const btn = w.document.querySelector('[data-act="phoneup-discussion"]');
  assert.ok(btn, "the button shows next to the upload area");
  btn.click(); await sleep(100);
  const layer = phoneLayer(w);
  assert.match(layer.innerHTML, /Nahrát z telefonu · NO-S01/);
  assert.ok(layer.querySelector(".phoneqr svg"), "the QR code is drawn in the page");
  assert.match(layer.textContent, /Platí 15 minut/);
  assert.ok(!layer.textContent.includes(TOKEN), "the token is not shown as text");
  assert.ok(!w.document.getElementById("app").innerHTML.includes(TOKEN));
  const create = srv.st.writes.find(x => x.path === "/api/upload-sessions");
  assert.deepEqual(create.body, { case_id: "NO-S01", target: "discussion" });
  // The intake overlay is not involved: the page's own dialog layer is untouched.
  assert.equal(w.document.getElementById("overlay").innerHTML, "");
  srv.phoneSends("us-1", "foto zpravy.jpg");
  await sleep(1800);
  assert.ok(srv.st.polls >= 1, "the dialog polls the session");
  assert.match(phoneLayer(w).innerHTML, /Přijato z telefonu \(1\)/);
  assert.match(phoneLayer(w).innerHTML, /foto zpravy\.jpg/);
  const app = w.document.getElementById("app").innerHTML;
  assert.match(app, /foto zpravy\.jpg/, "the file joins the existing upload list");
  assert.match(app, /z telefonu/, "marked z telefonu next to who and when");
  srv.phoneSends("us-1", "posledni.pdf");
  phoneLayer(w).querySelector('.btn.primary[data-phoneclose]').click();
  await sleep(200);
  assert.equal(phoneLayer(w).innerHTML, "", "Hotovo closes the dialog");
  assert.ok(srv.st.writes.some(x => x.method === "DELETE" && x.path === "/api/upload-sessions/us-1"), "and ends the session");
  assert.match(w.document.getElementById("app").innerHTML, /posledni\.pdf/, "a file that arrived just before Hotovo is still picked up");
  const polls = srv.st.polls; await sleep(1700);
  assert.equal(srv.st.polls, polls, "no polling after the dialog closed");
  assert.ok(!(w.__toasts || []).some(t => NO_ERROR.test(t)), "no error toast");
  assert.deepEqual(errors, []);
}

// 3. Where the desktop cannot upload (closed case), there is no phone button; the Documents tab dialog has one otherwise.
{
  const srv = fakeServer();
  const { w, ev, errors } = await apiOpen(srv);
  ev(`openPatient("S01_pacient.pdf")`); await sleep(100);
  ev(`action("upload")`); await sleep(20);
  assert.ok(w.document.querySelector('#overlay [data-act="phoneup-documents"]'), "the Documents tab dialog has the button");
  w.document.querySelector('#overlay [data-act="phoneup-documents"]').click(); await sleep(100);
  assert.equal(srv.st.writes.find(x => x.path === "/api/upload-sessions").body.target, "documents");
  // Escape closes the phone dialog first, and only it.
  w.document.dispatchEvent(new w.KeyboardEvent("keydown", { key: "Escape", bubbles: true })); await sleep(50);
  assert.equal(phoneLayer(w).innerHTML, "");
  assert.match(w.document.getElementById("overlay").innerHTML, /Nahrát dokument · NO-S01/, "the dialog below stays open");
  ev(`S.overlay = null; renderOverlay(); P(S.pid).status = "closed"; curProto().mode = "docs"; render()`); await sleep(50);
  assert.doesNotMatch(w.document.getElementById("app").innerHTML, /Nahrát z telefonu/, "no button on a closed case");
  ev(`action("upload")`); await sleep(20);
  assert.doesNotMatch(w.document.getElementById("overlay").innerHTML, /Nahrát z telefonu/);
  assert.deepEqual(errors, []);
}

// 4. "Nový pacient", step "Dokumenty": the phone's files reach the intake's list; an expired code offers a new one.
{
  const srv = fakeServer();
  const { w, ev, errors } = await apiOpen(srv);
  ev(`action("newpatient")`); await sleep(20);
  for (const [id, v] of [["nf0", "Věra"], ["nf1", "Lipenská"], ["nf2", "585614/4019"]]) w.document.getElementById(id).value = v;
  w.document.getElementById("nfg").checked = true;
  w.document.querySelector('[data-act="newnext"]').click(); await sleep(150);
  assert.equal(ev(`S.overlay.step`), 1);
  w.document.querySelector('[data-act="phoneup-intake"]').click(); await sleep(100);
  assert.deepEqual(srv.st.writes.find(x => x.path === "/api/upload-sessions").body, { case_id: "NO-S02", target: "intake" });
  assert.match(phoneLayer(w).innerHTML, /NO-S02/);
  srv.phoneSends("us-1", "01-ambulantni-zprava-2026-10-08.pdf");
  srv.phoneSends("us-1", "02-histologie.pdf", { identity: "conflicts", identity_cs: "Jméno nebo rodné číslo v dokumentu se neshoduje s pacientem případu; ověřte, zda dokument patří tomuto pacientovi." });
  await sleep(1800);
  const ov = w.document.getElementById("overlay").innerHTML;
  assert.match(ov, /01-ambulantni-zprava-2026-10-08\.pdf/, "the file is in the intake's list");
  assert.match(ov, /z telefonu/);
  assert.match(ov, /se neshoduje s pacientem/, "the wrong-patient alert shows on the row, as for a desktop upload");
  assert.equal(ev(`S.overlay.files.length`), 2);
  assert.ok(!w.document.querySelector('[data-act="newnext"]').disabled, "Zpracovat is enabled by the phone's files");
  // The code expired: "Nový kód" opens a new session.
  srv.st.sessions["us-1"].state = "expired";
  await sleep(1700);
  assert.match(phoneLayer(w).innerHTML, /Platnost kódu skončila/);
  phoneLayer(w).querySelector("[data-phonenew]").click(); await sleep(100);
  assert.ok(srv.st.sessions["us-2"], "a new session");
  assert.ok(phoneLayer(w).querySelector(".phoneqr svg"));
  // Closing the intake ends the phone session too.
  ev(`discardIntake(S.overlay); S.overlay = null; renderOverlay()`); await sleep(100);
  assert.equal(phoneLayer(w).innerHTML, "");
  assert.ok(srv.st.writes.some(x => x.method === "DELETE" && x.path === "/api/upload-sessions/us-2"));
  assert.ok(!(w.__toasts || []).some(t => NO_ERROR.test(t)));
  assert.deepEqual(errors, []);
}

console.log("Nahrát z telefonu: hidden in embedded mode and where upload is not allowed, QR drawn in the page without the token as text, polling, files in the upload and intake lists marked z telefonu, Hotovo, Escape, Nový kód and intake discard passed.");
