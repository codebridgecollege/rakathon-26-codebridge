// The server-side checks of the fact extraction (src/domain/extract), with hand-written model answers over synthetic
// page text: what is kept, what is "verify", what is dropped, and how sources are anchored.
import { describe, expect, it } from "vitest";
import { validateRun } from "@codebridge/domain/extraction/validate";
import { buildFromAnswer, findQuote, normalizeTnm, type PageReading } from "../src/domain/extract/build";
import { parseDate } from "../src/domain/extract/dates";
import { pageIdentity } from "../src/domain/extract/identity";
import type { ModelFact } from "../src/domain/extract/schema";
import { pseudonymize, type CaseIdentity } from "../src/domain/pseudonymize";

const ID: CaseIdentity = { patientNames: ["Věra Lipenská"], birthNumber: "585614/1234", birthDate: null, staffNames: ["Novák"] };

const P1 = `Chirurgická ambulance
Lipenská Věra, nar. 14.6.1958, r.č. 585614/1234, poj. 111
Diagnózy: C20 Zhoubný novotvar konečníku
Adenokarcinom rekta, G2, diag. 3/2026
CT hrudníku a břicha 17.3.2026: bez známek vzdálených metastáz
Stadium před léčbou: cT3b cN1 cM0 (MR pánve 16.3.2026)
7.10.2026 odeslána žádanka na CT hrudníku, břicha a pánve, t.č. výsledek nemáme
DM neguje. Kontrola u MUDr. Nováka.`;
const P2 = `Radiodiagnostické oddělení
Vrbenská Lenka, nar. 18.4.1959, r.č. 595418/1002
CT břicha 24.9.2026: metastatické postižení jater.`;

const page = (n: number, text: string, over: Partial<PageReading> = {}): PageReading => ({
  page: n,
  text,
  quoteText: "pdf_text",
  engine: "pdf text layer",
  words: [
    { t: "bez", b: [10, 100, 20, 10] },
    { t: "známek", b: [35, 100, 40, 10] },
  ],
  readability: "good",
  verify: [],
  identity: pageIdentity(text, ID),
  ...over,
});

const fact = (over: Partial<ModelFact>): ModelFact => ({
  kind: "diagnosis",
  part: 1,
  quote: "",
  subject: "patient",
  relation: null,
  status: "documented",
  negated: false,
  date_as_written: null,
  text: "",
  code: null,
  disease_status: null,
  primary: null,
  tnm_as_written: null,
  stage_kind: null,
  at_diagnosis: null,
  site: null,
  metastasis_status: null,
  modality: null,
  region: null,
  specimen: null,
  tumour_type: null,
  grade: null,
  line: null,
  stop_as_written: null,
  reason_stopped: null,
  dose: null,
  request_kind: null,
  decision_body: null,
  scale: null,
  value_as_written: null,
  reaction: null,
  risk_type: null,
  pack_years: null,
  strength: null,
  dosing: null,
  change: null,
  indication: null,
  reported_as: "original",
  certainty: "clear",
  uncertainty: null,
  ...over,
});

async function build(facts: ModelFact[], pages: PageReading[] = [page(1, P1)]) {
  const parts = pages.map((p) => pseudonymize(p.text, ID));
  return buildFromAnswer({ caseId: "NO-T", doc: { documentId: "T_pacient", part: null, pages }, calls: [{ pages: pages.map((_, i) => i), parts, answer: { facts } }] });
}

describe("fact extraction checks", () => {
  it("keeps a fact whose quote is in the page, maps placeholders back and anchors the source", async () => {
    const r = await build([fact({ kind: "diagnosis", quote: "C20 Zhoubný novotvar konečníku", text: "Zhoubný novotvar konečníku", code: "C20", primary: true })]);
    expect(r.facts).toHaveLength(1);
    const f = r.facts[0]!;
    expect(f).toMatchObject({ kind: "diagnosis", certainty: "clear", quarantined: false, codes: [{ system: "mkn-10", code: "C20", assigned_by: "source" }] });
    expect(f.id).toMatch(/^f-[0-9a-f]{8}$/);
    const s = r.sources[0]!;
    expect(s.type === "document" && P1.slice(...s.anchor!.char_range)).toBe("C20 Zhoubný novotvar konečníku");
    expect(s).toMatchObject({ quote_text: "pdf_text", identity: "matches", page: 1 });

    // A quote with a placeholder is found in the pseudonymized text and stored as the original words.
    const r2 = await build([fact({ kind: "plan", status: "planned", quote: "Kontrola u MUDr. [PERSONAL_1].", text: "Kontrola" })]);
    expect(r2.sources[0]!.type === "document" && r2.sources[0]!.quote).toBe("Kontrola u MUDr. Nováka.");
  });

  it("drops a fact whose quote is not on the page or names a part that was not sent", async () => {
    const r = await build([
      fact({ quote: "Adenokarcinom plic", text: "Adenokarcinom plic" }),
      fact({ part: 3, quote: "C20", text: "x" }),
    ]);
    expect(r.facts).toEqual([]);
    expect(r.report.dropped).toEqual({ quote_not_found: 1, bad_part: 1 });
  });

  it("keeps a code only when the page prints it, and a date only as written on the page", async () => {
    const r = await build([fact({ quote: "Adenokarcinom rekta, G2, diag. 3/2026", text: "Adenokarcinom rekta", code: "C18.7", date_as_written: "12.3.2026" })]);
    const f = r.facts[0]!;
    expect(f.codes).toEqual([]);
    expect(f.date).toEqual({ as_written: null, precision: null, sort: null });
    expect(f.certainty).toBe("verify");
    expect(f.certainty_reason?.code).toBe("date_not_in_text");
    expect(f.certainty_reason?.text).toContain("Kód C18.7");

    const ok = await build([fact({ quote: "Adenokarcinom rekta, G2, diag. 3/2026", text: "Adenokarcinom rekta", date_as_written: "3/2026" })]);
    expect(ok.facts[0]!.date).toEqual({ as_written: "3/2026", precision: "month", sort: "2026-03" });
  });

  it("marks a negation the wording does not support, and a positive finding quoted with a negation", async () => {
    const r = await build([
      fact({ kind: "metastasis", quote: "CT hrudníku a břicha 17.3.2026: bez známek vzdálených metastáz", text: "metastázy", site: "vzdálené", metastasis_status: "excluded", negated: true }),
      fact({ kind: "metastasis", quote: "CT hrudníku a břicha 17.3.2026: bez známek vzdálených metastáz", text: "metastázy jater", site: "játra", metastasis_status: "confirmed" }),
      fact({ kind: "comorbidity", quote: "DM neguje.", text: "DM", negated: true }),
      fact({ kind: "imaging", quote: "CT hrudníku a břicha 17.3.2026: bez známek vzdálených metastáz", text: "bez známek metastáz, drobná cysta jater", modality: "CT", negated: true }),
    ]);
    expect(r.facts[3]).toMatchObject({ certainty: "verify", certainty_reason: { code: "mixed_negation" } });
    const [excluded, confirmed, dm] = r.facts;
    expect(excluded).toMatchObject({ negated: true, certainty: "clear" });
    expect(confirmed).toMatchObject({ negated: false, certainty: "verify", certainty_reason: { code: "negation_unclear" } });
    expect(dm).toMatchObject({ negated: true, certainty: "clear" });
  });

  it("marks numbers not in the quote, a done fact that reads as a request, a poor page and the reading's own marks", async () => {
    const r = await build([
      fact({ kind: "stage", quote: "Stadium před léčbou: cT3b cN1 cM0", text: "cT3b cN1 cM0", tnm_as_written: "cT3b cN2 cM0", stage_kind: "clinical" }),
      fact({ kind: "imaging", status: "done", quote: "7.10.2026 odeslána žádanka na CT hrudníku, břicha a pánve, t.č. výsledek nemáme", text: "CT", modality: "CT" }),
    ]);
    expect(r.facts[0]!.certainty_reason?.code).toBe("number_not_in_quote");
    // "výsledek nemáme" is also a negation in the quote; the request wording is among the reasons.
    expect(r.facts[1]!.certainty_reason?.text).toContain("žádost nebo plán");

    const poor = await build([fact({ quote: "C20 Zhoubný novotvar konečníku", text: "x" })], [page(1, P1, { readability: "poor" })]);
    expect(poor.facts[0]!.certainty_reason?.code).toBe("poor_copy");
    const at = P1.indexOf("C20");
    const marked = await build([fact({ quote: "C20 Zhoubný novotvar konečníku", text: "x" })], [page(1, P1, { verify: [[at, at + 3]] })]);
    expect(marked.facts[0]!.certainty_reason?.code).toBe("ocr_check");
  });

  it("normalises TNM as written and keeps stage kinds apart", async () => {
    expect(normalizeTnm("cT3b cN1 cM0 (MR pánve 16.3.2026)")).toBe("cT3b cN1 cM0");
    expect(normalizeTnm("ypT2 ypN0 (0/14), R0")).toBe("ypT2 ypN0");
    expect(normalizeTnm("pT2a pN1(3+/5) M0")).toBe("pT2a pN1 M0");
    expect(normalizeTnm("stadium neuvedeno")).toBeNull();
    const r = await build([fact({ kind: "stage", quote: "Stadium před léčbou: cT3b cN1 cM0", text: "cT3b cN1 cM0", tnm_as_written: "cT3b cN1 cM0", stage_kind: "pathological" })]);
    expect(r.facts[0]).toMatchObject({ value: { tnm: "cT3b cN1 cM0" }, certainty: "verify", certainty_reason: { code: "stage_kind_unclear" } });
  });

  it("quarantines facts from a page that names another patient and raises an identity alert", async () => {
    const r = await build(
      [
        fact({ part: 1, quote: "C20 Zhoubný novotvar konečníku", text: "x", code: "C20" }),
        fact({ part: 2, kind: "metastasis", quote: "CT břicha 24.9.2026: metastatické postižení jater.", text: "jater", site: "játra", metastasis_status: "confirmed" }),
      ],
      [page(1, P1), page(2, P2)],
    );
    expect(r.sources.map((s) => s.type === "document" && s.identity)).toEqual(["matches", "conflicts"]);
    expect(r.facts.map((f) => f.quarantined)).toEqual([false, true]);
    expect(r.alerts).toHaveLength(1);
    expect(r.alerts[0]).toMatchObject({ kind: "identity", rule: "identity_page_conflict", subject: "T_pacient/p2", facts: [r.facts[1]!.id] });
    // The run carries no identity: names and birth numbers appear only inside verbatim quotes.
    const runText = JSON.stringify({ facts: r.facts, alerts: r.alerts, checks: r.checks });
    for (const s of ["Vrbenská", "595418", "Lipensk", "585614"]) expect(runText).not.toContain(s);
  });

  it("raises request_without_result for a request with no later result, not for one that has it", async () => {
    const req = fact({ kind: "request", status: "requested", quote: "7.10.2026 odeslána žádanka na CT hrudníku, břicha a pánve, t.č. výsledek nemáme", text: "CT hrudníku, břicha a pánve", request_kind: "exam", date_as_written: "7.10.2026" });
    const open = await build([req]);
    expect(open.alerts.map((a) => a.rule)).toEqual(["request_without_result"]);
    const text = P1 + "\nCT hrudníku, břicha a pánve 12.10.2026: bez progrese.";
    const done = await build(
      [req, fact({ kind: "imaging", status: "done", quote: "CT hrudníku, břicha a pánve 12.10.2026: bez progrese.", text: "CT hrudníku bez progrese", modality: "CT", negated: true, date_as_written: "12.10.2026" })],
      [page(1, text)],
    );
    expect(done.alerts).toEqual([]);
  });

  it("merges the same statement read twice, and writes checks for every kind it looked for", async () => {
    const d = fact({ kind: "comorbidity", quote: "DM neguje.", text: "DM", negated: true });
    const r = await build([d, d]);
    expect(r.facts).toHaveLength(1);
    expect(r.checks.find((c) => c.looks_for === "comorbidity")?.result).toBe("found");
    expect(r.checks.find((c) => c.looks_for === "lab_result")).toBeUndefined();
    expect(r.checks.find((c) => c.looks_for === "radiotherapy")?.result).toBe("nothing_found");
  });

  it("lists pages the model would not read as unreadable, never as nothing found", async () => {
    const pages = [page(1, P1), page(2, P2)];
    const parts = [pseudonymize(P1, ID)];
    const r = await buildFromAnswer({ caseId: "NO-T", doc: { documentId: "T_pacient", part: null, pages }, calls: [{ pages: [0], parts, answer: { facts: [] } }], unreadPages: [1] });
    expect(r.checks[0]!.unreadable).toEqual([{ document_id: "T_pacient", part: null, page: 2 }]);
  });

  it("writes facts, sources and checks the format validator accepts", async () => {
    const r = await build([
      fact({ kind: "diagnosis", quote: "C20 Zhoubný novotvar konečníku", text: "Zhoubný novotvar konečníku", code: "C20" }),
      fact({ kind: "stage", quote: "Stadium před léčbou: cT3b cN1 cM0", text: "cT3b cN1 cM0", tnm_as_written: "cT3b cN1 cM0", stage_kind: "clinical", date_as_written: "16.3.2026" }),
    ]);
    const run = {
      schema: "codebridge.extraction/2",
      case_id: "NO-T",
      content_language: "cs",
      run: { id: "run-t", producer: "pipeline", created_at: "2026-10-19T10:00:00Z", stages: [], supersedes: null },
      documents: [{ document_id: "T_pacient", sha256: null, parts: [] }],
      sources: r.sources,
      facts: r.facts,
      checks: r.checks,
      alerts: r.alerts,
      brief: null,
      question_draft: null,
    };
    const v = validateRun(run);
    expect(v.issues ?? []).toEqual([]);
  });
});

describe("checks found by review", () => {
  it("normalises joined TNM, marks an unrecognised category, and takes the stage kind from the prefix", async () => {
    expect(normalizeTnm("cT3bN1M0")).toBe("cT3b N1 M0");
    expect(normalizeTnm("T2N0M0 G3")).toBe("T2 N0 M0");
    const text = P1 + "\nStadium: pT2 pN0 MO";
    const r = await build(
      [
        fact({ kind: "stage", quote: "Stadium: pT2 pN0 MO", text: "pT2 pN0 MO", tnm_as_written: "pT2 pN0 MO", stage_kind: null }),
      ],
      [page(1, text)],
    );
    expect(r.facts[0]).toMatchObject({ value: { stage_kind: "pathological", tnm: "pT2 pN0" }, certainty: "verify", certainty_reason: { code: "tnm_unrecognised" } });
    const none = await build([fact({ kind: "stage", quote: "Stadium před léčbou: cT3b cN1 cM0", text: "T3 N1", tnm_as_written: null, stage_kind: null })]);
    expect(none.facts[0]!.certainty).toBe("verify");
  });

  it("never invents a performance status of 0", async () => {
    const r = await build([fact({ kind: "performance_status", quote: "C20 Zhoubný novotvar konečníku", text: "ECOG", scale: "ECOG", value_as_written: null })]);
    expect(r.facts[0]!.value).toMatchObject({ value_numeric: null, value_as_written: "" });
  });

  it("anchors a quote that is on the page twice where the fact's words are, or marks it", async () => {
    const text = "Závěr: bez metastáz\nplíce čisté\n\n\n\nCT jater 3.3.2026:\nbez metastáz";
    const r = await build([fact({ kind: "metastasis", quote: "bez metastáz", text: "jater bez metastáz", site: "játra", negated: true, metastasis_status: "excluded", date_as_written: "3.3.2026" })], [page(1, text)]);
    const s = r.sources[0]!;
    expect(s.type === "document" && s.anchor!.char_range[0]).toBe(text.lastIndexOf("bez metastáz"));
    const amb = await build([fact({ kind: "metastasis", quote: "bez metastáz", text: "metastázy", negated: true, metastasis_status: "excluded" })], [page(1, "bez metastáz\nbez metastáz")]);
    expect(amb.facts[0]!.certainty_reason?.code).toBe("quote_ambiguous");
  });

  it("does not close a request with a result of another region or kind", async () => {
    const text = "1.10.2026 odeslán požadavek na CT mozku\nCT hrudníku 5.10.2026 bez ložisek\nMDT 6.10.2026 doporučuje PET/CT";
    const pg = [page(1, text)];
    const r = await build(
      [
        fact({ kind: "request", status: "requested", quote: "1.10.2026 odeslán požadavek na CT mozku", text: "CT mozku", request_kind: "exam", date_as_written: "1.10.2026" }),
        fact({ kind: "imaging", status: "done", quote: "CT hrudníku 5.10.2026 bez ložisek", text: "CT hrudníku bez ložisek", modality: "CT", negated: true, date_as_written: "5.10.2026" }),
      ],
      pg,
    );
    expect(r.alerts.map((a) => a.rule)).toEqual(["request_without_result"]);
  });

  it("never merges a fact of the patient's page with one of another patient's page", async () => {
    const d = (part: number, quote: string) => fact({ part, kind: "comorbidity", quote, text: "DM", negated: true });
    const r = await build([d(1, "DM neguje."), d(2, "DM neguje.")], [page(1, P1), page(2, P2 + "\nDM neguje.")]);
    expect(r.facts.map((f) => f.quarantined)).toEqual([false, true]);
  });

  it("marks a code that is not in the quote when the page prints several", async () => {
    const text = P1 + "\nI10 Arteriální hypertenze";
    const r = await build([fact({ kind: "diagnosis", quote: "Adenokarcinom rekta, G2, diag. 3/2026", text: "Adenokarcinom rekta", code: "I10", date_as_written: "3/2026" })], [page(1, text)]);
    expect(r.facts[0]).toMatchObject({ codes: [{ code: "I10" }], certainty: "verify", certainty_reason: { code: "code_outside_quote" } });
  });

  it("lists a page no call sent as not read", async () => {
    const pages = [page(1, P1), page(2, P2)];
    const r = await buildFromAnswer({ caseId: "NO-T", doc: { documentId: "T_pacient", part: null, pages }, calls: [{ pages: [0], parts: [pseudonymize(P1, ID)], answer: { facts: [] } }] });
    expect(r.checks[0]!.unreadable.map((u) => u.page)).toEqual([2]);
  });

  it("marks a plan for a therapy the documents show as started", async () => {
    const text = "Do 2. linie indikován sunitinib.\nSunitinib od 27.1.2026.";
    const r = await build(
      [
        fact({ kind: "plan", status: "planned", quote: "Do 2. linie indikován sunitinib.", text: "sunitinib 2. linie" }),
        fact({ kind: "systemic_therapy", status: "done", quote: "Sunitinib od 27.1.2026.", text: "sunitinib", date_as_written: "27.1.2026" }),
      ],
      [page(1, text)],
    );
    expect(r.facts[0]).toMatchObject({ kind: "plan", certainty: "verify", certainty_reason: { code: "done_elsewhere" } });
    expect(r.facts[1]!.certainty).toBe("clear");
  });
});

describe("medication", () => {
  it("keeps a medication with its strength from the quote, and marks a strength the quote does not hold", async () => {
    const text = P1 + "\nBisoprolol 1,25 mg 1-0-0\nod 19.9.2026 Everolimus zvyšuji na 10 mg 1-0-0";
    const r = await build(
      [
        fact({ kind: "medication", quote: "Bisoprolol 1,25 mg 1-0-0", text: "Bisoprolol", strength: "1,25 mg", dosing: "1-0-0" }),
        fact({ kind: "medication", quote: "Bisoprolol 1,25 mg 1-0-0", text: "Bisoprolol", strength: "4,25 mg", dosing: "1-0-0" }),
        fact({ kind: "medication", quote: "od 19.9.2026 Everolimus zvyšuji na 10 mg 1-0-0", text: "Everolimus", strength: "10 mg", dosing: "1-0-0", change: "zvýšení dávky", date_as_written: "19.9.2026" }),
      ],
      [page(1, text)],
    );
    expect(r.facts[0]).toMatchObject({ kind: "medication", certainty: "clear", value: { drug: "Bisoprolol", strength: "1,25 mg", dosing: "1-0-0" } });
    expect(r.facts[1]).toMatchObject({ certainty: "verify", certainty_reason: { code: "number_not_in_quote" } });
    // A dose change is its own fact, keyed by its start (EXTRACTION-FORMAT.md, "medication").
    expect(r.facts[2]).toMatchObject({ date: { sort: "2026-09-19" }, value: { change: "zvýšení dávky" } });
    expect(r.facts[2]!.key).toBe("medication|everolimus|start:2026-09-19");
  });
});

describe("dates, quotes and page identity", () => {
  it("keeps a partial date partial", () => {
    expect(parseDate("3/2024")).toEqual({ as_written: "3/2024", precision: "month", sort: "2024-03" });
    expect(parseDate("12. 3. 2026")).toEqual({ as_written: "12. 3. 2026", precision: "day", sort: "2026-03-12" });
    expect(parseDate("2024")).toEqual({ as_written: "2024", precision: "year", sort: "2024" });
    expect(parseDate("20.9.2026 07:40")).toEqual({ as_written: "20.9.2026 07:40", precision: "minute", sort: "2026-09-20T07:40" });
    expect(parseDate("31.2.2026").sort).toBeNull();
    expect(parseDate("loni na jaře")).toEqual({ as_written: "loni na jaře", precision: null, sort: null });
    // A day and a month without a year get no year; a range without the start's year gets no sort form.
    expect(parseDate("5.10").sort).toBeNull();
    expect(parseDate("3.24").sort).toBeNull();
    expect(parseDate("3/24")).toMatchObject({ precision: "month", sort: "2024-03" });
    expect(parseDate("12.3.-15.3.2026").sort).toBeNull();
    expect(parseDate("7.4.2026 - 18.5.2026").sort).toBe("2026-04-07");
  });

  it("finds a quote across line breaks but not with other words", () => {
    expect(findQuote("bez známek\nvzdálených  metastáz", "bez známek vzdálených metastáz")).toEqual([0, 31]);
    expect(findQuote("bez známek vzdálených metastáz", "bez vzdálených metastáz")).toBeNull();
  });

  it("tells the patient's page from another patient's and from a page without identity", () => {
    expect(pageIdentity(P1, ID)).toBe("matches");
    expect(pageIdentity(P2, ID)).toBe("conflicts");
    // The same surname with another first name and birth number is another person.
    expect(pageIdentity("Lipenská Jana, nar. 1.1.1950, r.č. 505101/1234", ID)).toBe("conflicts");
    expect(pageIdentity("Hb 120 g/l, CRP 5 mg/l", ID)).toBe("cannot_verify");
    // The usual header of the patient's own page is not a conflict ("RČ" is a label, not another name).
    expect(pageIdentity("Pacient: Lipenská Věra, RČ 585614/1234", ID)).toBe("matches");
    expect(pageIdentity("Pacientka: Lipenská Věra\nDg.: C20", ID)).toBe("matches");
    // A name and its birth label on separate lines.
    expect(pageIdentity("Vrbenská Lenka,\nnar. 18.4.1959", ID)).toBe("conflicts");
  });
});
