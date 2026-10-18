// The FHIR R4 export: structure, codes, provenance and the trust rules, with a fixed clock and ids. The catalog is a
// stub that echoes the message ID and its arguments, so these checks see which label went where; the Czech wording
// is checked in app/test/patient-fhir.test.ts against the real catalog. Synthetic values only.
import { describe, expect, it } from "vitest";
import { fhirBundle, fhirDate, fhirJson, questionPlain, type FhirRow } from "../src/fhir-export";
import { fromFullExtraction, type Item } from "../src/case-data";
import { qState } from "../src/case-view";

const t = (id: string, args?: Record<string, string | number>) => (args ? `${id}${JSON.stringify(args)}` : id);
const NOW = "2026-10-18T10:00:00.000Z";
const deps = () => {
  let n = 0;
  return { now: NOW, uuid: () => `id-${++n}`, t };
};

const src = (page: number, quote: string) => ({ file: "10_pacient.pdf", page, quote });
const CASE: Item = {
  file: "10_pacient.pdf",
  // As the server sends it: the case data is stripped of identity, so the name's source comes with the list row.
  patient: { sex: "muž", sex_certainty: "inferred" },
  diagnosis: { code: "C64", text_cs: "Zhoubný novotvar ledviny mimo pánvičku", source: src(1, "C64 Zhoubný novotvar") },
  mdt_question: { text_cs: null, note_cs: "Otázka není formulována.", closest_source: src(3, "zadávám k projednáni") },
  summary: [{ text_cs: "Pacient po nefrektomii.", sources: [src(1, "nefrektomie vpravo")] }],
  sections: {
    imaging: [{ text_cs: "MR mozku: ložisko do 3 mm", date: "14.9.2026", source: src(1, "MR mozku"), certainty: "documented" }],
    clinical_finding: [{ text_cs: "Bez metastáz v plicích", date: "9/23", negated: true, source: src(2, "bez MTS"), certainty: "unclear_ocr" }],
    comorbidities: [{ text_cs: "Hypertenze", date: "4/2022", source: src(2, "HT") }],
    medication: [
      { text_cs: "Everolimus 10 mg", date: "4/2022", source: src(2, "everolimus") },
      { text_cs: "Kontraindikace NSAID", source: src(2, "KI NSAID") },
      { text_cs: "Snad alergie", certainty: "inferred", source: src(2, "alerg") },
    ],
  },
  timeline: [{ type: "diagnosis", date: "4/2022", label_cs: "Diagnóza C64", source: src(1, "dg. 4/2022") }],
  labs: [
    { code: "B_KREA", name_cs: "Kreatinin", value: "4,130", unit: "mmol/l", reference_range: "0,05 ... 0,1", out_of_range: "high", date: "2.6.2022", source: src(3, "B_KREA 4,130"), certainty: "documented" },
    { code: "S_X", name_cs: "X", value: "neg.", unit: "", date: null, source: src(3, "X neg.") },
  ],
  labs_note_cs: null,
  flags: [{ kind: "missing", text_cs: "Chybí histologie.", note: "Pozorování asistenta.", based_on: [src(3, "histologie")] }],
  ocr_quality_note: "Text vrstva je špatná.",
};
type Row = FhirRow & { question: string | null; qkind: string | null };
const row = (x: Partial<Row> = {}): Row => ({
  id: "NO-010",
  name: "Daniel Poláček",
  birth: null,
  explicit: false,
  question: null,
  draft: "Jaký postup?",
  qkind: "document_purpose",
  basis: [{ role: "purpose", quote: "zadávám k projednáni", source: { file: "10_pacient.pdf", page: 3 } }],
  identitySource: src(1, "Poláček Daniel"),
  ...x,
});
const build = (p = row(), edit?: Parameters<typeof qState>[1], confirm?: Parameters<typeof qState>[2]) =>
  fhirBundle({ p, cd: fromFullExtraction(CASE.file, p.id, CASE, {}), q: qState(p, edit, confirm) }, deps());
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const all = (b: any, type: string) => b.entry.map((e: any) => e.resource).filter((r: any) => r.resourceType === type);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const byUrl = (b: any, url: string) => b.entry.find((e: any) => e.fullUrl === url).resource;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const provFor = (b: any, url: string) => all(b, "Provenance").filter((p: any) => p.target[0].reference === url);

describe("fhirDate", () => {
  it("keeps the document's precision and never converts what it cannot read safely", () => {
    expect(fhirDate("2.6.2022")).toBe("2022-06-02");
    expect(fhirDate("4/2022")).toBe("2022-04");
    for (const s of ["9/23", "11/2023 až 6/2025", "", null, "1112023"]) expect(fhirDate(s)).toBeNull();
  });
});

describe("fhirBundle", () => {
  const b = build();

  it("is a collection with the Composition first, stamped with the injected clock and ids", () => {
    expect(b).toMatchObject({ resourceType: "Bundle", type: "collection", timestamp: NOW });
    expect(b.entry[0].resource.resourceType).toBe("Composition");
    expect(b.entry.every((e: { fullUrl: string }) => /^urn:uuid:id-\d+$/.test(e.fullUrl))).toBe(true);
  });

  it("identifies the patient by case ID and leaves out an inferred sex and a missing birth date", () => {
    const [pat] = all(b, "Patient");
    expect(pat.identifier).toEqual([{ system: "https://github.com/codebridgecollege/rakathon-26-codebridge/fhir/NamingSystem/case-id", value: "NO-010" }]);
    expect(pat.name).toEqual([{ text: "Daniel Poláček", family: "Poláček", given: ["Daniel"] }]);
    expect(pat).not.toHaveProperty("gender");
    expect(pat).not.toHaveProperty("birthDate");
    // A full birth date is exported; a partial one is not.
    expect(all(build(row({ birth: "2.6.1960" })), "Patient")[0].birthDate).toBe("1960-06-02");
    expect(all(build(row({ birth: "6/1960" })), "Patient")[0]).not.toHaveProperty("birthDate");
    // A sex the document states is exported.
    const doc = { ...CASE, patient: { ...CASE.patient, sex: "žena", sex_certainty: "documented" } };
    const p = row();
    expect(all(fhirBundle({ p, cd: fromFullExtraction(CASE.file, p.id, doc, {}), q: qState(p, undefined, undefined) }, deps()), "Patient")[0].gender).toBe("female");
  });

  it("gives the Patient a Provenance from the row's identity source, with the name as quoted", () => {
    const patientUrl = (x: typeof b) => x.entry.find((e: { resource: { resourceType: string } }) => e.resource.resourceType === "Patient").fullUrl;
    const [pv] = provFor(b, patientUrl(b));
    expect(pv.entity[0].extension).toEqual([
      { url: "https://github.com/codebridgecollege/rakathon-26-codebridge/fhir/StructureDefinition/source-page", valueInteger: 1 },
      { url: "https://github.com/codebridgecollege/rakathon-26-codebridge/fhir/StructureDefinition/source-quote", valueString: "Poláček Daniel" },
    ]);
    // No recorded source, no Provenance: the export never makes one up.
    const none = build(row({ identitySource: null }));
    expect(provFor(none, patientUrl(none))).toHaveLength(0);
    // Case data that still holds the source (a local extraction, not stripped by the seed) is used when the row has none.
    const p = row({ identitySource: null });
    const local = { ...CASE, patient: { ...(CASE.patient as Item), source: src(1, "Pacient z místní extrakce") } };
    const b2 = fhirBundle({ p, cd: fromFullExtraction(CASE.file, p.id, local, {}), q: qState(p, undefined, undefined) }, deps());
    expect(provFor(b2, patientUrl(b2))[0].entity[0].extension[1].valueString).toBe("Pacient z místní extrakce");
  });

  it("exports the diagnosis with the MKN-10 system and the code as given, onset from the timeline", () => {
    const dx = all(b, "Condition").find((c: Item) => c.category[0].coding[0].code === "encounter-diagnosis");
    expect(dx.code.coding).toEqual([{ system: "https://uzis.cz/terminology/CodeSystem/mkn-10", code: "C64", display: "Zhoubný novotvar ledviny mimo pánvičku" }]);
    expect(dx.onsetDateTime).toBe("2022-04");
  });

  it("keeps a lab value's written precision, its unit, range and a note with the value as written", () => {
    const json = fhirJson(b);
    expect(json).toContain('"value": 4.130,');
    const [krea, x] = all(b, "Observation").filter((o: Item) => o.category[0].coding[0].code === "laboratory" && o.code.coding?.length);
    expect(krea.code.coding).toEqual([{ system: "https://github.com/codebridgecollege/rakathon-26-codebridge/fhir/CodeSystem/fno-local-lab-code", code: "B_KREA", display: "Kreatinin" }]);
    expect(krea.referenceRange).toEqual([{ text: "0,05 ... 0,1" }]);
    expect(krea.effectiveDateTime).toBe("2022-06-02");
    // The H mark is the assistant's evaluation, and the text says so.
    expect(krea.interpretation[0]).toEqual({ coding: [{ system: "http://terminology.hl7.org/CodeSystem/v3-ObservationInterpretation", code: "H" }], text: 'patient-fhir-lab-out-of-range{"dir":"high"}' });
    // A value that is not a number stays text; a missing date is said, never filled.
    expect(x.valueString).toBe("neg.");
    expect(x).not.toHaveProperty("effectiveDateTime");
    expect(x.note.map((n: Item) => n.text)).toContain("patient-fhir-lab-no-date");
  });

  it("keeps an unreadable date as a note and a negation as stated, with the reading preliminary", () => {
    const o = all(b, "Observation").find((x: Item) => x.valueString === "Bez metastáz v plicích");
    expect(o.status).toBe("preliminary");
    expect(o).not.toHaveProperty("effectiveDateTime");
    expect(o.note).toEqual([{ text: "patient-fhir-negated" }, { text: 'patient-fhir-date-in-doc{"date":"9/23"}' }]);
  });

  it("exports past treatment with status unknown and keeps a comorbidity's date as a note, not an onset", () => {
    const hyp = all(b, "Condition").find((c: Item) => c.code.text === "Hypertenze");
    expect(hyp).not.toHaveProperty("onsetDateTime");
    expect(hyp.note).toEqual([{ text: 'patient-fhir-date-in-doc{"date":"4/2022"}' }]);
    const withTx = { ...CASE, sections: { past_treatment: [{ text_cs: "Nefrektomie vpravo", date: "4/2022", source: src(1, "NE") }] } };
    const p = row();
    const [proc] = all(fhirBundle({ p, cd: fromFullExtraction(CASE.file, p.id, withTx, {}), q: qState(p, undefined, undefined) }, deps()), "Procedure");
    expect(proc).toMatchObject({ status: "unknown", performedDateTime: "2022-04", code: { text: "Nefrektomie vpravo" } });
  });

  it("never exports a contraindicated drug as a medication, and an inference only as the assistant's observation", () => {
    expect(all(b, "Flag").map((f: Item) => f.code.text)).toEqual(["Kontraindikace NSAID"]);
    expect(all(b, "MedicationStatement").map((m: Item) => m.medicationCodeableConcept.text)).toEqual(["Everolimus 10 mg"]);
    expect(fhirJson(b)).not.toMatch(/"valueString": "Snad alergie"|"text": "Snad alergie"/);
  });

  it("writes flags as DetectedIssues by the assistant Device, implicating their documents", () => {
    const [device] = all(b, "Device");
    const deviceUrl = b.entry.find((e: Item) => e.resource === device).fullUrl;
    const issues = all(b, "DetectedIssue");
    expect(issues.map((i: Item) => i.code.coding[0].code).sort()).toEqual(["missing", "unclear"]);
    const missing = issues.find((i: Item) => i.code.coding[0].code === "missing");
    expect(missing).toMatchObject({ status: "preliminary", author: { reference: deviceUrl }, detail: "Chybí histologie. (Pozorování asistenta.)" });
    expect(byUrl(b, missing.implicated[0].reference).resourceType).toBe("DocumentReference");
  });

  it("gives every fact a Provenance with the document, the page and the quote", () => {
    const facts = b.entry.filter((e: Item) => !["Provenance", "Device", "DocumentReference", "Composition"].includes(e.resource.resourceType));
    for (const f of facts) expect(provFor(b, f.fullUrl).length, f.resource.resourceType).toBeGreaterThan(0);
    const lab = b.entry.find((e: Item) => e.resource.code?.text === "Kreatinin");
    const [pv] = provFor(b, lab.fullUrl);
    expect(pv.recorded).toBe(NOW);
    expect(pv.entity[0].extension).toEqual([
      { url: "https://github.com/codebridgecollege/rakathon-26-codebridge/fhir/StructureDefinition/source-page", valueInteger: 3 },
      { url: "https://github.com/codebridgecollege/rakathon-26-codebridge/fhir/StructureDefinition/source-quote", valueString: "B_KREA 4,130" },
    ]);
    expect(byUrl(b, pv.entity[0].what.reference)).toMatchObject({ resourceType: "DocumentReference", content: [{ attachment: { url: "10_pacient.pdf" } }] });
  });

  it("is a preliminary Composition with the fixed sections, and empty sections say the gap", () => {
    const comp = b.entry[0].resource;
    expect(comp.status).toBe("preliminary");
    expect(comp.section.map((s: Item) => s.title)).toEqual([
      "patient-fhir-sec-question",
      "patient-fhir-sec-summary",
      "patient-fhir-sec-course",
      "patient-fhir-sec-conditions",
      "patient-fhir-sec-findings",
      "patient-fhir-sec-treatment",
      "patient-fhir-sec-medication",
      "patient-fhir-sec-drug-flags",
      "patient-fhir-sec-labs",
      "patient-fhir-sec-observations",
      "patient-fhir-sec-notes",
    ]);
    const treatment = comp.section[5];
    expect(treatment.emptyReason.coding[0].code).toBe("unavailable");
    // A summary sentence's Provenance points at that sentence.
    const sent = provFor(b, b.entry[0].fullUrl).find((p: Item) => p.target[0].extension?.[0].valueUri === "s1");
    expect(sent.entity[0].extension[1].valueString).toBe("nefrektomie vpravo");
  });

  it("exports a drafted question labelled as a draft, with a Provenance for the passages it rests on", () => {
    const q = b.entry[0].resource.section[0].text.div;
    expect(q).toContain("Jaký postup? patient-fhir-q-draft{&quot;kind&quot;:&quot;document_purpose&quot;} patient-fhir-basis");
    const draftProv = provFor(b, b.entry[0].fullUrl).find((p: Item) => p.activity.text === "patient-fhir-activity-q-draft");
    expect(draftProv.entity[0].extension[1].valueString).toBe("zadávám k projednáni");
    // An explicit question has no draft Provenance.
    const ex = build(row({ explicit: true, question: "Otázka?" }));
    expect(provFor(ex, ex.entry[0].fullUrl).some((p: Item) => p.activity.text === "patient-fhir-activity-q-draft")).toBe(false);
  });

  it("exports a doctor's edited question with its tag", () => {
    const e = build(row(), { text: "Resekce?", by: "MUDr. Novák", when: "1. 1. 2026" });
    expect(e.entry[0].resource.section[0].text.div).toContain("Resekce? patient-fhir-q-edited{&quot;explicit&quot;:&quot;no&quot;}");
  });

  it("states the gap with the extraction's note when there is no question and no draft", () => {
    const g = build(row({ draft: null, basis: null }));
    expect(g.entry[0].resource.section[0].text.div).toBe('<div xmlns="http://www.w3.org/1999/xhtml">patient-fhir-gap Otázka není formulována.</div>');
  });
});

describe("questionPlain", () => {
  it("names who confirmed a draft and when", () => {
    const p = row();
    expect(questionPlain(t, qState(p, undefined, { text: null, by: "MUDr. A", when: "1. 1. 2026" }))).toMatch(/^Jaký postup\? patient-fhir-q-confirmed\{"by":"MUDr. A","when":"1. 1. 2026"\} patient-fhir-basis/);
    expect(questionPlain(t, qState(row({ draft: null }), undefined, undefined))).toBe("patient-fhir-q-none");
  });
});
