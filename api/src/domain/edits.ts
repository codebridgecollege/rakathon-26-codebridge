// A doctor's correction of an extracted fact. The source value never changes; the override is stored next to it, and
// the edit log only grows (a revert is a new row).
import { D } from "./errors";

// The page's edit keys only (ed(), edLink() in mocks/src/v3-template.html): a field name, optionally an index and a
// part. The key goes into the access-log line, so it must never be free text.
const KEY_HEADS = "brief|reason|proposal|q|dx|assess|sev|od|oc|sp|fa|faw|OA|RA|PA|SA|FA|AA|abusus|EA|preventive";
export const KEY_RE = new RegExp(`^(?:${KEY_HEADS})(?::\\d{1,4}(?::(?:e|c|t|line|note))?)?$`);

export type CurrentEdit = { log_id: number | null; by_name: string } | null;
export type EditOp = { kind: "save"; text: string } | { kind: "revert" } | { kind: "noop" };

function checkExpected(current: CurrentEdit, expected: unknown): void {
  const want = current ? current.log_id : null;
  if ((expected ?? null) !== want) throw D.editConflict(current?.by_name ?? "");
}

export function saveEdit(key: string, current: CurrentEdit, text: unknown, orig: unknown, expected: unknown): EditOp {
  if (!KEY_RE.test(key)) throw D.invalidInput({ fields: { key: "Neplatný klíč údaje." } });
  if (typeof text !== "string" || text.length > 4000) throw D.invalidInput({ fields: { text: "Text je příliš dlouhý." } });
  if (orig !== null && orig !== undefined && (typeof orig !== "string" || orig.length > 4000)) throw D.invalidInput({ fields: { orig: "Neplatný původní údaj." } });
  checkExpected(current, expected);
  const t = text.trim();
  // An empty text or the original value means "back to the source", as in the page.
  if (!t || t === (orig ?? "")) return current ? { kind: "revert" } : { kind: "noop" };
  return { kind: "save", text: t };
}

export function revertEdit(key: string, current: CurrentEdit, expected: unknown): EditOp {
  if (!KEY_RE.test(key)) throw D.invalidInput({ fields: { key: "Neplatný klíč údaje." } });
  checkExpected(current, expected);
  return current ? { kind: "revert" } : { kind: "noop" };
}
