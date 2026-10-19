// A doctor's correction of an extracted fact. The source value never changes; the override is stored next to it, and
// the edit log only grows (a revert is a new row).
import { D } from "./errors";

// The key goes into the access-log line, so it must never be free text. Two kinds of key:
// - a field that is not a fact of the run (the brief, the reason, the proposal, the question, the diagnosis line, a
//   deviation's assessment and severity), optionally with an index and a part;
// - "f:<fact id>" with an optional part: an edit of one fact of a codebridge.extraction/2 run. The fact ID is stable
//   across runs, so the edit stays with its fact when the case is processed again;
// - "v:<view line id>" with an optional part: an edit of one composed line (EXTRACTION-FORMAT.md, "Composed views").
//   The line ID follows from the line's facts, so the edit stays with the facts, not with the line's position.
const FIELD_HEADS = "brief|reason|proposal|q|dx|assess|sev";
const PART = "(?::(?:t|c|e|line|note))";
/** A fact ID as keys.ts mints it ("f-" and 8 hex digits); the 6-digit form is the worked examples'. */
export const FACT_ID_RE = /^f-[0-9a-f]{6,8}$/;
/** A composed view line's ID as keys.ts viewLineId mints it. */
export const VIEW_LINE_ID_RE = /^vl-[0-9a-f]{8}$/;
export const KEY_RE = new RegExp(`^(?:(?:${FIELD_HEADS})(?::\\d{1,4}${PART}?)?|f:f-[0-9a-f]{6,8}${PART}?|v:vl-[0-9a-f]{8}${PART}?)$`);
// Keys of the codebridge.extraction/1 view: a section and a position in its list ("od:1:e"). A position does not survive
// a new run, so nothing new is saved under one; an existing edit under one can still be reverted (the view lists it as
// orphaned, and a doctor must be able to clear it).
const LEGACY_HEADS = "od|oc|sp|fa|faw|OA|RA|PA|SA|FA|AA|abusus|EA|preventive";
export const LEGACY_KEY_RE = new RegExp(`^(?:${LEGACY_HEADS})(?::\\d{1,4}${PART}?)?$`);

/** The fact an "f:" key edits, or null for a field key. */
export function factIdOfKey(key: string): string | null {
  const m = /^f:(f-[0-9a-f]{6,8})(?::|$)/.exec(key);
  return m && KEY_RE.test(key) ? m[1]! : null;
}

/** The composed view line a "v:" key edits, or null. */
export function lineIdOfKey(key: string): string | null {
  const m = /^v:(vl-[0-9a-f]{8})(?::|$)/.exec(key);
  return m && KEY_RE.test(key) ? m[1]! : null;
}

export type CurrentEdit = { log_id: number | null; by_name: string } | null;
export type EditOp = { kind: "save"; text: string } | { kind: "revert" } | { kind: "noop" };

function checkExpected(current: CurrentEdit, expected: unknown): void {
  const want = current ? current.log_id : null;
  if ((expected ?? null) !== want) throw D.editConflict(current?.by_name ?? "");
}

function checkKey(key: string, allowLegacy: boolean): void {
  if (KEY_RE.test(key) || (allowLegacy && LEGACY_KEY_RE.test(key))) return;
  if (LEGACY_KEY_RE.test(key)) throw D.legacyEditKey();
  throw D.invalidInput({ fields: { key: "Neplatný klíč údaje." } });
}

export function saveEdit(key: string, current: CurrentEdit, text: unknown, orig: unknown, expected: unknown): EditOp {
  checkKey(key, true);
  if (typeof text !== "string" || text.length > 4000) throw D.invalidInput({ fields: { text: "Text je příliš dlouhý." } });
  if (orig !== null && orig !== undefined && (typeof orig !== "string" || orig.length > 4000)) throw D.invalidInput({ fields: { orig: "Neplatný původní údaj." } });
  checkExpected(current, expected);
  const t = text.trim();
  // An empty text or the original value means "back to the source", as in the page.
  if (!t || t === (orig ?? "")) return current ? { kind: "revert" } : { kind: "noop" };
  // Back to the source is allowed under an old positional key, a new text is not.
  if (!KEY_RE.test(key)) throw D.legacyEditKey();
  return { kind: "save", text: t };
}

export function revertEdit(key: string, current: CurrentEdit, expected: unknown): EditOp {
  checkKey(key, true);
  checkExpected(current, expected);
  return current ? { kind: "revert" } : { kind: "noop" };
}
