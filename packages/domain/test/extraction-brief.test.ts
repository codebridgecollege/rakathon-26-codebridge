// What the brief's model may see and what of its answer is kept (src/extraction/brief.ts). The model is not called
// here: answers are written by hand, as a model could write them, including the ways it goes wrong.
import { describe, expect, it } from "vitest";
import { acceptBrief, briefFacts, briefPrompt, droppedAlert, withBriefAlerts, withheldAlert, writtenSort, type Alert, type BriefAnswer, type DocumentSource, type Fact, type FactDate } from "../src/extraction/index";

function date(as_written: string | null): FactDate {
  if (!as_written) return { as_written: null, precision: null, sort: null };
  const sort = writtenSort(as_written)!;
  return { as_written, precision: sort.length === 10 ? "day" : sort.length === 7 ? "month" : "year", sort };
}

const src = (id: string, document_id: string, quote: string): DocumentSource => ({ id, type: "document", document_id, part: null, page: 1, quote, quote_text: "pdf_text", anchor: null, reported_as: "original", identity: "matches", reading_check: null });

let n = 0;
function fact<K extends Fact["kind"]>(kind: K, value: Extract<Fact, { kind: K }>["value"], over: Partial<Fact> = {}): Fact {
  n++;
  return { id: `f-${String(n).padStart(8, "0")}`, key: `k${n}`, kind, subject: "patient", value, date: date(null), status: "documented", negated: false, not_stated: [], origin: "document", certainty: "clear", codes: [], note: null, quarantined: false, sources: ["s1"], ...over } as Fact;
}

const sources = [src("s1", "D1", "MR mozku 14.9.2026: solitární ložisko vpravo 3 mm"), src("s2", "D2", "bez metastáz v játrech")];
const mr = fact("imaging", { modality: "MR", region: "mozek", finding_text: "solitární ložisko vpravo do 3 mm", response: null }, { date: date("14.9.2026"), status: "done" });
const liver = fact("metastasis", { site: "játra", status: "excluded", basis: "imaging", text: "bez metastáz v játrech" }, { date: date("16.9.2026"), negated: true, sources: ["s2"] });
const unsure = fact("stage", { tnm_as_written: "pT2 pN1 MO", tnm: "pT2 pN1 M0", stage_kind: "pathological", edition: null, as_of: "2.6.2022", at_diagnosis: true }, { date: date("2.6.2022"), certainty: "verify" });
const relative = fact("family_history", { relation: "matka", condition: "karcinom prsu" }, { subject: "relative" });
const other = fact("imaging", { modality: "CT", region: "játra", finding_text: "metastázy", response: null }, { date: date("24.9.2026"), status: "done", quarantined: true });
const lab = fact("lab_result", { name_as_written: "K", value_as_written: "5,8", value_numeric: 5.8, unit_as_written: "mmol/l", unit: "mmol/l", reference_range: null, reference_low: null, reference_high: null, out_of_range: null, out_of_range_origin: null, draw: { as_written: null, requisition: null, specimen: null } });
const run = { facts: [mr, liver, unsure, relative, other, lab], sources };

describe("briefFacts and briefPrompt", () => {
  it("offers verified facts of the patient only: no unverified, quarantined, relative's or lab facts", () => {
    expect(briefFacts(run).map((f) => f.id)).toEqual([mr.id, liver.id]);
    // A doctor's confirmation makes an unverified fact usable.
    expect(briefFacts(run, { confirmed: [unsure.id] }).map((f) => f.id)).toEqual([unsure.id, mr.id, liver.id]);
  });

  it("lists the facts under short references, one part per document, with the negation spelled out", () => {
    const { parts, refs } = briefPrompt(briefFacts(run), sources, true);
    expect(parts).toEqual([
      { documentId: "D1", text: "Navrhnout otázku pro MDT: ano\n\nFakta:\n[F1] | zobrazení | 14.9.2026 | provedeno | MR mozek: solitární ložisko vpravo do 3 mm" },
      { documentId: "D2", text: "[F2] | metastáza | 16.9.2026 | ZÁPOR | bez metastáz v játrech" },
    ]);
    expect([...refs]).toEqual([["F1", mr.id], ["F2", liver.id]]);
  });
});

describe("acceptBrief", () => {
  const { refs } = briefPrompt(briefFacts(run), sources, true);
  const accept = (answer: BriefAnswer) => acceptBrief(answer, run, briefFacts(run), refs, { model: "m", prompt: "compose-brief-cs@1" });

  it("keeps sentences backed by their facts and drops each kind of unbacked one, never repairing it", () => {
    const out = accept({
      sentences: [
        { text: "Na MR mozku 14.9.2026 solitární ložisko vpravo do 3 mm.", facts: ["F1"] },
        { text: "V játrech bez metastáz.", facts: ["[F2]"] },
        { text: "Na MR mozku 14.9.2026 ložisko vlevo.", facts: ["F1"] },
        { text: "Na MR mozku ložisko do 5 mm.", facts: ["F1"] },
        { text: "Na MR mozku bez dalších ložisek.", facts: ["F1"] },
        { text: "Metastázy v játrech.", facts: ["F2"] },
        { text: "Ložisko 15.9.2026.", facts: ["F1"] },
        { text: "Ložisko.", facts: [] },
        { text: "Léčba everolimem.", facts: ["F1"] },
      ],
      question: null,
    });
    expect(out.brief!.sentences.map((s) => s.facts)).toEqual([[mr.id], [liver.id]]);
    expect(out.dropped.map(({ facts: _f, ...x }) => x)).toEqual([
      { sentence: 2, reasons: ["side"] },
      { sentence: 3, reasons: ["number"] },
      { sentence: 4, reasons: ["negation"] },
      { sentence: 5, reasons: ["negation"] },
      { sentence: 6, reasons: ["date"] },
      { sentence: 7, reasons: ["no_facts"] },
      { sentence: 8, reasons: ["drug"] },
    ]);
  });

  it("gives no brief at all when no sentence survives, and keeps a backed question as a draft with its basis", () => {
    const out = accept({
      sentences: [{ text: "Ložisko vlevo.", facts: ["F1"] }],
      question: { text: "Jaký postup u solitárního ložiska v mozku?", question_kind: "latest_finding", basis: [{ role: "finding", facts: ["F1"] }] },
    });
    expect(out.brief).toBeNull();
    expect(out.question).toEqual({ text: "Jaký postup u solitárního ložiska v mozku?", question_kind: "latest_finding", basis: [{ role: "finding", facts: [mr.id] }] });
    const unbacked = accept({ sentences: [], question: { text: "Jaký postup po MR z 1.10.2026?", question_kind: "latest_finding", basis: [{ role: "finding", facts: ["F1"] }] } });
    expect(unbacked.question).toBeNull();
    expect(unbacked.dropped).toEqual([{ sentence: "question", reasons: ["date"], facts: [mr.id] }]);
  });
});

describe("acceptBrief against what a sentence says about its facts", () => {
  const susp = fact("metastasis", { site: "pravá mozečková hemisféra", status: "suspected", basis: "imaging", text: "suspekce na solitární metastázu" }, { date: date("14.9.2026") });
  const req = fact("request", { what: "PET/CT s 18F-FET", request_kind: "exam", result_fact: null }, { date: date("1.10.2026"), status: "requested" });
  const hist = fact("histology", { specimen: "biopsie rekta", result_text: "adenokarcinom", tumour_type: null, grade: "G2" }, { date: date("12.3.2026") });
  const nodes = fact("histology", { specimen: "resekát", result_text: "0/14 uzlin s metastázou", tumour_type: null, grade: null }, { date: date("21.8.2026"), negated: true });
  const cStage = fact("stage", { tnm_as_written: "cT3b cN1 M0", tnm: "cT3b cN1 M0", stage_kind: "clinical", edition: null, as_of: "16.3.2026", at_diagnosis: true }, { date: date("16.3.2026") });
  const facts = [susp, req, hist, nodes, cStage];
  const refs = new Map(facts.map((f, i) => [`F${i + 1}`, f.id]));
  const check = (text: string, ...cited: string[]) => acceptBrief({ sentences: [{ text, facts: cited }], question: null }, { sources }, facts, refs, { model: "m", prompt: "p" }).dropped[0]?.reasons ?? [];

  it("keeps a suspicion a suspicion", () => {
    expect(check("MR 14.9.2026: suspekce na solitární metastázu v pravé mozečkové hemisféře.", "F1")).toEqual([]);
    expect(check("MR 14.9.2026 potvrdila metastázu v pravé mozečkové hemisféře.", "F1")).toContain("certainty");
  });

  it("never states a request as done, nor a gap", () => {
    expect(check("Vyžádáno PET/CT s 18F-FET.", "F2")).toEqual([]);
    expect(check("PET/CT s 18F-FET potvrdilo progresi.", "F2")).toContain("status");
    expect(check("PET/CT s 18F-FET neprovedeno.", "F2")).toContain("gap_wording");
  });

  it("never borrows a negation from another cited fact, and checks negating verbs", () => {
    expect(check("Histologie adenokarcinom G2 nepotvrdila; 0/14 uzlin s metastázou (negativní nález).", "F3", "F4")).toContain("negation");
    expect(check("Biopsie adenokarcinom neprokázala.", "F3")).toContain("negation");
  });

  it("keeps the stage's kind and time", () => {
    expect(check("Klinické stadium cT3b cN1 M0.", "F5")).toEqual([]);
    expect(check("Patologické stadium cT3b cN1 M0.", "F5")).toContain("stage_kind");
    expect(check("Současné stadium je cT3b cN1 M0.", "F5")).toContain("stage_kind");
  });

  it("checks abbreviations and drug names the facts do not hold", () => {
    expect(check("Adenokarcinom G2, léčba FOLFOX.", "F3")).toContain("abbreviation");
  });

  it("refuses a question that proposes its answer, and an answer of another shape", () => {
    const q = (text: string) =>
      acceptBrief({ sentences: [], question: { text, question_kind: "latest_finding", basis: [{ role: "finding", facts: ["F1"] }] } }, { sources }, facts, refs, { model: "m", prompt: "p" }).dropped[0]?.reasons ?? [];
    expect(q("Jaký postup u suspekce na metastázu v pravé mozečkové hemisféře?")).toEqual([]);
    expect(q("Je u suspekce na metastázu indikována radiochirurgie, že?")).toContain("recommendation");
    expect(acceptBrief({ sentences: null }, { sources }, facts, refs, { model: "m", prompt: "p" })).toEqual({ brief: null, question: null, dropped: [{ sentence: "question", reasons: ["invalid"], facts: [] }] });
  });
});

describe("droppedAlert and withBriefAlerts", () => {
  it("says how many sentences were dropped and links their facts; without a brief, no brief alert at all", () => {
    const { refs } = briefPrompt(briefFacts(run), sources, false);
    const accepted = acceptBrief({ sentences: [{ text: "Ložisko vpravo.", facts: ["F1"] }, { text: "Ložisko vlevo.", facts: ["F1"] }], question: null }, run, briefFacts(run), refs, { model: "m", prompt: "p" });
    expect(droppedAlert(accepted)).toMatchObject({ rule: "brief_sentences_dropped", kind: "unclear", facts: [mr.id], message: { args: { count: 1 } } });
    const withAlerts = withBriefAlerts({ ...run, alerts: [] as Alert[] }, briefFacts(run), accepted);
    expect(withAlerts.alerts.map((a) => a.rule).sort()).toEqual(["brief_sentences_dropped", "brief_unverified_withheld"]);
    expect(withBriefAlerts(withAlerts, briefFacts(run), null).alerts).toEqual([]);
  });
});

describe("withheldAlert", () => {
  it("lists the unverified facts of the brief's kinds the brief leaves out, never quarantined or relative's ones", () => {
    const a = withheldAlert(run, briefFacts(run))!;
    expect(a).toMatchObject({ rule: "brief_unverified_withheld", kind: "unclear", facts: [unsure.id], message: { args: { count: 1 } } });
    // The subject names the set: a newly withheld fact is a new alert, never covered by an earlier acknowledgement.
    const more = fact("metastasis", { site: "mozeček", status: "suspected", basis: "imaging", text: null }, { date: date("14.9.2026"), certainty: "verify" });
    const b = withheldAlert({ facts: [...run.facts, more] }, briefFacts(run))!;
    expect(b.id).not.toBe(a.id);
    // Findings first: the left-out metastasis leads the list.
    expect(b.facts).toEqual([more.id, unsure.id]);
    expect(withheldAlert(run, briefFacts(run, { confirmed: [unsure.id] }))).toBeNull();
  });
});
