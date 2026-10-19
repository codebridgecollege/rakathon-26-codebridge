// What the brief's model may see and what of its answer is kept (src/extraction/brief.ts). The model is not called
// here: answers are written by hand, as a model could write them, including the ways it goes wrong.
import { describe, expect, it } from "vitest";
import { acceptBrief, briefFacts, briefPrompt, withheldAlert, writtenSort, type BriefAnswer, type DocumentSource, type Fact, type FactDate } from "../src/extraction/index";

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
    expect(out.dropped).toEqual([
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
    expect(unbacked.dropped).toEqual([{ sentence: "question", reasons: ["date"] }]);
  });
});

describe("withheldAlert", () => {
  it("lists the unverified facts of the brief's kinds the brief leaves out, never quarantined or relative's ones", () => {
    const a = withheldAlert(run, briefFacts(run))!;
    expect(a).toMatchObject({ rule: "brief_unverified_withheld", subject: "brief", kind: "unclear", facts: [unsure.id], message: { args: { count: 1 } } });
    expect(withheldAlert(run, briefFacts(run, { confirmed: [unsure.id] }))).toBeNull();
  });
});
