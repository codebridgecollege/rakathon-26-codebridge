// Checks mock v3's uploads in API mode (step 6, docs/research/backend-steps/step-6.md "As implemented") in jsdom against
// a fake server that follows the upload contract: the "Projednání" upload panel sends each file as its own raw request,
// lists what the server stored, names refused files with the server's reason, shows the wrong-patient alert and removes
// an upload. Embedded mode keeps the browser-only list (covered by v3.mjs).
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

// The fake decides by file name what the real server decides by hash; the page only shows the answer.
const REFUSAL = "Ve sdílené ukázce lze nahrát jen připravené syntetické dokumenty (např. ze složky samples/S02_pacient/upload). Jiný soubor se neuložil, protože by šlo o data bez souhlasu s jejich zpracováním.";
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
      if (!/^0\d-/.test(name)) return err(422, "upload_not_fixture", REFUSAL);
      const d = { id: `up-${++st.seq}`, origin: "upload", name, size: body.size, state: "stored", state_cs: "nezpracováno", type_cs: "Laboratorní výsledky",
        identity: /histologie/.test(name) ? "conflicts" : "matches", identity_cs: /histologie/.test(name) ? "Dokument patří jinému pacientovi: jméno nebo rodné číslo se neshoduje." : null,
        uploaded_by: H.user, uploaded_at: new Date().toISOString() };
      list.push(d);
      return json(201, { data: { document: d }, data_epoch: st.epoch, state: {} });
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

// 1. The "Projednání" panel uploads each file on its own, lists the server's answer, refuses and removes.
{
  const srv = fakeServer();
  const { w, ev, errors } = await apiOpen(srv);
  ev(`openPatient("S01_pacient.pdf")`); await sleep(100);
  ev(`curProto().mode = "docs"; render()`); await sleep(200);
  const files = ["04-laborator-2026-03-10.pdf", "vlastni-zprava.pdf", "02-histologie-biopsie-2026-03-12.pdf"].map(n => new w.File([new Uint8Array([37, 80, 68, 70, 45])], n, { type: "application/pdf" }));
  w.addUploads(files);
  await sleep(300);
  const ups = srv.st.writes.filter(x => /\/documents$/.test(x.path));
  assert.equal(ups.length, 3, "one request per file");
  assert.equal(ups[0].headers["Content-Type"], "application/pdf");
  const html = w.document.getElementById("app").innerHTML;
  assert.match(html, /04-laborator-2026-03-10\.pdf/);
  assert.match(html, /nezpracováno/);
  assert.match(html, /Ve sdílené ukázce lze nahrát jen připravené syntetické dokumenty/, "the refusal is shown with the server's reason");
  assert.match(html, /Dokument patří jinému pacientovi/, "the wrong-patient alert is shown");
  assert.equal(srv.st.writes.filter(x => /audit\/events/.test(x.path)).length, 0, "the server logs uploads itself; no view event");
  assert.ok(w.__toasts.some(t => /Nahráno: 2 soubory, odmítnuto 1/.test(t)));
  w.document.querySelector("[data-delupapi]").click();
  await sleep(150);
  assert.ok(srv.st.writes.some(x => x.method === "DELETE" && x.path === "/api/documents/up-1"));
  assert.doesNotMatch(w.document.getElementById("app").innerHTML, /04-laborator-2026-03-10\.pdf/);
  assert.deepEqual(errors, []);
}

console.log("Uploads in API mode: one raw request per file, the server's list, refusals with reasons, the wrong-patient alert and removal passed.");
