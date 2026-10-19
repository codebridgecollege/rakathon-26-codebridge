// What the calendar card shows of a case, read from the
// list row, the doctor's edits and, only when the case is already loaded, its extraction. The card never starts a
// load: opening the card is not opening the case.
import type { CaseState, PatientRow } from "@codebridge/api-client";
import type { CaseData } from "../stores/cases";
import { fromExtraction, type CaseData as ViewData } from "@codebridge/domain/case-data";
import { qState, stripMarkers } from "@codebridge/domain/case-view";
import { editOf } from "./lists";

// The case's view, built from its run the same way the patient screen builds it; a case without one has no brief.
const viewOf = (cd: CaseData | null): ViewData | null => (cd ? fromExtraction(cd.file, cd.id, cd.extraction, cd.documents) : null);

// The diagnosis line: histology, grade and the TNM at diagnosis with its context, or the list row's diagnosis. A doctor's
// edit replaces the base text and says so; an unchecked OCR doubt keeps its mark.
export type DxLine = { text: string; edited: boolean; context: string | null; verify: boolean };
export function dxLine(p: PatientRow, cs: Partial<CaseState> | undefined, cd: CaseData | null): DxLine {
  const d = viewOf(cd)?.brief?.dx_headline;
  if (!d) return { text: p.diagnosis ?? "", edited: false, context: null, verify: false };
  const e = editOf(cs, "dx");
  const base = [d.histology_cs, d.grade_cs, d.tnm_cs].filter(Boolean).join(", ");
  return { text: e ? e.text : base, edited: !!e, context: d.tnm_context_cs || null, verify: !!d.ocr_note_cs && !e };
}

// The MDT question as the card shows it, by the same rule as the patient screen (qState()): the doctor's edit, the
// referral's explicit question, the assistant's draft, or null (shown with the gap wording). draft is true only for an
// assistant's draft no doctor has confirmed or edited, which the card labels as a draft.
export function questionOf(p: PatientRow, cs: Partial<CaseState> | undefined): { text: string; draft: boolean } | null {
  const q = qState(p, editOf(cs, "q"), cs?.qConfirm);
  return q.mode === "none" ? null : { text: q.text, draft: q.mode === "draft" };
}

// The brief without its [n] reference marks, cut for the card; null when the case is not loaded or has none.
export function briefOf(cs: Partial<CaseState> | undefined, cd: CaseData | null): { text: string; edited: boolean } | null {
  const orig = viewOf(cd)?.brief?.text_cs || null;
  if (!orig) return null;
  const e = editOf(cs, "brief");
  return { text: e ? e.text : stripMarkers(orig), edited: !!e };
}
