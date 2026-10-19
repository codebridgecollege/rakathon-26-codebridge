// The case rules (src/extraction/rules.ts) over small synthetic runs, one per failure case they guard, and over the
// converted reference cases, whose hand-written alerts the rules must reproduce where they cover the same ground.
import { describe, expect, it } from "vitest";
import {
  alertId,
  applyCaseRules,
  caseRules,
  citedExams,
  supersededFacts,
  validateRun,
  writtenSort,
  type Alert,
  type Check,
  type DocumentSource,
  type ExtractionRun,
  type Fact,
  type FactDate,
} from "../src/extraction/index";
import run10 from "../../../fixtures/data/runs/NO-010.json";
import runS01 from "../../../fixtures/data/runs/NO-S01.json";
import runS02 from "../../../fixtures/data/runs/NO-S02.json";

const copy = <T>(x: T): T => JSON.parse(JSON.stringify(x));

function date(as_written: string | null): FactDate {
  if (!as_written) return { as_written: null, precision: null, sort: null };
  const sort = writtenSort(as_written)!;
  return { as_written, precision: sort.length === 10 ? "day" : sort.length === 7 ? "month" : "year", sort };
}

function src(id: string, reported_as: "original" | "cited" = "original", document_id = "D1"): DocumentSource {
  return { id, type: "document", document_id, part: null, page: 1, quote: id, quote_text: "pdf_text", anchor: null, reported_as, identity: "matches", reading_check: null };
}

let n = 0;
/** A fact with a frame that passes the validator; `value` and the overrides make it what the test needs. */
function fact<K extends Fact["kind"]>(kind: K, value: Extract<Fact, { kind: K }>["value"], over: Partial<Fact> = {}): Fact {
  n++;
  return {
    id: `f-${String(n).padStart(8, "0")}`,
    key: `k${n}`,
    kind,
    subject: "patient",
    value,
    date: date(null),
    status: "documented",
    negated: false,
    not_stated: [],
    origin: "document",
    certainty: "clear",
    codes: [],
    note: null,
    quarantined: false,
    sources: ["s-orig"],
    ...over,
  } as Fact;
}

const imaging = (modality: string, region: string | null, when: string | null, sources: string[], over: Partial<Fact> = {}) =>
  fact("imaging", { modality, region, finding_text: "nález", response: null }, { date: date(when), status: "done", sources, ...over });

function input(facts: Fact[], sources: DocumentSource[] = [src("s-orig"), src("s-cited", "cited")], checks: Check[] = []) {
  return { facts, sources, documents: [{ document_id: "D1", sha256: null, parts: [] }], checks, run: { created_at: "2026-10-19T08:00:00Z" } };
}

const rules = (facts: Fact[], sources?: DocumentSource[]) => caseRules(input(facts, sources)).alerts;
const byRule = (alerts: Alert[], rule: string) => alerts.filter((a) => a.rule === rule);

describe("original report missing", () => {
  it("raises one alert per report that is only cited, keyed by the report, with a check that found nothing", () => {
    const mr = imaging("MR", "mozek", "14.9.2026", ["s-cited"]);
    const out = caseRules(input([mr]));
    const subject = "report|imaging|mr|mozek|2026-09-14";
    expect(out.alerts).toEqual([
      { id: alertId({ rule: "original_report_missing", subject }), rule: "original_report_missing", subject, kind: "missing", facts: [mr.id], message: { id: "alert-original-report-missing", args: { fact: mr.id } }, note: null },
    ]);
    expect(out.checks.find((c) => c.looks_for === "original_report")).toMatchObject({ expected: { of_fact: mr.id }, result: "nothing_found" });
  });

  it("finds the original in another fact of the same exam, also when the citation gives only the month", () => {
    const cited = imaging("CT", "hrudník", "9/2026", ["s-cited"]);
    const original = imaging("CT s kontrastní látkou", "hrudníku a břicha", "17.9.2026", ["s-orig"]);
    const out = caseRules(input([cited, original]));
    expect(out.alerts).toEqual([]);
    expect(out.checks.find((c) => c.expected?.of_fact === cited.id)?.result).toBe("found");
  });

  it("joins the facts of one cited report (a histology with its receptors), never facts of two kinds", () => {
    const h = (text: string) => fact("histology", { specimen: null, result_text: text, tumour_type: null, grade: null }, { date: date("15.9.2026"), sources: ["s-cited"] });
    const histology = [h("Invazivní karcinom NST"), h("ER 90 %"), h("HER2 1+"), h("Ki-67 25 %")];
    const colo = [
      imaging("koloskopie", "rektum", "9.3.2026", ["s-cited"]),
      fact("procedure", { name: "Koloskopie; odebrána biopsie", region: "rektum", text: null }, { date: date("9.3.2026"), status: "done", sources: ["s-cited"] }),
    ];
    const out = rules([...histology, ...colo]);
    expect(out.map((a) => [a.facts.length, a.subject])).toEqual([
      [4, "report|histology|||2026-09-15"],
      [1, "report|imaging|koloskopie|rektu|2026-03-09"],
      [1, "report|procedure||biops+kolos+odebr+rektu|2026-03-09"],
    ]);
    // Two reports of one kind and day that are not the same exam keep apart, with distinct subjects.
    const two = rules([imaging("CT", "mozek", "1.9.2026", ["s-cited"]), imaging("CT", "hrudník", "1.9.2026", ["s-cited"])]);
    expect(new Set(two.map((a) => a.id)).size).toBe(2);
  });

  it("names a report by its own words, so an acknowledged alert never moves to another report when one joins", () => {
    const chest = imaging("CT", "hrudník", "1.9.2026", ["s-cited"], { id: "f-00000005" } as Partial<Fact>);
    const before = rules([chest]);
    const brain = imaging("CT", "mozek", "1.9.2026", ["s-cited"], { id: "f-00000001" } as Partial<Fact>);
    const after = rules([brain, chest]);
    expect(after.find((a) => a.facts.includes(chest.id))!.id).toBe(before[0]!.id);
    expect(after.find((a) => a.facts.includes(brain.id))!.id).not.toBe(before[0]!.id);
  });

  it("keeps a missing histology report apart from the found protocol of the biopsy that took the sample", () => {
    const bronchoscopy = fact("procedure", { name: "bronchoskopie s biopsií PHL", region: null, text: null }, { date: date("11.9.2026"), status: "done", sources: ["s-cited"] });
    const protocol = fact("procedure", { name: "bronchoskopie s biopsií PHL", region: null, text: null }, { date: date("11.9.2026"), status: "done", sources: ["s-orig"] });
    const histology = fact("histology", { specimen: "biopsie PHL", result_text: "adenokarcinom", tumour_type: null, grade: null }, { date: date("11.9.2026"), sources: ["s-cited"] });
    expect(rules([bronchoscopy, protocol, histology]).map((a) => a.facts)).toEqual([[histology.id]]);
  });

  it("finds a histology report cited by its report date when the original carries the sampling date", () => {
    const cited = fact("histology", { specimen: "core-cut biopsie levého prsu", result_text: "invazivní karcinom", tumour_type: null, grade: null }, { date: date("15.9.2026"), sources: ["s-cited"] });
    const original = fact("histology", { specimen: "core-cut biopsie levého prsu", result_text: "invazivní karcinom NST", tumour_type: null, grade: "G2" }, { date: date("10.9.2026"), sources: ["s-orig"] });
    expect(rules([cited, original])).toEqual([]);
    const tooEarly = fact("histology", { specimen: "core-cut biopsie levého prsu", result_text: "x", tumour_type: null, grade: null }, { date: date("1.6.2026"), sources: ["s-orig"] });
    expect(rules([cited, tooEarly])).toHaveLength(1);
  });

  it("never takes a less precisely dated summary line for the report a citation names", () => {
    const cited = fact("histology", { specimen: null, result_text: "adenokarcinom", tumour_type: null, grade: null }, { date: date("14.9.2026"), sources: ["s-cited"] });
    const summary = fact("histology", { specimen: null, result_text: "EGFR wt", tumour_type: null, grade: null }, { date: date("9/2026"), sources: ["s-orig"] });
    expect(rules([cited, summary])).toHaveLength(1);
    // The other way round, a citation by month finds the report of a day in it.
    const byMonth = imaging("CT", "hrudník", "9/2026", ["s-cited"]);
    expect(rules([byMonth, imaging("CT", "hrudník", "17.9.2026", ["s-orig"])])).toEqual([]);
  });

  it("raises a missing report for a cited exam with a negative finding, and never links a citation by its year alone", () => {
    const negative = imaging("CT", "hrudník a břicho", "17.3.2026", ["s-cited"], { negated: true });
    expect(rules([negative])).toHaveLength(1);
    expect(rules([imaging("CT", "hrudník", "2025", ["s-cited"]), imaging("CT", "hrudník", "3.3.2025", ["s-orig"])])).toHaveLength(1);
  });

  it("never matches across modality, region or an undated exam: a wrong match would hide the gap", () => {
    const cases = [
      [imaging("MR", "mozek", "14.9.2026", ["s-cited"]), imaging("CT", "mozek", "14.9.2026", ["s-orig"])],
      [imaging("CT", "mozek", "14.9.2026", ["s-cited"]), imaging("CT", "hrudník", "14.9.2026", ["s-orig"])],
      [imaging("CT", "mozek", null, ["s-cited"]), imaging("CT", "mozek", null, ["s-orig"])],
      [imaging("CT", "mozek", "14.9.2026", ["s-cited"]), imaging("CT", "mozek", "15.9.2026", ["s-orig"])],
    ];
    for (const facts of cases) expect(byRule(rules(facts), "original_report_missing")).toHaveLength(1);
  });

  it("counts a NIS record and an original page as the report, and skips plans, requests and recorded negatives", () => {
    const nis = { id: "s-nis", type: "nis", system: "https://nis.example/fhir", resource: "DiagnosticReport/1", version: null, last_updated: null } as const;
    const fromNis = imaging("CT", "hrudník", "1.9.2026", ["s-nis"]);
    const mixed = imaging("MR", "mozek", "2.9.2026", ["s-cited", "s-orig"]);
    const planned = imaging("PET/CT", null, "1.11.2026", ["s-cited"], { status: "planned" });
    const notDone = fact("procedure", { name: "bronchoskopie", region: null, text: null }, { date: date("3.9.2026"), status: "done", negated: true, sources: ["s-cited"] });
    const out = caseRules({ ...input([fromNis, mixed, planned, notDone]), sources: [src("s-orig"), src("s-cited", "cited"), nis] } as never);
    expect(out.alerts).toEqual([]);
  });

  it("covers histology, procedures, MDT decisions and radiotherapy, not a cited systemic therapy", () => {
    const facts = [
      fact("histology", { specimen: "biopsie", result_text: "adenokarcinom", tumour_type: null, grade: null }, { date: date("14.9.2026"), sources: ["s-cited"] }),
      fact("procedure", { name: "bronchoskopie s biopsií", region: null, text: null }, { date: date("11.9.2026"), status: "done", sources: ["s-cited"] }),
      fact("decision", { body: "mdt", body_as_written: "MDT", text: "neoadjuvance" }, { date: date("20.3.2026"), sources: ["s-cited"] }),
      fact("radiotherapy", { target: "pánev", dose: null, fractions: null, text: null }, { date: date("7.4.2026"), status: "done", sources: ["s-cited"] }),
      fact("systemic_therapy", { regimen: "kapecitabin", line: null, start: "7.4.2026", stop: null, reason_stopped: null, text: null }, { date: date("7.4.2026"), status: "done", sources: ["s-cited"] }),
    ];
    expect(citedExams(facts, [src("s-orig"), src("s-cited", "cited")]).map((c) => c.fact.kind).sort()).toEqual(["decision", "histology", "procedure", "radiotherapy"]);
  });

  it("groups more than three missing reports into one alert that a newly missing report replaces", () => {
    const four = ["1.1.2026", "2.1.2026", "3.1.2026", "4.1.2026"].map((d) => imaging("CT", "hrudník", d, ["s-cited"]));
    const a = rules(four);
    expect(a).toHaveLength(1);
    expect(a[0]).toMatchObject({ rule: "original_reports_missing", kind: "missing", message: { id: "alert-original-reports-missing", args: { count: 4 } } });
    expect(a[0]!.subject).toMatch(/^cited_exams\|[0-9a-f]{8}$/);
    expect(a[0]!.facts).toEqual(four.map((f) => f.id));
    expect(rules([...four].reverse())[0]!.id).toBe(a[0]!.id);
    // A resolved grouped alert must not hide a fifth missing report: the set changed, so the alert is new.
    const five = rules([...four, imaging("MR", "mozek", "5.1.2026", ["s-cited"])]);
    expect(five[0]!.id).not.toBe(a[0]!.id);
    expect(caseRules(input(four), { groupMissingReportsAbove: 10 }).alerts).toHaveLength(4);
  });
});

describe("request without result", () => {
  const request = (what: string, when: string | null, over: Partial<Fact> = {}) =>
    fact("request", { what, request_kind: "exam", result_fact: null }, { date: date(when), status: "requested", ...over });

  it("raises an alert for a sent request with no result, never for the MDT referral itself", () => {
    const pet = request("PET/CT celotělové", "1.10.2026");
    const mdt = fact("request", { what: "projednání na MDT", request_kind: "mdt", result_fact: null }, { status: "requested" });
    expect(rules([pet, mdt]).map((a) => [a.rule, a.subject])).toEqual([["request_without_result", pet.id]]);
  });

  it("finds a later result of the same modality and region in another document", () => {
    const ct = request("CT hrudníku", "7.10.2026");
    const result = imaging("CT", "hrudník", "12.10.2026", ["s-other"]);
    expect(rules([ct, result], [src("s-orig"), src("s-other", "original", "D2")])).toEqual([]);
    // An earlier CT or another region is not the result.
    expect(rules([ct, imaging("CT", "hrudník", "1.10.2026", ["s-orig"])])).toHaveLength(1);
    expect(rules([ct, imaging("CT", "mozek", "12.10.2026", ["s-orig"])])).toHaveLength(1);
  });

  it("names a joined request alert the same way whatever the order of the facts", () => {
    const a = request("odeslána žádanka na CT", "7.10.2026");
    const b = request("doplnit výsledek CT", "7.10.2026");
    expect(rules([b, a])[0]!.id).toBe(rules([a, b])[0]!.id);
  });

  it("does not take a result dated only by a month as the result of a request in that month", () => {
    const ct = request("CT hrudníku", "7.10.2026");
    expect(rules([ct, imaging("CT", "hrudník", "10/2026", ["s-orig"])])).toHaveLength(1);
  });

  it("joins the same dated request mentioned twice into one alert", () => {
    const a = request("odeslána žádanka na CT", "7.10.2026");
    const b = request("doplnit výsledek CT", "7.10.2026");
    const out = rules([a, b]);
    expect(out).toHaveLength(1);
    expect(out[0]!.facts.sort()).toEqual([a.id, b.id].sort());
  });
});

describe("contradictions: like with like", () => {
  const stage = (kind: "clinical" | "pathological", tnm: string, when: string, written = tnm) =>
    fact("stage", { tnm_as_written: written, tnm, stage_kind: kind, edition: null, as_of: when, at_diagnosis: null }, { date: date(when) });

  it("never compares a clinical with a pathological stage, nor stages of different dates", () => {
    expect(rules([stage("clinical", "cT3 cN1 M0", "2.6.2022"), stage("pathological", "pT2a pN1 M0", "2.6.2022")])).toEqual([]);
    expect(rules([stage("clinical", "cT3 cN1 M0", "2.6.2022"), stage("clinical", "cT4 cN2 M1", "2.6.2026")])).toEqual([]);
  });

  it("raises a contradiction for two stages of one kind and date that disagree, not for a misread written form", () => {
    const a = stage("pathological", "pT2a pN1 M0", "2.6.2022");
    const b = stage("pathological", "pT3a pN1 M0", "2.6.2022");
    expect(rules([a, b])).toMatchObject([{ rule: "stage_differs", kind: "contradiction", subject: [a.id, b.id].sort().join("|") }]);
    expect(rules([stage("pathological", "pT2a pN1 M0", "2.6.2022", "pT2a pN1 MO"), stage("pathological", "pT2a pN1 M0", "2.6.2022")])).toEqual([]);
    // One statement leaves M out (S02: "cT3b cN1" next to "cT3b cN1 M0"): the categories both state agree.
    expect(rules([stage("clinical", "cT3b cN1", "16.3.2026"), stage("clinical", "cT3b cN1 M0", "16.3.2026")])).toEqual([]);
    expect(rules([stage("clinical", "cT3b cN1", "16.3.2026"), stage("clinical", "cT3b cN2 M0", "16.3.2026")])).toHaveLength(1);
  });

  const lab = (value: number, draw: string | null, unit = "mmol/l") =>
    fact("lab_result", {
      name_as_written: "K",
      value_as_written: String(value).replace(".", ","),
      value_numeric: value,
      unit_as_written: unit,
      unit,
      reference_range: null,
      reference_low: null,
      reference_high: null,
      out_of_range: null,
      out_of_range_origin: null,
      draw: { as_written: draw, requisition: null, specimen: null },
    }, { codes: [{ system: "fno-local-lab", code: "S_K", assigned_by: "source" }] });

  it("compares lab values only for the same draw with its time and the same unit", () => {
    expect(rules([lab(5.8, "21.9.2026 07:40"), lab(5.3, "21.9.2026 07:40")])).toMatchObject([{ rule: "lab_value_differs", kind: "contradiction" }]);
    expect(rules([lab(5.8, "21.9.2026"), lab(5.3, "21.9.2026")])).toEqual([]);
    expect(rules([lab(5.8, null), lab(5.3, null)])).toEqual([]);
    expect(rules([lab(5.8, "21.9.2026 07:40"), lab(5.8, "21.9.2026 07:40")])).toEqual([]);
    expect(rules([lab(5.8, "21.9.2026 07:40"), lab(5300, "21.9.2026 07:40", "µmol/l")])).toEqual([]);
    const urine = lab(45, "21.9.2026 07:40");
    if (urine.kind === "lab_result") urine.value.draw.specimen = "moč";
    expect(rules([lab(4.5, "21.9.2026 07:40"), urine])).toEqual([]);
  });

  const med = (dosing: string, when: string | null, status: Fact["status"] = "documented") =>
    fact("medication", { drug: "Spiriva (inhalačně)", strength: null, dosing, change: null, indication: null, text: null }, { date: date(when), status });

  it("raises differing dosing of one drug: unclear when undated, a contradiction for the same start, nothing for a stopped one", () => {
    expect(rules([med("1-0-1", null), med("2-0-0", null)])).toMatchObject([{ rule: "dosing_differs", kind: "unclear" }]);
    expect(rules([med("1-0-1", "1.9.2026"), med("2-0-0", "1.9.2026")])).toMatchObject([{ rule: "dosing_differs", kind: "contradiction" }]);
    expect(rules([med("1-0-1", null, "stopped"), med("2-0-0", null)])).toEqual([]);
    expect(rules([med("1-0-1", null), med("1 - 0 - 1", null)])).toEqual([]);
  });

  const met = (status: "suspected" | "confirmed" | "excluded", when: string, site = "játra") =>
    fact("metastasis", { site, status, basis: "imaging", text: null }, { date: date(when), negated: status === "excluded" });

  it("raises a metastasis stated and excluded at one site on one date (a negation misread), not a change over time", () => {
    expect(rules([met("confirmed", "16.9.2026"), met("excluded", "16.9.2026")])).toMatchObject([{ rule: "metastasis_status_differs", kind: "contradiction" }]);
    expect(rules([met("suspected", "16.9.2026"), met("confirmed", "16.9.2026")])).toEqual([]);
    expect(rules([met("excluded", "1.3.2026"), met("confirmed", "16.9.2026")])).toEqual([]);
    expect(rules([met("excluded", "16.9.2026", "játra"), met("confirmed", "16.9.2026", "plíce")])).toEqual([]);
  });

  it("raises differing grades of one specimen and differing performance status of one day", () => {
    const h = (grade: string) => fact("histology", { specimen: "nefrektomie vpravo", result_text: "RCC", tumour_type: null, grade }, { date: date("2.6.2022") });
    expect(rules([h("G2"), h("G3")])).toMatchObject([{ rule: "histology_grade_differs" }]);
    expect(rules([h("G2"), h("TRG 2")])).toEqual([]);
    expect(rules([h("G2"), h("G2 (Nottingham 3+2+2)")])).toEqual([]);
    const noSpecimen = (grade: string) => fact("histology", { specimen: null, result_text: "x", tumour_type: null, grade }, { date: date("2.6.2022") });
    expect(rules([noSpecimen("G2"), noSpecimen("G3")])).toEqual([]);
    const ps = (v: string, when: string) => fact("performance_status", { scale: "ECOG", value_as_written: v, value_numeric: Number(v) }, { date: date(when) });
    expect(rules([ps("1", "1.9.2026"), ps("2", "1.9.2026")])).toMatchObject([{ rule: "performance_status_differs", kind: "contradiction" }]);
    expect(rules([ps("1", "1.9.2026"), ps("2", "1.10.2026")])).toEqual([]);
  });

  it("calls response assessments of one exam a contradiction only on the same day and system; a partial date is unclear", () => {
    const resp = (category: string, when: string, system = "RECIST 1.1", modality = "CT") =>
      imaging(modality, "hrudník", when, ["s-orig"], { value: { modality, region: "hrudník", finding_text: "nález", response: { system, category } } } as Partial<Fact>);
    expect(rules([resp("PD", "10.11.2025"), resp("SD", "10.11.2025")])).toMatchObject([{ rule: "response_assessment_differs", kind: "contradiction" }]);
    expect(rules([resp("PD", "11/2025"), resp("SD", "10.11.2025")])).toMatchObject([{ rule: "response_assessment_differs", kind: "unclear" }]);
    expect(rules([resp("PD", "10.11.2025"), resp("iUPD", "10.11.2025", "iRECIST")])).toMatchObject([{ kind: "unclear" }]);
    expect(rules([resp("PD", "10.11.2025"), resp("SD", "10.11.2025", "RECIST 1.1", "MR")])).toEqual([]);
    expect(rules([resp("PD", "10.11.2025"), resp("SD", "10.12.2025")])).toEqual([]);
  });
});

describe("chronology", () => {
  const therapy = (start: string, stop: string | null) =>
    fact("systemic_therapy", { regimen: "sunitinib", line: 2, start, stop, reason_stopped: null, text: null }, { date: date(start), status: stop ? "stopped" : "done" });

  it("raises a therapy stopped before it started, never one whose partial stop date contains the start", () => {
    expect(rules([therapy("27.1.2026", "3.1.2026")])).toMatchObject([{ rule: "therapy_stop_before_start", kind: "chronology" }]);
    expect(rules([therapy("27.1.2026", "1/2026")])).toEqual([]);
    expect(rules([therapy("27.1.2026", "8/2026")])).toEqual([]);
    expect(rules([therapy("30.4.2026", "4-5/2026")])).toEqual([]);
    expect(rules([therapy("7.4.2026", "7.4.2026 - 18.5.2026")])).toEqual([]);
  });

  it("raises a performed exam dated after the run was made (a misread year), not a planned one", () => {
    expect(rules([imaging("CT", "hrudník", "16.9.2062", ["s-orig"])])).toMatchObject([{ rule: "date_after_processing" }]);
    expect(rules([imaging("CT", "hrudník", "10/2026", ["s-orig"])])).toEqual([]);
    expect(rules([imaging("CT", "hrudník", "1.12.2026", ["s-orig"], { status: "planned" })])).toEqual([]);
    // 22:30 UTC on 19.10. is already 20.10. in Prague.
    const late = { ...input([imaging("CT", "hrudník", "20.10.2026", ["s-orig"])]), run: { created_at: "2026-10-19T22:30:00Z" } };
    expect(caseRules(late).alerts).toEqual([]);
  });

  it("raises a result dated before its request", () => {
    const result = imaging("CT", "hrudník", "1.9.2026", ["s-orig"]);
    const req = fact("request", { what: "CT hrudníku", request_kind: "exam", result_fact: result.id }, { date: date("7.9.2026"), status: "requested" });
    expect(rules([req, result])).toMatchObject([{ rule: "result_before_request", facts: [req.id, result.id], message: { args: { fact_a: result.id, fact_b: req.id } } }]);
  });
});

describe("quarantine and determinism", () => {
  it("never lets a quarantined fact into an alert: another patient's CT does not contradict this one's", () => {
    const own = fact("metastasis", { site: "játra", status: "excluded", basis: "imaging", text: null }, { date: date("2.9.2026"), negated: true });
    const other = fact("metastasis", { site: "játra", status: "confirmed", basis: "imaging", text: null }, { date: date("2.9.2026"), quarantined: true, sources: ["s-cited"] });
    const cited = imaging("CT", "hrudník", "2.9.2026", ["s-cited"], { quarantined: true });
    const out = caseRules(input([own, other, cited]));
    expect(out.alerts).toEqual([]);
    expect(out.checks.filter((c) => c.looks_for === "original_report")).toEqual([]);
  });

  it("gives the same alerts in the same order whatever the order of the facts", () => {
    const facts = [
      imaging("MR", "mozek", "14.9.2026", ["s-cited"]),
      fact("request", { what: "PET/CT", request_kind: "exam", result_fact: null }, { status: "requested" }),
      fact("medication", { drug: "Spiriva", strength: null, dosing: "1-0-1", change: null, indication: null, text: null }),
      fact("medication", { drug: "Spiriva", strength: null, dosing: "2-0-0", change: null, indication: null, text: null }),
    ];
    expect(rules([...facts].reverse())).toEqual(rules(facts));
  });
});

describe("superseded values", () => {
  const ps = (v: string, when: string | null, status: Fact["status"] = "documented") =>
    fact("performance_status", { scale: "ECOG", value_as_written: v, value_numeric: Number(v) }, { date: date(when), status });

  it("lets the newest dated value of a slot replace the older ones; undated, planned and same-date values stay", () => {
    const a = ps("1", "8.1.2026");
    const b = ps("2", "6.10.2026");
    const c = ps("3", null);
    const d = ps("0", "1.12.2026", "planned");
    expect([...supersededFacts([a, b, c, d])]).toEqual([[a.id, b.id]]);
    expect(supersededFacts([ps("1", "6.10.2026"), ps("2", "6.10.2026")]).size).toBe(0);
    const mixed = [ps("1", "1.1.2025"), ps("2", "2026"), ps("3", "1.5.2026")];
    expect([...supersededFacts(mixed)]).toEqual([...supersededFacts([...mixed].reverse())]);
  });

  it("keeps a clinical and a pathological stage apart", () => {
    const stage = (kind: "clinical" | "pathological", when: string) =>
      fact("stage", { tnm_as_written: "x", tnm: "x", stage_kind: kind, edition: null, as_of: when, at_diagnosis: null }, { date: date(when) });
    expect(supersededFacts([stage("pathological", "2.6.2022"), stage("clinical", "1.9.2026")]).size).toBe(0);
  });
});

describe("applyCaseRules on the reference cases", () => {
  const runs = { "NO-010": run10, "NO-S01": runS01, "NO-S02": runS02 } as unknown as Record<string, ExtractionRun>;

  it("keeps every run valid, records the rules stage, and keeps the alerts of other rules", () => {
    for (const [id, r] of Object.entries(runs)) {
      const out = applyCaseRules(copy(r));
      expect(validateRun(out).issues, id).toEqual([]);
      expect(out.run.stages.at(-1)).toEqual({ name: "rules", engine: "codebridge case-rules@1" });
      for (const a of r.alerts.filter((x) => !["original_report_missing", "request_without_result", "dosing_differs", "response_assessment_differs"].includes(x.rule))) {
        expect(out.alerts.map((x) => x.id), `${id} ${a.rule}`).toContain(a.id);
      }
      expect(applyCaseRules(out), id).toEqual(out);
    }
  });

  it("reproduces case 10's hand-written request, dosing and response alerts under the same IDs", () => {
    const out = applyCaseRules(copy(runs["NO-010"]!));
    for (const rule of ["request_without_result", "dosing_differs", "response_assessment_differs"]) {
      expect(byRule(out.alerts, rule).map((a) => a.id), rule).toEqual(byRule(runs["NO-010"]!.alerts, rule).map((a) => a.id));
    }
    // The five hand-picked missing reports are among the cited exams the rule groups (issue #49).
    const grouped = byRule(out.alerts, "original_reports_missing")[0]!;
    for (const a of byRule(runs["NO-010"]!.alerts, "original_report_missing")) expect(grouped.facts).toContain(a.subject);
  });

  it("reproduces S01's missing reports and request one for one", () => {
    const out = applyCaseRules(copy(runs["NO-S01"]!));
    const facts = (r: ExtractionRun, rule: string) => byRule(r.alerts, rule).map((a) => a.facts.join("+")).sort();
    for (const rule of ["original_report_missing", "request_without_result"]) expect(facts(out, rule), rule).toEqual(facts(runs["NO-S01"]!, rule));
  });
});
