// What the calendar card shows of a case, read from the
// list row, the doctor's edits and, only when the case is already loaded, its extraction. The card never starts a
// load: opening the card is not opening the case.
import type { CaseState, PatientRow } from "@codebridge/api-client";
import type { CaseData } from "../stores/cases";
import { qState } from "@codebridge/domain/case-view";
import { editOf } from "./lists";

type DxHeadline = { histology_cs?: string; grade_cs?: string; tnm_cs?: string; tnm_context_cs?: string; ocr_note_cs?: string; ocr_check?: { mark?: boolean } };
type Extra = { diagnosis_headline?: DxHeadline; onco_summary_v3_cs?: string; onco_brief_v3_cs?: string; onco_brief_cs?: string };

// Only a full extraction ({ case, extra }) carries a brief; a synthetic patient's ({ syn }) does not.
const extraOf = (cd: CaseData | null): Extra | null => {
  const ex = cd?.extraction;
  return ex && typeof ex === "object" && "extra" in ex ? ((ex.extra ?? null) as Extra | null) : null;
};

// The diagnosis line: histology, grade and the TNM at diagnosis with its context, or the list row's diagnosis. A doctor's
// edit replaces the base text and says so; an unchecked OCR doubt keeps its mark.
export type DxLine = { text: string; edited: boolean; context: string | null; verify: boolean };
export function dxLine(p: PatientRow, cs: Partial<CaseState> | undefined, cd: CaseData | null): DxLine {
  const d = extraOf(cd)?.diagnosis_headline;
  if (!d) return { text: p.diagnosis ?? "", edited: false, context: null, verify: false };
  const e = editOf(cs, "dx");
  const base = [d.histology_cs, d.grade_cs, d.tnm_cs].filter(Boolean).join(", ");
  const cleared = d.ocr_check?.mark === false;
  return { text: e ? e.text : base, edited: !!e, context: d.tnm_context_cs || null, verify: !!d.ocr_note_cs && !cleared && !e };
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
  const x = extraOf(cd);
  const orig = x?.onco_summary_v3_cs || x?.onco_brief_v3_cs || x?.onco_brief_cs || null;
  if (!orig) return null;
  const e = editOf(cs, "brief");
  return { text: e ? e.text : orig.replace(/\s*\[\d+\]/g, ""), edited: !!e };
}
