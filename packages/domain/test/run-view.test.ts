// The adapter from a codebridge.extraction/2 run to the case view (run-view.ts), against the three converted runs.
// For case 10 it is compared part by part with today's view of the old fixtures (old-view.ts, the builders the app used before):
// equal where the view must stay the same, and every intended difference is asserted as such below, so a change in
// either is a deliberate one. The documents list is fed the parts the way D1 stores them (document_parts has no
// embedded_in_cs).
// JSON imports, as the other tests here: the package has no Node types.
import { describe, expect, it } from "vitest";
import { fromExtraction, sectionsOf, tabsFor, type CaseData, type Item } from "../src/case-data";
import { fromFullExtraction, fromSyn } from "./old-view";
import { warningEntries } from "../src/case-view";
import type { ExtractionRun, Fact } from "../src/extraction/types";
import { validateRun } from "../src/extraction/validate";
import { alertArgs, factDisplay, factRefs, factText, fromRun, negationShown, type DocInfo } from "../src/run-view";

import run10 from "../../../fixtures/data/runs/NO-010.json";
import runS01 from "../../../fixtures/data/runs/NO-S01.json";
import runS02 from "../../../fixtures/data/runs/NO-S02.json";
import case10 from "../../../fixtures/data/mock-case-10.json";
import extra10 from "../../../fixtures/data/mock-case-10-extra.json";
import synS01 from "../../../fixtures/data/mock-case-S01.json";
import synS02 from "../../../fixtures/data/mock-case-S02.json";

const RUNS: Record<string, unknown> = { "NO-010": run10, "NO-S01": runS01, "NO-S02": runS02 };
const SYN: Record<string, unknown> = { S01: synS01, S02: synS02 };
// A fresh copy per use, so a test that changes a run does not change the next one's.
const runOf = (id: string): ExtractionRun => JSON.parse(JSON.stringify(RUNS[id]));

const C = case10 as Item;
const E = extra10 as Item;
// D1 document_parts keeps title, type, date, date note, pages, readability and reason, not embedded_in_cs.
const d1Parts = (docs: Item[]) => docs.map(({ title_cs, type, date, date_note_cs, pages, readability, reason_cs }) => ({ title_cs, type, date, date_note_cs, pages, readability, reason_cs }));
const DOCS10: DocInfo[] = [{ id: "10_pacient", file: "10_pacient.pdf", page_count: C.page_count, note_cs: E.documents_note_cs, parts: d1Parts(E.documents) }];
const OLD = fromFullExtraction("10_pacient.pdf", "NO-010", C, E) as unknown as CaseData & { alerts: { flags: Item[]; gaps: Item[] } };
const NEW = fromExtraction("10_pacient.pdf", "NO-010", runOf("NO-010"), DOCS10);
const quoteOf = (cd: CaseData, i: number) => cd.refs[i]!.quote;

describe("case 10: the same view as before, from facts", () => {
  it("is a full case with the same tabs", () => {
    expect(NEW.level).toBe("full");
    expect(tabsFor(sectionsOf(NEW))).toEqual(tabsFor(sectionsOf(OLD)));
  });

  it("refs are the run's sources, each a file, page, verbatim quote and part", () => {
    const run = runOf("NO-010");
    expect(NEW.refs).toHaveLength(run.sources.length);
    expect(NEW.refs[0]).toEqual({ file: "10_pacient.pdf", page: run.sources[0]!.type === "document" ? run.sources[0]!.page : 0, quote: (run.sources[0] as { quote: string }).quote, part: "10_pacient/p0" });
  });

  it("onco lines: today's 16 lines, same text, date, kind and order, each keyed by its line ID", () => {
    const a: Item[] = OLD.record!.onco_compact!.lines;
    const b: Item[] = NEW.record!.onco_compact!.lines;
    expect(b.map((l) => l.text_cs)).toEqual(a.map((l) => l.text_cs));
    expect(b.map((l) => l.date_sort)).toEqual(a.map((l) => l.date_sort));
    expect(b.map((l) => l.kind)).toEqual(a.map((l) => l.kind));
    expect(b.map((l) => l.note_cs)).toEqual(a.map((l) => l.note_cs ?? null));
    expect(b.every((l) => /^v:vl-[0-9a-f]{8}$/.test(l.key) && l.fact_ids.length > 0)).toBe(true);
    expect(new Set(b.map((l) => l.key)).size).toBe(b.length);
    expect(NEW.record!.onco_compact!.other_dx_cs).toBe(OLD.record!.onco_compact!.other_dx_cs);
    // The e2e test's line.
    expect(b[12]!.text_cs).toMatch(/^3\. paliativní linie everolimus 5 mg denně/);
  });

  it("onco lines: every passage today's line cites is among the new line's sources", () => {
    const a: Item[] = OLD.record!.onco_compact!.lines;
    const b: Item[] = NEW.record!.onco_compact!.lines;
    // Intended difference: a line now lists the sources of all its facts, so some lines gain passages. The old
    // quotes were trimmed variants, so they are compared by the new quote containing the old one's start.
    a.forEach((l: Item, i: number) => {
      const now = b[i]!.refs.map((r: number) => String(quoteOf(NEW, r)).replace(/\s+/g, " "));
      for (const r of l.refs) {
        const head = String(quoteOf(OLD, r)).replace(/\s+/g, " ").slice(0, 12);
        expect(now.some((q: string) => q.includes(head)), `line ${i}: ${head}`).toBe(true);
      }
    });
  });

  it("timeline: today's 16 cards with the same title, text, detail, date, status and category", () => {
    const a = OLD.record!.timeline;
    const b = NEW.record!.timeline;
    expect(b).toHaveLength(16);
    expect(b.map((t) => [t.title_cs, t.text_cs, t.detail_cs, t.date, t.date_sort, t.status])).toEqual(a.map((t) => [t.title_cs, t.text_cs, t.detail_cs, t.date, t.date_sort, t.status]));
    // Category: today's kinds "diagnosis" and "visit" are the category "clinical" (categoryOf's aliases).
    expect(b.map((t) => t.category)).toEqual(a.map((t) => ({ diagnosis: "clinical", visit: "clinical" })[t.kind as string] ?? t.kind));
    expect(new Set(b.map((t) => t.category)).size).toBe(6);
  });

  it("current state: the same exam, subjective items, ECOG, the clinical negative and objective findings in the same order", () => {
    const a = OLD.record!.status_praesens!;
    const b = NEW.record!.status_praesens!;
    expect(b.exam_title_cs).toBe(a.exam_title_cs);
    expect(b.exam_date_cs).toBe(a.exam_date_cs);
    const group = (cd: Item, g: string) => cd.items.filter((i: Item) => i.group === g).map((i: Item) => i.text_cs);
    expect(group(b, "subjective")).toEqual(group(a, "subjective"));
    // Today's vitals item bundled every measurement in one string; now each is its own fact (EXTRACTION-FORMAT.md).
    // Exam findings compared by kind, so a finding that happens to hold a unit is not filtered out of the comparison.
    const exam = (cd: Item) => cd.items.filter((i: Item) => i.group === "objective" && i.kind !== "vital_sign").map((i: Item) => i.text_cs);
    expect(exam(b)).toEqual(group(a, "objective").filter((t: string) => !t.startsWith("krevní tlak")));
    expect(group(b, "status").sort()).toEqual(group(a, "status").sort());
    const bp = b.items.find((i: Item) => i.what === "blood_pressure");
    const pulse = b.items.find((i: Item) => i.what === "pulse");
    expect([bp?.text_cs, pulse?.text_cs]).toEqual(["155/70 mmHg", "68/min"]);
    expect(b.items.find((i: Item) => i.what === "ecog")?.text_cs).toBe("1");
    const brain = b.items.find((i: Item) => i.kind === "metastasis");
    expect(brain).toMatchObject({ text_cs: "bez klinických známek mozkových metastáz", negated: true, group: "status" });
  });

  it("anamnesis: the same comorbidities, current drugs and epidemiology, with the listed differences", () => {
    const a = OLD.record!.anamnesis!;
    const b = NEW.record!.anamnesis!;
    const line = (x: Item) => (x.drug_cs ? [x.drug_cs, x.strength_cs, x.dosing_cs].filter(Boolean).join(" ") : x.comment_cs ? `${x.term_cs}, ${x.comment_cs}` : x.term_cs);
    // OA: the fact texts; "Dušnost" and the peripheral artery line are worded by their facts, and the brain MR's
    // Fazekas gliosis, a comorbidity fact, joins the list.
    const same = ["Hypertenzní nemoc", "Hyperlipoproteinémie, na dietě", "Hyperglykémie nalačno, anamnesticky", "Korové cysty ledvin", "Cysta jater v segmentu S2", "Hypokalcémie, léčena Calcichew", "Mírná hyperkalémie, dietní opatření, pacient poučen"];
    for (const t of same) {
      expect(a.OA!.map(line)).toContain(t);
      expect(b.OA!.map(line)).toContain(t);
    }
    expect(b.OA!.map(line)).toContain("Gliózy supratentoriálně Fazekas gr. III");
    // FA: every drug line of today, plus the planned everolimus 10 mg and the second Spiriva dosing as their own lines.
    for (const m of a.FA!) expect(b.FA!.map(line)).toContain(line(m).replace(/^Novetron 8 mg 1-0-1$/, "Novetron 8 mg 1-0-1 á 12 hod."));
    expect(b.FA!.filter((m) => m.drug_cs === "Spiriva (inhalačně)").map((m) => [m.dosing_cs, m.certainty])).toEqual([["1-0-1", "unclear_ocr"], ["2-0-0", "unclear_ocr"]]);
    expect(b.FA!.find((m) => m.dosing_cs === "2-0-0" && /Everolimus/.test(m.drug_cs))).toMatchObject({ change_status: "planned_unconfirmed" });
    expect(b.FA!.some((m) => /prednison/i.test(m.drug_cs))).toBe(false);
    expect(b.FA_warnings!.map(line)).toEqual(["ACE inhibitory při léčbě everolimem, pro zvýšené riziko anafylaxe"]);
    expect(b.EA!.map(line)).toEqual(a.EA!.map(line));
    expect(b.abusus!.map(line)).toEqual(["fumátor (kuřák)"]);
    expect(b.abusus![0]!.pack_years_cs).toBeNull();
    // preventive: no fact kind holds a preventive exam, so the section is not checked (it was the colonoscopy plan).
    expect(b.preventive).toEqual([]);
    expect(NEW.run!.sections.preventive!.result).toBe("not_run");
    for (const k of ["RA", "PA", "SA", "AA"]) expect(b[k]).toEqual([]);
    expect(NEW.run!.sections.AA!.result).toBe("nothing_found");
    expect(NEW.run!.sections.RA!.result).toBe("nothing_found");
    expect(NEW.run!.sections.PA!.result).toBe("nothing_found");
  });

  it("anamnesis items are keyed by fact ID, never by position", () => {
    const all = Object.values(NEW.record!.anamnesis!).flat();
    expect(all.every((x) => /^f:f-[0-9a-f]{8}$/.test(x.key))).toBe(true);
  });

  it("documents: the same list, titles, pages, readability and note; cited parts are marked", () => {
    const strip = (d: Item) => ({ ...d, embedded_in_cs: undefined, file: undefined, part_id: undefined, cited: undefined });
    expect(NEW.documents!.documents.map(strip)).toEqual(OLD.documents!.documents.map(strip));
    expect(NEW.documents!.pages).toBe(OLD.documents!.pages);
    expect(NEW.documents!.note).toBe(OLD.documents!.note);
    // Cited parts (an exam quoted in the outpatient report) come from the sources' reported_as. Intended difference:
    // the run marks the quoted internal and pulmonary exams as the report's own text, so those two lose the label.
    const cited = NEW.documents!.documents.filter((d) => d.cited).map((d) => d.title_cs);
    const embedded = OLD.documents!.documents.filter((d) => d.embedded_in_cs).map((d) => d.title_cs);
    expect(embedded.filter((t) => !cited.includes(t))).toEqual(["Interní vyšetření 10.2.2026 NNJ (dušnost)", "Plicní vyšetření 22.5.2026 MUDr. Hofrová"]);
    expect(cited.every((t) => embedded.includes(t))).toBe(true);
  });

  it("labs: the same 26 values from one undated sheet, no series", () => {
    const a = OLD.labs!.values;
    const b = NEW.labs!.values;
    expect(NEW.labs!.series).toBeNull();
    const key = (l: Item) => [l.code, l.name_cs, l.value, l.unit, l.reference_range, l.out_of_range ?? null, l.source.page, l.certainty];
    expect(b.map(key)).toEqual(a.map(key));
    // The quote is the page text verbatim (a line break stays), today's was trimmed onto one line.
    b.forEach((l, i) => expect(String(l.source.quote).replace(/\s+/g, " ")).toContain(String(a[i]!.source.quote).replace(/\s+/g, " ")));
  });

  it("headline: the stage at diagnosis from the stage fact, with its verify mark", () => {
    const d = NEW.brief!.dx_headline!;
    expect(d).toMatchObject({ grade_cs: "G2", tnm_cs: "pT2a pN1 M0", tnm_as_written: "pT2a pN1(3+/5) MO", stage_kind: "pathological", stage_at_diagnosis: true, histology_date_cs: "2.6.2022", mkn_cs: "C64 Zhoubný novotvar ledviny mimo pánvičku", certainty: "unclear_ocr" });
    expect(d.ocr_note_cs).toMatch(/MO/);
    // Intended difference: the histology is the fact's tumour type ("vpravo" was today's hand-written addition).
    expect(d.histology_cs).toBe("Světlobuněčný renální adenokarcinom");
  });

  it("alerts: one list keyed by alert ID with Fluent messages; today's flags and gaps are all covered", () => {
    const flags = NEW.alerts!.flags;
    expect(flags).toHaveLength(21);
    expect(flags.every((f) => /^al-[0-9a-f]{8}$/.test(f.id) && /^alert-/.test(f.message.id))).toBe(true);
    expect(new Set(flags.map((f) => f.kind))).toEqual(new Set(["missing", "unclear", "contradiction", "chronology"]));
    // Missing-document alerts are always on: today's three relevant alerts stay relevant.
    const rel = new Set(flags.filter((f) => f.relevant).map((f) => f.rule));
    for (const r of ["mdt_question_missing", "original_report_missing", "suspicion_not_verified"]) expect(rel.has(r)).toBe(true);
    // The alert's key in the view and the history is its ID, not its position.
    expect(warningEntries(NEW.alerts).map((e) => e.i)).toEqual(flags.map((f) => f.id));
  });

  it("brief: today's sentences with a marker per fact, in order", () => {
    const sentences = runOf("NO-010").brief!.sentences;
    const text = NEW.brief!.text_cs!;
    let at = 0;
    for (const s of sentences) {
      const i = text.indexOf(s.text, at);
      expect(i, s.text).toBeGreaterThanOrEqual(at);
      at = i + s.text.length;
    }
    expect(NEW.brief!.refs.length).toBeGreaterThan(0);
    expect(NEW.brief!.sentences).toHaveLength(sentences.length);
  });

  it("checks per section: found, nothing_found and not_run as the run says, with the unreadable pages", () => {
    const s = NEW.run!.sections;
    expect(s.labs!.result).toBe("found");
    expect(s.imaging!.result).toBe("found");
    expect(s.imaging!.unreadable.map((u) => u.page)).toEqual([4, 5]);
    expect(s.OA!.result).toBe("found");
  });
});

describe("S01 and S02: labs, alerts and documents, as before", () => {
  const syn = (id: string) => SYN[id] as Item;
  const docsOf = (s: Item, id: string): DocInfo[] => [{ id: `${id}_pacient`, file: `${id}_pacient.pdf`, page_count: s.list_entry?.page_count ?? null, note_cs: null, parts: d1Parts(s.documents) }];
  for (const id of ["S01", "S02"]) {
    const s = syn(id);
    const old = fromSyn(s, `${id}_pacient.pdf`, `NO-${id}`) as unknown as CaseData & { alerts: { flags: Item[]; gaps: Item[] } };
    const cd = fromRun(`${id}_pacient.pdf`, `NO-${id}`, runOf(`NO-${id}`), docsOf(s, id));

    it(`${id}: partial, no record, the same tabs`, () => {
      expect(cd.level).toBe("partial");
      expect(cd.record).toBeNull();
      expect(cd.brief).toBeNull();
      expect(tabsFor(sectionsOf(cd))).toEqual(tabsFor(sectionsOf(old)));
    });

    it(`${id}: the same lab series, draws and points`, () => {
      const a = old.labs!.series!;
      const b = cd.labs!.series!;
      expect(b.draws.map((d) => [d.date, d.time])).toEqual(a.draws.map((d) => [d.date, d.time]));
      expect(b.tests.map((t) => t.code).sort()).toEqual(a.tests.map((t) => t.code).sort());
      for (const t of a.tests) {
        const n = b.tests.find((x) => x.code === t.code)!;
        expect([n.name_cs, n.unit, n.reference_range]).toEqual([t.name_cs, t.unit, t.reference_range]);
        expect(n.points!.map((p) => [p.date, p.time, p.value, p.out_of_range ?? null])).toEqual(t.points!.map((p) => [p.date, p.time, p.value, p.out_of_range ?? null]));
      }
      expect(cd.labs!.values).toEqual([]);
    });

    it(`${id}: the same documents`, () => {
      const strip = (d: Item) => ({ title_cs: d.title_cs, type: d.type, date: d.date, pages: d.pages, readability: d.readability, reason_cs: d.reason_cs });
      expect(cd.documents!.documents.map(strip)).toEqual(old.documents!.documents.map(strip));
    });

    it(`${id}: every old data gap is covered by an alert of the same kind`, () => {
      const kinds = new Set(cd.alerts!.flags.map((f) => f.kind));
      for (const g of old.alerts!.gaps) expect(kinds.has(g.kind)).toBe(true);
    });
  }
});

describe("rules that keep the view honest", () => {
  const base = () => runOf("NO-010");

  it("a quarantined fact appears nowhere: not as a fact, not in a composed line or sentence, not through its sources", () => {
    const run = base();
    const f = run.facts.find((x) => x.kind === "comorbidity" && x.value.text === "Hypertenzní nemoc")!;
    f.quarantined = true;
    // The histology of the nephrectomy too: onco line 0, timeline card 1 and the first brief sentence rest on it.
    const h = run.facts.find((x) => x.kind === "histology" && x.date.as_written === "2.6.2022")!;
    h.quarantined = true;
    const cd = fromRun("10_pacient.pdf", "NO-010", run, DOCS10);
    const all = JSON.stringify(cd).toLowerCase();
    expect(all).not.toContain(f.id);
    expect(all).not.toContain(h.id);
    // The other-diagnoses line names hypertension, so it goes; so do the lines and the sentence over the histology.
    expect(all).not.toContain("hypertenzní nemoc");
    expect(cd.record!.onco_compact!.other_dx_cs).toBeNull();
    expect(cd.record!.onco_compact!.lines).toHaveLength(15);
    expect(cd.record!.timeline).toHaveLength(15);
    expect(cd.brief!.text_cs).not.toMatch(/^Pacient s metastatickým/);
    expect(cd.run!.view_line_ids).toHaveLength(16 + 16 + 1 - 3);
    const onlyHere = [...f.sources, ...h.sources].filter((s) => !run.facts.some((o) => o !== f && o !== h && o.sources.includes(s)));
    for (const s of onlyHere) expect(cd.refs.map((r) => r.quote)).not.toContain((run.sources.find((x) => x.id === s) as { quote: string }).quote);
  });

  it("an alert resting only on facts the view may not show is not shown; a document check of such a fact neither", () => {
    const run = base();
    const req = run.facts.find((x) => x.kind === "request")!;
    req.quarantined = true;
    const cd = fromRun("10_pacient.pdf", "NO-010", run, DOCS10);
    expect(cd.alerts!.flags.some((a) => a.rule === "request_without_result")).toBe(false);
    for (const c of Object.values(cd.run!.checks)) expect(c.expected?.of_fact).not.toBe(req.id);
  });

  it("a run without composed views is shown fact by fact, keyed by fact ID", () => {
    const run = base();
    delete run.views;
    expect(validateRun(run).ok).toBe(true);
    const cd = fromRun("10_pacient.pdf", "NO-010", run, DOCS10);
    const lines: Item[] = cd.record!.onco_compact!.lines;
    expect(lines.length).toBeGreaterThan(16);
    expect(lines.every((l) => /^f:f-/.test(l.key) && l.fact_ids.length === 1)).toBe(true);
    // Dated first, by date; planned lines never read as performed.
    const dated = lines.filter((l) => l.date_sort).map((l) => l.date_sort);
    expect(dated).toEqual([...dated].sort());
    expect(lines.filter((l) => l.status === "planned").every((l) => l.kind === "plan")).toBe(true);
    const tl = cd.record!.timeline;
    expect(tl.some((t) => t.fact_kind === "visit")).toBe(true);
    // Undated events are kept (the timeline shows them under "Bez data").
    expect(tl.some((t) => !t.date_sort && t.fact_kind === "imaging")).toBe(true);
    expect(tl.find((t) => t.fact_kind === "visit" && t.status === "planned")).toBeTruthy();
  });

  it("an unknown fact kind is a plain fact: its text, no crash", () => {
    expect(factText({ kind: "tumour_board", value: { text: "projednáno" } })).toBe("projednáno");
    expect(factText({ kind: "x", value: { a: "jedna", b: 2, c: "dvě" } })).toBe("jedna dvě");
    const run = base();
    run.facts.push({ ...run.facts[0]!, id: "f-0000aaaa", kind: "tumour_board", value: { text: "projednáno" } } as unknown as Fact);
    expect(() => fromRun("10_pacient.pdf", "NO-010", run, DOCS10)).not.toThrow();
  });

  it("a section shows 'nothing found' when its check found facts none of which the section lists, and 'found' when it lists some", () => {
    const run = base();
    // Only the smoking risk factor: the shared risk-factor check found something, but nothing epidemiological.
    run.facts = run.facts.filter((f) => !(f.kind === "risk_factor" && f.value.type === "epidemiology"));
    run.alerts = run.alerts.filter((a) => a.facts.every((id) => run.facts.some((f) => f.id === id)));
    const cd = fromRun("10_pacient.pdf", "NO-010", run, DOCS10);
    expect(cd.run!.sections.EA!.result).toBe("nothing_found");
    expect(cd.run!.sections.abusus!.result).toBe("found");
  });

  it("labs: one series per test and unit; a value dated only to a month stays a table row", () => {
    const run = runOf("NO-S01");
    const krea = run.facts.filter((f) => f.kind === "lab_result" && f.codes[0]?.code === "B_LKC");
    (krea[0]!.value as { unit: string }).unit = "G/l";
    const cd = fromRun("S01_pacient.pdf", "NO-S01", run);
    const tests = cd.labs!.series!.tests.filter((t) => t.code === "B_LKC");
    expect(tests.map((t) => [t.unit, t.points!.length])).toEqual([["G/l", 1], ["10^9/l", 3]]);
    const m = runOf("NO-S01");
    const f = m.facts.find((x) => x.kind === "lab_result")!;
    f.date = { as_written: "1/2026", precision: "month", sort: "2026-01" };
    const cd2 = fromRun("S01_pacient.pdf", "NO-S01", m);
    expect(cd2.labs!.values.map((v) => v.fact_ids[0])).toEqual([f.id]);
  });

  it("without a drafted question the alerts on the latest finding come first", () => {
    const run = base();
    run.question_draft = null;
    const cd = fromRun("10_pacient.pdf", "NO-010", run, DOCS10);
    // The latest dated finding is the brain MR of 14.9.2026; its missing original report is relevant.
    expect(cd.alerts!.flags.filter((a) => a.relevant).map((a) => a.rule)).toContain("original_report_missing");
  });

  it("a negated fact whose text holds no negation is flagged for a negation label", () => {
    const pe = runOf("NO-010").facts.find((f) => f.kind === "diagnosis" && f.negated)!;
    expect(factText(pe)).toBe("plicní embolie");
    expect(negationShown(factText(pe))).toBe(false);
    expect(negationShown("bez klinických známek mozkových metastáz")).toBe(true);
    const cd = fromRun("10_pacient.pdf", "NO-010", runOf("NO-010"), DOCS10);
    const item = cd.record!.sections!.clinical_finding!.concat(...Object.values(cd.record!.sections!)).find((i) => i.fact_ids[0] === pe.id);
    expect(item).toMatchObject({ negated: true, text_cs: "plicní embolie", negation_label: true });
    // Without composed views the timeline shows it as its own event, with the label; the text alone never reads as present.
    const run = runOf("NO-010");
    delete run.views;
    const ev = fromRun("10_pacient.pdf", "NO-010", run, DOCS10).record!.timeline.find((t) => t.fact_ids?.[0] === pe.id);
    expect(ev).toMatchObject({ negated: true, negation_label: true });
    // A metastasis whose text says the negation itself needs no label.
    const brain = cd.record!.status_praesens!.items.find((i: Item) => i.kind === "metastasis");
    expect(brain.negation_label).toBe(false);
  });

  it("an alert's sources are its visible facts' passages; an identity alert names no quarantined content", () => {
    const run = base();
    const f = run.facts.find((x) => x.kind === "symptom" && x.negated)!;
    f.quarantined = true;
    run.alerts.push({ id: "al-00000001", rule: "page_identity_conflict", subject: "10_pacient/p2#4", kind: "identity", facts: [f.id], message: { id: "alert-identity-conflict", args: { document: "10_pacient/p2", page: 4 } }, note: null });
    const cd = fromRun("10_pacient.pdf", "NO-010", run, DOCS10);
    const id = cd.alerts!.flags.find((a) => a.kind === "identity")!;
    expect(id.fact_ids).toEqual([]);
    expect(id.based_on).toEqual([]);
    expect(id.message.args).toEqual({ document: "10_pacient/p2", page: 4 });
  });

  it("alert arguments: a fact ID becomes its line, a document or part its title; a fact the view lacks is said and listed", () => {
    const t = (id: string, args?: Record<string, string | number>) => (args ? `${id}${JSON.stringify(args)}` : id);
    const req = NEW.alerts!.flags.find((a) => a.rule === "request_without_result")!;
    expect(alertArgs(NEW, req, t)).toEqual({ args: { fact: "projednání nálezu MR mozku na neurochirurgickém semináři" }, unresolved: [] });
    const page = NEW.alerts!.flags.find((a) => a.rule === "document_date_not_stated")!;
    expect(alertArgs(NEW, page, t).args.document).toBe("Ambulantní vyšetření kontrolní: subjektivně, objektivní nález, přehled vyšetření");
    const gone = { ...req, message: { id: req.message.id, args: { fact: "f-00000000" } } };
    expect(alertArgs(NEW, gone, t)).toEqual({ args: { fact: "patient-alert-fact-unavailable" }, unresolved: ["f-00000000"] });
    // A negated fact whose text does not say so is labelled.
    const pe = runOf("NO-010").facts.find((f) => f.kind === "diagnosis" && f.negated)!;
    expect(factDisplay(pe, t)).toBe('patient-fact-negated{"text":"plicní embolie"}');
  });

  it("guideline fact IDs resolve to their passages; an ID the run does not hold is flagged, not hidden", () => {
    const mr = runOf("NO-010").facts.find((f) => f.kind === "imaging" && f.date.as_written === "14.9.2026")!;
    const r = factRefs(NEW, [mr.id, "f-00000000"]);
    expect(r.refs.length).toBe(mr.sources.length);
    expect(r.unresolved).toEqual(["f-00000000"]);
  });

  it("without the document list the parts are named by ID, so a source still opens", () => {
    const cd = fromRun("10_pacient.pdf", "NO-010", runOf("NO-010"));
    expect(cd.documents!.documents[0]).toMatchObject({ title_cs: "10_pacient/p0", file: "10_pacient.pdf" });
    expect(cd.documents!.pages).toBeNull();
  });
});
