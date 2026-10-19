// NIS records into extraction/2 facts (issue #22, phase 2): the per-resource rules on small hand-made resources.
// The whole test patients (S01, S02, case 10, F01-F04) run through the Worker's tests (api/test/nis-map.test.ts).
import { describe, expect, it } from "vitest";
import { czechDate, fhirDate, mapNisResources, nisRun } from "../src/nis-map";

const SYS = "https://nis.test/fhir";
const LAB = { coding: [{ system: "http://terminology.hl7.org/CodeSystem/observation-category", code: "laboratory" }] };
const meta = { versionId: "3", lastUpdated: "2026-10-01T08:00:00Z" };
const lab = (id: string, extra: Record<string, unknown> = {}) => ({
  resourceType: "Observation", id, meta, status: "final", category: [LAB],
  code: { coding: [{ system: "https://github.com/codebridgecollege/rakathon-26-codebridge/fhir/CodeSystem/fno-local-lab-code", code: "S_CREAE" }], text: "Kreatinin" },
  effectiveDateTime: "2026-10-06T07:30:00+02:00",
  valueQuantity: { value: 142, unit: "µmol/l" },
  referenceRange: [{ low: { value: 59, unit: "µmol/l" }, high: { value: 104, unit: "µmol/l" }, text: "59 ... 104" }],
  ...extra,
});

describe("dates", () => {
  it("keeps the precision the record gives, never adds a day or a time", () => {
    expect(fhirDate("2025-12")).toEqual({ as_written: "2025-12", precision: "month", sort: "2025-12" });
    expect(fhirDate("2026-10-06T07:30:00+02:00")).toEqual({ as_written: "2026-10-06T07:30:00+02:00", precision: "minute", sort: "2026-10-06T07:30" });
    expect(czechDate("diag. 12/2025")).toEqual({ as_written: "diag. 12/2025", precision: "month", sort: "2025-12" });
    expect(czechDate("DUS 24.2.2026")).toMatchObject({ precision: "day", sort: "2026-02-24" });
    expect(czechDate("diag. 4/2022")).toMatchObject({ precision: "month", sort: "2022-04" });
    expect(czechDate("někdy loni")).toEqual({ as_written: "někdy loni", precision: null, sort: null });
  });
});

describe("lab results", () => {
  it("keeps value, unit, range and the FNO code as given, with a nis source", () => {
    const m = mapNisResources(SYS, [lab("o1")]);
    const f = m.drafts[0]!;
    expect(f).toMatchObject({ kind: "lab_result", origin: "nis", certainty: "clear", status: "documented" });
    expect(f.codes).toEqual([{ system: "fno-local-lab", code: "S_CREAE", assigned_by: "source" }]);
    expect(f.value).toMatchObject({
      name_as_written: "Kreatinin", value_as_written: "142", value_numeric: 142, unit_as_written: "µmol/l", unit: "µmol/l",
      reference_range: "59 ... 104", reference_low: 59, reference_high: 104, out_of_range: null, out_of_range_origin: null,
    });
    expect(m.sources).toEqual([{ id: f.sources[0], type: "nis", system: SYS, resource: "Observation/o1", version: "3", last_updated: "2026-10-01T08:00:00Z" }]);
  });

  it("flags out of range only where the record does, and keeps an unknown code system under its URI", () => {
    const m = mapNisResources(SYS, [
      lab("o2", { interpretation: [{ coding: [{ system: "http://terminology.hl7.org/CodeSystem/v3-ObservationInterpretation", code: "H" }] }] }),
      lab("o3", { code: { coding: [{ system: "https://example.cz/nclp", code: "03096" }], text: "Kreatinin" } }),
    ]);
    expect(m.drafts[0]!.value).toMatchObject({ out_of_range: "high", out_of_range_origin: "document" });
    // 142 is above 104, but the record carries no flag: the mapping does not compute one.
    expect(m.drafts[1]!.value).toMatchObject({ out_of_range: null });
    expect(m.drafts[1]!.codes).toEqual([{ system: "https://example.cz/nclp", code: "03096", assigned_by: "source" }]);
  });

  it("marks a preliminary result for checking and leaves out a void one", () => {
    const m = mapNisResources(SYS, [lab("p", { status: "preliminary" }), lab("x", { status: "entered-in-error" })]);
    expect(m.drafts).toHaveLength(1);
    expect(m.drafts[0]).toMatchObject({ certainty: "verify", certainty_reason: { code: "nis_preliminary" } });
    expect(m.skipped).toEqual([{ resource: "Observation/x", reason: "void_status" }]);
  });
});

describe("diagnoses and stages", () => {
  it("states disease status only where the record does; a refuted diagnosis is negated", () => {
    const cond = (id: string, ver: string, extra: Record<string, unknown> = {}) => ({
      resourceType: "Condition", id, meta,
      verificationStatus: { coding: [{ code: ver }] },
      code: { coding: [{ system: "https://uzis.cz/terminology/CodeSystem/mkn-10", code: "C711" }], text: "Zhoubný novotvar čelního laloku" },
      onsetString: "diag. 12/2025",
      ...extra,
    });
    const m = mapNisResources(SYS, [cond("a", "confirmed"), cond("b", "provisional"), cond("c", "refuted"), cond("d", "confirmed", { code: { coding: [{ system: "https://uzis.cz/terminology/CodeSystem/mkn-10", code: "I802" }], text: "Flebitida" } })]);
    expect(m.drafts.map((d) => [d.kind === "diagnosis" && d.value.disease_status, d.negated, d.kind === "diagnosis" && d.value.primary])).toEqual([
      [null, false, true],
      ["suspected", false, true],
      [null, true, true],
      [null, false, false],
    ]);
    expect(m.drafts[0]!.date).toEqual({ as_written: "diag. 12/2025", precision: "month", sort: "2025-12" });
    expect(m.drafts[0]!.codes).toEqual([{ system: "mkn-10", code: "C711", assigned_by: "source" }]);
  });

  it("keeps clinical, pathological and post-neoadjuvant stages apart and maps no stage of unknown kind", () => {
    const st = (id: string, code: Record<string, unknown>, value: string) => ({ resourceType: "Observation", id, meta, status: "final", code, effectiveDateTime: "2026-03-17", valueString: value });
    const m = mapNisResources(SYS, [
      st("c", { text: "Klinické stadium TNM (cTNM)" }, "cT3b cN1 cM0"),
      st("y", { text: "Stadium po neoadjuvanci (ypTNM)" }, "ypT2 ypN0"),
      st("p", { coding: [{ system: "http://loinc.org", code: "21902-2" }] }, "pT2a pN1 M0"),
      st("u", { text: "Stadium TNM" }, "T2 N0"),
    ]);
    expect(m.drafts.map((d) => d.kind === "stage" && [d.value.stage_kind, d.value.tnm_as_written, d.value.tnm, d.value.as_of])).toEqual([
      ["clinical", "cT3b cN1 cM0", null, "2026-03-17"],
      ["post_neoadjuvant", "ypT2 ypN0", null, "2026-03-17"],
      ["pathological", "pT2a pN1 M0", null, "2026-03-17"],
    ]);
    expect(m.skipped).toEqual([{ resource: "Observation/u", reason: "stage_kind_unknown" }]);
  });
});

describe("requests, reports, treatment", () => {
  const sr = (id: string, status = "active") => ({ resourceType: "ServiceRequest", id, meta, status, intent: "order", code: { text: id === "mr" ? "MR mozku" : "PET/CT" }, authoredOn: "2026-09-01" });
  const rad = { resourceType: "DiagnosticReport", id: "r1", meta, status: "final", category: [{ coding: [{ system: "http://terminology.hl7.org/CodeSystem/v2-0074", code: "RAD" }] }], code: { text: "MR mozku" }, basedOn: [{ reference: "ServiceRequest/mr" }], effectiveDateTime: "2026-09-08", conclusion: "Bez ložiskových změn." };

  it("links a request to its report and leaves the one without a report requested, with no result", () => {
    const { run, validation } = nisRun({ caseId: "NO-X", system: SYS, resources: [sr("mr", "completed"), rad, sr("pet")], runId: "run-1", createdAt: "2026-10-19T10:00:00Z", previous: null, supersedes: null });
    expect(validation.issues).toEqual([]);
    const img = run.facts.find((f) => f.kind === "imaging")!;
    expect(img.value).toEqual({ modality: "MR", region: "mozku", finding_text: "Bez ložiskových změn.", response: null });
    const reqs = run.facts.filter((f) => f.kind === "request");
    expect(reqs.map((f) => f.kind === "request" && [f.value.what, f.status, f.value.result_fact])).toEqual([
      ["MR mozku", "done", img.id],
      ["PET/CT", "requested", null],
    ]);
    expect(run.run.producer).toBe("nis");
    expect(run.checks.find((c) => c.looks_for === "request")?.result).toBe("found");
    expect(run.checks.find((c) => c.looks_for === "histology")?.result).toBe("nothing_found");
  });

  it("maps medication and procedures without inventing a status the record does not give", () => {
    const m = mapNisResources(SYS, [
      { resourceType: "MedicationStatement", id: "m1", meta, status: "unknown", medicationCodeableConcept: { text: "Enoxaparin" }, effectivePeriod: { start: "2026-02-24" }, dosage: [{ text: "80 mg s.c. á 12 hod." }] },
      { resourceType: "MedicationStatement", id: "m2", meta, status: "not-taken", medicationCodeableConcept: { text: "Warfarin" } },
      { resourceType: "Procedure", id: "p1", meta, status: "completed", code: { text: "Nízká přední resekce rekta" }, performedDateTime: "2026-08-11" },
      { resourceType: "Encounter", id: "e1", meta, status: "finished" },
      { resourceType: "Patient", id: "pt", meta },
    ]);
    expect(m.drafts.map((d) => [d.kind, d.status, d.negated])).toEqual([
      ["medication", "documented", false],
      ["medication", "documented", true],
      ["procedure", "done", false],
    ]);
    expect(m.drafts[0]!.value).toMatchObject({ drug: "Enoxaparin", dosing: "80 mg s.c. á 12 hod.", strength: null });
    expect(m.skipped.map((s) => s.reason)).toEqual(["no_fact_kind", "not_clinical"]);
  });

  it("keeps fact IDs across a refresh and gives a changed value a new source version", () => {
    const first = nisRun({ caseId: "NO-X", system: SYS, resources: [lab("o1")], runId: "run-1", createdAt: "2026-10-19T10:00:00Z", previous: null, supersedes: null });
    const corrected = lab("o1", { meta: { versionId: "4", lastUpdated: "2026-10-02T08:00:00Z" }, valueQuantity: { value: 124, unit: "µmol/l" } });
    const second = nisRun({ caseId: "NO-X", system: SYS, resources: [corrected], runId: "run-2", createdAt: "2026-10-20T10:00:00Z", previous: first.run, supersedes: "run-1" });
    expect(second.run.facts[0]!.id).toBe(first.run.facts[0]!.id);
    expect(second.run.sources[0]!.id).not.toBe(first.run.sources[0]!.id);
    expect(second.run.sources[0]).toMatchObject({ version: "4" });
    expect(second.validation.ok).toBe(true);
  });
});
