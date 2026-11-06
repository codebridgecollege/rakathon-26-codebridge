// The side panel of a running MDT (PRODUCT.md, "During the MDT: the side panel"): what a doctor glances at while the
// radiologist shows images in PACS. Pure, so the rules are tested without a screen. It only picks from what the
// extraction holds and adds no judgement of its own: which comorbidity bears on which treatment is the doctor's call.
// A part the run does not have stays null, shown as "-", never as "none".
import { refAt, type CaseData, type Item, type SourceRef } from "./case-data";
import { timelineSorted, vitalsOf } from "./case-view";

// item: the extraction's fact or event, for its certainty marks (Marks.vue).
export type PanelEvent = { key: number; date: string | null; title: string; planned: boolean; negated: boolean; source: SourceRef | undefined; item: Item };
export type PanelFact = { text: string; note: string; negated: boolean; source: SourceRef | undefined; item: Item };

const EXAMS = new Set(["imaging", "pathology", "laboratory"]);
const TREATMENTS = new Set(["systemic", "surgery", "radiotherapy"]);

const COURSE = new Set(["systemic", "surgery", "radiotherapy", "pathology", "mdt"]);
const COURSE_IMAGING = 3;

export type MdtPanel = {
  // The performance status as the document writes it, with its source; null when the exam does not state it.
  ps: { text: string; source: SourceRef | undefined; item: Item } | null;
  // Newest first, undated last. Null when the run has no timeline part.
  exams: PanelEvent[] | null;
  treatments: PanelEvent[] | null;
  // The compact disease course: treatment, histology and MDT decisions, with only the newest imaging, newest first.
  course: PanelEvent[] | null;
  // Stated contraindications, comorbidities and allergies; null when the anamnesis was not extracted.
  contraindications: PanelFact[] | null;
  comorbidities: PanelFact[] | null;
  allergies: PanelFact[] | null;
};

function factsOf(cd: CaseData, items: Item[] | undefined): PanelFact[] {
  return (items ?? []).map((it) => ({
    text: String(it.term_cs ?? ""),
    note: String(it.comment_cs ?? ""),
    negated: !!it.negation_label,
    source: refAt(cd, (it.refs ?? [])[0]),
    item: it,
  }));
}

export function mdtPanelOf(cd: CaseData | null | undefined): MdtPanel {
  const rec = cd?.record ?? null;
  if (!cd || !rec) return { ps: null, exams: null, treatments: null, course: null, contraindications: null, comorbidities: null, allergies: null };
  const ecog = vitalsOf((rec.status_praesens?.items ?? []) as Item[]).ecog as Item | null;
  const events = rec.timeline?.length
    ? timelineSorted(rec.timeline)
        .slice()
        .reverse()
        // timelineSorted puts undated events last; reversed they would lead, so they go back to the end.
        .sort((a, b) => (a.date_sort ? 0 : 1) - (b.date_sort ? 0 : 1))
    : null;
  const pick = (cats: Set<string>) =>
    events
      ? events
          .filter((e) => cats.has(e.category))
          .map((e) => ({ key: e.i, date: e.date ?? null, title: e.title_cs, planned: e.status === "planned", negated: !!e.negation_label, source: e.source, item: e }))
      : null;
  const a = rec.anamnesis;
  const imaging = pick(new Set(["imaging"]))?.slice(0, COURSE_IMAGING) ?? [];
  const place = (x: PanelEvent) => events!.findIndex((e) => e.i === x.key);
  // What is planned leads, whatever its date: the next step must not sit below the fold of a long history.
  const course = events ? (pick(COURSE) ?? []).concat(imaging).sort((x, y) => Number(y.planned) - Number(x.planned) || place(x) - place(y)) : null;
  return {
    ps: ecog ? { text: String(ecog.text_cs), source: refAt(cd, (ecog.refs ?? [])[0]), item: ecog } : null,
    exams: pick(EXAMS),
    treatments: pick(TREATMENTS),
    course,
    contraindications: a ? factsOf(cd, a.FA_warnings) : null,
    comorbidities: a ? factsOf(cd, a.OA) : null,
    allergies: a ? factsOf(cd, a.AA) : null,
  };
}
