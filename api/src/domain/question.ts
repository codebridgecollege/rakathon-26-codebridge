// Confirming the assistant's drafted MDT question (team decision 2026-10-17): the doctor confirms the exact text they
// read. A draft re-extracted in the meantime has another hash and is refused, so confirmed content never changes
// silently.
import { D } from "./errors";

export function confirmDraft(draft: string | null, currentSha: string | null, sentSha: unknown, lastConfirmation: { text: string; by_name: string } | null): void {
  if (!draft || !currentSha) throw D.noDraftQuestion();
  if (sentSha !== currentSha) throw D.questionChanged();
  if (lastConfirmation && lastConfirmation.text === draft) throw D.questionConfirmed(lastConfirmation.by_name);
}
