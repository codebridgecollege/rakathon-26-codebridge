// NIS records into the extraction format (issue #22, phase 2): FHIR R4 resources of one linked patient become facts of
// a codebridge.extraction/2 run with producer "nis" (docs/design/EXTRACTION-FORMAT.md, "The NIS producer"). Pure: the
// Worker pulls the resources (api/src/services/fhir.ts), this maps them, keys.ts and match.ts give the facts their keys
// and IDs.
//
// The rules (CLAUDE.md, "Clinical trust"):
//   - Every fact points at its NIS record (a source of type "nis": system, resource, version, last updated) and has
//     origin "nis". The record is its own evidence; there is no quote.
//   - Values, units, ranges, codes and dates are kept as the NIS gives them. A code is never invented: a coding goes
//     into codes with assigned_by "source", under a short system name where we know the URI, else under the URI.
//   - Disease status only where the record states one, no out-of-range flag the record does not carry, no TNM
//     normalisation, no stage kind guessed from a value. What cannot be mapped is reported, not forced. The one rule of
//     ours is `primary` (the oncological diagnosis), set from the MKN-10 code and only when it is unambiguous.
//   - A sent request is not a done exam: a ServiceRequest is a request fact, with result_fact only when a report
//     names it in basedOn.
//   - The NIS answers for its structured records only, never for the documents, so its checks say "found" or
//     "not_run", never "nothing_found" (which the view shows as "neuvedeno v dostupné dokumentaci").
import { assignFactIds, type MatchResult } from "./extraction/match";
import { FRAGMENT_SCHEMA, type Fragment, type FragmentFact } from "./fragments";
import { sourceIdFor } from "./extraction/keys";
import { validateRun, type ValidationResult } from "./extraction/validate";
import {
  EXTRACTION_SCHEMA,
  FACT_KINDS,
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
  type VisitType,
} from "./extraction/types";

type R = Record<string, any>;
type Drafted = DraftFact & { draft_id?: string };

// Code systems we know by URI, under the short names the format uses. Any other system keeps its URI (NČLP included,
// until FNO names its URI: docs/agent/OPEN_QUESTIONS.md).
export const CODE_SYSTEMS: Record<string, string> = {
  "https://uzis.cz/terminology/CodeSystem/mkn-10": "mkn-10",
  "https://github.com/codebridgecollege/rakathon-26-codebridge/fhir/CodeSystem/fno-local-lab-code": "fno-local-lab",
  "http://snomed.info/sct": "snomed-ct",
  "http://loinc.org": "loinc",
  "http://www.whocc.no/atc": "atc",
};

// LOINC stage-group codes. The separate T, N and M codes (21899-0, 21905-5 and the like) are parts of one stage; as
// facts they would read as several stages of one day, which is the shape of a contradiction, so they are not mapped.
const LOINC_STAGE: Record<string, StageKind> = { "21908-9": "clinical", "21902-2": "pathological" };
const LOINC_TNM_PART = new Set(["21905-5", "21906-3", "21907-1", "21899-0", "21900-6", "21901-4"]);

// What the mapping did with each resource, for the run's log and the tests. Types and reasons only, no content.
export type Skipped = { resource: string; reason: string };
export type NisDocument = { resource: string; version: string | null; status: string | null; title: string | null; date: string | null; replaces: string[]; attachment_url: string | null; content_type: string | null };
export type Mapped = { sources: NisSource[]; drafts: Drafted[]; checks: Check[]; documents: NisDocument[]; skipped: Skipped[] };

const str = (x: unknown): string | null => (typeof x === "string" && x.trim() ? x.trim() : null);
const refId = (r: R) => `${r.resourceType}/${r.id}`;
const NONE: FactDate = { as_written: null, precision: null, sort: null };

// Wall time in Prague for an instant with an offset, "2026-03-17T23:30:00Z" -> "2026-03-18T00:30": the hospital's day
// and hour, whichever offset the NIS writes.
function pragueMinute(instant: string): string | null {
  const t = Date.parse(instant);
  if (Number.isNaN(t)) return null;
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Prague", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
      .formatToParts(new Date(t))
      .map((x) => [x.type, x.value]),
  );
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
}

// A FHIR date or dateTime as the record gives it: precision from its length; sort cut to that precision, in Prague
// time when the record gives a time with an offset. No day is added to a month, no time to a day.
export function fhirDate(v: unknown): FactDate {
  const s = str(v);
  if (!s) return NONE;
  if (/^\d{4}$/.test(s)) return { as_written: s, precision: "year", sort: s };
  if (/^\d{4}-\d{2}$/.test(s)) return { as_written: s, precision: "month", sort: s };
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return { as_written: s, precision: "day", sort: s };
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(s)) {
    const withZone = /(Z|[+-]\d{2}:\d{2})$/.test(s);
    return { as_written: s, precision: "minute", sort: withZone ? (pragueMinute(s) ?? s.slice(0, 16)) : s.slice(0, 16) };
  }
  return { as_written: s, precision: null, sort: null };
}

// A date inside Czech text as the NIS writes it in a string field ("diag. 12/2025", "DUS 24.2.2026"). The first date
// found sets precision and sort; the text stays as written. A bare year counts only when it is the text's only number,
// so "2000 mg od 2019" is not dated 2000.
export function czechDate(v: unknown): FactDate {
  const s = str(v);
  if (!s) return NONE;
  const pad = (n: string) => n.padStart(2, "0");
  let m = /(?<!\d)(\d{1,2})\.\s?(\d{1,2})\.\s?(\d{4})(?!\d)/.exec(s);
  if (m) return { as_written: s, precision: "day", sort: `${m[3]}-${pad(m[2]!)}-${pad(m[1]!)}` };
  m = /(?<![\d.])(\d{1,2})\/(\d{4})(?!\d)/.exec(s);
  if (m) return { as_written: s, precision: "month", sort: `${m[2]}-${pad(m[1]!)}` };
  const numbers = s.match(/\d+/g) ?? [];
  if (numbers.length === 1 && /^(19|20)\d{2}$/.test(numbers[0]!)) return { as_written: s, precision: "year", sort: numbers[0]! };
  return { as_written: s, precision: null, sort: null };
}

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

const codesIn = (r: R, field: "category") => ((Array.isArray(r[field]) ? r[field] : r[field] ? [r[field]] : []) as R[]).flatMap((c) => (c?.coding ?? []) as R[]);
const obsCategory = (r: R) => codesIn(r, "category").filter((c) => c?.system === "http://terminology.hl7.org/CodeSystem/observation-category").map((c) => c.code as string);
const catV2 = (r: R) => codesIn(r, "category").map((c) => c?.code as string);

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
    // note is the assistant's own note; a NIS remark is not the assistant's words, so it stays null.
    note: null,
    quarantined: false,
    sources: [src],
  };
}

// The fact is mapped but shown for checking, with the reason in the doctor's language.
function verify<F extends { certainty: string; certainty_reason?: unknown }>(f: F, code: string, text: string): F {
  return { ...f, certainty: "verify", certainty_reason: { code, text } };
}

// A record the NIS still marks as preliminary is shown for checking, never as a settled value.
function preliminary<F extends { certainty: string; certainty_reason?: unknown }>(f: F, status: unknown): F {
  return status === "preliminary" || status === "registered" || status === "partial" ? verify(f, "nis_preliminary", "V NIS je záznam označen jako předběžný.") : f;
}

// Records that do not stand: not mapped at all. Condition has no status; it says so in verificationStatus.
const VOID = new Set(["entered-in-error", "cancelled"]);
const isVoid = (r: R) => VOID.has(r.status) || ((r.verificationStatus?.coding ?? []) as R[]).some((c) => c?.code === "entered-in-error");

// The stage kind as the record states it: a LOINC stage-group code, or the NIS's own label naming one kind only.
// "ycTNM" (clinical restaging after neoadjuvant therapy) is none of the format's kinds, and a label that names two
// kinds, or disagrees with the code, is ambiguous: neither is mapped.
function stageKindOf(o: R): StageKind | "ambiguous" | "part" | null {
  const codes = ((o.code?.coding ?? []) as R[]).filter((c) => c?.system === "http://loinc.org").map((c) => c.code as string);
  if (codes.some((c) => LOINC_TNM_PART.has(c))) return "part";
  const fromCode = codes.map((c) => LOINC_STAGE[c]).find(Boolean) ?? null;
  const t = (str(o.code?.text) ?? "").toLowerCase();
  if (/\byc\s?tnm\b/.test(t)) return "ambiguous";
  const named = new Set<StageKind>();
  if (/\byp\s?tnm\b|po neoadjuvanci/.test(t)) named.add("post_neoadjuvant");
  if (/\bp\s?tnm\b|patologick/.test(t)) named.add("pathological");
  if (/\bc\s?tnm\b|klinick/.test(t)) named.add("clinical");
  if (named.size > 1 || (fromCode && named.size === 1 && !named.has(fromCode))) return "ambiguous";
  return fromCode ?? [...named][0] ?? null;
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

// A primary malignant neoplasm or one in situ (MKN-10 C00-C76, C80-C97, D00-D09). C77-C79 are secondary.
const isPrimaryCancerCode = (codes: FactCode[]) => codes.some((c) => c.system === "mkn-10" && /^(C([0-6]\d|7[0-6]|8\d|9[0-7])|D0\d)/.test(c.code));

const MED_STATUS: Record<string, FactStatus> = { active: "documented", completed: "stopped", stopped: "stopped", "on-hold": "interrupted", intended: "planned", unknown: "documented" };
// FHIR keeps "completed" (the course ran its plan) apart from "stopped" (halted early); the format's status cannot, so
// the text says which.
const MED_TEXT: Record<string, string> = { completed: "ukončeno (dle NIS dokončeno)", stopped: "vysazeno (dle NIS)", "on-hold": "přerušeno (dle NIS)" };
// A procedure still running is not done; the format has no "in progress", so it stays documented with a word saying so.
const PROC_STATUS: Record<string, FactStatus> = { completed: "done", preparation: "planned", stopped: "stopped", "on-hold": "interrupted", "in-progress": "documented", unknown: "documented" };
// An unknown request status is no reason to say a request was sent and has no result.
const REQ_STATUS: Record<string, FactStatus> = { draft: "planned", active: "requested", "on-hold": "requested", completed: "done", revoked: "stopped", unknown: "documented" };

// The visit type from the Encounter's class (HL7 v3 ActCode). "consultation" is not a class, so the NIS import never
// says it; a document producer may.
const VISIT_CLASS: Record<string, VisitType> = { AMB: "outpatient", IMP: "admission", ACUTE: "admission", NONAC: "admission", SS: "admission", EMER: "emergency" };
const VISIT_STATUS: Record<string, FactStatus> = { finished: "done", planned: "planned", arrived: "documented", triaged: "documented", "in-progress": "documented", onleave: "documented", unknown: "documented" };

// The kinds a NIS import maps, by the resource types it reads. Only "found" or "not_run" (see the header).
export const NIS_KINDS: readonly FactKind[] = ["diagnosis", "stage", "lab_result", "procedure", "medication", "request", "imaging", "histology", "visit"];

// The kinds a skipped record could have held: its kind's check cannot say "found everything".
const SKIP_KINDS: Record<string, FactKind[]> = {
  Observation: ["lab_result", "stage"],
  DiagnosticReport: ["imaging", "histology"],
  Condition: ["diagnosis"],
  Procedure: ["procedure"],
  MedicationStatement: ["medication"],
  ServiceRequest: ["request"],
  Encounter: ["visit"],
};

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

  // One copy of each record: a page boundary that shifts during paging can return a record twice.
  const seen = new Set<string>();
  const unique = resources.filter((r) => r && typeof r === "object" && str(r.resourceType) && str(r.id) && !seen.has(refId(r)) && seen.add(refId(r)));

  // Reports by the requests they answer (basedOn). A reference counts when it is relative or within this NIS, without
  // its version; when several reports answer one request, the final one with the lowest ID, so the link does not
  // move between refreshes.
  const base = system.replace(/\/+$/, "");
  const srRef = (ref: unknown) => {
    const s = str(ref)?.replace(/\/_history\/[^/]+$/, "");
    if (!s) return null;
    const local = s.startsWith(`${base}/`) ? s.slice(base.length + 1) : /^[A-Za-z]+\/[^/]+$/.test(s) ? s : null;
    return local?.startsWith("ServiceRequest/") ? local : null;
  };
  const reportFor = new Map<string, R>();
  const rank = (r: R) => (r.status === "final" || r.status === "amended" || r.status === "corrected" ? 0 : 1);
  for (const r of unique)
    if (r.resourceType === "DiagnosticReport" && !isVoid(r) && str(r.conclusion))
      for (const b of (r.basedOn ?? []) as R[]) {
        const k = srRef(b?.reference);
        if (!k) continue;
        const have = reportFor.get(k);
        if (!have || rank(r) < rank(have) || (rank(r) === rank(have) && String(r.id) < String(have.id))) reportFor.set(k, r);
      }

  for (const r of unique) {
    if (isVoid(r)) {
      skip(r, "void_status");
      continue;
    }
    switch (r.resourceType) {
      case "Observation": {
        const date = fhirDate(r.effectiveDateTime ?? r.effectivePeriod?.start ?? r.effectiveInstant);
        if (obsCategory(r).includes("laboratory")) {
          const name = textOf(r.code);
          if (!name) {
            skip(r, "no_text");
            break;
          }
          const q = r.valueQuantity as R | undefined;
          const num = q && typeof q.value === "number" ? q.value : null;
          // "<0.5" keeps its sign in the text and gets no number: 0.5 would be a different value.
          const comparator = str(q?.comparator);
          const valueText = num !== null ? `${comparator ?? ""}${num}` : (str(r.valueString) ?? textOf(r.valueCodeableConcept));
          if (valueText === null) {
            skip(r, "no_value");
            break;
          }
          const ranges = (r.referenceRange ?? []) as R[];
          const rr = ranges[0];
          const unit = str(q?.unit) ?? str(q?.code);
          const flag = interpretation(r);
          let f: Drafted = preliminary(
            {
              ...frame("lab_result", source(r), date, "documented", codesOf(r.code)),
              not_stated: date.as_written ? [] : ["draw"],
              value: {
                name_as_written: name,
                value_as_written: valueText,
                value_numeric: comparator ? null : num,
                unit_as_written: unit,
                unit,
                reference_range: str(rr?.text),
                reference_low: typeof rr?.low?.value === "number" ? rr.low.value : null,
                reference_high: typeof rr?.high?.value === "number" ? rr.high.value : null,
                out_of_range: flag,
                out_of_range_origin: flag ? "document" : null,
                // The draw time in Prague wall time, so the fact's key does not change when the NIS writes the same
                // instant with another offset; the record's own text stays in date.as_written.
                draw: { as_written: date.precision === "minute" ? date.sort : date.as_written, requisition: null, specimen: str(r.specimen?.display) },
              },
            },
            r.status,
          );
          if (ranges.length > 1) f = verify(f, "nis_several_ranges", "NIS uvádí více referenčních mezí; zobrazena je první.");
          drafts.push(f);
        } else if (isStageObservation(r)) {
          const kind = stageKindOf(r);
          if (kind === "part") {
            skip(r, "tnm_component");
            break;
          }
          if (kind === null || kind === "ambiguous") {
            skip(r, kind === null ? "stage_kind_unknown" : "stage_kind_ambiguous");
            break;
          }
          const tnm = str(r.valueString) ?? textOf(r.valueCodeableConcept);
          if (!tnm) {
            skip(r, "no_value");
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
        // The diagnosis date only: recordedDate is when the entry was made, possibly years later.
        const onset = fhirDate(r.onsetDateTime ?? r.onsetPeriod?.start);
        const date = onset.as_written ? onset : czechDate(r.onsetString);
        let f: Drafted = {
          ...frame("diagnosis", source(r), date, "documented", codes),
          negated: refuted,
          not_stated: date.as_written ? [] : ["date"],
          value: { text, disease_status: diseaseStatus(r), primary: false },
        };
        // A resolved or inactive condition is not a current one; the record's end date goes into the reason.
        const clin = ((r.clinicalStatus?.coding ?? []) as R[]).map((x) => x?.code);
        if (clin.includes("resolved") || clin.includes("inactive") || r.abatementDateTime || r.abatementString || r.abatementPeriod) {
          const end = str(r.abatementDateTime) ?? str(r.abatementString) ?? str(r.abatementPeriod?.start);
          f = verify(f, "nis_resolved", end ? `V NIS uzavřeno k ${end}.` : "V NIS označeno jako uzavřené nebo neaktivní.");
        }
        drafts.push(f);
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
          value: { name, region: textOf(r.bodySite?.[0]), text: r.status === "in-progress" ? "probíhá (dle NIS)" : null },
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
        const status = r.status === "not-taken" ? "documented" : (MED_STATUS[r.status] ?? "documented");
        // The end date is the stop only for a stopped drug; a still-active drug with an end is a planned end, kept in the text.
        const stopped = status === "stopped";
        const said = [MED_TEXT[r.status], end && !stopped ? `do ${end}` : null].filter(Boolean).join(", ");
        drafts.push({
          ...frame("medication", source(r), start, status, codesOf(r.medicationCodeableConcept)),
          negated: r.status === "not-taken",
          value: { drug, strength: null, dosing: str(r.dosage?.[0]?.text), change: null, indication: textOf(r.reasonCode?.[0]), text: said || null, stop_as_written: stopped ? end : null },
        });
        break;
      }
      case "ServiceRequest": {
        const what = textOf(r.code) ?? textOf(r.reasonCode?.[0]);
        if (!what) {
          skip(r, "no_text");
          break;
        }
        const report = reportFor.get(refId(r));
        drafts.push({
          ...frame("request", source(r), fhirDate(r.authoredOn), REQ_STATUS[r.status] ?? "documented", codesOf(r.code)),
          value: { what, request_kind: null, result_fact: report ? `draft:${refId(report)}` : null },
        });
        break;
      }
      case "DiagnosticReport": {
        const cats = catV2(r);
        const name = textOf(r.code);
        const date = fhirDate(r.effectiveDateTime ?? r.effectivePeriod?.start);
        const conclusion = str(r.conclusion);
        if (cats.includes("LAB")) {
          // A lab report only groups its Observations, which are mapped one by one.
          skip(r, "lab_report_grouping");
          break;
        }
        if (!conclusion || !name) {
          skip(r, conclusion ? "no_text" : "no_conclusion");
          break;
        }
        if (cats.some((c) => ["RAD", "NMR", "CT", "US"].includes(c))) {
          const { modality, region } = modalityOf(name);
          drafts.push(preliminary({ ...frame("imaging", source(r), date, "done", codesOf(r.code)), draft_id: `draft:${refId(r)}`, value: { modality, region, finding_text: conclusion, response: null } }, r.status));
        } else if (cats.some((c) => ["PAT", "SP", "CP"].includes(c))) {
          drafts.push(
            preliminary({ ...frame("histology", source(r), date, "done", codesOf(r.code)), draft_id: `draft:${refId(r)}`, value: { specimen: name, result_text: conclusion, tumour_type: null, grade: null } }, r.status),
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
      case "Encounter": {
        // Encounter.class is one Coding in R4. Its code counts only in HL7's ActCode system (or with no system), so a
        // local "AMB" of another code list is not read as outpatient.
        const klass = r.class as R | undefined;
        const cls = !klass?.system || klass.system === "http://terminology.hl7.org/CodeSystem/v3-ActCode" ? str(klass?.code) : null;
        const date = fhirDate(r.period?.start);
        drafts.push({
          ...frame("visit", source(r), date, VISIT_STATUS[r.status] ?? "documented", codesOf(r.type?.[0])),
          not_stated: date.as_written ? [] : ["date"],
          value: {
            type: (cls && VISIT_CLASS[cls]) || "other",
            type_as_written: textOf(r.type?.[0]),
            department: str(r.serviceProvider?.display),
            // A reason given only as a reference (reasonReference) has no text here; the referenced Condition is its own fact.
            reason: textOf(r.reasonCode?.[0]),
            end_as_written: str(r.period?.end),
          },
        });
        break;
      }
      default:
        // Identity (Patient), insurance (Coverage) and people stay out of a run.
        skip(r, "not_clinical");
    }
  }
  // A result_fact naming a report that produced no fact would dangle: the request then has none.
  const ids = new Set(drafts.map((d) => d.draft_id).filter(Boolean));
  for (const d of drafts) if (d.kind === "request" && d.value.result_fact && !ids.has(d.value.result_fact)) d.value = { ...d.value, result_fact: null };

  // The primary diagnosis is the one primary cancer code; with none or several, no diagnosis is marked.
  const primaries = drafts.filter((d) => d.kind === "diagnosis" && !d.negated && isPrimaryCancerCode(d.codes));
  if (primaries.length === 1) {
    const p = primaries[0]!;
    if (p.kind === "diagnosis") p.value = { ...p.value, primary: true };
  }

  return { sources, drafts, checks: checksFor(drafts, skipped, []), documents, skipped };
}

// What the run says it looked at: "found" for a kind with facts, "not_run" for everything else. A kind whose records
// were skipped or cut off by the paging limit is "not_run" even with facts, because the NIS may hold more of it than
// the facts show.
function checksFor(drafts: readonly Drafted[], skipped: readonly Skipped[], truncatedTypes: readonly string[]): Check[] {
  const incomplete = new Set<FactKind>();
  for (const s of skipped) {
    if (["void_status", "lab_report_grouping", "not_clinical", "tnm_component"].includes(s.reason)) continue;
    for (const k of SKIP_KINDS[s.resource.split("/")[0]!] ?? []) incomplete.add(k);
  }
  for (const t of truncatedTypes) for (const k of SKIP_KINDS[t] ?? []) incomplete.add(k);
  return FACT_KINDS.map((k) => ({
    id: `chk-nis-${k}`,
    looks_for: k,
    expected: null,
    covered: [],
    unreadable: [],
    result: NIS_KINDS.includes(k) && !incomplete.has(k) && drafts.some((d) => d.kind === k) ? ("found" as const) : ("not_run" as const),
  }));
}

/**
 * The case's NIS fragment for the case merge (docs/research/2026-10-20-case-merge-contract.md, "The NIS fragment"):
 * the mapped facts with draft IDs "nis:<Type>/<id>" (one per record, stable across imports), their sources and checks,
 * no alerts. `importId` names the import, so the merge can tell which link it belongs to.
 */
export function nisFragment(i: { system: string; resources: readonly R[]; importId: string; truncated?: readonly string[] }): { fragment: Fragment; mapped: Mapped } {
  const mapped = mapNisResources(i.system, i.resources);
  if (i.truncated?.length) mapped.checks = checksFor(mapped.drafts, mapped.skipped, i.truncated);
  const resourceOf = new Map(mapped.sources.map((s) => [s.id, s.resource]));
  const rename = (x: string) => (x.startsWith("draft:") ? `nis:${x.slice("draft:".length)}` : x);
  const facts: FragmentFact[] = mapped.drafts.map((d) => {
    const own = d.draft_id ? rename(d.draft_id) : `nis:${resourceOf.get(d.sources[0] ?? "") ?? ""}`;
    const f = { ...d, draft_id: own } as FragmentFact;
    if (f.kind === "request" && f.value.result_fact) f.value = { ...f.value, result_fact: rename(f.value.result_fact) };
    return f;
  });
  return {
    mapped,
    fragment: {
      schema: FRAGMENT_SCHEMA,
      producer: "nis",
      document_id: "nis",
      document_sha256: null,
      pipeline_run: i.importId,
      parts: [],
      stages: [{ name: "nis_import", engine: "codebridge nis-map 1" }],
      sources: mapped.sources,
      facts,
      checks: mapped.checks.filter((c) => c.result === "found"),
      alerts: [],
    },
  };
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
  // Resource types the pull cut off at its limit (patientRecord's `truncated`).
  truncated?: readonly string[];
};

// A whole run with producer "nis": the mapped facts get their keys and IDs against the previous NIS run of the case
// (so a confirmation stays on the same fact across refreshes), and the run is validated before anyone stores it.
export function nisRun(i: NisRunInput): { run: ExtractionRun; match: MatchResult; mapped: Mapped; validation: ValidationResult } {
  const mapped = mapNisResources(i.system, i.resources);
  if (i.truncated?.length) mapped.checks = checksFor(mapped.drafts, mapped.skipped, i.truncated);
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
