// The case data of one case in the one shape the patient view reads, whatever produced it: a full extraction
// ({ case, extra }, case 10), a synthetic patient ({ syn }), or nothing (no run).
// Each part is null when the extraction has no such part; null means "not in the extraction", never "nothing found",
// so a view shows a missing part as missing and never as empty. Identity (name, birth number) is not case data: it
// stays on the list row. The extraction objects are kept by reference, not cloned.

import type { ExtractionRun } from "./extraction/types";
import { fromRun, type DocInfo, type RunView } from "./run-view";

// A pointer to the exact passage a fact rests on. `file` may be absent: then the reference points into the open case.
export type SourceRef = { file?: string; page: number | string; quote?: string };

// The extraction's items carry many optional fields; the views read them by name. Typed loosely on purpose: the
// extraction schema is produced by the pipeline and the views must tolerate fields that are absent.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Item = Record<string, any>;

export type Flag = Item & { kind: string; text_cs: string; based_on?: SourceRef[]; note?: string; relevant?: boolean };
export type DataGap = Item & { kind: string; text_cs: string; refs?: SourceRef[]; source?: SourceRef };
export type DocumentInfo = Item & { title_cs: string; type?: string; date?: string | null; pages?: number[]; readability?: string; reason_cs?: string; file?: string; embedded_in_cs?: string };
export type LabValue = Item & { code?: string; name_cs: string; value: string; unit?: string; reference_range?: string; out_of_range?: "high" | "low" | null; date?: string | null; source: SourceRef; certainty?: string; note?: string };
export type LabDraw = Item & { date: string; time?: string; source: SourceRef };
export type LabPoint = Item & { date: string; time?: string; value: string | null; out_of_range?: "high" | "low" | null; source: SourceRef; certainty?: string };
export type LabTest = Item & { code: string; name_cs: string; unit: string; reference_range: string; points?: LabPoint[] };
export type LabSeries = Item & { draws: LabDraw[]; tests: LabTest[]; note_cs?: string; synthetic?: boolean };
export type TimelineEvent = Item & { date?: string | null; date_sort?: string | null; kind?: string; category?: string; type?: string; status?: string; title_cs: string; text_cs: string; source?: SourceRef; note_cs?: string; ocr_note_cs?: string };

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
  alerts: null | { flags: Flag[]; gaps: DataGap[] };
  documents: null | { documents: DocumentInfo[]; pages: number | null; note: string | null };
  note_cs: string | null;
  // The parts only a codebridge.extraction/2 run gives (facts by ID, checks per section); absent for the old format.
  run?: RunView | null;
};

export function fromFullExtraction(file: string, id: string, c: Item, e: Item): CaseData {
  return {
    file,
    id,
    level: "full",
    refs: e.refs || [],
    brief: {
      text_cs: e.onco_summary_v3_cs || e.onco_brief_v3_cs || e.onco_brief_cs || null,
      refs: e.onco_summary_v3_refs || e.onco_brief_v3_refs || e.onco_brief_refs || [],
      reason_cs: e.mdt_reason_v3_cs || null,
      reason_refs: e.mdt_reason_v3_refs || [],
      dx_headline: e.diagnosis_headline || null,
      summary_items: c.summary || [],
    },
    record: {
      onco_compact: e.onco_compact_v3 || null,
      onco_detailed: e.onco_detailed_v3 || [],
      status_praesens: e.status_praesens || null,
      // The older timeline shape (case.timeline) is mapped here once, so every reader sees one event shape.
      timeline:
        e.timeline_cards_v3 ||
        e.timeline_cards ||
        (c.timeline || []).map((t: Item) => ({ ...t, kind: t.type, title_cs: t.label_cs, text_cs: t.label_cs, status: t.status || "done" })),
      timeline_source: c.timeline || [],
      anamnesis: e.anamnesis_v3 || null,
      sections: c.sections || null,
      patient: c.patient || {},
      diagnosis: c.diagnosis || null,
      mdt_question: c.mdt_question || {},
      ocr_quality_note: c.ocr_quality_note || null,
    },
    labs: { values: c.labs || [], note_cs: c.labs_note_cs || null, series: null },
    alerts: { flags: c.flags || [], gaps: e.data_gaps_v3 || [] },
    documents: { documents: e.documents || [], pages: c.page_count ?? null, note: e.documents_note_cs || null },
    note_cs: null,
  };
}

// A synthetic patient: documents, data gaps and lab series are processed, nothing else. A lab series that may not be
// charted (synthetic values, or fewer than two dated draws) never enters the case data, so no chart is invented.
export function fromSyn(s: Item, file: string, id: string): CaseData {
  const ser = s.labs_series as LabSeries | undefined;
  const chartable = !!ser && !ser.synthetic && (ser.draws || []).length >= 2;
  return {
    file,
    id,
    level: "partial",
    refs: [],
    brief: null,
    record: null,
    labs: chartable ? { values: [], note_cs: null, series: ser! } : null,
    alerts: { flags: [], gaps: s.data_gaps || [] },
    documents: { documents: s.documents || [], pages: s.list_entry?.page_count ?? null, note: null },
    note_cs: s.note_cs || null,
  };
}

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

// The server's extraction data (GET /cases/:id/extraction, `data`): null for a case without a run, { case, extra } or
// { syn }. The cases store has already refused any other shape.
export function fromExtraction(
  file: string,
  id: string,
  data: { case?: unknown; extra?: unknown; syn?: unknown } | ExtractionRun | null,
  docs: DocInfo[] | null = null,
): CaseData {
  if (!data) return unprocessedCase(file, id);
  if ("schema" in data && data.schema === "codebridge.extraction/2") return fromRun(file, id, data, docs);
  if ("case" in data && data.case) return fromFullExtraction(file, id, data.case as Item, ("extra" in data && (data.extra as Item)) || {});
  if ("syn" in data && data.syn) return fromSyn(data.syn as Item, file, id);
  return unprocessedCase(file, id);
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
  const d = (docsOf(f)?.documents || []).find((x) => (!x.file || x.file === f) && (x.pages || []).includes(Number(r.page)));
  return d ? d.title_cs : (r.file ?? f);
}

// The document id of a source file (the server names documents by file without ".pdf").
export const docIdOf = (file: string) => String(file).replace(/\.pdf$/i, "");
// The case number in links: "10" for 10_pacient.pdf, "S01" for S01_pacient.pdf.
export const nrOf = (file: string) => String(file).replace("_pacient.pdf", "");
