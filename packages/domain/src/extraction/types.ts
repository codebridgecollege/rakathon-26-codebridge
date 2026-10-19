// The extraction format codebridge.extraction/2 (docs/design/EXTRACTION-FORMAT.md) as TypeScript types. A run is one
// extraction of one case: facts that point at sources, the checks that say what was looked at, alerts from rules, the
// brief and the drafted MDT question. Everything the case view shows is computed from these in code.
//
// These types are the source of truth: `npm run schema -w @codebridge/domain` generates the JSON Schema
// (schema/extraction-2.schema.json) from them, and the Python pipeline validates against that same file. The JSDoc
// comments end up in the schema as descriptions, so they say what a producer must write, not how the view uses it.
//
// No patient identity anywhere in a run: name, birth number and birth date live only in D1 `patients`.

export const EXTRACTION_SCHEMA = "codebridge.extraction/2";

/** What wrote the run: prepared by hand, the document pipeline, or the NIS (FHIR) import. */
export type Producer = "fixture" | "pipeline" | "nis";

/** The page text a quote is verbatim against: the PDF's own text layer, Tesseract OCR, or the AI reading. */
export type QuoteText = "pdf_text" | "tesseract" | "vision";

export type DatePrecision = "minute" | "day" | "month" | "year";

/** A date exactly as the document writes it. A partial date never gets a made-up day. */
export interface FactDate {
  /** Verbatim, for example "4/2022", "2.6.2022", "base line CT z 03/2023". */
  as_written: string | null;
  precision: DatePrecision | null;
  /**
   * ISO form used only for ordering, cut to the precision: "2022-06-02", "2022-04", "2022", or a full timestamp for
   * minute precision.
   */
  sort: string | null;
}

// ---------------------------------------------------------------------------------------------------------------------
// Run metadata

export interface RunStage {
  /** The pipeline step, for example "ocr", "extract_facts", "rules", "convert". */
  name: string;
  /** A deterministic engine and its version, for example "tesseract 5.3.0 ces 4.1.0". */
  engine?: string | null;
  /** The model deployment name, from configuration. */
  model?: string | null;
  /** The prompt name and version in the repository, for example "extract-facts@3". */
  prompt?: string | null;
  prompt_sha256?: string | null;
  temperature?: number | null;
}

export interface RunInfo {
  /** Unique run ID, for example "run-2026-10-19T10:04:11Z-a1b2". */
  id: string;
  producer: Producer;
  /** ISO timestamp with zone. */
  created_at: string;
  stages: RunStage[];
  /** The run this one replaces; both stay (append-only). */
  supersedes: string | null;
}

/** A document version the run read. The document itself, its parts and its identity check live in D1. */
export interface RunDocument {
  document_id: string;
  sha256: string | null;
  /** Stable part IDs, for example "10_pacient/p0". */
  parts: string[];
}

// ---------------------------------------------------------------------------------------------------------------------
// Sources

export interface SourceAnchor {
  page_text_sha256: string;
  engine: string;
  /** Start and end offset of the quote in the stored page text. */
  char_range: [number, number];
  /** Word boxes [x, y, width, height] in page pixels. */
  boxes: [number, number, number, number][];
}

export interface ReadingCheckToken {
  pdf_text?: string | null;
  tesseract?: string | null;
  vision?: string | null;
  /** How the readings compare, for example "differ" or "agree". */
  rule: string;
}

/** The per-token comparison of the readings that produces the "ověřit" mark. */
export interface ReadingCheck {
  mark: boolean;
  tokens: ReadingCheckToken[];
}

/** The identity printed on the page compared with the case's patient. Only the result is stored, never the identity. */
export type IdentityResult = "matches" | "conflicts" | "cannot_verify";

/** A passage in a document page. */
export interface DocumentSource {
  /** For example "src-7c1e". */
  id: string;
  type: "document";
  document_id: string;
  /** Stable part ID, or null when the document is not split into parts. */
  part: string | null;
  /** Page number, starting at 1. */
  page: number;
  /** Verbatim against the page text named in quote_text, misreadings included ("mg/1", "O"). */
  quote: string;
  quote_text: QuoteText;
  anchor: SourceAnchor | null;
  /** "cited" when another document quotes the report (for example "popis z NIS" in an outpatient report). */
  reported_as: "original" | "cited";
  identity: IdentityResult;
  reading_check: ReadingCheck | null;
}

/** A record in the NIS (the hospital system). It is its own evidence: no page, no quote. */
export interface NisSource {
  id: string;
  type: "nis";
  system: string;
  /** FHIR resource type and ID, for example "Observation/8812". */
  resource: string;
  version: string | null;
  last_updated: string | null;
}

export type Source = DocumentSource | NisSource;

// ---------------------------------------------------------------------------------------------------------------------
// Facts: the common frame

export type Subject = "patient" | "relative";
export type FactStatus = "documented" | "planned" | "requested" | "done" | "stopped" | "interrupted";
/** document: stated in a document; nis: from the NIS; assistant: the assistant's own inference. */
export type Origin = "document" | "nis" | "assistant";
export type Certainty = "clear" | "verify" | "conflicting" | "inferred" | "unreadable";

export interface CertaintyReason {
  /** A stable code, for example "ocr_char_swap". */
  code: string;
  /** Shown to the doctor in a tooltip, in the content language. */
  text: string;
}

export interface FactCode {
  /** The code system, for example "nclp", "mkn-10", "snomed-ct", "fno-local-lab", "atc". */
  system: string;
  code: string;
  /** "source" when the document or NIS gives the code, "assistant" when we assigned it. A code is never invented. */
  assigned_by: "source" | "assistant";
  display?: string | null;
}

interface FactFrame<K extends string, V> {
  /** Stable across runs; confirmations, edits and alerts attach to it. For example "f-8d41c2". */
  id: string;
  /** Deterministic from the kind and the identifying values (keys.ts); never a page number or a position. */
  key: string;
  kind: K;
  /** "relative" for family history: a relative's disease never becomes the patient's. */
  subject: Subject;
  value: V;
  date: FactDate;
  status: FactStatus;
  /** The document states the opposite ("bez plicní embolie"). A finding, not a gap. */
  negated: boolean;
  /** Fields of this fact the documents leave open. A field that is simply missing was not looked for. */
  not_stated: string[];
  origin: Origin;
  certainty: Certainty;
  certainty_reason?: CertaintyReason | null;
  codes: FactCode[];
  /** The assistant's free-text note about this fact, in the content language. */
  note: string | null;
  /** Set when a source page shows another patient: kept, but left out of the view, the brief and the rules. */
  quarantined: boolean;
  /** Source IDs, all saying the same thing. Empty only for an assistant fact with based_on. */
  sources: string[];
  /** For an assistant fact: the facts it was computed from. */
  based_on?: string[];
}

// ---------------------------------------------------------------------------------------------------------------------
// Fact values per kind

/** Disease status as the document says it. Needs review by a clinical expert before real patients. */
export type DiseaseStatus =
  | "suspected"
  | "confirmed_histology"
  | "progression"
  | "stable"
  | "remission"
  | "suspected_recurrence"
  | "recurrence";

export interface DiagnosisValue {
  text: string;
  disease_status: DiseaseStatus | null;
  /** The oncological diagnosis the MDT discusses, as opposed to other diagnoses. */
  primary: boolean;
}

export interface HistologyValue {
  specimen: string | null;
  result_text: string;
  tumour_type: string | null;
  grade: string | null;
}

export type StageKind = "clinical" | "pathological" | "post_neoadjuvant";

export interface StageValue {
  tnm_as_written: string;
  /** Normalised TNM, for example "pT2a pN1 M0", or null when it cannot be normalised. */
  tnm: string | null;
  stage_kind: StageKind;
  edition: string | null;
  /** The date the stage describes, as written. */
  as_of: string | null;
  at_diagnosis: boolean | null;
}

export type MetastasisStatus = "suspected" | "confirmed" | "excluded";

export interface MetastasisValue {
  site: string;
  status: MetastasisStatus;
  /** How it was established, for example "clinical", "imaging", "histology". */
  basis: string | null;
  text: string | null;
}

export interface ProcedureValue {
  name: string;
  region: string | null;
  text: string | null;
}

export interface SystemicTherapyValue {
  /** Drug or regimen as written. */
  regimen: string;
  line: number | null;
  start: string | null;
  stop: string | null;
  reason_stopped: string | null;
  text: string | null;
}

export interface RadiotherapyValue {
  target: string;
  dose: string | null;
  fractions: string | null;
  text: string | null;
}

export interface ImagingResponse {
  /** "RECIST 1.1", "iRECIST". */
  system: string;
  category: string;
}

export interface ImagingValue {
  /** "CT", "MR", "PET/CT", "UZ", "RTG", "scintigrafie". */
  modality: string;
  region: string | null;
  finding_text: string;
  response: ImagingResponse | null;
}

export interface LabDraw {
  /** Draw date and time as written. */
  as_written: string | null;
  requisition: string | null;
  specimen: string | null;
}

export interface LabResultValue {
  name_as_written: string;
  value_as_written: string;
  value_numeric: number | null;
  unit_as_written: string | null;
  /** The unit after correcting misreadings ("mg/1" read as "mg/l"); null when none is given. */
  unit: string | null;
  reference_range: string | null;
  reference_low: number | null;
  reference_high: number | null;
  out_of_range: "high" | "low" | null;
  /** "document" when the lab printed the flag, "assistant" when computed from the range. */
  out_of_range_origin: "document" | "assistant" | null;
  draw: LabDraw;
}

export type VitalSignWhat =
  | "blood_pressure"
  | "pulse"
  | "temperature"
  | "weight"
  | "height"
  | "bmi"
  | "spo2"
  | "respiratory_rate"
  | "other";

export interface VitalSignValue {
  what: VitalSignWhat;
  label_as_written: string | null;
  value_as_written: string;
  value_numeric: number | null;
  unit: string | null;
}

export interface PerformanceStatusValue {
  /** "ECOG", "Karnofsky". */
  scale: string;
  value_as_written: string;
  value_numeric: number | null;
}

export interface ExamFindingValue {
  region: string | null;
  text: string;
}

export interface SymptomValue {
  text: string;
}

export interface ComorbidityValue {
  /** The diagnosis text; an MKN-10 code, if given, goes in codes. */
  text: string;
}

export interface MedicationValue {
  drug: string;
  strength: string | null;
  dosing: string | null;
  /** A change the document states, for example "od 19.9.2026 navýšení". */
  change: string | null;
  indication: string | null;
  text: string | null;
}

export interface ContraindicationValue {
  what: string;
  stated_by: "document" | "assistant";
}

export interface AllergyValue {
  substance: string;
  reaction: string | null;
}

export interface AdverseEventValue {
  text: string;
  grade: string | null;
  related_therapy: string | null;
}

export interface PrognosticScoreValue {
  /** "IMDC", "MSKCC". */
  score: string;
  value_as_written: string;
  risk_group: string | null;
}

export interface RiskFactorValue {
  type: "smoking" | "alcohol" | "social" | "epidemiology";
  text: string;
  pack_years: number | null;
}

export interface FamilyHistoryValue {
  relation: string;
  condition: string;
}

export interface RequestValue {
  what: string;
  request_kind: "exam" | "consultation" | "mdt" | "other" | null;
  /** The fact holding the result, if one exists. A sent request is not a done exam. */
  result_fact: string | null;
}

export interface DecisionValue {
  body: "mdt" | "koc" | "consultation" | "other";
  body_as_written: string | null;
  text: string;
}

export interface PlanValue {
  what: string;
  when_as_written: string | null;
}

/** The kind of visit or stay. "other" when the source names none of these. */
export type VisitType = "outpatient" | "admission" | "consultation" | "emergency" | "other";

/** A visit or hospital stay (an outpatient visit, an admission, a consultation). It goes on the timeline. */
export interface VisitValue {
  type: VisitType;
  /** The visit's own name as the source gives it, for example "Ambulantní vyšetření kontrolní". */
  type_as_written: string | null;
  /** The department or clinic as written. */
  department: string | null;
  /** Why the visit took place, as written. */
  reason: string | null;
  /** The end of a stay (discharge) as written; null for a visit without one or a stay still going on. */
  end_as_written: string | null;
}

/** Always origin "assistant": a length between two facts, shown as a fact, never a verdict. */
export interface IntervalValue {
  from_fact: string;
  to_fact: string;
  days: number | null;
  /** The length as computed and shown, for example "38 dní". */
  length_as_computed: string;
  from_precision: DatePrecision | null;
  to_precision: DatePrecision | null;
}

export type DiagnosisFact = FactFrame<"diagnosis", DiagnosisValue>;
export type HistologyFact = FactFrame<"histology", HistologyValue>;
export type StageFact = FactFrame<"stage", StageValue>;
export type MetastasisFact = FactFrame<"metastasis", MetastasisValue>;
export type ProcedureFact = FactFrame<"procedure", ProcedureValue>;
export type SystemicTherapyFact = FactFrame<"systemic_therapy", SystemicTherapyValue>;
export type RadiotherapyFact = FactFrame<"radiotherapy", RadiotherapyValue>;
export type ImagingFact = FactFrame<"imaging", ImagingValue>;
export type LabResultFact = FactFrame<"lab_result", LabResultValue>;
export type VitalSignFact = FactFrame<"vital_sign", VitalSignValue>;
export type PerformanceStatusFact = FactFrame<"performance_status", PerformanceStatusValue>;
export type ExamFindingFact = FactFrame<"exam_finding", ExamFindingValue>;
export type SymptomFact = FactFrame<"symptom", SymptomValue>;
export type ComorbidityFact = FactFrame<"comorbidity", ComorbidityValue>;
export type MedicationFact = FactFrame<"medication", MedicationValue>;
export type ContraindicationFact = FactFrame<"contraindication", ContraindicationValue>;
export type AllergyFact = FactFrame<"allergy", AllergyValue>;
export type AdverseEventFact = FactFrame<"adverse_event", AdverseEventValue>;
export type PrognosticScoreFact = FactFrame<"prognostic_score", PrognosticScoreValue>;
export type RiskFactorFact = FactFrame<"risk_factor", RiskFactorValue>;
export type FamilyHistoryFact = FactFrame<"family_history", FamilyHistoryValue>;
export type RequestFact = FactFrame<"request", RequestValue>;
export type DecisionFact = FactFrame<"decision", DecisionValue>;
export type PlanFact = FactFrame<"plan", PlanValue>;
export type VisitFact = FactFrame<"visit", VisitValue>;
export type IntervalFact = FactFrame<"interval", IntervalValue>;

export type Fact =
  | DiagnosisFact
  | HistologyFact
  | StageFact
  | MetastasisFact
  | ProcedureFact
  | SystemicTherapyFact
  | RadiotherapyFact
  | ImagingFact
  | LabResultFact
  | VitalSignFact
  | PerformanceStatusFact
  | ExamFindingFact
  | SymptomFact
  | ComorbidityFact
  | MedicationFact
  | ContraindicationFact
  | AllergyFact
  | AdverseEventFact
  | PrognosticScoreFact
  | RiskFactorFact
  | FamilyHistoryFact
  | RequestFact
  | DecisionFact
  | PlanFact
  | VisitFact
  | IntervalFact;

export type FactKind = Fact["kind"];

/** Every fact kind of /2, in the order of the spec's table. */
export const FACT_KINDS = [
  "diagnosis",
  "histology",
  "stage",
  "metastasis",
  "procedure",
  "systemic_therapy",
  "radiotherapy",
  "imaging",
  "lab_result",
  "vital_sign",
  "performance_status",
  "exam_finding",
  "symptom",
  "comorbidity",
  "medication",
  "contraindication",
  "allergy",
  "adverse_event",
  "prognostic_score",
  "risk_factor",
  "family_history",
  "request",
  "decision",
  "plan",
  "visit",
  "interval",
] as const satisfies readonly FactKind[];

/** A fact with its key and ID still to be assigned (keys.ts, match.ts). Producers build these. */
export type DraftFact = Fact extends infer F ? (F extends Fact ? Omit<F, "id" | "key"> : never) : never;

// ---------------------------------------------------------------------------------------------------------------------
// Checks

export interface CheckPart {
  document_id: string;
  part: string | null;
}

export interface CheckPage extends CheckPart {
  page: number;
}

export type CheckResult = "found" | "nothing_found" | "not_run";

/** One step of the pipeline that looked for something: what, over which documents, and what came out. */
export interface Check {
  /** For example "chk-allergy" or "chk-report-mr-brain-2026-09-14". */
  id: string;
  /** A fact kind ("allergy") or a document kind ("original_report"). */
  looks_for: string;
  /** For a document check: the fact whose document is expected. */
  expected: { of_fact: string } | null;
  covered: CheckPart[];
  unreadable: CheckPage[];
  /** found: facts exist; nothing_found: the listed parts say nothing; not_run: this producer does not look. */
  result: CheckResult;
}

// ---------------------------------------------------------------------------------------------------------------------
// Alerts

export type AlertKind = "missing" | "contradiction" | "chronology" | "unclear" | "poor_copy" | "identity";

export const ALERT_KINDS = [
  "missing",
  "contradiction",
  "chronology",
  "unclear",
  "poor_copy",
  "identity",
] as const satisfies readonly AlertKind[];

/** A Fluent message (i18n/<locale>/*.ftl) so the alert follows the UI language. */
export interface AlertMessage {
  id: string;
  /** Fact IDs or plain values the view formats; never Czech words that would need grammatical case. */
  args: Record<string, string | number>;
}

/** The result of a rule over facts. The assistant's observation; it never blocks anything. */
export interface Alert {
  /** Derived from rule and subject (keys.ts alertId), so acknowledgements carry over to the next run. */
  id: string;
  rule: string;
  /**
   * What the rule is about: a fact ID, an expected document, a pair of fact IDs ("f-a|f-b", sorted), or a field name.
   */
  subject: string;
  kind: AlertKind;
  /** The facts the alert rests on. */
  facts: string[];
  message: AlertMessage;
  /** The model's free-text explanation, in the content language. */
  note: string | null;
}

// ---------------------------------------------------------------------------------------------------------------------
// Brief and the drafted MDT question

export interface BriefSentence {
  /** In the content language. */
  text: string;
  /** The facts the sentence states; a sentence with none is dropped. */
  facts: string[];
}

export interface MadeBy {
  model: string | null;
  prompt: string | null;
}

export interface Brief {
  sentences: BriefSentence[];
  made_by: MadeBy;
}

export interface QuestionBasis {
  role: "purpose" | "finding" | "other";
  facts: string[];
}

/** Stays labelled as a draft until a doctor confirms or edits it (D1 question_confirmations). */
export interface QuestionDraft {
  text: string;
  /** For example "document_purpose", "latest_finding". */
  question_kind: string;
  basis: QuestionBasis[];
}

// ---------------------------------------------------------------------------------------------------------------------
// Composed views

/** The event categories a composed line is filed under, the same as the timeline's. */
export type ViewCategory =
  | "imaging"
  | "systemic"
  | "medication"
  | "mdt"
  | "surgery"
  | "pathology"
  | "radiotherapy"
  | "laboratory"
  | "clinical";

export const VIEW_CATEGORIES = [
  "imaging",
  "systemic",
  "medication",
  "mdt",
  "surgery",
  "pathology",
  "radiotherapy",
  "laboratory",
  "clinical",
] as const satisfies readonly ViewCategory[];

/**
 * One line of a composed view: the wording a producer chose for one or more facts, as a clinician writes a summary
 * line ("St. p. 2. linii sunitinib 50 mg denně; toxicita: ..."). It never adds content: every date, number, negation
 * and side in the text must be backed by its facts, as for a brief sentence.
 */
export interface ViewLine {
  /**
   * Derived from the view's name and the sorted fact IDs (keys.ts viewLineId), so a doctor's edit follows the facts.
   * @pattern ^vl-[0-9a-f]{8}$
   */
  id: string;
  /** The line, in the content language. */
  text: string;
  /** A timeline card's heading; null for a summary line. */
  title: string | null;
  /** A timeline card's longer text; null for a summary line. */
  detail: string | null;
  /** The date the line is filed under. A partial date stays partial. */
  date: FactDate;
  category: ViewCategory;
  /** "planned" and "requested" never read as performed. */
  status: FactStatus;
  /**
   * The facts the line states; at least one.
   * @minItems 1
   */
  facts: string[];
  /** The assistant's note on the line, in the content language. */
  note: string | null;
}

/**
 * Lines composed from the facts by a producer (the fixture conversion, later a composition step). Optional: a run
 * without them is shown fact by fact. Each list is the whole view in its display order.
 */
export interface ComposedViews {
  /** The oncology summary, one line per event as clinicians write it. */
  onco_lines?: ViewLine[];
  /** The other diagnoses next to the oncology summary. */
  other_diagnoses?: ViewLine[];
  /** The timeline cards. */
  timeline?: ViewLine[];
  made_by: MadeBy;
}

/** The names of the composed views, in the order the format lists them. */
export const VIEW_NAMES = ["onco_lines", "other_diagnoses", "timeline"] as const satisfies readonly (keyof ComposedViews)[];
export type ViewName = (typeof VIEW_NAMES)[number];

// ---------------------------------------------------------------------------------------------------------------------
// The run

/** One extraction of one case. Never changed after it is written. */
export interface ExtractionRun {
  schema: typeof EXTRACTION_SCHEMA;
  /** The case ID, never the patient's identity. */
  case_id: string;
  /** The language of the documents (BCP 47), for example "cs". Assistant text in the run is in this language. */
  content_language: string;
  run: RunInfo;
  documents: RunDocument[];
  sources: Source[];
  facts: Fact[];
  checks: Check[];
  alerts: Alert[];
  brief: Brief | null;
  question_draft: QuestionDraft | null;
  /** Optional composed lines (added within /2); a run without them is shown fact by fact. */
  views?: ComposedViews | null;
}
