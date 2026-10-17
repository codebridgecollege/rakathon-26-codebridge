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

console.log("Case store: embedded seed, unprocessed cases, no network in embedded mode and the data-driven view passed.");
process.exit(0);
