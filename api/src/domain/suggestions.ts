// A drafted task waits for a doctor: edit, confirm (it becomes a task with who confirmed it) or dismiss. A decided
// draft is never decided again (CLAUDE.md: a draft is never shown as approved; a doctor confirms).
import { D } from "./errors";
import { isIsoDay } from "./time";

export type SuggestionRow = {
  id: number;
  case_id: string;
  text: string;
  who: string | null;
  due: string | null;
  due_source: string | null;
  due_by: string | null;
  timing: string | null;
  state: "draft" | "confirmed" | "dismissed" | "superseded";
  decided_by_name: string | null;
};

export function assertDraft(s: SuggestionRow): void {
  if (s.state !== "draft") throw D.suggestionDecided(s.decided_by_name);
}

export type SuggestionPatch = { text?: unknown; who?: unknown; due?: unknown };

export function editSuggestion(s: SuggestionRow, patch: SuggestionPatch, actorName: string, staffNames: ReadonlySet<string>): SuggestionRow {
  assertDraft(s);
  const next = { ...s };
  if (patch.text !== undefined) {
    if (typeof patch.text !== "string" || !patch.text.trim() || patch.text.length > 500) throw D.invalidInput({ fields: { text: "Text úlohy chybí nebo je příliš dlouhý." } });
    next.text = patch.text;
  }
  if (patch.who !== undefined) {
    if (typeof patch.who !== "string" || (patch.who && !staffNames.has(patch.who))) throw D.invalidInput({ fields: { who: "Osoba není v seznamu personálu." } });
    next.who = patch.who;
  }
  if (patch.due !== undefined) {
    if (typeof patch.due !== "string" || (patch.due && !isIsoDay(patch.due))) throw D.invalidInput({ fields: { due: "Termín zadejte jako datum." } });
    // A typed date is the person's, and says so; clearing it leaves the date to a person again.
    next.due = patch.due || null;
    next.due_source = patch.due ? "manual" : "none";
    next.due_by = actorName;
  }
  return next;
}

export function confirmTask(s: SuggestionRow, actorName: string) {
  assertDraft(s);
  if (!s.text.trim()) throw D.invalidInput();
  return {
    text: s.text,
    who: s.who || "",
    due: s.due,
    due_source: s.due_source,
    due_by: s.due_by,
    timing: s.timing,
    from_suggestion_id: s.id,
    confirmed_by: actorName,
  };
}
