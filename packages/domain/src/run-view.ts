// The case view of a codebridge.extraction/2 run (EXTRACTION-FORMAT.md, "How the case view uses it"): every part the
// patient view reads (CaseData) is computed here from the run's facts, sources, checks, alerts, brief and composed
// views, so the components keep one shape whoever produced the run. Pure: no interface text. Where the view needs
// words of its own (a negation label, "nezkontrolováno", an alert's message), it gets a code or a Fluent message ID and
// the app picks the catalog text.
//
// Rules that decide what the doctor sees, in one place:
// - Quarantined facts appear nowhere. The wire already strips them (wire.ts Extraction); this module drops any that
//   arrive anyway, with the sources only they cite and their IDs in alerts.
// - Every item carries its fact IDs and its edit key ("f:<fact id>" or "v:<view line id>", edits.ts), never a position.
// - A composed view (views.onco_lines, other_diagnoses, timeline) is shown when the run has it; otherwise the part is
//   computed fact by fact.
// - The record (overview, timeline, anamnesis, current state) is shown when any check of a record kind ran; a run that
//   looked only at labs and requests (S01, S02) shows labs, alerts and documents, as before.
import type { CaseData, DocumentInfo, Flag, Item, LabDraw, LabPoint, LabSeries, LabTest, LabValue, SourceRef, TimelineEvent } from "./case-data";
import { negationCues } from "./extraction/backing";
import type { Check, CheckPage, ExtractionRun, Fact, Source, ViewLine } from "./extraction/types";

// ---------- inputs ----------

/** One logical document inside a stored file, as GET /cases/:id/documents sends it (D1 document_parts). */
export type PartInfo = {
  title_cs: string;
  type?: string | null;
  date?: string | null;
  date_note_cs?: string | null;
  pages?: number[];
  readability?: string | null;
  reason_cs?: string | null;
};
/** One stored file of the case with its parts in ordinal order (GET /cases/:id/documents). */
export type DocInfo = { id: string; file?: string | null; name?: string | null; page_count?: number | null; note_cs?: string | null; parts?: PartInfo[] };

// ---------- the extra parts a run gives the view ----------

/** What a check found for one view section: found, nothing_found ("-" with the gap wording) or not_run. */
export type SectionCheck = { result: Check["result"]; unreadable: CheckPage[]; check_ids: string[] };

/** The view parts only a /2 run has; null on a case built from the old format. */
export type RunView = {
  run_id: string;
  producer: string;
  /** The facts the view may show (never a quarantined one), by ID. */
  facts: Record<string, Fact>;
  /** The IDs of the composed lines in the run, for telling a line edit from an orphan. */
  view_line_ids: string[];
  /** Checks by the section they decide (see SECTION_CHECKS), and every check by ID. */
  sections: Record<string, SectionCheck>;
  checks: Record<string, Check>;
};

// ---------- small helpers ----------

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const str = (x: unknown): string | null => (typeof x === "string" && x.trim() ? x : null);

// Whether a text states a negation itself (the validator's cue list). A negated fact whose own text holds none gets a
// negation label in the view (negation_label), so "plicní embolie" recorded as absent never reads as present.
export const negationShown = (text: string | null | undefined) => negationCues(String(text || "")).size > 0;

/** The fact as one line of text in the content language, from its own fields; a verbatim text field wins. */
export function factText(f: Fact | { kind: string; value: unknown }): string {
  const v = (f.value || {}) as Record<string, unknown>;
  const join = (...xs: unknown[]) => xs.map(str).filter(Boolean).join(" ");
  switch (f.kind) {
    case "diagnosis":
    case "symptom":
    case "comorbidity":
    case "adverse_event":
    case "risk_factor":
    case "exam_finding":
    case "decision":
      return String(v.text ?? "");
    case "histology":
      return String(v.result_text ?? "");
    case "stage":
      return String(v.tnm ?? v.tnm_as_written ?? "");
    case "metastasis":
      return str(v.text) ?? String(v.site ?? "");
    case "procedure":
      return str(v.text) ?? String(v.name ?? "");
    case "systemic_therapy":
      return str(v.text) ?? String(v.regimen ?? "");
    case "radiotherapy":
      return str(v.text) ?? join(v.target, v.dose, v.fractions);
    case "imaging": {
      const head = join(v.modality, v.region);
      return head ? `${head}: ${v.finding_text ?? ""}` : String(v.finding_text ?? "");
    }
    case "lab_result":
      return join(v.name_as_written, v.value_as_written, v.unit ?? v.unit_as_written);
    case "vital_sign":
      return join(v.label_as_written ?? v.what, v.value_as_written, v.unit);
    case "performance_status":
      return join(v.scale, v.value_as_written);
    case "medication":
      return join(v.drug, v.strength, v.dosing);
    case "contraindication":
      return String(v.what ?? "");
    case "allergy":
      return str(v.reaction) ? `${v.substance}: ${v.reaction}` : String(v.substance ?? "");
    case "prognostic_score":
      return [join(v.score, v.value_as_written), str(v.risk_group)].filter(Boolean).join(", ");
    case "family_history":
      return `${v.relation ?? ""}: ${v.condition ?? ""}`;
    case "request":
      return String(v.what ?? "");
    case "plan":
      return [str(v.what), str(v.when_as_written)].filter(Boolean).join(", ");
    case "visit":
      return str(v.type_as_written) ?? String(v.type ?? "");
    case "interval":
      return String(v.length_as_computed ?? "");
    default:
      // An unknown kind (a newer producer) is shown as a plain fact: its own text, or every string it holds.
      return str(v.text) ?? str(v.what) ?? str(v.name) ?? Object.values(v).filter((x) => typeof x === "string").join(" ");
  }
}

// ---------- marks: the view's certainty fields from a fact's frame ----------

/**
 * The fields Marks.vue and tagsOf() read (certainty, ocr_note_cs, note_cs, change_status), from facts:
 * "verify" and "unreadable" give the "!" with the reason, "conflicting" the "≠", an assistant inference the "i",
 * planned and requested the "?", and the assistant's note its own icon.
 */
export function marksFrom(facts: Fact[], note: string | null | undefined = undefined, planned = false): Item {
  const verify = facts.filter((f) => f.certainty === "verify" || f.certainty === "unreadable");
  const conflicting = facts.filter((f) => f.certainty === "conflicting");
  const inferred = facts.length > 0 && facts.every((f) => f.certainty === "inferred" || f.origin === "assistant");
  const reasons = (fs: Fact[]) => [...new Set(fs.map((f) => f.certainty_reason?.text).filter(Boolean))].join(" ") || null;
  const notes = note !== undefined ? note : ([...new Set(facts.map((f) => f.note).filter(Boolean))].join(" ") || null);
  const out: Item = { certainty: "documented", ocr_note_cs: null, note_cs: null, change_status: null, negated: facts.length > 0 && facts.every((f) => f.negated) };
  if (conflicting.length) {
    out.certainty = "conflicting";
    out.note_cs = [reasons(conflicting), notes].filter(Boolean).join(" ") || null;
  } else {
    if (inferred) out.certainty = "inferred";
    else if (verify.length) out.certainty = "unclear_ocr";
    out.note_cs = notes;
  }
  if (verify.length) out.ocr_note_cs = reasons(verify);
  if (planned) out.change_status = "planned_unconfirmed";
  if (facts.some((f) => f.certainty === "unreadable")) out.unreadable = true;
  return out;
}

/** The negation label of a fact's own line: set when the fact is a recorded negative its text does not say. */
const negationLabel = (f: Fact, text: string) => f.negated && !negationShown(text);

const isPlanned = (f: Fact) => f.status === "planned" || f.status === "requested";

// ---------- sections and their checks ----------

/** The checks that decide each section of the view: anamnesis sections, current state, labs, the record parts. */
export const SECTION_CHECKS: Record<string, string[]> = {
  OA: ["comorbidity"],
  RA: ["family_history"],
  PA: ["work_history"],
  SA: ["social_history"],
  FA: ["medication"],
  AA: ["allergy"],
  abusus: ["risk_factor"],
  EA: ["risk_factor"],
  preventive: ["preventive"],
  state: ["vital_sign", "performance_status", "exam_finding", "symptom"],
  labs: ["lab_result"],
  imaging: ["imaging"],
  histology: ["histology"],
  therapy: ["systemic_therapy", "radiotherapy", "procedure"],
  diagnosis: ["diagnosis", "stage"],
};

// The record kinds: a run whose checks for any of these ran (found or nothing_found) has a record to show.
const RECORD_KINDS = new Set(["diagnosis", "histology", "stage", "metastasis", "procedure", "systemic_therapy", "radiotherapy", "imaging", "vital_sign", "performance_status", "exam_finding", "symptom", "comorbidity", "medication"]);

/**
 * A section's check, corrected by what the section shows: a check that ran and found facts of its kind, none of which
 * this section lists (abusus and EA share the risk-factor check; every drug may be stopped), is "nothing found" here;
 * a section that lists items is "found" whatever its check says.
 */
function shownCheck(c: SectionCheck, shown: number): SectionCheck {
  if (shown > 0) return { ...c, result: "found" };
  return c.result === "found" ? { ...c, result: "nothing_found" } : c;
}

function sectionCheck(checks: Check[], kinds: string[]): SectionCheck {
  const own = checks.filter((c) => !c.expected && kinds.includes(c.looks_for));
  if (!own.length) return { result: "not_run", unreadable: [], check_ids: [] };
  // One check that found something decides "found"; "nothing found" needs every check to have run and found none.
  const result: Check["result"] = own.some((c) => c.result === "found") ? "found" : own.every((c) => c.result === "nothing_found") ? "nothing_found" : "not_run";
  return { result, unreadable: own.flatMap((c) => c.unreadable), check_ids: own.map((c) => c.id) };
}

// ---------- the adapter ----------

type Ctx = {
  run: ExtractionRun;
  facts: Map<string, Fact>;
  sources: Map<string, Source>;
  srcIndex: Map<string, number>;
  refs: SourceRef[];
};

const refsOf = (x: Ctx, fs: Fact[]): number[] => {
  const out: number[] = [];
  for (const f of fs) for (const s of f.sources) {
    const i = x.srcIndex.get(s);
    if (i !== undefined && !out.includes(i)) out.push(i);
  }
  return out;
};
const firstRef = (x: Ctx, fs: Fact[]): SourceRef | undefined => {
  const i = refsOf(x, fs)[0];
  return i === undefined ? undefined : x.refs[i];
};
const factsOf = (x: Ctx, ids: string[]) => ids.map((id) => x.facts.get(id)).filter((f): f is Fact => !!f);
const byDate = (a: Fact, b: Fact) => (a.date.sort ? 0 : 1) - (b.date.sort ? 0 : 1) || String(a.date.sort || "").localeCompare(String(b.date.sort || ""));

/** A source as the view's pointer: the stored file and page with the quote, or a NIS record (no page). */
function refOf(s: Source): SourceRef {
  if (s.type === "document") return { file: `${s.document_id}.pdf`, page: s.page, quote: s.quote };
  return { page: "NIS", quote: s.resource, nis: { system: s.system, resource: s.resource, version: s.version, last_updated: s.last_updated } } as SourceRef;
}

// The event category of a fact, for the computed timeline and onco lines.
const KIND_CATEGORY: Record<string, string> = {
  imaging: "imaging",
  systemic_therapy: "systemic",
  medication: "medication",
  decision: "mdt",
  procedure: "surgery",
  histology: "pathology",
  radiotherapy: "radiotherapy",
  lab_result: "laboratory",
};
const categoryOfFact = (f: Fact) => KIND_CATEGORY[f.kind] || "clinical";

const ONCO_KINDS = ["procedure", "systemic_therapy", "radiotherapy", "imaging", "metastasis", "decision", "plan"];
const TIMELINE_KINDS = new Set([...ONCO_KINDS, "histology", "diagnosis", "request", "visit"]);

// A composed line or a brief sentence states all its facts in its own words, so one the view may not show (quarantined,
// or missing from the payload) would leak through the text: such a line is not shown at all.
const allKnown = (x: Ctx, ids: string[]) => ids.length > 0 && ids.every((id) => x.facts.has(id));

function line(x: Ctx, view: string, l: ViewLine): Item {
  const fs = factsOf(x, l.facts);
  const planned = l.status === "planned" || l.status === "requested";
  return {
    ...marksFrom(fs, l.note ?? null, planned),
    text_cs: l.text,
    title_cs: l.title ?? l.text,
    detail_cs: l.detail,
    date: l.date.as_written,
    date_sort: l.date.sort,
    category: l.category,
    kind: planned && view === "onco_lines" ? "plan" : l.category,
    status: planned ? "planned" : "done",
    refs: refsOf(x, fs),
    source: firstRef(x, fs),
    fact_ids: fs.map((f) => f.id),
    key: `v:${l.id}`,
    line_id: l.id,
  };
}

function factLine(x: Ctx, f: Fact): Item {
  return {
    ...marksFrom([f], undefined, isPlanned(f)),
    text_cs: factText(f),
    negation_label: negationLabel(f, factText(f)),
    date: f.date.as_written,
    date_sort: f.date.sort,
    category: categoryOfFact(f),
    kind: isPlanned(f) ? "plan" : categoryOfFact(f),
    status: isPlanned(f) ? "planned" : "done",
    refs: refsOf(x, [f]),
    source: firstRef(x, [f]),
    fact_ids: [f.id],
    fact_kind: f.kind,
    key: `f:${f.id}`,
  };
}

/** The diagnosis headline: the primary diagnosis, the histology and the stage at diagnosis, each from its fact. */
function headline(x: Ctx): Item | null {
  const all = [...x.facts.values()];
  const dx = (all.find((f) => f.kind === "diagnosis" && f.value.primary && !f.negated) ?? null) as Extract<Fact, { kind: "diagnosis" }> | null;
  const stages = all.filter((f): f is Extract<Fact, { kind: "stage" }> => f.kind === "stage").sort(byDate);
  const stage = stages.find((s) => s.value.at_diagnosis) ?? stages[0] ?? null;
  const hists = all.filter((f): f is Extract<Fact, { kind: "histology" }> => f.kind === "histology" && !f.negated).sort(byDate);
  // The histology that set the stage (same day), else the first one: the diagnosis is confirmed by histology.
  const hist = (stage && hists.find((h) => h.date.sort && h.date.sort === stage.date.sort)) || hists[0] || null;
  if (!dx && !hist && !stage) return null;
  const fs = ([dx, hist, stage] as (Fact | null)[]).filter((f): f is Fact => !!f);
  const code = dx?.codes.find((c) => c.system === "mkn-10") ?? dx?.codes[0];
  return {
    ...marksFrom(fs),
    histology_cs: hist ? cap(hist.value.tumour_type ?? hist.value.result_text) : dx ? cap(dx.value.text) : null,
    grade_cs: hist?.value.grade ?? null,
    tnm_cs: stage ? (stage.value.tnm ?? stage.value.tnm_as_written) : null,
    tnm_as_written: stage?.value.tnm_as_written ?? null,
    stage_kind: stage?.value.stage_kind ?? null,
    stage_at_diagnosis: stage?.value.at_diagnosis ?? null,
    tnm_context_cs: stage?.note ?? null,
    histology_date_cs: stage?.value.as_of ?? hist?.date.as_written ?? null,
    mkn_cs: code ? [code.code, code.display].filter(Boolean).join(" ") : null,
    extent_as_written_cs: dx?.value.text ?? null,
    date_cs: dx?.date.as_written ?? null,
    refs: refsOf(x, fs),
    fact_ids: fs.map((f) => f.id),
    note_cs: null,
  };
}

/**
 * The exam "Aktuální stav" shows. The documents rarely date the current exam separately: its findings carry no date
 * of their own, while an older exam quoted in the same report is dated. So: the document part holding the most
 * undated state findings; if every finding is dated, the part of the latest one. The visit fact of that part (stream
 * F's `visit`) names the exam. A producer that marks the current visit explicitly would replace this rule.
 */
function currentState(x: Ctx): Item | null {
  const stateKinds = new Set(["vital_sign", "performance_status", "exam_finding", "symptom"]);
  const partsOf = (f: Fact) => [...new Set(f.sources.map((s) => x.sources.get(s)).map((s) => (s?.type === "document" ? (s.part ?? s.document_id) : null)).filter((p): p is string => !!p))];
  const state = [...x.facts.values()].filter((f) => stateKinds.has(f.kind));
  if (!state.length) return null;
  const score = new Map<string, { undated: number; latest: string }>();
  for (const f of state) for (const p of partsOf(f)) {
    const s = score.get(p) ?? { undated: 0, latest: "" };
    if (!f.date.sort) s.undated++;
    else if (f.date.sort > s.latest) s.latest = f.date.sort;
    score.set(p, s);
  }
  const best = [...score.entries()].sort((a, b) => b[1].undated - a[1].undated || b[1].latest.localeCompare(a[1].latest))[0]?.[0];
  if (!best) return null;
  const inPart = (f: Fact) => partsOf(f).includes(best);
  const bestUndated = score.get(best)!.undated > 0;
  // The exam's own findings: undated ones when the exam is undated, else those of its latest day.
  const own = (f: Fact) => inPart(f) && (bestUndated ? !f.date.sort : f.date.sort === score.get(best)!.latest);
  const visit = [...x.facts.values()].find((f) => f.kind === "visit" && f.status === "done" && inPart(f)) as Extract<Fact, { kind: "visit" }> | undefined;
  const items: Item[] = [];
  for (const f of x.run.facts) {
    if (!x.facts.has(f.id) || !own(f)) continue;
    // The clinical negative "bez klinických známek mozkových metastáz" belongs to the exam, as the doctors write it.
    const clinicalMeta = f.kind === "metastasis" && f.value.basis === "clinical";
    if (!stateKinds.has(f.kind) && !clinicalMeta) continue;
    const v = f.value as unknown as Record<string, unknown>;
    const region = str(v.region);
    const subjective = f.kind === "symptom" || (f.kind === "exam_finding" && region?.toLowerCase() === "subjektivně");
    items.push({
      ...marksFrom([f]),
      // The assistant's inference from the performance status ("chodící, soběstačný") sits with the status, not with
      // the exam findings: it is not something the doctor examined.
      group: subjective ? "subjective" : f.kind === "performance_status" || clinicalMeta || f.certainty === "inferred" ? "status" : "objective",
      kind: f.kind,
      what: f.kind === "vital_sign" ? v.what : f.kind === "performance_status" ? String(v.scale ?? "").toLowerCase() : null,
      label_cs: f.kind === "vital_sign" ? (str(v.label_as_written) ?? String(v.what)) : f.kind === "performance_status" ? `${v.scale} PS` : region ? cap(region) : clinicalMeta ? String(v.site ?? "") : null,
      text_cs: f.kind === "vital_sign" ? [v.value_as_written, v.unit].filter(Boolean).join(" ") : f.kind === "performance_status" ? String(v.value_as_written ?? "") : factText(f),
      negation_label: negationLabel(f, factText(f)),
      value_as_written: v.value_as_written ?? null,
      unit: v.unit ?? null,
      refs: refsOf(x, [f]),
      fact_ids: [f.id],
      key: `f:${f.id}`,
    });
  }
  return {
    exam_title_cs: visit ? (visit.value.type_as_written ?? null) : null,
    exam_date_cs: visit?.date.as_written ?? null,
    exam_date_note_cs: null,
    visit_fact_id: visit?.id ?? null,
    items,
  };
}

// "Chronická obstrukční plicní nemoc, u kuřáka; ..." as term and comment, the way the anamnesis lists it. Display only:
// the fact keeps its one text, and the edit keys name the fact with the part (t, c).
function termComment(text: string): { term_cs: string; comment_cs: string } {
  const i = text.indexOf(", ");
  return i > 0 ? { term_cs: text.slice(0, i), comment_cs: text.slice(i + 2) } : { term_cs: text, comment_cs: "" };
}

function anamnesis(x: Ctx): Record<string, Item[]> {
  const all = x.run.facts.filter((f) => x.facts.has(f.id));
  const item = (f: Fact, text: string) => ({ ...marksFrom([f], undefined, isPlanned(f)), ...termComment(text), negation_label: negationLabel(f, text), refs: refsOf(x, [f]), fact_ids: [f.id], key: `f:${f.id}`, fact_kind: f.kind });
  const risk = (types: string[]) => all.filter((f) => f.kind === "risk_factor" && types.includes(f.value.type));
  return {
    // A comorbidity the documents deny is listed with its negation, never dropped into silence.
    OA: all.filter((f) => f.kind === "comorbidity").map((f) => item(f, factText(f))),
    RA: all.filter((f) => f.kind === "family_history").map((f) => item(f, factText(f))),
    PA: [],
    SA: risk(["social"]).map((f) => item(f, factText(f))),
    // Current medication: a stopped or interrupted drug is history, shown in the timeline, not in the list.
    FA: all
      .filter((f): f is Extract<Fact, { kind: "medication" }> => f.kind === "medication" && f.status !== "stopped" && f.status !== "interrupted")
      .map((f) => ({
        ...marksFrom([f], undefined, isPlanned(f)),
        drug_cs: f.value.drug,
        strength_cs: f.value.strength,
        dosing_cs: f.value.dosing,
        indication_cs: f.value.indication,
        change_cs: f.value.change,
        comment_line_cs: [f.value.indication, f.value.change].filter(Boolean).join("; ") || f.value.text || "",
        refs: refsOf(x, [f]),
        fact_ids: [f.id],
        key: `f:${f.id}`,
      })),
    FA_warnings: all.filter((f) => f.kind === "contraindication").map((f) => item(f, factText(f))),
    AA: all.filter((f) => f.kind === "allergy").map((f) => item(f, factText(f))),
    abusus: risk(["smoking", "alcohol"]).map((f) => ({ ...item(f, factText(f)), pack_years_cs: f.kind === "risk_factor" && f.value.pack_years != null ? String(f.value.pack_years) : null })),
    EA: risk(["epidemiology"]).map((f) => item(f, factText(f))),
    preventive: [],
  };
}

// The finding groups of the report and the FHIR export, one item per fact.
function findingSections(x: Ctx): Record<string, Item[]> {
  const groups: Record<string, string[]> = {
    clinical_finding: ["exam_finding", "symptom", "performance_status", "vital_sign", "diagnosis", "metastasis"],
    imaging: ["imaging"],
    histology: ["histology"],
    past_treatment: ["procedure", "systemic_therapy", "radiotherapy"],
    current_state: ["plan", "request", "visit", "decision"],
    medication: ["medication", "contraindication"],
    comorbidities: ["comorbidity"],
  };
  const out: Record<string, Item[]> = {};
  for (const [k, kinds] of Object.entries(groups)) {
    out[k] = x.run.facts
      // The primary diagnosis is the record's diagnosis; other diagnoses, an excluded one included ("bez plicní
      // embolie"), are findings.
      .filter((f) => x.facts.has(f.id) && kinds.includes(f.kind) && !(f.kind === "diagnosis" && f.value.primary))
      .map((f) => ({ ...marksFrom([f], undefined, isPlanned(f)), date: f.date.as_written, text_cs: factText(f), negation_label: negationLabel(f, factText(f)), note: f.note, source: firstRef(x, [f]), fact_ids: [f.id], key: `f:${f.id}`, fact_kind: f.kind }));
  }
  return out;
}

function labs(x: Ctx): CaseData["labs"] {
  const all = x.run.facts.filter((f): f is Extract<Fact, { kind: "lab_result" }> => x.facts.has(f.id) && f.kind === "lab_result");
  if (!all.length) return null;
  // A test is its code (or name) with its unit: two creatinine values in different units are never one series.
  const codeOf = (f: (typeof all)[number]) => f.codes[0]?.code ?? f.value.name_as_written;
  const testOf = (f: (typeof all)[number]) => `${codeOf(f)}|${f.value.unit ?? f.value.unit_as_written ?? ""}`;
  // A draw is a day, with a time when the sheet gives one ("2026-01-08T07:40"); a value dated only to a month or a
  // year stays a table row, so no point is placed on a made-up day.
  const drawOf = (f: (typeof all)[number]) =>
    f.date.sort && (f.date.precision === "day" || f.date.precision === "minute") ? { date: f.date.sort.slice(0, 10), time: f.date.sort.length > 10 ? f.date.sort.slice(11, 16) : "" } : null;
  const dated = all.filter((f) => drawOf(f));
  const drawKeys = [...new Set(dated.map((f) => `${drawOf(f)!.date}|${drawOf(f)!.time}`))].sort();
  // A trend needs at least two dated draws; a single sheet or undated values stay a table of the document's values.
  const series: LabSeries | null =
    drawKeys.length >= 2
      ? {
          draws: drawKeys.map((k) => {
            const [date, time] = k.split("|") as [string, string];
            const first = dated.find((f) => drawOf(f)!.date === date && drawOf(f)!.time === time)!;
            return { date, time, source: firstRef(x, [first])!, requisition: first.value.draw.requisition } as LabDraw;
          }),
          tests: [...new Set(dated.map(testOf))].map((test) => {
            const fs = dated.filter((f) => testOf(f) === test);
            const t = fs[0]!;
            return {
              code: codeOf(t),
              name_cs: t.value.name_as_written,
              unit: t.value.unit ?? t.value.unit_as_written ?? "",
              reference_range: t.value.reference_range ?? "",
              reference_low: t.value.reference_low,
              reference_high: t.value.reference_high,
              points: fs.map(
                (f) =>
                  ({
                    ...marksFrom([f]),
                    date: drawOf(f)!.date,
                    time: drawOf(f)!.time,
                    value: f.value.value_as_written,
                    out_of_range: f.value.out_of_range,
                    out_of_range_origin: f.value.out_of_range_origin,
                    source: firstRef(x, [f])!,
                    certainty: marksFrom([f]).certainty,
                    fact_ids: [f.id],
                    key: `f:${f.id}`,
                  }) as LabPoint,
              ),
            } as LabTest;
          }),
        }
      : null;
  const inSeries = new Set(series ? dated.map((f) => f.id) : []);
  const values: LabValue[] = all
    .filter((f) => !inSeries.has(f.id))
    .map((f) => ({
      ...marksFrom([f]),
      code: f.codes[0]?.code,
      name_cs: f.value.name_as_written,
      value: f.value.value_as_written,
      unit: f.value.unit ?? f.value.unit_as_written ?? undefined,
      reference_range: f.value.reference_range ?? undefined,
      out_of_range: f.value.out_of_range,
      out_of_range_origin: f.value.out_of_range_origin,
      date: f.value.draw.as_written ?? f.date.as_written,
      source: firstRef(x, [f])!,
      note: f.certainty_reason?.text ?? undefined,
      fact_ids: [f.id],
      key: `f:${f.id}`,
    }));
  return { values, note_cs: null, series };
}

// The kinds of fact that are findings, for the alerts that matter when the MDT has no question (CLAUDE.md: then for
// the most recent finding).
const FINDING_KINDS = new Set(["imaging", "histology", "metastasis", "diagnosis", "exam_finding", "lab_result"]);

function alerts(x: Ctx): CaseData["alerts"] {
  let basis = new Set((x.run.question_draft?.basis || []).flatMap((b) => b.facts));
  if (!basis.size) {
    const findings = [...x.facts.values()].filter((f) => FINDING_KINDS.has(f.kind) && f.date.sort).sort(byDate);
    const latest = findings.at(-1)?.date.sort;
    basis = new Set(findings.filter((f) => f.date.sort === latest).map((f) => f.id));
  }
  const flags: Flag[] = [];
  for (const a of x.run.alerts) {
    // An alert names only the facts the view may show. An identity alert keeps its message, which names document and
    // page, never what they say; any other alert resting only on facts the view may not show is not shown either.
    const fs = factsOf(x, a.facts);
    if (a.kind !== "identity" && a.facts.length && !fs.length) continue;
    flags.push({
      id: a.id,
      i: a.id,
      rule: a.rule,
      subject: a.subject,
      kind: a.kind,
      message: a.message,
      note: a.note ?? undefined,
      text_cs: "",
      fact_ids: fs.map((f) => f.id),
      based_on: refsOf(x, fs).map((i) => x.refs[i]!),
      // Relevant to the MDT question: the alert rests on a fact the drafted question rests on (else the latest finding).
      relevant: fs.some((f) => basis.has(f.id)),
    });
  }
  return { flags, gaps: [] };
}

function documents(x: Ctx, docs: DocInfo[] | null): CaseData["documents"] {
  const list: DocumentInfo[] = [];
  // A part all of whose passages are cited ("popis z NIS" in an outpatient report) is a quotation inside another
  // report, not the report itself; the view labels it so.
  const kinds = new Map<string, Set<string>>();
  for (const s of x.sources.values()) if (s.type === "document" && s.part) kinds.set(s.part, (kinds.get(s.part) ?? new Set()).add(s.reported_as));
  for (const d of x.run.documents) {
    const info = docs?.find((i) => i.id === d.document_id);
    const file = info?.file ?? `${d.document_id}.pdf`;
    d.parts.forEach((partId, k) => {
      const p = info?.parts?.[Number(/\/p(\d+)$/.exec(partId)?.[1] ?? k)];
      const cited = kinds.get(partId)?.size === 1 && kinds.get(partId)!.has("cited");
      // Without the document list the part has no title; its ID stands in, so the source still opens.
      list.push(p ? ({ ...p, title_cs: p.title_cs, file, part_id: partId, cited } as DocumentInfo) : { title_cs: partId, file, part_id: partId, pages: [], cited });
    });
  }
  const pages = docs ? docs.reduce((n, d) => n + (d.page_count ?? 0), 0) : null;
  const note = docs?.map((d) => d.note_cs).filter(Boolean).join(" ") || null;
  return { documents: list, pages, note };
}

function timeline(x: Ctx): TimelineEvent[] {
  const composed = x.run.views?.timeline;
  if (composed) return composed.filter((l) => allKnown(x, l.facts)).map((l) => line(x, "timeline", l) as TimelineEvent);
  return x.run.facts
    .filter((f) => x.facts.has(f.id) && TIMELINE_KINDS.has(f.kind))
    .map((f) => {
      const v = f.value as unknown as Record<string, unknown>;
      const title = f.kind === "visit" ? factText(f) : f.kind === "imaging" ? [v.modality, v.region].filter(Boolean).join(" ") || factText(f) : factText(f);
      const text = f.kind === "visit" ? [str(v.department), str(v.reason)].filter(Boolean).join(", ") : f.kind === "imaging" ? String(v.finding_text ?? "") : "";
      return { ...factLine(x, f), title_cs: title, text_cs: text, detail_cs: null } as TimelineEvent;
    });
}

function oncoCompact(x: Ctx): Item | null {
  const composed = x.run.views?.onco_lines;
  const others = x.run.views?.other_diagnoses;
  const lines = composed
    ? composed.filter((l) => allKnown(x, l.facts)).map((l) => line(x, "onco_lines", l))
    : x.run.facts.filter((f) => x.facts.has(f.id) && ONCO_KINDS.includes(f.kind)).sort(byDate).map((f) => factLine(x, f));
  const other = others?.[0] && allKnown(x, others[0].facts) ? line(x, "other_diagnoses", others[0]) : null;
  // A denied diagnosis ("bez plicní embolie") is a finding, listed with the findings, not among the patient's diagnoses.
  const otherFacts = others ? [] : x.run.facts.filter((f) => x.facts.has(f.id) && !f.negated && ((f.kind === "diagnosis" && !f.value.primary) || f.kind === "comorbidity"));
  if (!lines.length && !other && !otherFacts.length) return null;
  return {
    lines,
    other_dx_cs: other ? other.text_cs : otherFacts.length ? otherFacts.map((f) => factText(f)).join(", ") : null,
    other_dx_refs: other ? other.refs : refsOf(x, otherFacts),
    other_dx_key: other ? other.key : null,
    other_dx_fact_ids: other ? other.fact_ids : otherFacts.map((f) => f.id),
  };
}

/** The brief as prose with [n] markers after each sentence, numbered over the sources of its facts. */
function brief(x: Ctx): { text_cs: string | null; refs: SourceRef[]; sentences: Item[] } {
  const refs: SourceRef[] = [];
  const sentences: Item[] = [];
  const parts: string[] = [];
  for (const s of x.run.brief?.sentences || []) {
    // A sentence states all its facts in its own words: one resting on a fact the view may not show is not shown.
    if (!allKnown(x, s.facts)) continue;
    const fs = factsOf(x, s.facts);
    // One marker per fact, its first passage: every fact stays traceable without a marker per quoted line.
    const firsts = [...new Set(fs.map((f) => refsOf(x, [f])[0]).filter((i): i is number => i !== undefined))];
    const marks = firsts.map((i) => {
      const r = x.refs[i]!;
      let n = refs.indexOf(r);
      if (n < 0) n = refs.push(r) - 1;
      return `[${n + 1}]`;
    });
    parts.push(`${s.text}${marks.length ? ` ${marks.join(" ")}` : ""}`);
    sentences.push({ text_cs: s.text, fact_ids: fs.map((f) => f.id) });
  }
  return { text_cs: parts.length ? parts.join(" ") : null, refs, sentences };
}

/**
 * The case view of a /2 run. `docs` is the case's stored documents with their parts (titles, types, pages,
 * readability); without them the documents list names parts by ID.
 */
export function fromRun(file: string, id: string, run: ExtractionRun, docs: DocInfo[] | null = null): CaseData {
  const visible = run.facts.filter((f) => !f.quarantined);
  const facts = new Map(visible.map((f) => [f.id, f]));
  // Only sources a visible fact cites: a quarantined fact's passage must not reach the view through the refs.
  const cited = new Set(visible.flatMap((f) => f.sources));
  const sources = new Map(run.sources.filter((s) => cited.has(s.id)).map((s) => [s.id, s]));
  const srcIndex = new Map<string, number>();
  const refs: SourceRef[] = [];
  for (const s of run.sources) {
    if (!cited.has(s.id)) continue;
    srcIndex.set(s.id, refs.length);
    refs.push(refOf(s));
  }
  const x: Ctx = { run, facts, sources, srcIndex, refs };
  const ran = run.checks.some((c) => !c.expected && RECORD_KINDS.has(c.looks_for) && c.result !== "not_run");
  const b = brief(x);
  const checks = run.checks.filter((c) => !c.expected || facts.has(c.expected.of_fact));
  const anam = ran ? anamnesis(x) : null;
  const state = ran ? currentState(x) : null;
  const lab = labs(x);
  const shown: Record<string, number | undefined> = {
    ...Object.fromEntries(Object.entries(anam ?? {}).map(([k, v]) => [k, v.length])),
    state: state?.items.length,
    labs: lab ? lab.values.length + (lab.series?.tests.length ?? 0) : undefined,
  };
  const sections: Record<string, SectionCheck> = {};
  for (const [k, kinds] of Object.entries(SECTION_CHECKS)) {
    const c = sectionCheck(checks, kinds);
    sections[k] = shown[k] === undefined ? c : shownCheck(c, shown[k]!);
  }
  const viewLineIds = [...(run.views?.onco_lines || []), ...(run.views?.other_diagnoses || []), ...(run.views?.timeline || [])].filter((l) => allKnown(x, l.facts)).map((l) => l.id);
  const dx = [...facts.values()].find((f) => f.kind === "diagnosis" && f.value.primary && !f.negated);
  const purpose = (run.question_draft?.basis || []).find((p) => p.role === "purpose");
  return {
    file,
    id,
    level: ran ? "full" : "partial",
    refs,
    brief: ran
      ? {
          text_cs: b.text_cs,
          refs: b.refs,
          reason_cs: null,
          reason_refs: [],
          dx_headline: headline(x),
          summary_items: [],
          sentences: b.sentences,
        }
      : null,
    record: ran
      ? {
          onco_compact: oncoCompact(x),
          onco_detailed: [],
          status_praesens: state,
          timeline: timeline(x),
          timeline_source: dx ? [{ type: "diagnosis", date: dx.date.as_written, label_cs: factText(dx), source: firstRef(x, [dx]) }] : [],
          anamnesis: anam,
          sections: findingSections(x),
          patient: {},
          diagnosis: dx ? { code: dx.codes[0]?.code ?? null, text_cs: factText(dx), source: firstRef(x, [dx]), fact_ids: [dx.id] } : null,
          mdt_question: { text_cs: null, note_cs: null, closest_source: purpose ? firstRef(x, factsOf(x, purpose.facts)) : null },
          ocr_quality_note: null,
        }
      : null,
    labs: lab,
    alerts: alerts(x),
    documents: documents(x, docs),
    note_cs: null,
    run: { run_id: run.run.id, producer: run.run.producer, facts: Object.fromEntries(facts), view_line_ids: viewLineIds, sections, checks: Object.fromEntries(checks.map((c) => [c.id, c])) },
  };
}
