// Writes test/extraction-key-vectors.json: inputs and the keys and IDs keys.ts builds for them. The TypeScript and the
// Python tests (pipeline/tests/test_extraction_format.py) both check against this file, so a key built by the Python
// pipeline equals the one the Worker builds. Rerun only on a deliberate key change, and say so in the change: every
// changed key moves doctor confirmations to the matcher's similarity step.
//
//   node packages/domain/scripts/extraction-key-vectors.ts      (Node 23.6 or newer runs TypeScript directly)
import { writeFileSync } from "node:fs";
import { alertId, buildFactKey, dateSeg, fnv1a32, normText, pairSubject } from "../src/extraction/keys.ts";
import type { DraftFact, FactDate, Source } from "../src/extraction/types.ts";

const undated: FactDate = { as_written: null, precision: null, sort: null };
const day = (as_written: string, sort: string): FactDate => ({ as_written, precision: "day", sort });

const sources: Source[] = [
  { id: "src-a", type: "document", document_id: "10_pacient", part: "10_pacient/p2", page: 3, quote: "S_HSCRP: 9,5 mg/1 [O ... 5]", quote_text: "tesseract", anchor: null, reported_as: "original", identity: "matches", reading_check: null },
  { id: "src-b", type: "document", document_id: "10_lab", part: null, page: 1, quote: "Kreatinin 107", quote_text: "pdf_text", anchor: null, reported_as: "original", identity: "matches", reading_check: null },
  { id: "src-n", type: "nis", system: "https://nis.fno.example/fhir", resource: "Observation/8812", version: "3", last_updated: null },
];

const frame = {
  subject: "patient" as const,
  status: "documented" as const,
  negated: false,
  not_stated: [],
  origin: "document" as const,
  certainty: "clear" as const,
  codes: [],
  note: null,
  quarantined: false,
  sources: ["src-a"],
};

const facts: DraftFact[] = [
  { ...frame, kind: "lab_result", date: undated, codes: [{ system: "fno-local-lab", code: "S_HSCRP", assigned_by: "source" }], value: { name_as_written: "hsCRP", value_as_written: "9,5", value_numeric: 9.5, unit_as_written: "mg/1", unit: "mg/l", reference_range: "0 ... 5", reference_low: 0, reference_high: 5, out_of_range: "high", out_of_range_origin: "assistant", draw: { as_written: null, requisition: null, specimen: null } } },
  { ...frame, kind: "lab_result", date: day("17.9.2026 7:40", "2026-09-17"), sources: ["src-b", "src-n"], value: { name_as_written: "Kreatinin  ", value_as_written: "107", value_numeric: 107, unit_as_written: "µmol/l", unit: "µmol/l", reference_range: "59 ... 104", reference_low: 59, reference_high: 104, out_of_range: "high", out_of_range_origin: "document", draw: { as_written: "17.9.2026  7:40", requisition: "Ž 2611|04", specimen: "sérum" } } },
  { ...frame, kind: "diagnosis", date: day("2.6.2022", "2022-06-02"), codes: [{ system: "mkn-10", code: "C64", assigned_by: "source" }], value: { text: "Světlobuněčný karcinom ledviny", disease_status: "confirmed_histology", primary: true } },
  { ...frame, kind: "diagnosis", date: undated, value: { text: "Hypertenzní nemoc.", disease_status: null, primary: false } },
  { ...frame, kind: "histology", date: day("2.6.2022", "2022-06-02"), value: { specimen: "Ledvina vlevo", result_text: "ccRCC", tumour_type: "světlobuněčný", grade: "G2" } },
  { ...frame, kind: "stage", date: day("2.6.2022", "2022-06-02"), value: { tnm_as_written: "pT2a pN1(3+/5) MO", tnm: "pT2a pN1 M0", stage_kind: "pathological", edition: null, as_of: "2.6.2022", at_diagnosis: true } },
  { ...frame, kind: "metastasis", date: { as_written: "03/2023", precision: "month", sort: "2023-03" }, negated: true, value: { site: "Mozek", status: "excluded", basis: "clinical", text: null } },
  { ...frame, kind: "procedure", date: { as_written: "4/2022", precision: "month", sort: "2022-04" }, value: { name: "Nefrektomie", region: "vlevo", text: null } },
  { ...frame, kind: "systemic_therapy", date: undated, value: { regimen: "Everolimus", line: 3, start: "9/2026", stop: null, reason_stopped: null, text: null } },
  { ...frame, kind: "radiotherapy", date: { as_written: "2024", precision: "year", sort: "2024" }, value: { target: "Th10", dose: "8 Gy", fractions: "1", text: null } },
  { ...frame, kind: "imaging", date: day("14.9.2026", "2026-09-14"), value: { modality: "MR", region: "Mozek", finding_text: "ložisko 3 mm", response: null } },
  { ...frame, kind: "vital_sign", date: undated, value: { what: "blood_pressure", label_as_written: "TK", value_as_written: "135/80", value_numeric: null, unit: "mmHg" } },
  { ...frame, kind: "vital_sign", date: undated, value: { what: "other", label_as_written: "Obvod pasu", value_as_written: "98", value_numeric: 98, unit: "cm" } },
  { ...frame, kind: "performance_status", date: undated, value: { scale: "ECOG", value_as_written: "1", value_numeric: 1 } },
  { ...frame, kind: "exam_finding", date: undated, value: { region: "Břicho", text: "Měkké, nebolestivé." } },
  { ...frame, kind: "symptom", date: undated, negated: true, value: { text: "Bolesti hlavy" } },
  { ...frame, kind: "comorbidity", date: undated, codes: [{ system: "mkn-10", code: "I10", assigned_by: "source" }], value: { text: "Hypertenze" } },
  { ...frame, kind: "comorbidity", date: undated, value: { text: "  CHOPN   II. st.  " } },
  { ...frame, kind: "medication", date: day("19.9.2026", "2026-09-19"), value: { drug: "Afinitor", strength: "10 mg", dosing: "1-0-0", change: "navýšení", indication: null, text: null } },
  { ...frame, kind: "contraindication", date: undated, value: { what: "ACE inhibitor s everolimem", stated_by: "assistant" } },
  { ...frame, kind: "allergy", date: undated, value: { substance: "Penicilin", reaction: null } },
  { ...frame, kind: "adverse_event", date: undated, value: { text: "Stomatitida G2", grade: "2", related_therapy: "everolimus" } },
  { ...frame, kind: "prognostic_score", date: undated, value: { score: "IMDC", value_as_written: "1", risk_group: "intermediární" } },
  { ...frame, kind: "risk_factor", date: undated, value: { type: "smoking", text: "kuřák", pack_years: 20 } },
  { ...frame, kind: "family_history", subject: "relative", date: undated, value: { relation: "Matka", condition: "Ca prsu" } },
  { ...frame, kind: "request", status: "requested", date: undated, value: { what: "Projednání nálezu MR mozku na NCH semináři", request_kind: "consultation", result_fact: null } },
  { ...frame, kind: "decision", date: day("1.10.2026", "2026-10-01"), value: { body: "mdt", body_as_written: "MDT uro", text: "Pokračovat v léčbě" } },
  { ...frame, kind: "plan", status: "planned", date: { as_written: "za 3 měsíce", precision: null, sort: null }, value: { what: "Kontrolní CT", when_as_written: "za 3 měsíce" } },
  { ...frame, kind: "interval", origin: "assistant", certainty: "inferred", sources: [], based_on: ["f-1", "f-2"], date: undated, value: { from_fact: "f-1", to_fact: "f-2", days: 38, length_as_computed: "38 dní", from_precision: "day", to_precision: "day" } },
];

const byId = new Map(sources.map((s) => [s.id, s]));
const texts = ["", "NO-010|al", "Žluťoučký kůň", "S_HSCRP", "é", "😀 emoji"];
const vectors = {
  fnv1a32: texts.map((t) => [t, fnv1a32(t)]),
  norm_text: ["  Hypertenzní  nemoc. ", "A|B", "Ca\tprsu;", "ÉCOG ", "é"].map((t) => [t, normText(t)]),
  date_seg: [undated, day("2.6.2022", "2022-06-02"), { as_written: "03/2024", precision: "month", sort: "2024-03-15" }, { as_written: " Base line CT z 03/2023 ", precision: null, sort: null }, { as_written: "14.9.2026 10:05", precision: "minute", sort: "2026-09-14T10:05:00+02:00" }].map((d) => [d, dateSeg(d as FactDate)]),
  fact_keys: facts.map((fact) => ({ fact, sources, key: buildFactKey(fact, byId) })),
  alert_ids: [
    { rule: "request_without_result", subject: "f-3c90de" },
    { rule: "same_time_disagrees", subject: pairSubject("f-b", "f-a") },
    { rule: "missing_field", subject: "age" },
  ].map((a) => [a, alertId(a)]),
};

writeFileSync(new URL("../test/extraction-key-vectors.json", import.meta.url), JSON.stringify(vectors, null, 1) + "\n");
console.log(`wrote ${vectors.fact_keys.length} fact keys`);
