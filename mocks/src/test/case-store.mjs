// Checks the per-case data store of mock v3 (docs/research/backend-steps/step-3.md) in jsdom, with no network.
// Usage: JSDOM_PATH=/path/to/node_modules/jsdom node mocks/src/test/case-store.mjs  (needs jsdom 24, e.g. npm i jsdom@24.1.0 in a temp folder)
import { createRequire } from "module";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { TextEncoder, TextDecoder } from "node:util";
import { webcrypto } from "node:crypto";

const require = createRequire(import.meta.url);
const { JSDOM, VirtualConsole } = require(process.env.JSDOM_PATH || "jsdom");
const html = readFileSync(new URL("../../v3.html", import.meta.url), "utf8");
const sleep = ms => new Promise(r => setTimeout(r, ms));

// Opens the built page. Embedded mode (a file URL) must make no request for case data: the fetch stub records every call.
async function open({ url = "file:///repo/mocks/v3.html", fetchImpl } = {}) {
  const errors = [], calls = [];
  const vc = new VirtualConsole();
  vc.on("jsdomError", e => { if (!/Not implemented/.test(e.message)) errors.push(e.message); });
  const dom = new JSDOM(html, {
    url, runScripts: "dangerously", pretendToBeVisual: true, virtualConsole: vc,
    beforeParse(w) {
      w.TextEncoder = TextEncoder; w.TextDecoder = TextDecoder;
      if (!w.structuredClone) w.structuredClone = structuredClone;
      if (!w.crypto?.randomUUID) Object.defineProperty(w, "crypto", { value: webcrypto });
      w.scrollTo = () => {}; w.Element.prototype.scrollIntoView = function () {};
      w.fetch = async (u, o) => { calls.push(String(u)); if (fetchImpl) return fetchImpl(String(u), o, w); throw new TypeError("offline"); };
    },
  });
  const w = dom.window;
  for (let i = 0; i < 50 && /Načítám…/.test(w.document.getElementById("app").innerHTML); i++) await sleep(50);
  return { w, ev: s => w.eval(s), errors, calls };
}

// 1. Embedded seed: case 10 has every part, a synthetic patient documents, alerts and a lab series, FNO's patients none.
{
  const { ev, errors, calls } = await open();
  const c10 = ev(`caseData("10_pacient.pdf")`);
  assert.equal(c10.level, "full");
  for (const part of ["brief", "record", "labs", "alerts", "documents"]) assert.ok(c10[part], `case 10 has ${part}`);
  assert.ok(c10.brief.text_cs && c10.record.onco_compact && c10.labs.values.length && c10.alerts.flags.length && c10.documents.documents.length);
  assert.equal(c10.labs.series, null, "case 10 has one undated panel, never a series");
  const s01 = ev(`caseData("S01_pacient.pdf")`);
  assert.equal(s01.level, "partial");
  assert.equal(s01.brief, null); assert.equal(s01.record, null);
  assert.ok(s01.documents.documents.length && s01.alerts.gaps.length && s01.labs.series.draws.length >= 2);
  // An unprocessed case is ready once opened, with every part null: "not processed", never "nothing found".
  assert.equal(ev(`caseData("2_pacient.pdf")`), null, "nothing is created before the case is opened");
  ev(`ensureCase(P("2_pacient.pdf"))`);
  const c2 = ev(`caseData("2_pacient.pdf")`);
  assert.equal(c2.level, "none");
  for (const part of ["brief", "record", "labs", "alerts", "documents"]) assert.equal(c2[part], null);
  assert.equal(ev(`hasMissing(P("2_pacient.pdf"))`), null);
  // Opening the cases on Pages asks the network for no case data.
  for (const f of ["10", "S01", "2"]) { ev(`location.hash = "#patient/${f}/overview"`); await sleep(60); }
  await sleep(500);
  assert.deepEqual(calls.filter(u => /\/api\/cases\//.test(u)), [], "no case-data request in embedded mode");
  assert.deepEqual(errors, []);
}

// 2. One data-driven view: the tabs follow the parts the case data holds.
{
  const { w, ev, errors } = await open();
  const tabs = async hash => { ev(`location.hash = "${hash}"`); await sleep(80); return [...w.document.querySelectorAll(".tabs [data-tab]")].map(b => b.dataset.tab); };
  assert.deepEqual(await tabs("#patient/10/overview"), ["overview", "anamnesis", "documents", "labs", "alerts", "next", "dev", "prognosis"]);
  assert.deepEqual(await tabs("#patient/S01/documents"), ["documents", "labs", "alerts", "prognosis"]);
  assert.ok(w.document.querySelector(".gapsbtn.warn"), "S01: amber missing-documents button");
  assert.match(w.document.querySelector(".blk .head").textContent, /Zpracováno: dokumenty, chybějící podklady, laboratoř/);
  assert.deepEqual(await tabs("#patient/2/overview"), ["prognosis"]);
  assert.match(w.document.querySelector(".blk .head").textContent, /Nezpracováno/);
  assert.ok(w.document.querySelector(".unchecked"), "patient 2: the unchecked signal");
  assert.equal(ev(`missingState(P("2_pacient.pdf"))`), "unchecked");
  assert.equal(ev(`missingState(P("S01_pacient.pdf"))`), "yes");
  assert.match(ev(`reportHtml(P("2_pacient.pdf"), ensureProto(P("2_pacient.pdf")), [])`), /Chybějící podklady nezkontrolovány/);
  // A case whose data gains a brief and finding groups shows them with no code change.
  ev(`(() => { const cd = caseData("S01_pacient.pdf");
    setReady("S01_pacient.pdf", { ...cd, brief: { text_cs: "Testovací souhrn případu [1].", refs: [{ file: "S01_pacient.pdf", page: 1, quote: "MR mozku" }], reason_cs: null, reason_refs: [], dx_headline: null, summary_items: [] },
      record: { sections: { imaging: [{ text_cs: "MR mozku: testovací nález", date: "29.9.2026", source: { file: "S01_pacient.pdf", page: 1 } }] }, timeline: [], onco_detailed: [] } }, true); })()`);
  await tabs("#patient/S01/documents");
  assert.match(w.document.querySelector(".blk .prose").textContent, /Testovací souhrn případu/);
  assert.ok(w.document.querySelector('[data-act="fhirdlg"]'), "finding groups enable the FHIR export");
  const b = ev(`fhirBundle(P("S01_pacient.pdf"))`);
  assert.ok(b.entry.some(e => e.resource.resourceType === "Observation" && e.resource.valueString === "MR mozku: testovací nález"));
  assert.ok(!b.entry.some(e => e.resource.resourceType === "Condition"), "no extracted diagnosis, no Condition");
  assert.match(ev(`reportHtml(P("S01_pacient.pdf"), ensureProto(P("S01_pacient.pdf")), [])`), /Zobrazovací vyšetření<\/h4><ul><li>29\.9\.2026: MR mozku: testovací nález/);
  assert.deepEqual(errors, []);
}

// 3. API mode against a fake server built from the page's own embedded data, with replies released by the test.
const harvest = await open();
const H = JSON.parse(harvest.ev(`JSON.stringify({ patients: S.patients.map(p => ({ ...p, processing: p.full ? "full" : SYN.some(s => s.file === p.file) ? "partial" : "none" })),
  tasks: S.tasks, staff: defaultStaff(), user: S.user, userId: userIdOf(S.user), other: USERS.find(u => u !== S.user && userIdOf(u)), otherId: userIdOf(USERS.find(u => u !== S.user && userIdOf(u))),
  c10: { case: CASE, extra: EXTRA }, syn: SYN })`));
const json = (status, body) => ({ ok: status < 400, status, headers: { get: () => "application/json" }, json: async () => body });
// gates[path] holds the replies the test has not released yet; held=false answers at once.
function fakeServer({ held = true, fail = {} } = {}) {
  const gates = {}, log = [];
  const extraction = id => {
    const p = H.patients.find(x => x.id === id), syn = H.syn.find(s => s.file === p?.file);
    if (!p) return json(404, { error: { code: "case_not_found", message_cs: "Případ nenalezen." } });
    return json(200, { case_id: id, data: p.file === "10_pacient.pdf" ? H.c10 : syn ? { syn } : null });
  };
  const impl = (u) => {
    const path = new URL(u, "http://localhost/").pathname + new URL(u, "http://localhost/").search;
    log.push(path);
    if (path === "/api/health") return json(200, { service: "codebridge-mdt", features: { data: true }, limits: {} });
    if (path === "/api/me") return json(200, { user: { id: H.userId, name: H.user, role: "doctor" }, auth_mode: "demo" });
    if (path === "/api/staff") return json(200, { ...H.staff, seq: 0 });
    if (path === "/api/patients") return json(200, { patients: structuredClone(H.patients), total: H.patients.length, page: 0 });
    if (path.startsWith("/api/tasks")) return json(200, { tasks: H.tasks });
    const m = path.match(/^\/api\/cases\/([^/]+)\/extraction$/);
    if (m) {
      const id = decodeURIComponent(m[1]);
      const reply = () => fail[id] ? json(fail[id], { error: { code: "internal", message_cs: "Chyba serveru (test)." } }) : extraction(id);
      if (!held) return reply();
      return new Promise(res => { (gates[id] = gates[id] || []).push(() => res(reply())); });
    }
    if (/^\/api\/cases\/[^/]+\/guidance$/.test(path)) return json(200, { guidelines: [], statements: [], pages: [], literature: [], queries: [], not_retrieved: [] });
    if (/^\/api\/cases\/[^/]+$/.test(path)) return json(200, {});
    return json(404, { error: { code: "not_found", message_cs: "Nenalezeno." } });
  };
  const release = async (id, i = 0) => { const g = gates[id]; assert.ok(g && g[i], `a request for ${id} is waiting`); const f = g[i]; g[i] = null; f(); await sleep(30); };
  return { impl, release, log, gates };
}
const apiOpen = async srv => { const r = await open({ url: "http://localhost/", fetchImpl: srv.impl }); for (let i = 0; i < 40 && r.ev(`DATA.mode`) !== "api"; i++) await sleep(25); assert.equal(r.ev(`DATA.mode`), "api"); return r; };
const text = w => w.document.getElementById("app").textContent;
{
  const srv = fakeServer();
  const { w, ev, errors } = await apiOpen(srv);
  assert.equal(ev(`caseData("10_pacient.pdf")`), null, "API mode seeds nothing from the inlined data");
  assert.ok(!srv.log.some(u => u.includes("/extraction")), "no case data before a case is opened");
  // Loading state, then the data.
  ev(`openPatient("10_pacient.pdf")`);
  assert.match(text(w), /Načítám podklady případu…/);
  assert.equal(w.document.querySelector(".tabs"), null, "no tabs while loading");
  assert.equal(w.document.querySelector('[data-act="reportdlg"]'), null, "no report while loading");
  await srv.release("NO-010");
  assert.equal(ev(`caseOf(P("10_pacient.pdf")).state`), "ready");
  assert.ok(w.document.querySelector('[data-tab="anamnesis"]') && w.document.querySelector('[data-act="fhirdlg"]'));
  // Stale reply: open S01 then patient 13 (processed? no: unprocessed resolves at once) then S01's reply arrives late.
  ev(`openPatient("S01_pacient.pdf")`);
  ev(`openPatient("10_pacient.pdf")`);
  await sleep(100); // the two hash changes settle first; they render on their own
  w.eval(`render = (() => { const r = render; return () => { window.__renders = (window.__renders || 0) + 1; return r(); }; })()`);
  await srv.release("NO-S01");
  assert.equal(ev(`S.pid`), "10_pacient.pdf");
  assert.equal(ev(`window.__renders || 0`), 0, "a late reply for a case no longer open does not re-render");
  assert.equal(ev(`caseOf(P("S01_pacient.pdf")).state`), "ready", "but it stays in the cache");
  // Deep link while loading lands on its tab.
  ev(`caseStore.entries.delete("S01_pacient.pdf")`);
  ev(`location.hash = "#patient/S01/labs"`); await sleep(60);
  assert.match(text(w), /Načítám podklady případu…/);
  await srv.release("NO-S01", 1);
  assert.equal(ev(`S.tab`), "labs");
  assert.ok(w.document.querySelector('.tab[data-tab="labs"][aria-selected="true"]'));
  // A reply older than the latest request for the same case is dropped (retry and user switch bump gen).
  ev(`openPatient("2_pacient.pdf")`);
  ev(`caseStore.entries.delete("S01_pacient.pdf"); ensureCase(P("S01_pacient.pdf")); caseStore.reset();`);
  await srv.release("NO-S01", 2);
  assert.equal(ev(`caseData("S01_pacient.pdf")`), null, "a reply from before a reset is not written");
  // An unprocessed case needs no request.
  ev(`openPatient("2_pacient.pdf")`);
  assert.equal(ev(`caseOf(P("2_pacient.pdf")).state`), "ready");
  assert.ok(!srv.log.some(u => u.includes("NO-002/extraction")));
  assert.ok(w.document.querySelector(".unchecked"));
  // Nothing about cases in localStorage.
  assert.ok(!Object.keys(w.localStorage).some(k => /case|pacient|extract/i.test(k)), "no case data in localStorage");
  assert.deepEqual(errors, []);
}
// 4. Errors: a failed load is never "nothing missing" or "not processed"; retry loads; approval is not blocked.
{
  const srv = fakeServer({ held: false, fail: { "NO-S01": 500 } });
  const { w, ev, errors } = await apiOpen(srv);
  ev(`openPatient("S01_pacient.pdf")`); await sleep(60);
  assert.match(text(w), /Podklady případu se nepodařilo načíst\. Chyba serveru \(test\)\./);
  assert.match(text(w), /Chybějící podklady nelze ověřit \(načtení selhalo\)/);
  assert.ok(w.document.querySelector('[data-act="caseretry"]'));
  assert.equal(w.document.querySelector(".gapsbtn"), null, "no Upozornění button that could read as nothing missing");
  assert.equal(ev(`missingState(P("S01_pacient.pdf"))`), "failed");
  const rep = ev(`reportHtml(P("S01_pacient.pdf"), ensureProto(P("S01_pacient.pdf")), [])`);
  assert.match(rep, /nepodařilo načíst ze serveru/); assert.doesNotMatch(rep, /není zpracovaná/);
  assert.ok(w.document.getElementById("concl"), "the conclusion stays available");
  // Retry against a working server.
  const ok = fakeServer({ held: false });
  w.fetch = async u => ok.impl(String(u));
  w.document.querySelector('[data-act="caseretry"]').click(); await sleep(60);
  assert.equal(ev(`caseOf(P("S01_pacient.pdf")).state`), "ready");
  assert.ok(w.document.querySelector(".gapsbtn.warn"));
  assert.deepEqual(errors, []);
}
// 5. Approval waits while the case data loads; a user switch clears loaded cases; at most five API-loaded cases stay.
{
  const srv = fakeServer({ held: false });
  const { w, ev, errors } = await apiOpen(srv);
  ev(`openPatient("10_pacient.pdf")`); await sleep(40);
  ev(`(() => { const pr = ensureProto(P("10_pacient.pdf")); pr.concl = "Test"; caseOf(P("10_pacient.pdf")).state = "loading"; action("approve"); })()`);
  assert.notEqual(ev(`ensureProto(P("10_pacient.pdf")).state`), "approved", "approval waits for the case data");
  ev(`caseOf(P("10_pacient.pdf")).state = "ready"`);
  // LRU over every processed case: list rows marked processed so each one loads.
  ev(`S.patients.forEach(p => { p.processing = "partial"; })`);
  for (const p of H.patients) { ev(`openPatient(${JSON.stringify(p.file)})`); await sleep(15); }
  await sleep(50);
  const apiLoaded = ev(`[...caseStore.entries.values()].filter(e => e.state === "ready" && !e.seeded).length`);
  assert.ok(apiLoaded <= 5, `at most five API-loaded cases (${apiLoaded})`);
  // A user switch clears them.
  const sel = w.document.getElementById("user"); sel.value = H.other; sel.dispatchEvent(new w.Event("change", { bubbles: true })); await sleep(80);
  assert.ok(ev(`[...caseStore.entries.values()].every(e => e.seeded || e.loadedAt > Date.now() - 200)`), "loaded cases were cleared on the user switch");
  assert.deepEqual(errors, []);
}

console.log("Case store: embedded seed, no network on Pages, the data-driven view and API mode (loading, stale replies, deep link, errors, retry, approval, LRU, user switch) passed.");
process.exit(0);
