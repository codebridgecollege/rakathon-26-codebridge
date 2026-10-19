// The case data of one case in the one shape the patient view reads: built from the case's codebridge.extraction/2 run
// (run-view.ts), or empty for a case without a run. Each part is null when the run has no such part; null means "not
// in the extraction", never "nothing found", so a view shows a missing part as missing and never as empty. Identity
// (name, birth number) is not case data: it stays on the list row.

import type { ExtractionRun } from "./extraction/types";
import { fromRun, type DocInfo, type RunView } from "./run-view";

// A pointer to the exact passage a fact rests on. `file` may be absent: then the reference points into the open case.
// `part` names the logical document inside the file ("10_pacient/p1"), when the run gives it.
export type SourceRef = { file?: string; page: number | string; quote?: string; part?: string | null };

// The extraction's items carry many optional fields; the views read them by name. Typed loosely on purpose: the
// extraction schema is produced by the pipeline and the views must tolerate fields that are absent.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Item = Record<string, any>;

// One alert of the run: its ID, kind, Fluent message (the app formats it in the UI language), the assistant's note in
// the content language, the facts it rests on and their passages, and whether it bears on the MDT question.
export type Flag = Item & {
  id: string;
  kind: string;
  rule: string;
  message: { id: string; args: Record<string, string | number> };
  note?: string;
  fact_ids: string[];
  based_on?: SourceRef[];
  relevant?: boolean;
};
export type DocumentInfo = Item & { title_cs: string; type?: string; date?: string | null; pages?: number[]; readability?: string; reason_cs?: string; file?: string; embedded_in_cs?: string };
export type LabValue = Item & { code?: string; name_cs: string; value: string; unit?: string; reference_range?: string; out_of_range?: "high" | "low" | null; date?: string | null; source: SourceRef; certainty?: string; note?: string };
export type LabDraw = Item & { date: string; time?: string; source: SourceRef };
export type LabPoint = Item & { date: string; time?: string; value: string | null; out_of_range?: "high" | "low" | null; source: SourceRef; certainty?: string };
export type LabTest = Item & { code: string; name_cs: string; unit: string; reference_range: string; points?: LabPoint[] };
export type LabSeries = Item & { draws: LabDraw[]; tests: LabTest[]; note_cs?: string; synthetic?: boolean };
export type TimelineEvent = Item & { date?: string | null; date_sort?: string | null; kind?: string; category?: string; type?: string; status?: string; title_cs: string; text_cs: string; source?: SourceRef; note_cs?: string; ocr_note_cs?: string; negation_label?: boolean; fact_ids?: string[]; key?: string };

export type CaseData = {
  file: string;
  id: string;
  level: "full" | "partial" | "none";
  // The indexed sources of the case; facts point at them by position.
  refs: SourceRef[];
  brief: null | {
    text_cs: string | null;
    refs: SourceRef[];
    reason_cs: string | null;
    reason_refs: SourceRef[];
    dx_headline: Item | null;
    summary_items: Item[];
    // A /2 run's brief sentences with the facts each states.
    sentences?: Item[];
  };
  record: null | {
    onco_compact: Item | null;
    onco_detailed: Item[];
    status_praesens: Item | null;
    timeline: TimelineEvent[];
    // The FHIR export dates the diagnosis from the original timeline's events, with their sources.
    timeline_source: Item[];
    anamnesis: Record<string, Item[]> | null;
    sections: Record<string, Item[]> | null;
    patient: Item;
    diagnosis: Item | null;
    mdt_question: Item;
    ocr_quality_note: string | null;
  };
  labs: null | { values: LabValue[]; note_cs: string | null; series: LabSeries | null };
  alerts: null | { flags: Flag[] };
  documents: null | { documents: DocumentInfo[]; pages: number | null; note: string | null };
  note_cs: string | null;
  // The parts only a codebridge.extraction/2 run gives (facts by ID, checks per section); absent for the old format.
  run?: RunView | null;
};

// A case the assistant has not processed: every part null, so the view says "not processed" and "not checked".
export const unprocessedCase = (file: string, id: string): CaseData => ({
  file,
  id,
  level: "none",
  refs: [],
  brief: null,
  record: null,
  labs: null,
  alerts: null,
  documents: null,
  note_cs: null,
});

// The server's extraction data (GET /cases/:id/extraction): the run, or null for a case without one (and for a run
// still in the old format /1, which the server sends as null). `docs` are the stored documents with their parts.
export function fromExtraction(file: string, id: string, data: ExtractionRun | null, docs: DocInfo[] | null = null): CaseData {
  return data ? fromRun(file, id, data, docs) : unprocessedCase(file, id);
}

// Which parts of the patient view a case can show; decided by its data, not by which patient it is.
export type Sections = {
  brief: boolean;
  onco: boolean;
  status: boolean;
  timeline: boolean;
  anamnesis: boolean;
  documents: boolean;
  labs: boolean;
  // The missing-document check ran for this case.
  alerts: boolean;
  // Finding groups: the report's sections and the FHIR export.
  record: boolean;
  guidance: boolean;
};

export function sectionsOf(cd: CaseData | null | undefined): Sections {
  return {
    brief: !!cd?.brief?.text_cs,
    onco: !!(cd?.record?.onco_compact || cd?.record?.onco_detailed?.length),
    status: !!cd?.record?.status_praesens,
    timeline: (cd?.record?.timeline || []).length > 0,
    anamnesis: !!cd?.record?.anamnesis,
    documents: !!cd?.documents,
    labs: !!(cd?.labs?.series || cd?.labs?.values?.length),
    alerts: !!cd?.alerts,
    record: !!cd?.record?.sections,
    guidance: cd?.level === "full",
  };
}

// The patient tabs in their fixed order; each shows when the case data holds its part. Labels live in the catalog.
export const TABS = ["overview", "anamnesis", "documents", "labs", "alerts", "next", "dev", "prognosis"] as const;
export type Tab = (typeof TABS)[number];
const TAB_SHOWN: Record<Tab, (s: Sections) => boolean> = {
  overview: (s) => s.onco || s.status,
  anamnesis: (s) => s.anamnesis,
  documents: (s) => s.documents,
  labs: (s) => s.labs,
  alerts: (s) => s.alerts,
  next: (s) => s.guidance,
  dev: (s) => s.guidance,
  prognosis: () => true,
};
export const tabsFor = (s: Sections): Tab[] => TABS.filter((t) => TAB_SHOWN[t](s));
export const isTab = (x: unknown): x is Tab => typeof x === "string" && (TABS as readonly string[]).includes(x);

// The i-th indexed source of a case.
export const refAt = (cd: CaseData | null | undefined, i: unknown): SourceRef | undefined =>
  typeof i === "number" ? (cd?.refs || [])[i] : undefined;

// The title of the document a reference points into, found through the case that holds the file; the file name when
// the document list does not know the page. `fallbackFile` is the open case's file, for a reference without a file.
export function docTitle(r: SourceRef, docsOf: (file: string) => CaseData["documents"] | null, fallbackFile: string): string {
  const f = r.file || fallbackFile;
  const docs = docsOf(f)?.documents || [];
  // The part the source names wins: two parts may share a page (the lab sheet on page 3 of the outpatient report).
  const d = (r.part && docs.find((x) => x.part_id === r.part)) || docs.find((x) => (!x.file || x.file === f) && (x.pages || []).includes(Number(r.page)));
  return d ? d.title_cs : (r.file ?? f);
}

// The document id of a source file (the server names documents by file without ".pdf").
export const docIdOf = (file: string) => String(file).replace(/\.pdf$/i, "");
// The case number in links: "10" for 10_pacient.pdf, "S01" for S01_pacient.pdf.
export const nrOf = (file: string) => String(file).replace("_pacient.pdf", "");
