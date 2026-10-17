// Regression checks for category filtering, source indexes and incomplete clinical dates.
// Run: node mocks/src/test/timeline-categories.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const template = readFileSync(new URL("../v3-template.html", import.meta.url), "utf8");
const extra = JSON.parse(readFileSync(new URL("../data/mock-case-10-extra.json", import.meta.url), "utf8"));
const categoryCode = template.slice(template.indexOf("const EVENT_CATEGORIES ="), template.indexOf("/* ---------- navigation ---------- */"));
const timelineCode = template.slice(template.indexOf("function timelineEvents("), template.indexOf("function tabOverview("));
// The case data is built by the page's own fromFullExtraction, which also maps the older timeline shape.
const extractionCode = template.slice(template.indexOf("function fromFullExtraction("), template.indexOf("function fromSyn("));
const context = vm.createContext({ S: { tlExcluded: new Set(), selTl: null }, esc: value => String(value ?? "").replace(/[&<>"']/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]) });
vm.runInContext(categoryCode + timelineCode + extractionCode + ";globalThis.api = { categoryOf, timelineCard, timelineEvents, setTimelineCategory, EVENT_CATEGORIES, icon, fromFullExtraction };", context);
const { api, S } = context;
let cd = api.fromFullExtraction("10_pacient.pdf", "NO-010", {}, extra);
assert.equal(api.EVENT_CATEGORIES.length, 9);
assert.equal(api.categoryOf({ category: "unrecognized", kind: "imaging" }), "clinical");
assert.equal(api.categoryOf({ kind: "histology" }), "pathology");
assert.match(api.icon("clinical"), /data-icon="stethoscope"/);
assert.match(api.icon("medication"), /data-icon="pill"/);
assert.match(api.icon("surgery"), /data-icon="scalpel"/); // our own scalpel, not Lucide's scissors (round 24)
assert.doesNotMatch(api.icon("surgery"), /<circle/);

// A filtered and sorted view must keep indexes into the original source array.
const expected = { imaging: [3, 7, 8, 10, 11, 13], systemic: [4, 5, 9, 12], surgery: [1, 2, 6], pathology: [], mdt: [14], clinical: [0, 15] };
for (const [category, indexes] of Object.entries(expected)) {
  api.setTimelineCategory("all", false);
  api.setTimelineCategory(category, true);
  const html = api.timelineCard(cd, true);
  assert.deepEqual([...html.matchAll(/data-tl="(\d+)"/g)].map(m => +m[1]), indexes, category);
  for (const i of indexes) assert.equal(api.timelineEvents(cd)[i].source.file, "10_pacient.pdf");
}
api.setTimelineCategory("all", true);
let html = api.timelineCard(cd, true);
assert.match(html, /4\/2022/); // Partial dates stay partial.
assert.match(html, /Bez data · plán/); // Undated MDT referral stays planned.
assert.match(html, /9\.10\.2026 · plán/); // A past scheduled date is not proof of completion.
assert.match(html, /type="checkbox" data-tl-category="laboratory" checked/);
assert.match(html, /type="checkbox" data-tl-category="medication" checked/);
assert.doesNotMatch(html, />K ověření</);

// Opt out of two categories independently, then restore only one of them.
api.setTimelineCategory("imaging", false);
api.setTimelineCategory("systemic", false);
html = api.timelineCard(cd, true);
assert.deepEqual([...html.matchAll(/data-tl="(\d+)"/g)].map(m => +m[1]), [0, 1, 2, 6, 15, 14]);
assert.equal(S.tlExcluded.size, 2);
api.setTimelineCategory("imaging", true);
assert.equal(S.tlExcluded.has("systemic"), true);
assert.equal([...api.timelineCard(cd, true).matchAll(/data-tl="(\d+)"/g)].length, 12);
api.setTimelineCategory("imaging", true);
assert.equal(S.tlExcluded.size, 1); // Repeated selection is idempotent.
api.setTimelineCategory("invalid", false);
assert.equal(S.tlExcluded.size, 1);
api.setTimelineCategory("all", false);
assert.match(api.timelineCard(cd, true), /Všechny kategorie jsou skryté/);
assert.equal([...api.timelineCard(cd, true).matchAll(/data-tl="(\d+)"/g)].length, 0);
api.setTimelineCategory("imaging", true);
api.setTimelineCategory("systemic", true);
assert.equal([...api.timelineCard(cd, true).matchAll(/data-tl="(\d+)"/g)].length, 10);
api.setTimelineCategory("all", true);
assert.equal(S.tlExcluded.size, 0);

// Exercise the legacy fallback with records ordered differently from their dates.
cd = api.fromFullExtraction("case.pdf", "NO-X", { timeline: [
  { type: "other", label_cs: "Kontrola", date: "3/2026", date_sort: "2026-03", source: { file: "case.pdf", page: 3 } },
  { type: "histology", label_cs: '<script>unsafe</script>', date: "2/2026", date_sort: "2026-02", source: { file: "case.pdf", page: 2 } },
  { type: "mdt", label_cs: "Plán MDT", date: null, date_sort: null, status: "planned", source: { file: "case.pdf", page: 1 } },
] }, {});
html = api.timelineCard(cd, true);
assert.deepEqual([...html.matchAll(/data-tl="(\d+)"/g)].map(m => +m[1]), [1, 0, 2]);
assert.match(html, /&lt;script&gt;unsafe&lt;\/script&gt;/);
assert.doesNotMatch(html, /<script>unsafe/);
api.setTimelineCategory("all", false);
api.setTimelineCategory("pathology", true);
assert.match(api.timelineCard(cd, true), /data-tl="1"/);
assert.equal(api.timelineEvents(cd)[1].source.page, 2);
api.setTimelineCategory("all", false);
api.setTimelineCategory("laboratory", true);
assert.match(api.timelineCard(cd, true), /nejsou zaznamenané události/);
console.log("Timeline category regression checks passed.");
