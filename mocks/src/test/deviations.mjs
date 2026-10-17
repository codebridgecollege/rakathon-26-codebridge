// Verify the built case observations, source IDs, historical editions and passive UI.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const read = path => readFileSync(new URL(path, import.meta.url), "utf8");
const template = read("../v3-template.html");
const built = read("../../v3.html");
const guide = JSON.parse(built.match(/<script id="guide-data" type="application\/json">([\s\S]*?)<\/script>/)[1]);
const extra = JSON.parse(read("../data/mock-case-10-extra.json"));
const observations = guide.deviation_findings;
assert.equal(observations.length, 4);
for (const finding of observations) {
  assert.equal(finding.severity, null);
  assert.ok(finding.clinical_consequence_cs);
  for (const i of finding.source_refs) {
    assert.equal(extra.refs[i].file, "10_pacient.pdf");
    assert.ok(extra.refs[i].quote);
  }
  for (const id of finding.statement_ids) assert.ok(guide.statements.some(x => x.id === id));
  if (finding.past_statement_id) {
    const st = guide.past_statements.find(x => x.id === finding.past_statement_id);
    assert.equal(st.edition.year, 2023);
    assert.ok(st.edition.valid_from <= st.decision_date && st.decision_date <= st.edition.valid_to);
  }
}
const esc = value => String(value ?? "").replace(/[&<>"']/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]);
const context = vm.createContext({ GUIDE: guide, EXTRA: extra, S: {retro: {}}, esc, DASH: '<span title="neuvedeno v dostupné dokumentaci">-</span>',
  fmtDate: String, pageOf: st => `s. ${st.printed_page || st.pdf_page}`, GL: id => guide.guidelines.find(x => x.id === id) || {}, PAST: () => guide.past_statements,
  anyStmt: id => [...guide.statements, ...guide.past_statements].find(x => x.id === id), R3: i => extra.refs[i], docTitle: ref => ref.file });
const a = template.indexOf("const SEV ="), b = template.indexOf("/* Cases the mock has not processed", a);
vm.runInContext(template.slice(a, b) + ";globalThis.view = {deviationFindings, retroList};", context);
const html = context.view.deviationFindings({file: "10_pacient.pdf"});
assert.equal([...html.matchAll(/data-deviation-finding=/g)].length, 4);
assert.doesNotMatch(html, /<(input|select|textarea)\b|data-dev=|data-retro=/);
assert.match(html, /při doložené toxicitě/);
assert.match(html, /Neznamená to, že nebyly provedeny nebo podány/);
assert.match(html, /provided the treatment is well tolerated/);
assert.match(html, /personalized and more lenient BP targets/);
assert.doesNotMatch(context.view.deviationFindings({file:"S01_pacient.pdf"}), /data-deviation-finding=/);
const history = [{v:"major",by:"Lékař A",when:"dříve"}, {v:"minor",by:"Lékař B",when:"později"}];
context.S.retro["10_pacient.pdf"] = {"past-nivo-ipi-regimen": {sev:"minor",sevBy:"Lékař B",sevWhen:"později", hist:{sev:history}}};
const rated = context.view.deviationFindings({file:"10_pacient.pdf"});
assert.match(rated, /Historie hodnocení \(2\)/);
assert.match(rated, /Lékař A/);
assert.match(rated, /Lékař B/);
assert.doesNotMatch(rated, /<(input|select|textarea)\b/);
context.S.retro["10_pacient.pdf"]["past-nivo-ipi-regimen"].assess = "";
context.S.retro["10_pacient.pdf"]["past-nivo-ipi-regimen"].hist.assess = [
  {v:"uncertain",by:"Lékař C",when:"dříve"}, {v:"",by:"Lékař D",when:"později"}
];
const cleared = context.view.retroList({file:"10_pacient.pdf"});
assert.match(cleared, /Lékař C/);
assert.match(cleared, /Lékař D/);
assert.match(html, /Tabulka 14, s. PDF 42/);
for (const x of guide.past_statements) {
  const rendered = context.view.retroList({file:"10_pacient.pdf"});
  assert.ok(rendered.includes(esc(x.quote)));
  assert.ok(rendered.includes(`${x.edition.pdf_url}#page=${x.pdf_page}`));
}
console.log("Case 10 passive deviations, sources, conditional quotes and prior rating history passed.");
