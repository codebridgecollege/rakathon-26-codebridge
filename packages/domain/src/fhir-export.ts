// The case as a FHIR R4 Bundle (team decision 2026-10-17: produce FHIR, no server). The Bundle must stay the same JSON
// as before, because fhir/validate.sh checked a saved copy with the official HL7 validator. Every fact gets
// a Provenance that names the document, page and quote, so the export keeps the rule that each claim points to its
// source. Mapping and profiles: fhir/README.md.
//
// Pure: the clock, the id source and the catalog come in as deps, so this file holds no interface text and no
// runtime globals. FHIR translates only our own labels and section titles (I18N.md, "PDF and FHIR"); the content
// (names, quotes, codes, values) is written as the documents give it.
import type { CaseData, Item, SourceRef } from "./case-data";
import type { QState } from "./case-view";
import { alertArgs } from "./run-view";

export type T = (id: string, args?: Record<string, string | number>) => string;
export type FhirDeps = { now: string; uuid: () => string; t: T };

// The list row's part the export reads: identity (kept apart from the case data), where the document names the
// patient, and the question's draft.
export type FhirRow = { id: string; name: string; birth: string | null; explicit: boolean; draft: string | null; basis: unknown; identitySource?: SourceRef | null };
// q: the question's state, with the confirmation's time already formatted for reading (the server sends ISO).
export type FhirInput = { p: FhirRow; cd: CaseData; q: QState };

export const FHIR_BASE = "https://github.com/codebridgecollege/rakathon-26-codebridge/fhir";
export const FHIR_SYS = {
  mkn10: "https://uzis.cz/terminology/CodeSystem/mkn-10",
  certainty: `${FHIR_BASE}/CodeSystem/extraction-certainty`,
  flag: `${FHIR_BASE}/CodeSystem/assistant-flag`,
  // FNO's own lab codes (S_HSCRP, B_HB): kept as the source gives them; the URI stands for FNO's code list until FNO
  // names the real one.
  lab: `${FHIR_BASE}/CodeSystem/fno-local-lab-code`,
  caseId: `${FHIR_BASE}/NamingSystem/case-id`,
  obsCat: "http://terminology.hl7.org/CodeSystem/observation-category",
  interp: "http://terminology.hl7.org/CodeSystem/v3-ObservationInterpretation",
  condCat: "http://terminology.hl7.org/CodeSystem/condition-category",
};
export const FHIR_EXT = (n: string) => `${FHIR_BASE}/StructureDefinition/${n}`;

// The narrative is XHTML inside JSON; a quote with "<" or "&" must not break it.
const esc = (s: unknown) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

// Dates stay as precise as the document: "2.6.2022" -> 2022-06-02, "4/2022" -> 2022-04. Anything else ("9/23",
// "11/2023 až 6/2025") is not converted; the original text goes into a note instead of a guessed date.
export function fhirDate(s: unknown): string | null {
  if (!s) return null;
  let m = String(s).trim().match(/^(\d{1,2})\.\s*(\d{1,2})\.\s*(\d{4})$/);
  if (m) return `${m[3]}-${m[2]!.padStart(2, "0")}-${m[1]!.padStart(2, "0")}`;
  m = String(s).trim().match(/^(\d{1,2})\/(\d{4})$/);
  return m ? `${m[2]}-${m[1]!.padStart(2, "0")}` : null;
}

// A lab value keeps its written precision ("4,130" stays 4.130, not 4.13). JSON numbers lose trailing zeros in
// JavaScript, so the value is held as a marked string and written as a bare number by fhirJson().
export const FHIR_NUM = "~fhirnum~";
export const fhirJson = (b: unknown) => JSON.stringify(b, null, 2).replace(new RegExp(`"${FHIR_NUM}(-?[0-9.]+)"`, "g"), "$1");

type Basis = { role?: string; quote?: string; source: SourceRef };
const basisOf = (b: unknown): Basis[] => (Array.isArray(b) ? (b as Basis[]) : []);

// The passages a draft rests on: the document's purpose sentence first, then each finding the draft cites, every one
// verbatim with its page.
export const basisPlain = (t: T, bs: unknown) =>
  basisOf(bs)
    .map((b) => t("patient-fhir-basis", { role: b.role === "purpose" ? "purpose" : "finding", quote: String(b.quote ?? ""), file: String(b.source.file ?? ""), page: String(b.source.page) }))
    .join(" ");

// Plain text of the MDT question for the report and the FHIR export: a draft says it is a draft, a confirmation says
// who confirmed it, a doctor's text says a doctor wrote it.
export function questionPlain(t: T, q: QState): string {
  // Any basis value, even an empty list, adds the space.
  const basis = "basis" in q && q.basis ? ` ${basisPlain(t, q.basis)}` : "";
  if (q.mode === "edited") return `${q.text} ${t("patient-fhir-q-edited", { explicit: q.explicit ? "yes" : "no" })}`;
  if (q.mode === "explicit") return q.text;
  if (q.mode === "confirmed") return `${q.text} ${t("patient-fhir-q-confirmed", { by: String(q.by), when: String(q.when) })}${basis}`;
  if (q.mode === "draft") return `${q.text} ${t("patient-fhir-q-draft", { kind: q.kind })}${basis}`;
  return t("patient-fhir-q-none");
}

// The extraction is typed loosely (case-data.ts); the resources are plain JSON built field by field.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = Record<string, any>;

export function fhirBundle(input: FhirInput, deps: FhirDeps): Json {
  const { p, cd, q: qs } = input;
  const { now, t } = deps;
  const r = cd.record;
  const c = {
    file: cd.file,
    patient: { ...(r?.patient || {}), name: p.name, birth_date: p.birth } as Item,
    diagnosis: r?.diagnosis,
    sections: r?.sections || {},
    labs: cd.labs?.values || [],
    labs_note_cs: cd.labs?.note_cs || null,
    flags: cd.alerts?.flags || [],
    summary: cd.brief?.summary_items || [],
    timeline: r?.timeline_source || [],
    mdt_question: (r?.mdt_question || {}) as Item,
    ocr_quality_note: r?.ocr_quality_note,
  };
  const entries: Json[] = [];
  const uid = () => "urn:uuid:" + deps.uuid();
  // Each resource carries a one-line human-readable text, as FHIR recommends, so a reader without our app can see
  // what it is.
  const add = (res: Json, line?: string) => {
    const fullUrl = uid();
    if (line) res.text = { status: "generated", div: `<div xmlns="http://www.w3.org/1999/xhtml">${esc(line)}</div>` };
    entries.push({ fullUrl, resource: res });
    return fullUrl;
  };
  const ref = (u: string) => ({ reference: u });
  // How sure the reading is goes in an extension on the resource, not in a tag: it changes how the fact is read.
  const cert = (v: unknown) => ({ extension: [{ url: FHIR_EXT("extraction-certainty"), valueCoding: { system: FHIR_SYS.certainty, code: v || "documented" } }] });
  const dateNote = (d: unknown, iso: string | null) => (d && !iso ? [{ text: t("patient-fhir-date-in-doc", { date: String(d) }) }] : []);
  const devName = t("patient-fhir-device-name");
  const assistant = add({ resourceType: "Device", deviceName: [{ name: devName, type: "user-friendly-name" }], type: { text: t("patient-fhir-device-type") } }, devName);
  const docs: Record<string, string> = {};
  // Assigned right after the Device, before any DocumentReference is made; docRef() reads it when called.
  let patient = "";
  const docRef = (file: string) =>
    docs[file] ||
    (docs[file] = add(
      { resourceType: "DocumentReference", status: "current", subject: ref(patient), content: [{ attachment: { contentType: "application/pdf", url: file, title: file } }] },
      t("patient-fhir-doc-text", { file: String(file) }),
    ));
  // One Provenance per target; "element" points at one summary sentence inside the Composition's narrative.
  const prov = (target: string, sources: (SourceRef | null | undefined)[] | undefined, activity?: string | null, element?: string) => {
    const src = (sources || []).filter(Boolean) as SourceRef[];
    if (!src.length) return;
    add(
      {
        resourceType: "Provenance",
        target: [{ reference: target, ...(element ? { extension: [{ url: "http://hl7.org/fhir/StructureDefinition/targetElement", valueUri: element }] } : {}) }],
        recorded: now,
        activity: { coding: [{ system: "http://terminology.hl7.org/CodeSystem/v3-DataOperation", code: "CREATE" }], text: activity || t("patient-fhir-activity-extracted") },
        agent: [{ type: { coding: [{ system: "http://terminology.hl7.org/CodeSystem/provenance-participant-type", code: "assembler" }] }, who: ref(assistant) }],
        entity: src.map((s) => ({
          role: "source",
          what: ref(docRef(s.file as string)),
          extension: [{ url: FHIR_EXT("source-page"), valueInteger: +s.page }, ...(s.quote ? [{ url: FHIR_EXT("source-quote"), valueString: s.quote }] : [])],
        })),
      },
      t("patient-fhir-provenance-text", { refs: src.map((s) => t("patient-fhir-source-ref", { file: String(s.file), page: String(s.page) })).join("; ") }),
    );
  };
  // The case ID is the identifier; the name is there because a FHIR Patient for exchange inside the hospital needs
  // it. Sex is left out unless the document states it: an inferred sex is a guess.
  const nm = (c.patient.name || "").trim().split(/\s+/),
    sexDoc = c.patient.sex_certainty === "documented";
  const birthIso = fhirDate(c.patient.birth_date);
  patient = add(
    {
      resourceType: "Patient",
      identifier: [{ system: FHIR_SYS.caseId, value: p.id }],
      name: [{ text: c.patient.name, family: nm.slice(-1)[0], given: nm.slice(0, -1) }],
      ...(sexDoc && c.patient.sex === "muž" ? { gender: "male" } : sexDoc && c.patient.sex === "žena" ? { gender: "female" } : {}),
      // A partial birth date ("1960", "3/1960") is not a birth date FHIR readers can trust as one; it is left out.
      ...(/^\d{4}-\d\d-\d\d$/.test(birthIso || "") ? { birthDate: birthIso } : {}),
    },
    t("patient-fhir-patient-text", { name: String(c.patient.name), id: p.id }),
  );
  // The server keeps the name's source with the identity (the list row), not in the case data, which is stripped of
  // identity; case data that still carries one (a local extraction) is the fallback.
  prov(patient, [p.identitySource ?? (c.patient.source as SourceRef | undefined)]);
  const subj = ref(patient);
  docRef(c.file);
  const ids = { observations: [] as string[], procedures: [] as string[], medications: [] as string[], conditions: [] as string[], labs: [] as string[], issues: [] as string[], flags: [] as string[] };
  // The diagnosis date comes from the timeline's diagnosis event, with that event's source.
  const dxEv = c.timeline.find((x) => x.type === "diagnosis"),
    dxIso = fhirDate(dxEv?.date);
  // No extracted diagnosis, no Condition: the Composition section then states the gap.
  if (c.diagnosis) {
    const dx = add(
      {
        resourceType: "Condition",
        ...cert("documented"),
        subject: subj,
        category: [{ coding: [{ system: FHIR_SYS.condCat, code: "encounter-diagnosis" }] }],
        code: { coding: [{ system: FHIR_SYS.mkn10, code: c.diagnosis.code, display: c.diagnosis.text_cs }], text: c.diagnosis.text_cs },
        ...(dxIso ? { onsetDateTime: dxIso } : {}),
      },
      dxEv
        ? t("patient-fhir-dx-text-dated", { code: String(c.diagnosis.code), text: String(c.diagnosis.text_cs), date: String(dxEv.date) })
        : t("patient-fhir-dx-text", { code: String(c.diagnosis.code), text: String(c.diagnosis.text_cs) }),
    );
    prov(dx, [c.diagnosis.source, dxEv?.source]);
    ids.conditions.push(dx);
  }
  const issue = (kind: string, text: string, sources: SourceRef[] | undefined) => {
    const u = add(
      {
        resourceType: "DetectedIssue",
        status: "preliminary",
        patient: subj,
        author: ref(assistant),
        code: { coding: [{ system: FHIR_SYS.flag, code: kind }] },
        detail: text,
        ...((sources || []).length ? { implicated: [...new Set(sources!.map((s) => docRef(s.file as string)))].map(ref) } : {}),
      },
      t("patient-fhir-issue-text", { text }),
    );
    ids.issues.push(u);
    prov(u, sources, t("patient-fhir-activity-observation"));
  };
  // Findings stay text: the documents state them as sentences, and turning them into coded values would add meaning
  // the source does not have. The section names the kind of finding.
  const OBS: Record<string, [string, string]> = {
    clinical_finding: ["exam", t("patient-fhir-obs-clinical")],
    current_state: ["exam", t("patient-fhir-obs-current")],
    imaging: ["imaging", t("patient-fhir-obs-imaging")],
    histology: ["laboratory", t("patient-fhir-obs-histology")],
  };
  for (const [sec, items] of Object.entries(c.sections)) {
    for (const it of items) {
      const iso = fhirDate(it.date);
      // A recorded negative whose own text does not say so carries the label in every field a reader sees.
      const text = it.negation_label ? t("patient-fact-negated", { text: String(it.text_cs) }) : String(it.text_cs);
      const notes = [...(it.note ? [{ text: it.note }] : []), ...(it.negated ? [{ text: t("patient-fhir-negated") }] : []), ...dateNote(it.date, iso)];
      const line = it.date ? t("patient-fhir-dated-line", { date: String(it.date), text: text }) : text;
      const base = { ...cert(it.certainty), ...(notes.length ? { note: notes } : {}) };
      let u: string | undefined;
      // What the assistant inferred is its observation, not a fact from the record.
      if (it.certainty === "inferred") {
        issue("unclear", text, [it.source]);
        continue;
      }
      const obs = OBS[sec];
      if (obs) {
        u = add(
          {
            resourceType: "Observation",
            ...base,
            status: it.certainty === "unclear_ocr" ? "preliminary" : "final",
            subject: subj,
            category: [{ coding: [{ system: FHIR_SYS.obsCat, code: obs[0] }] }],
            code: { text: obs[1] },
            valueString: text,
            ...(iso ? { effectiveDateTime: iso } : {}),
          },
          line,
        );
        ids.observations.push(u);
      }
      // Status "unknown": from the documents alone the assistant cannot tell whether a treatment is completed.
      else if (sec === "past_treatment") {
        u = add({ resourceType: "Procedure", ...base, status: "unknown", subject: subj, code: { text: text }, ...(iso ? { performedDateTime: iso } : {}) }, line);
        ids.procedures.push(u);
      }
      // A contraindication is a warning about a drug, never a drug the patient takes.
      else if (sec === "medication" && /kontraindik/i.test(text)) {
        u = add(
          { resourceType: "Flag", ...base, status: "active", subject: subj, category: [{ coding: [{ system: "http://terminology.hl7.org/CodeSystem/flag-category", code: "drug" }] }], code: { text: text } },
          line,
        );
        ids.flags.push(u);
      } else if (sec === "medication") {
        u = add({ resourceType: "MedicationStatement", ...base, status: "unknown", subject: subj, medicationCodeableConcept: { text: text }, ...(iso ? { effectiveDateTime: iso } : {}) }, line);
        ids.medications.push(u);
      }
      // The date next to a comorbidity is the date of the exam that mentions it, not its onset, so it stays a note.
      else if (sec === "comorbidities") {
        u = add(
          {
            resourceType: "Condition",
            ...cert(it.certainty),
            subject: subj,
            category: [{ coding: [{ system: FHIR_SYS.condCat, code: "problem-list-item" }] }],
            code: { text: text },
            ...(it.note || it.date ? { note: [...(it.note ? [{ text: it.note }] : []), ...(it.date ? [{ text: t("patient-fhir-date-in-doc", { date: String(it.date) }) }] : [])] } : {}),
          },
          line,
        );
        ids.conditions.push(u);
      }
      if (u) prov(u, [it.source]);
    }
  }
  // Lab values keep the written value, unit and reference range. Which values are out of range was worked out by the
  // assistant from the stated range, not marked in the document, so the interpretation says so.
  for (const l of c.labs) {
    const raw = String(l.value).trim(),
      num = /^-?\d+(,\d+)?$/.test(raw) ? raw.replace(",", ".") : null,
      iso = fhirDate(l.date);
    const written = `${raw}${l.unit ? " " + l.unit : ""}`;
    const high = l.out_of_range === "high";
    const u = add(
      {
        resourceType: "Observation",
        ...cert(l.certainty),
        status: l.certainty === "unclear_ocr" ? "preliminary" : "final",
        subject: subj,
        category: [{ coding: [{ system: FHIR_SYS.obsCat, code: "laboratory" }] }],
        code: { coding: l.code ? [{ system: FHIR_SYS.lab, code: l.code, display: l.name_cs }] : [], text: l.name_cs },
        ...(num != null ? { valueQuantity: { value: FHIR_NUM + num, unit: l.unit } } : { valueString: written }),
        ...(l.reference_range ? { referenceRange: [{ text: l.reference_range }] } : {}),
        ...(high || l.out_of_range === "low"
          ? { interpretation: [{ coding: [{ system: FHIR_SYS.interp, code: high ? "H" : "L" }], text: t("patient-fhir-lab-out-of-range", { dir: high ? "high" : "low" }) }] }
          : {}),
        ...(iso ? { effectiveDateTime: iso } : {}),
        note: [{ text: t("patient-fhir-lab-as-written", { value: written }) }, ...(l.note ? [{ text: l.note }] : []), ...(l.date ? [] : [{ text: t("patient-fhir-lab-no-date") }])],
      },
      t("patient-fhir-lab-text", { name: String(l.name_cs), value: raw, unit: l.unit || "", range: l.reference_range || "-" }),
    );
    ids.labs.push(u);
    prov(u, [l.source]);
  }
  // Missing documents, contradictions and changes are the assistant's observations, not facts from the record.
  for (const f of c.flags) {
    // The alert's message in the export's language, its fact arguments as their lines; the assistant's note stays in the
    // content language.
    const text = t(f.message.id, alertArgs(cd, f, t).args);
    issue(f.kind, f.note ? `${text} (${f.note})` : text, f.based_on);
  }
  // The summary for the MDT: a preliminary Composition by the assistant. Each summary sentence and timeline event has
  // an id, and its Provenance points at that sentence, so every quote stays tied to the sentence it supports.
  const compUrl = uid();
  const lis = (arr: unknown[], pre: string) => `<div xmlns="http://www.w3.org/1999/xhtml"><ul>${arr.map((x, i) => `<li id="${pre}${i + 1}">${esc(x)}</li>`).join("")}</ul></div>`;
  const gapDiv = `<div xmlns="http://www.w3.org/1999/xhtml">${esc(t("patient-fhir-gap"))}</div>`;
  const empty = { emptyReason: { coding: [{ system: "http://terminology.hl7.org/CodeSystem/list-empty-reason", code: "unavailable" }] }, text: { status: "generated", div: gapDiv } };
  const sec = (title: string, list: string[]) => ({ title, ...(list.length ? { entry: list.map(ref) } : empty) });
  const tl = c.timeline,
    q = c.mdt_question;
  // A doctor's text, or a draft where the document states no question, is exported with its label (questionPlain);
  // otherwise the document's question as written, or the gap with the extraction's note.
  const qText = qs.mode === "edited" || (!q.text_cs && p.draft) ? questionPlain(t, qs) : q.text_cs || `${t("patient-fhir-gap")} ${q.note_cs || ""}`.trim();
  const comp = {
    resourceType: "Composition",
    text: { status: "generated", div: `<div xmlns="http://www.w3.org/1999/xhtml">${esc(t("patient-fhir-comp-text", { id: p.id }))}</div>` },
    status: "preliminary",
    type: { text: t("patient-fhir-comp-type") },
    subject: subj,
    date: now,
    author: [ref(assistant)],
    title: t("patient-fhir-comp-title", { id: p.id }),
    section: [
      { title: t("patient-fhir-sec-question"), text: { status: "generated", div: `<div xmlns="http://www.w3.org/1999/xhtml">${esc(qText)}</div>` } },
      { title: t("patient-fhir-sec-summary"), text: { status: "generated", div: lis(c.summary.map((s) => s.text_cs), "s") } },
      tl.length
        ? { title: t("patient-fhir-sec-course"), text: { status: "generated", div: lis(tl.map((x) => t("patient-fhir-dated-line", { date: String(x.date), text: String(x.label_cs) })), "t") } }
        : { title: t("patient-fhir-sec-course"), ...empty },
      sec(t("patient-fhir-sec-conditions"), ids.conditions),
      sec(t("patient-fhir-sec-findings"), ids.observations),
      sec(t("patient-fhir-sec-treatment"), ids.procedures),
      sec(t("patient-fhir-sec-medication"), ids.medications),
      sec(t("patient-fhir-sec-drug-flags"), ids.flags),
      sec(t("patient-fhir-sec-labs"), ids.labs),
      sec(t("patient-fhir-sec-observations"), ids.issues),
      ...(c.ocr_quality_note || c.labs_note_cs
        ? [{ title: t("patient-fhir-sec-notes"), text: { status: "generated", div: lis([c.ocr_quality_note, c.labs_note_cs].filter(Boolean), "n") } }]
        : []),
    ],
  };
  c.summary.forEach((s, i) => prov(compUrl, s.sources, null, `s${i + 1}`));
  tl.forEach((x, i) => prov(compUrl, [x.source], null, `t${i + 1}`));
  if (q.closest_source) prov(compUrl, [q.closest_source]);
  // The passages a drafted question rests on get their own Provenance, so the export keeps where the draft comes from.
  if (p.draft && !p.explicit) prov(compUrl, basisOf(p.basis).map((b) => ({ ...b.source, quote: b.quote })), t("patient-fhir-activity-q-draft"));
  entries.unshift({ fullUrl: compUrl, resource: comp });
  return { resourceType: "Bundle", type: "collection", timestamp: now, entry: entries };
}
