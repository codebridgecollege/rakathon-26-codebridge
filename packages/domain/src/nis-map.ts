// NIS records into the extraction format (issue #22, phase 2): FHIR R4 resources of one linked patient become facts of
// a codebridge.extraction/2 run with producer "nis" (docs/design/EXTRACTION-FORMAT.md). Pure: the Worker pulls the
// resources (api/src/services/fhir.ts), this maps them, keys.ts and match.ts give the facts their keys and IDs.
//
// The rules (CLAUDE.md, "Clinical trust"):
//   - Every fact points at its NIS record (a source of type "nis": system, resource, version, last updated) and has
//     origin "nis". The record is its own evidence; there is no quote.
//   - Values, units, ranges, codes and dates are kept as the NIS gives them. A code is never invented: a coding goes
//     into codes with assigned_by "source", under a short system name where we know the URI, else under the URI.
//   - Nothing is inferred: disease status only where the record states one, no out-of-range flag the record does not
//     carry, no TNM normalisation, no stage kind guessed from a value. What cannot be mapped is reported, not forced.
//   - A sent request is not a done exam: a ServiceRequest is a request fact, with result_fact only when a report
//     names it in basedOn.
import { assignFactIds, type MatchResult } from "./extraction/match";
import { sourceIdFor } from "./extraction/keys";
import { validateRun, type ValidationResult } from "./extraction/validate";
import {
  EXTRACTION_SCHEMA,
  type Check,
  type DiseaseStatus,
  type DraftFact,
  type ExtractionRun,
  type FactCode,
  type FactDate,
  type FactKind,
  type FactStatus,
  type NisSource,
  type StageKind,
} from "./extraction/types";

type R = Record<string, any>;
type Drafted = DraftFact & { draft_id?: string };

// Code systems we know by URI, under the short names the format uses. Any other system keeps its URI.
export const CODE_SYSTEMS: Record<string, string> = {
  "https://uzis.cz/terminology/CodeSystem/mkn-10": "mkn-10",
  "https://github.com/codebridgecollege/rakathon-26-codebridge/fhir/CodeSystem/fno-local-lab-code": "fno-local-lab",
  "http://snomed.info/sct": "snomed-ct",
  "http://loinc.org": "loinc",
  "http://www.whocc.no/atc": "atc",
};

// LOINC codes of TNM observations, by the kind of stage they state. The NIS's own wording is the other way to tell
// the kind (stageKindOf); a stage whose kind neither says is not mapped.
const LOINC_STAGE: Record<string, StageKind> = {
  "21908-9": "clinical", "21905-5": "clinical", "21906-3": "clinical", "21907-1": "clinical",
  "21902-2": "pathological", "21899-0": "pathological", "21900-6": "pathological", "21901-4": "pathological",
};

// note stays null on every fact: it is the assistant's own note, and a NIS remark is not the assistant's words.

// What the mapping did with each resource, for the run's log and the tests. Counts and types only, no content.
export type Skipped = { resource: string; reason: string };
export type NisDocument = { resource: string; version: string | null; status: string | null; title: string | null; date: string | null; replaces: string[]; attachment_url: string | null; content_type: string | null };
export type Mapped = { sources: NisSource[]; drafts: Drafted[]; checks: Check[]; documents: NisDocument[]; skipped: Skipped[] };

const str = (x: unknown): string | null => (typeof x === "string" && x.trim() ? x.trim() : null);
const refId = (r: R) => `${r.resourceType}/${r.id}`;

// A FHIR date or dateTime as the record gives it: precision from its length, sort as local wall time. No day is
// added to a month, no time to a day.
export function fhirDate(v: unknown): FactDate {
  const s = str(v);
  if (!s) return { as_written: null, precision: null, sort: null };
  if (/^\d{4}$/.test(s)) return { as_written: s, precision: "year", sort: s };
  if (/^\d{4}-\d{2}$/.test(s)) return { as_written: s, precision: "month", sort: s };
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return { as_written: s, precision: "day", sort: s };
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(s)) return { as_written: s, precision: "minute", sort: s.slice(0, 16) };
  return { as_written: s, precision: null, sort: null };
}

// A date inside Czech text as the NIS writes it in a string field ("diag. 12/2025", "DUS 24.2.2026"). The first date
// found sets precision and sort; the text stays as written.
export function czechDate(v: unknown): FactDate {
  const s = str(v);
  if (!s) return { as_written: null, precision: null, sort: null };
  const pad = (n: string) => n.padStart(2, "0");
  let m = /(?<!\d)(\d{1,2})\.\s?(\d{1,2})\.\s?(\d{4})(?!\d)/.exec(s);
  if (m) return { as_written: s, precision: "day", sort: `${m[3]}-${pad(m[2]!)}-${pad(m[1]!)}` };
  m = /(?<![\d.])(\d{1,2})\/(\d{4})(?!\d)/.exec(s);
  if (m) return { as_written: s, precision: "month", sort: `${m[2]}-${pad(m[1]!)}` };
  m = /(?<![\d./])((?:19|20)\d{2})(?![\d/])/.exec(s);
  if (m) return { as_written: s, precision: "year", sort: m[1]! };
  return { as_written: s, precision: null, sort: null };
}

const firstDate = (...vs: FactDate[]) => vs.find((d) => d.as_written) ?? { as_written: null, precision: null, sort: null };

function codesOf(cc: R | undefined): FactCode[] {
  const out: FactCode[] = [];
  for (const c of (Array.isArray(cc?.coding) ? cc!.coding : []) as R[]) {
    const code = str(c?.code);
    if (!code) continue;
    const sys = str(c?.system);
    out.push({ system: sys ? (CODE_SYSTEMS[sys] ?? sys) : "unknown", code, assigned_by: "source", ...(str(c?.display) ? { display: str(c?.display) } : {}) });
  }
  return out;
}

const textOf = (cc: R | undefined): string | null =>
  str(cc?.text) ?? str((Array.isArray(cc?.coding) ? cc!.coding : []).map((c: R) => c?.display).find(Boolean)) ?? str(cc?.coding?.[0]?.code);

const hasCode = (cc: R | undefined, system: string, code: string) => ((cc?.coding ?? []) as R[]).some((c) => c?.system === system && c?.code === code);
const category = (r: R, system: string) => ((r.category ?? []) as R[]).flatMap((c) => (c?.coding ?? []) as R[]).filter((c) => c?.system === system).map((c) => c.code as string);
const catV2 = (r: R) => ((Array.isArray(r.category) ? r.category : r.category ? [r.category] : []) as R[]).flatMap((c) => (c?.coding ?? []) as R[]).map((c) => c?.code as string);

function frame<K extends FactKind>(kind: K, src: string, date: FactDate, status: FactStatus, codes: FactCode[] = []) {
  return {
    kind,
    subject: "patient" as const,
    date,
    status,
    negated: false,
    not_stated: [] as string[],
    origin: "nis" as const,
    certainty: "clear" as const,
    codes,
    note: null,
    quarantined: false,
    sources: [src],
  };
}

// A record the NIS still marks as preliminary is shown for checking, never as a settled value.
function preliminary<F extends { certainty: string; certainty_reason?: unknown }>(f: F, status: unknown): F {
  if (status === "preliminary" || status === "registered" || status === "partial")
    return { ...f, certainty: "verify", certainty_reason: { code: "nis_preliminary", text: "V NIS je záznam označen jako předběžný." } };
  return f;
}

// Statuses that mean the record does not stand: it is not mapped at all.
const VOID = new Set(["entered-in-error", "cancelled"]);

function stageKindOf(o: R): StageKind | null {
  for (const c of (o.code?.coding ?? []) as R[]) if (c?.system === "http://loinc.org" && LOINC_STAGE[c.code]) return LOINC_STAGE[c.code]!;
  const t = (str(o.code?.text) ?? "").toLowerCase();
  // The NIS's own label of the stage kind; checked longest first, so "ypTNM" is not read as "pTNM".
  if (/\byp\s?tnm\b|po neoadjuvanci/.test(t)) return "post_neoadjuvant";
  if (/\bp\s?tnm\b|patologick/.test(t)) return "pathological";
  if (/\bc\s?tnm\b|klinick/.test(t)) return "clinical";
  return null;
}

const isStageObservation = (o: R) => stageKindOf(o) !== null || /\btnm\b|stadium/i.test(str(o.code?.text) ?? "");

function interpretation(o: R): "high" | "low" | null {
  for (const c of ((o.interpretation ?? []) as R[]).flatMap((i) => (i?.coding ?? []) as R[])) {
    if (["H", "HH", "HU"].includes(c?.code)) return "high";
    if (["L", "LL", "LU"].includes(c?.code)) return "low";
  }
  return null;
}

// The modality at the start of a report's name, as Czech reports name them; otherwise the whole name, so nothing is
// guessed. The rest of the name is the region.
const MODALITIES = ["PET/CT", "PET/MR", "CT", "MR", "MRI", "UZ", "USG", "RTG", "scintigrafie", "mamografie"];
function modalityOf(name: string): { modality: string; region: string | null } {
  for (const m of MODALITIES) {
    if (name.toLowerCase().startsWith(m.toLowerCase()) && (name.length === m.length || /[\s,]/.test(name[m.length]!)))
      return { modality: m, region: str(name.slice(m.length).replace(/^[\s,]+/, "")) };
  }
  return { modality: name, region: null };
}

// Only what the record states: FHIR's verification and clinical status. A confirmed diagnosis is not "confirmed by
// histology" (the record does not say on what basis), so it stays without a status.
function diseaseStatus(c: R): DiseaseStatus | null {
  const ver = ((c.verificationStatus?.coding ?? []) as R[]).map((x) => x?.code);
  const clin = ((c.clinicalStatus?.coding ?? []) as R[]).map((x) => x?.code);
  if (clin.includes("recurrence") || clin.includes("relapse")) return "recurrence";
  if (clin.includes("remission")) return "remission";
  if (ver.includes("provisional") || ver.includes("differential") || ver.includes("unconfirmed")) return "suspected";
  return null;
}

// Malignant neoplasms and in-situ (MKN-10 C00-C97, D00-D09): the diagnosis an oncology MDT discusses. A rule on the
// code the NIS gives, not a reading of the text.
const isOncological = (codes: FactCode[]) => codes.some((c) => c.system === "mkn-10" && /^(C\d|D0\d)/.test(c.code));

const MED_STATUS: Record<string, FactStatus> = {
  active: "documented", completed: "stopped", stopped: "stopped", "on-hold": "interrupted", intended: "planned", unknown: "documented",
};
const PROC_STATUS: Record<string, FactStatus> = { completed: "done", "in-progress": "done", preparation: "planned", stopped: "stopped", "on-hold": "interrupted", unknown: "documented" };
const REQ_STATUS: Record<string, FactStatus> = { draft: "planned", active: "requested", "on-hold": "requested", completed: "done", revoked: "stopped", unknown: "requested" };

// The kinds a NIS import looks for, by the resource types it reads. The run's checks say so, so an empty section
// reads "nothing in the NIS" for these and "not checked" for the rest.
export const NIS_KINDS: readonly FactKind[] = ["diagnosis", "stage", "lab_result", "procedure", "medication", "request", "imaging", "histology"];

export function mapNisResources(system: string, resources: readonly R[]): Mapped {
  const sources: NisSource[] = [];
  const srcOf = new Map<string, string>();
  const taken = new Set<string>();
  const source = (r: R) => {
    const key = refId(r);
    const have = srcOf.get(key);
    if (have) return have;
    const s: Omit<NisSource, "id"> = { type: "nis", system, resource: key, version: str(r.meta?.versionId), last_updated: str(r.meta?.lastUpdated) };
    const id = sourceIdFor(s, taken);
    taken.add(id);
    sources.push({ id, ...s });
    srcOf.set(key, id);
    return id;
  };
  const drafts: Drafted[] = [];
  const skipped: Skipped[] = [];
  const documents: NisDocument[] = [];
  const skip = (r: R, reason: string) => skipped.push({ resource: refId(r), reason });

  // Reports by the requests they answer (basedOn), so a request gets its result_fact.
  const reportFor = new Map<string, string>();
  for (const r of resources)
    if (r.resourceType === "DiagnosticReport" && !VOID.has(r.status))
      for (const b of (r.basedOn ?? []) as R[]) if (str(b?.reference)) reportFor.set(b.reference.replace(/^.*\/(ServiceRequest\/)/, "$1"), `draft:${refId(r)}`);

  for (const r of resources) {
    if (!r || typeof r !== "object" || !str(r.resourceType) || !str(r.id)) continue;
    if (VOID.has(r.status)) {
      skip(r, "void_status");
      continue;
    }
    switch (r.resourceType) {
      case "Observation": {
        const date = fhirDate(r.effectiveDateTime ?? r.effectivePeriod?.start ?? r.effectiveInstant);
        if (category(r, "http://terminology.hl7.org/CodeSystem/observation-category").includes("laboratory")) {
          const q = r.valueQuantity as R | undefined;
          const valueText = q && typeof q.value === "number" ? String(q.value) : str(r.valueString) ?? textOf(r.valueCodeableConcept);
          if (valueText === null) {
            skip(r, "no_value");
            break;
          }
          const rr = ((r.referenceRange ?? []) as R[])[0];
          const unit = str(q?.unit);
          const flag = interpretation(r);
          drafts.push(
            preliminary(
              {
                ...frame("lab_result", source(r), date, "documented", codesOf(r.code)),
                value: {
                  name_as_written: textOf(r.code) ?? "",
                  value_as_written: valueText,
                  value_numeric: q && typeof q.value === "number" ? q.value : null,
                  unit_as_written: unit,
                  unit,
                  reference_range: str(rr?.text),
                  reference_low: typeof rr?.low?.value === "number" ? rr.low.value : null,
                  reference_high: typeof rr?.high?.value === "number" ? rr.high.value : null,
                  out_of_range: flag,
                  out_of_range_origin: flag ? "document" : null,
                  draw: { as_written: date.as_written, requisition: null, specimen: str(r.specimen?.display) },
                },
              },
              r.status,
            ),
          );
        } else if (isStageObservation(r)) {
          const kind = stageKindOf(r);
          const tnm = str(r.valueString) ?? textOf(r.valueCodeableConcept);
          if (!kind || !tnm) {
            skip(r, kind ? "no_value" : "stage_kind_unknown");
            break;
          }
          drafts.push(
            preliminary(
              {
                ...frame("stage", source(r), date, "documented", codesOf(r.code)),
                value: { tnm_as_written: tnm, tnm: null, stage_kind: kind, edition: null, as_of: date.as_written, at_diagnosis: null },
              },
              r.status,
            ),
          );
        } else skip(r, "observation_kind_not_mapped");
        break;
      }
      case "Condition": {
        const codes = codesOf(r.code);
        const text = textOf(r.code);
        if (!text) {
          skip(r, "no_text");
          break;
        }
        const refuted = ((r.verificationStatus?.coding ?? []) as R[]).some((x) => x?.code === "refuted");
        const date = firstDate(fhirDate(r.onsetDateTime ?? r.onsetPeriod?.start), czechDate(r.onsetString), fhirDate(r.recordedDate));
        drafts.push({
          ...frame("diagnosis", source(r), date, "documented", codes),
          negated: refuted,
          value: { text, disease_status: diseaseStatus(r), primary: isOncological(codes) },
        });
        break;
      }
      case "Procedure": {
        const name = textOf(r.code);
        if (!name) {
          skip(r, "no_text");
          break;
        }
        const notDone = r.status === "not-done";
        drafts.push({
          ...frame("procedure", source(r), fhirDate(r.performedDateTime ?? r.performedPeriod?.start), notDone ? "documented" : (PROC_STATUS[r.status] ?? "documented"), codesOf(r.code)),
          negated: notDone,
          value: { name, region: textOf(r.bodySite?.[0]), text: str(r.note?.[0]?.text) },
        });
        break;
      }
      case "MedicationStatement": {
        const drug = textOf(r.medicationCodeableConcept) ?? str(r.medicationReference?.display);
        if (!drug) {
          skip(r, "no_text");
          break;
        }
        const start = fhirDate(r.effectivePeriod?.start ?? r.effectiveDateTime);
        const end = str(r.effectivePeriod?.end);
        drafts.push({
          ...frame("medication", source(r), start, r.status === "not-taken" ? "documented" : (MED_STATUS[r.status] ?? "documented"), codesOf(r.medicationCodeableConcept)),
          negated: r.status === "not-taken",
          value: { drug, strength: null, dosing: str(r.dosage?.[0]?.text), change: null, indication: textOf(r.reasonCode?.[0]), text: end ? `do ${end}` : null },
        });
        break;
      }
      case "ServiceRequest": {
        const what = textOf(r.code) ?? textOf(r.reasonCode?.[0]);
        if (!what) {
          skip(r, "no_text");
          break;
        }
        const result = reportFor.get(refId(r)) ?? null;
        drafts.push({
          ...frame("request", source(r), fhirDate(r.authoredOn), REQ_STATUS[r.status] ?? "requested", codesOf(r.code)),
          value: { what, request_kind: null, result_fact: result },
        });
        break;
      }
      case "DiagnosticReport": {
        const cats = catV2(r);
        const name = textOf(r.code) ?? "";
        const date = fhirDate(r.effectiveDateTime ?? r.effectivePeriod?.start);
        const conclusion = str(r.conclusion);
        if (cats.includes("LAB")) {
          // A lab report only groups its Observations, which are mapped one by one.
          skip(r, "lab_report_grouping");
          break;
        }
        if (!conclusion) {
          skip(r, "no_conclusion");
          break;
        }
        if (cats.includes("RAD") || cats.includes("NMR") || cats.includes("CT") || cats.includes("US")) {
          const { modality, region } = modalityOf(name);
          drafts.push(preliminary({ ...frame("imaging", source(r), date, "done", codesOf(r.code)), draft_id: `draft:${refId(r)}`, value: { modality, region, finding_text: conclusion, response: null } }, r.status));
        } else if (cats.includes("PAT") || cats.includes("SP") || cats.includes("CP")) {
          drafts.push(
            preliminary(
              { ...frame("histology", source(r), date, "done", codesOf(r.code)), draft_id: `draft:${refId(r)}`, value: { specimen: name || null, result_text: conclusion, tumour_type: null, grade: null } },
              r.status,
            ),
          );
        } else skip(r, "report_category_not_mapped");
        break;
      }
      case "DocumentReference": {
        const att = (r.content?.[0]?.attachment ?? {}) as R;
        documents.push({
          resource: refId(r),
          version: str(r.meta?.versionId),
          status: str(r.status),
          title: str(r.description) ?? str(att.title),
          date: str(r.context?.period?.start) ?? str(r.date),
          replaces: ((r.relatesTo ?? []) as R[]).filter((x) => x?.code === "replaces").map((x) => str(x?.target?.reference)).filter((x): x is string => !!x),
          attachment_url: str(att.url),
          content_type: str(att.contentType),
        });
        break;
      }
      case "Encounter":
        // extraction/2 has no fact kind for a visit; the visit's findings come with its documents.
        skip(r, "no_fact_kind");
        break;
      default:
        // Identity (Patient), insurance (Coverage) and people stay out of a run.
        skip(r, "not_clinical");
    }
  }
  // A result_fact that names a report which produced no fact (no conclusion) would dangle: the request then has none.
  const ids = new Set(drafts.map((d) => d.draft_id).filter(Boolean));
  for (const d of drafts) if (d.kind === "request" && d.value.result_fact && !ids.has(d.value.result_fact)) d.value = { ...d.value, result_fact: null };

  const checks: Check[] = NIS_KINDS.map((k) => ({
    id: `chk-nis-${k}`,
    looks_for: k,
    expected: null,
    covered: [],
    unreadable: [],
    result: drafts.some((d) => d.kind === k) ? "found" : "nothing_found",
  }));
  return { sources, drafts, checks, documents, skipped };
}

export type NisRunInput = {
  caseId: string;
  system: string;
  resources: readonly R[];
  runId: string;
  createdAt: string;
  previous: Pick<ExtractionRun, "facts" | "sources"> | null;
  supersedes: string | null;
  issuedIds?: Iterable<string>;
};

// A whole run with producer "nis": the mapped facts get their keys and IDs against the previous NIS run of the case
// (so a confirmation stays on the same fact across refreshes), and the run is validated before anyone stores it.
export function nisRun(i: NisRunInput): { run: ExtractionRun; match: MatchResult; mapped: Mapped; validation: ValidationResult } {
  const mapped = mapNisResources(i.system, i.resources);
  const match = assignFactIds(i.caseId, mapped.drafts, mapped.sources, i.previous, { issuedIds: i.issuedIds ?? [] });
  const run: ExtractionRun = {
    schema: EXTRACTION_SCHEMA,
    case_id: i.caseId,
    content_language: "cs",
    run: { id: i.runId, producer: "nis", created_at: i.createdAt, stages: [{ name: "nis_import", engine: "codebridge nis-map 1" }], supersedes: i.supersedes },
    documents: [],
    sources: mapped.sources,
    facts: match.facts,
    checks: mapped.checks,
    alerts: [],
    brief: null,
    question_draft: null,
  };
  return { run, match, mapped, validation: validateRun(run) };
}

