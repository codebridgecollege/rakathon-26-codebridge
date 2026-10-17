// The discussion record of a case: notes, the conclusion draft and the next steps, one row per case. It stays a draft
// until a doctor approves it; an approved protocol is never edited, and "Nový závěr" starts an empty draft only after
// approval (the mock wiped an unapproved draft here; fixed).
import { D } from "./errors";
import type { Status } from "./status";
import { isIsoDay } from "./time";

export type Step = { text: string; who: string; due: string };
export type Protocol = {
  notes: string;
  conclusion: string;
  steps: Step[];
  state: "draft" | "approved";
  version: number;
  updated_by_name: string | null;
};
export type ProtocolPatch = { notes?: unknown; concl?: unknown; steps?: unknown };

export const MAX_TEXT = 20_000;
export const MAX_STEPS = 30;

export const emptyProtocol = (): Protocol => ({ notes: "", conclusion: "", steps: [], state: "draft", version: 0, updated_by_name: null });

// Steps name their assignee by display name, as the page shows them; it must be someone on the staff list.
export function validateSteps(steps: unknown, staffNames: ReadonlySet<string>): Step[] {
  if (!Array.isArray(steps) || steps.length > MAX_STEPS) throw D.invalidInput({ fields: { steps: `Nejvýše ${MAX_STEPS} úloh.` } });
  return steps.map((s, i) => {
    const o = (s ?? {}) as Record<string, unknown>;
    const text = typeof o.text === "string" ? o.text : "";
    const who = typeof o.who === "string" ? o.who : "";
    const due = typeof o.due === "string" ? o.due : "";
    if (text.length > 500) throw D.invalidInput({ fields: { [`steps.${i}.text`]: "Úloha může mít nejvýše 500 znaků." } });
    if (who && !staffNames.has(who)) throw D.invalidInput({ fields: { [`steps.${i}.who`]: "Osoba není v seznamu personálu." } });
    if (due && !isIsoDay(due)) throw D.invalidInput({ fields: { [`steps.${i}.due`]: "Termín zadejte jako datum." } });
    return { text, who, due };
  });
}

export function assertEditable(p: Protocol, caseStatus: Status): void {
  if (p.state === "approved") throw D.protocolLocked();
  if (caseStatus === "closed") throw D.caseClosedEdit();
}

// A partial update with optimistic concurrency: the caller names the version it edited.
export function patchProtocol(p: Protocol, caseStatus: Status, patch: ProtocolPatch, expectedVersion: unknown, staffNames: ReadonlySet<string>): Protocol {
  assertEditable(p, caseStatus);
  if (expectedVersion !== p.version) throw D.protocolConflict(p.updated_by_name ?? "", p);
  const next = { ...p };
  if (patch.notes !== undefined) {
    if (typeof patch.notes !== "string" || patch.notes.length > MAX_TEXT) throw D.invalidInput({ fields: { notes: "Poznámky jsou příliš dlouhé." } });
    next.notes = patch.notes;
  }
  if (patch.concl !== undefined) {
    if (typeof patch.concl !== "string" || patch.concl.length > MAX_TEXT) throw D.invalidInput({ fields: { concl: "Závěr je příliš dlouhý." } });
    next.conclusion = patch.concl;
  }
  if (patch.steps !== undefined) next.steps = validateSteps(patch.steps, staffNames);
  next.version = p.version + 1;
  return next;
}

// "Nový závěr": only once the current conclusion is approved, on an open case, and against the decision the doctor saw.
export function newDraft(p: Protocol, caseStatus: Status, latestDecisionId: string | null, expectedDecisionId: unknown): void {
  if (caseStatus === "closed") throw D.caseClosedEdit();
  if (p.state !== "approved" || !latestDecisionId) throw D.notApprovedYet();
  if (expectedDecisionId !== latestDecisionId) throw D.decisionChanged();
}
