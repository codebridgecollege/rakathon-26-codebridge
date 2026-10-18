// Shared pieces of the list screens (patients, calendar, tasks, staff, administration): catalog IDs that are picked
// by a code, the route of a case, and the readers of the stored workflow state those screens need.
import type { CaseState, PatientRow } from "@codebridge/api-client";
import { slotLocked } from "@codebridge/domain/slots";

// Static IDs per code, so the catalog check sees every one (docs/design/I18N.md, "IDs are static").
export const STATUS_LABEL_IDS: Record<string, string> = {
  new: "lists-status-new",
  scheduled: "lists-status-scheduled",
  attention: "lists-status-attention",
  ready: "lists-status-ready",
  done: "lists-status-done",
  closed: "lists-status-closed",
};
export const STATUS_CLASS: Record<string, string> = {
  new: "st-new",
  scheduled: "st-scheduled",
  attention: "st-attention",
  ready: "st-ready",
  done: "st-done",
  closed: "st-closed",
};
// The dot in a booked calendar slot, by status (the copied CSS's colour tokens).
export const STATUS_DOT: Record<string, string> = { new: "muted", scheduled: "change", attention: "missing", ready: "ok", done: "accent", closed: "faint" };
// 0 = Sunday, as Date.getUTCDay().
export const WEEKDAY_IDS = ["lists-weekday-sun", "lists-weekday-mon", "lists-weekday-tue", "lists-weekday-wed", "lists-weekday-thu", "lists-weekday-fri", "lists-weekday-sat"] as const;
// The mini month's header row starts on Monday.
export const MINI_WEEKDAY_IDS = [1, 2, 3, 4, 5, 6, 0].map((i) => WEEKDAY_IDS[i]!);
export const SEMINAR_LABEL_IDS: Record<string, string> = { neuro: "calendar-seminar-neuro" };

// The patient view's route. Kept in one place, so the patient screens (ported separately) can change it in one line.
// The case number is the file's number (/patient/10/overview).
export const caseNumber = (file: string) => String(file).replace("_pacient.pdf", "");
export const caseRoute = (file: string) => `/patient/${encodeURIComponent(caseNumber(file))}/overview`;

// The stored state of a case by its list row's file (workflow.cases is keyed by case id).
export function caseStateOf(cases: Record<string, Partial<CaseState>>, p: Pick<PatientRow, "id" | "file">): Partial<CaseState> | undefined {
  return cases[p.id] ?? Object.values(cases).find((c) => c.file === p.file);
}

type DecisionWire = { slot?: { day: string; time: string } | null };
// A slot a conclusion was approved on is part of the MDT record: it cannot be freed or moved.
export function isSlotLocked(cases: Record<string, Partial<CaseState>>, p: PatientRow): boolean {
  const decisions = ((caseStateOf(cases, p)?.decisions ?? []) as DecisionWire[]).map((d) => ({ slot_day: d.slot?.day ?? null, slot_time: d.slot?.time ?? null }));
  return slotLocked(p.slot, decisions);
}

// A drafted task from an approved conclusion, as the workflow state sends it (store/work.ts, "sugg").
export type Suggestion = {
  id: number;
  pid: string;
  case_id: string;
  text: string;
  quote: string | null;
  who: string;
  due: string;
  dueSrc: string;
  dueBy: string | null;
  timing: string;
  state: string;
  by: string | null;
  when: string | null;
};
export const suggestionsOf = (cases: Record<string, Partial<CaseState>>) =>
  Object.values(cases).flatMap((c) => ((c.sugg ?? []) as unknown as Suggestion[]).map((x) => ({ ...x, pid: c.file ?? x.pid })));

// A doctor's edit of a fact, keyed by the fact ("q", "dx", "brief", ...).
export type FactEdit = { text: string; by: string; when: string };
export const editOf = (cs: Partial<CaseState> | undefined, key: string) => (cs?.edits?.[key] as FactEdit | undefined) ?? undefined;

export type EditLogEntry = { pid: string; key: string; orig: string | null; text: string; by: string; when: string; reverted: boolean; confirmed: boolean };
export const editLogOf = (cases: Record<string, Partial<CaseState>>) =>
  Object.values(cases).flatMap((c) => ((c.editLog ?? []) as unknown as EditLogEntry[]).map((e) => ({ ...e, pid: c.file ?? e.pid })));
