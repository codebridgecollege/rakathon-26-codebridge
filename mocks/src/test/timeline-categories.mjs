// Regression checks for category filtering, source indexes and incomplete clinical dates.
// Run: node mocks/src/test/timeline-categories.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const template = readFileSync(new URL("../v3-template.html", import.meta.url), "utf8");
const extra = JSON.parse(readFileSync(new URL("../data/mock-case-10-extra.json", import.meta.url), "utf8"));
const categoryCode = template.slice(template.indexOf("const EVENT_CATEGORIES ="), template.indexOf("/* ---------- navigation ---------- */"));
const timelineCode = template.slice(template.indexOf("function timelineEvents()"), template.indexOf("function tabOverview()"));
const context = vm.createContext({ EXTRA: extra, CASE: {}, S: { tlCategory: "all", selTl: null }, esc: value => String(value ?? "").replace(/[&<>"']/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]) });
vm.runInContext(categoryCode + timelineCode + ";globalThis.api = { categoryOf, timelineCard, timelineEvents, EVENT_CATEGORIES, icon };", context);
const { api, S } = context;
assert.equal(api.EVENT_CATEGORIES.length, 9);
assert.equal(api.categoryOf({ category: "unrecognized", kind: "imaging" }), "clinical");
assert.equal(api.categoryOf({ kind: "histology" }), "pathology");
assert.match(api.icon("clinical"), /data-icon="stethoscope"/);
assert.match(api.icon("medication"), /data-icon="pill"/);

// A filtered and sorted view must keep indexes into the original source array.
const expected = { imaging: [3, 7, 8, 10, 11, 13], systemic: [4, 5, 9, 12], surgery: [1, 2, 6], pathology: [], mdt: [14], clinical: [0, 15] };
for (const [category, indexes] of Object.entries(expected)) {
  S.tlCategory = category;
  const html = api.timelineCard(true);
  assert.deepEqual([...html.matchAll(/data-tl="(\d+)"/g)].map(m => +m[1]), indexes, category);
  for (const i of indexes) assert.equal(api.timelineEvents()[i].source.file, "10_pacient.pdf");
}
S.tlCategory = "all";
let html = api.timelineCard(true);
assert.match(html, /4\/2022/); // Partial dates stay partial.
assert.match(html, /Bez data · plán/); // Undated MDT referral stays planned.
assert.match(html, /9\.10\.2026 · plán/); // A past scheduled date is not proof of completion.
assert.match(html, /data-tl-category="laboratory"[^>]*disabled/);
assert.match(html, /data-tl-category="medication"[^>]*disabled/);
assert.doesNotMatch(html, />K ověření</);

// Exercise the legacy fallback with records ordered differently from their dates.
context.EXTRA = {};
context.CASE = { timeline: [
  { type: "other", label_cs: "Kontrola", date: "3/2026", date_sort: "2026-03", source: { file: "case.pdf", page: 3 } },
  { type: "histology", label_cs: '<script>unsafe</script>', date: "2/2026", date_sort: "2026-02", source: { file: "case.pdf", page: 2 } },
  { type: "mdt", label_cs: "Plán MDT", date: null, date_sort: null, status: "planned", source: { file: "case.pdf", page: 1 } },
] };
html = api.timelineCard(true);
assert.deepEqual([...html.matchAll(/data-tl="(\d+)"/g)].map(m => +m[1]), [1, 0, 2]);
assert.match(html, /&lt;script&gt;unsafe&lt;\/script&gt;/);
assert.doesNotMatch(html, /<script>unsafe/);
S.tlCategory = "pathology";
assert.match(api.timelineCard(true), /data-tl="1"/);
assert.equal(api.timelineEvents()[1].source.page, 2);
S.tlCategory = "laboratory";
assert.match(api.timelineCard(true), /nejsou zaznamenané události/);
console.log("Timeline category regression checks passed.");
