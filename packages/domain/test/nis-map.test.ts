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
    // A dose is not a year.
    expect(czechDate("2000 mg od 2019")).toMatchObject({ precision: null, sort: null });
    expect(czechDate("diag. 2019")).toMatchObject({ precision: "year", sort: "2019" });
  });

  it("sorts a time with an offset in Prague time, so the day is the hospital's", () => {
    expect(fhirDate("2026-03-17T23:30:00Z").sort).toBe("2026-03-18T00:30");
    expect(fhirDate("2026-10-06T05:30:00Z").sort).toBe("2026-10-06T07:30");
    expect(fhirDate("2026-10-06T07:30:00+02:00").sort).toBe("2026-10-06T07:30");
    // Across the end of summer time (25.10.2026 03:00 CEST becomes 02:00 CET).
    expect(fhirDate("2026-10-25T01:30:00Z").sort).toBe("2026-10-25T02:30");
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

  it("keeps a comparator in the value and gives it no number", () => {
    const m = mapNisResources(SYS, [lab("c", { valueQuantity: { value: 0.5, comparator: "<", unit: "µg/l" } })]);
    expect(m.drafts[0]!.value).toMatchObject({ value_as_written: "<0.5", value_numeric: null, unit: "µg/l" });
  });

  it("keys a lab draw the same whichever offset the NIS writes, and marks several ranges for checking", () => {
    const a = nisRun({ caseId: "X", system: SYS, resources: [lab("o1")], runId: "r1", createdAt: "2026-10-19T10:00:00Z", previous: null, supersedes: null });
    const b = nisRun({ caseId: "X", system: SYS, resources: [lab("o1", { effectiveDateTime: "2026-10-06T05:30:00Z" })], runId: "r2", createdAt: "2026-10-19T10:00:00Z", previous: a.run, supersedes: "r1" });
    expect(b.run.facts[0]!.key).toBe(a.run.facts[0]!.key);
    expect(b.run.facts[0]!.id).toBe(a.run.facts[0]!.id);
    const two = mapNisResources(SYS, [lab("o2", { referenceRange: [{ text: "59 ... 104" }, { text: "44 ... 80" }] })]);
    expect(two.drafts[0]).toMatchObject({ certainty: "verify", certainty_reason: { code: "nis_several_ranges" } });
  });

  it("skips a lab without a name, and says a dateless draw is not stated", () => {
    const m = mapNisResources(SYS, [lab("n", { code: {} }), lab("d", { effectiveDateTime: undefined })]);
    expect(m.skipped).toEqual([{ resource: "Observation/n", reason: "no_text" }]);
    expect(m.drafts[0]).toMatchObject({ not_stated: ["draw"], date: { as_written: null } });
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
    // Two primary cancer codes (a and b): which one the MDT discusses is not stated, so neither is marked primary.
    expect(m.drafts.map((d) => [d.kind === "diagnosis" && d.value.disease_status, d.negated, d.kind === "diagnosis" && d.value.primary])).toEqual([
      [null, false, false],
      ["suspected", false, false],
      [null, true, false],
      [null, false, false],
    ]);
    expect(m.drafts[0]!.date).toEqual({ as_written: "diag. 12/2025", precision: "month", sort: "2025-12" });
    expect(m.drafts[0]!.codes).toEqual([{ system: "mkn-10", code: "C711", assigned_by: "source" }]);
    const one = mapNisResources(SYS, [cond("a", "confirmed"), cond("m", "confirmed", { code: { coding: [{ system: "https://uzis.cz/terminology/CodeSystem/mkn-10", code: "C787" }], text: "Sekundární ZN jater" } })]);
    expect(one.drafts.map((d) => d.kind === "diagnosis" && d.value.primary)).toEqual([true, false]);
  });

  it("leaves out a condition entered in error, and marks a resolved one for checking with its end", () => {
    const base = { resourceType: "Condition", meta, code: { coding: [{ system: "https://uzis.cz/terminology/CodeSystem/mkn-10", code: "C50" }], text: "Ca prsu" } };
    const m = mapNisResources(SYS, [
      { ...base, id: "e", verificationStatus: { coding: [{ code: "entered-in-error" }] } },
      { ...base, id: "r", clinicalStatus: { coding: [{ code: "resolved" }] }, abatementDateTime: "2020-05", recordedDate: "2024-01-02" },
    ]);
    expect(m.skipped).toEqual([{ resource: "Condition/e", reason: "void_status" }]);
    expect(m.drafts).toHaveLength(1);
    expect(m.drafts[0]).toMatchObject({ certainty: "verify", certainty_reason: { code: "nis_resolved", text: "V NIS uzavřeno k 2020-05." } });
    // recordedDate is when the entry was made, not the diagnosis date.
    expect(m.drafts[0]).toMatchObject({ date: { as_written: null }, not_stated: ["date"] });
  });

  it("keeps clinical, pathological and post-neoadjuvant stages apart and maps no stage of unknown kind", () => {
    const st = (id: string, code: Record<string, unknown>, value: string) => ({ resourceType: "Observation", id, meta, status: "final", code, effectiveDateTime: "2026-03-17", valueString: value });
    const m = mapNisResources(SYS, [
      st("c", { text: "Klinické stadium TNM (cTNM)" }, "cT3b cN1 cM0"),
      st("y", { text: "Stadium po neoadjuvanci (ypTNM)" }, "ypT2 ypN0"),
      st("p", { coding: [{ system: "http://loinc.org", code: "21902-2" }] }, "pT2a pN1 M0"),
      st("u", { text: "Stadium TNM" }, "T2 N0"),
      st("t", { coding: [{ system: "http://loinc.org", code: "21899-0" }], text: "pT" }, "pT3"),
      st("yc", { text: "ycTNM" }, "ycT2 ycN0"),
      st("two", { text: "Klinické stadium, patologicky ověřeno" }, "T2 N0"),
    ]);
    expect(m.drafts.map((d) => d.kind === "stage" && [d.value.stage_kind, d.value.tnm_as_written, d.value.tnm, d.value.as_of])).toEqual([
      ["clinical", "cT3b cN1 cM0", null, "2026-03-17"],
      ["post_neoadjuvant", "ypT2 ypN0", null, "2026-03-17"],
      ["pathological", "pT2a pN1 M0", null, "2026-03-17"],
    ]);
    expect(m.skipped).toEqual([
      { resource: "Observation/u", reason: "stage_kind_unknown" },
      { resource: "Observation/t", reason: "tnm_component" },
      { resource: "Observation/yc", reason: "stage_kind_ambiguous" },
      { resource: "Observation/two", reason: "stage_kind_ambiguous" },
    ]);
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
    // The NIS never answers for the documents: no "nothing_found", and every kind has a check.
    expect(run.checks.find((c) => c.looks_for === "histology")?.result).toBe("not_run");
    expect(run.checks).toHaveLength(26);
    expect(run.checks.some((c) => c.result === "nothing_found")).toBe(false);
  });

  it("links a versioned or absolute basedOn of this NIS, the final report first, and never another server's", () => {
    const report = (id: string, ref: string, status = "final") => ({ ...rad, id, status, basedOn: [{ reference: ref }] });
    const m1 = mapNisResources(SYS, [sr("mr", "completed"), report("r2", `${SYS}/ServiceRequest/mr/_history/3`), report("r1", "ServiceRequest/mr", "preliminary")]);
    expect(m1.drafts.find((d) => d.kind === "request")!.value).toMatchObject({ result_fact: "draft:DiagnosticReport/r2" });
    const m2 = mapNisResources(SYS, [sr("mr", "completed"), report("r9", "https://other.example/fhir/ServiceRequest/mr")]);
    expect(m2.drafts.find((d) => d.kind === "request")!.value).toMatchObject({ result_fact: null });
  });

  it("does not call a check complete when records of its kind were skipped or cut off", () => {
    const stageSkip = { resourceType: "Observation", id: "s", meta, status: "final", code: { text: "Stadium TNM" }, valueString: "T2" };
    const a = nisRun({ caseId: "X", system: SYS, resources: [sr("pet"), stageSkip], runId: "r", createdAt: "2026-10-19T10:00:00Z", previous: null, supersedes: null });
    expect(a.run.checks.find((c) => c.looks_for === "request")?.result).toBe("found");
    expect(a.run.checks.find((c) => c.looks_for === "stage")?.result).toBe("not_run");
    const b = nisRun({ caseId: "X", system: SYS, resources: [sr("pet")], runId: "r", createdAt: "2026-10-19T10:00:00Z", previous: null, supersedes: null, truncated: ["ServiceRequest"] });
    expect(b.run.checks.find((c) => c.looks_for === "request")?.result).toBe("not_run");
  });

  it("maps medication and procedures without inventing a status the record does not give", () => {
    const m = mapNisResources(SYS, [
      { resourceType: "MedicationStatement", id: "m1", meta, status: "unknown", medicationCodeableConcept: { text: "Enoxaparin" }, effectivePeriod: { start: "2026-02-24" }, dosage: [{ text: "80 mg s.c. á 12 hod." }] },
      { resourceType: "MedicationStatement", id: "m2", meta, status: "not-taken", medicationCodeableConcept: { text: "Warfarin" } },
      { resourceType: "Procedure", id: "p1", meta, status: "completed", code: { text: "Nízká přední resekce rekta" }, performedDateTime: "2026-08-11" },
      { resourceType: "Procedure", id: "p2", meta, status: "in-progress", code: { text: "Radioterapie" }, performedPeriod: { start: "2026-10-01" } },
      { resourceType: "MedicationStatement", id: "m3", meta, status: "completed", medicationCodeableConcept: { text: "Kapecitabin" }, effectivePeriod: { start: "2026-04-07", end: "2026-05-18" } },
      { resourceType: "Patient", id: "pt", meta },
    ]);
    expect(m.drafts.map((d) => [d.kind, d.status, d.negated])).toEqual([
      ["medication", "documented", false],
      ["medication", "documented", true],
      ["procedure", "done", false],
      ["procedure", "documented", false],
      ["medication", "stopped", false],
    ]);
    expect(m.drafts[3]!.value).toMatchObject({ text: "probíhá (dle NIS)" });
    // A stopped drug's end date is its stop, as the record writes it; the text keeps only the status.
    expect(m.drafts[4]!.value).toMatchObject({ text: "ukončeno (dle NIS dokončeno)", stop_as_written: "2026-05-18" });
    expect(m.drafts[0]!.value).toMatchObject({ drug: "Enoxaparin", dosing: "80 mg s.c. á 12 hod.", strength: null });
    expect(m.skipped.map((s) => s.reason)).toEqual(["not_clinical"]);
  });

  it("maps an Encounter to a visit: type from its class, the rest as written, no visit type guessed", () => {
    const enc = (id: string, extra: Record<string, unknown>) => ({ resourceType: "Encounter", id, meta, status: "finished", ...extra });
    const m = mapNisResources(SYS, [
      enc("a", { class: { system: "http://terminology.hl7.org/CodeSystem/v3-ActCode", code: "AMB" }, type: [{ text: "Ambulantní vyšetření kontrolní" }], serviceProvider: { reference: "Organization/x", display: "Onkologická ambulance" }, period: { start: "2026-10-06", end: "2026-10-06" } }),
      enc("b", { class: { code: "IMP" }, reasonCode: [{ text: "Plánovaná operace" }], period: { start: "2026-08-10T08:00:00+02:00" } }),
      enc("c", { class: { code: "VR" }, status: "planned" }),
      enc("d", { class: { code: "AMB" }, status: "cancelled" }),
      enc("e", { class: { code: "AMB" }, status: "entered-in-error" }),
      enc("f", { class: { system: "https://example.cz/local", code: "AMB" }, status: "in-progress", type: [{ coding: [{ system: "http://snomed.info/sct", code: "11429006", display: "Konzultace" }] }] }),
    ]);
    expect(m.drafts.map((d) => [d.kind, d.status, d.value, d.date.sort])).toEqual([
      ["visit", "done", { type: "outpatient", type_as_written: "Ambulantní vyšetření kontrolní", department: "Onkologická ambulance", reason: null, end_as_written: "2026-10-06" }, "2026-10-06"],
      ["visit", "done", { type: "admission", type_as_written: null, department: null, reason: "Plánovaná operace", end_as_written: null }, "2026-08-10T08:00"],
      ["visit", "planned", { type: "other", type_as_written: null, department: null, reason: null, end_as_written: null }, null],
      // A local "AMB" is not HL7's; a visit still going on is documented, not done; a coded type keeps its code.
      ["visit", "documented", { type: "other", type_as_written: "Konzultace", department: null, reason: null, end_as_written: null }, null],
    ]);
    expect(m.drafts[3]!.codes).toEqual([{ system: "snomed-ct", code: "11429006", assigned_by: "source", display: "Konzultace" }]);
    expect(m.drafts[2]!.not_stated).toEqual(["date"]);
    expect(m.skipped).toEqual([
      { resource: "Encounter/d", reason: "void_status" },
      { resource: "Encounter/e", reason: "void_status" },
    ]);
    const { run, validation } = nisRun({ caseId: "X", system: SYS, resources: [enc("a", { class: { code: "AMB" }, period: { start: "2026-10-06" } })], runId: "r", createdAt: "2026-10-19T10:00:00Z", previous: null, supersedes: null });
    expect(validation.issues).toEqual([]);
    expect(run.facts[0]!.key).toBe("visit|outpatient|2026-10-06");
    expect(run.checks.find((c) => c.looks_for === "visit")?.result).toBe("found");
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
