// Today's case view of the old fixtures ({ case, extra } for case 10, { syn } for S01 and S02), as the app built it before
// it read codebridge.extraction/2 runs. Kept only so test/run-view.test.ts can compare the adapter's view with it
// part by part; nothing in the app or the server uses it.
import type { CaseData, Item, LabSeries } from "../src/case-data";

type OldCaseData = Omit<CaseData, "alerts"> & { alerts: { flags: Item[]; gaps: Item[] } | null };

export function fromFullExtraction(file: string, id: string, c: Item, e: Item): OldCaseData {
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
export function fromSyn(s: Item, file: string, id: string): OldCaseData {
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

