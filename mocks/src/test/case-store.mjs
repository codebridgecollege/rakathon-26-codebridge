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

console.log("Case store: embedded seed, unprocessed cases and no network in embedded mode passed.");
process.exit(0);
