// A doctor's confirmation of one fact of a codebridge.extraction/2 run (EXTRACTION-FORMAT.md, "Fact identity"). The
// confirmation attaches to the fact ID, which stays the same across runs, and records a hash of what the fact said.
// When a later run gives the same ID another value, the hashes differ and the view shows both values and asks the
// doctor again, instead of carrying the confirmation over to a value nobody confirmed. Pure; the server hashes.
import { D } from "./errors";
import type { Fact } from "./extraction/types";

export type ConfirmAction = "confirm" | "withdraw";
/** unconfirmed: never confirmed or withdrawn; confirmed: the current value; changed: confirmed with another value. */
export type ConfirmState = "unconfirmed" | "confirmed" | "changed";

export function confirmationState(rows: readonly { action: ConfirmAction; value_sha256: string }[], currentSha: string): ConfirmState {
  const last = rows.at(-1);
  if (!last || last.action === "withdraw") return "unconfirmed";
  return last.value_sha256 === currentSha ? "confirmed" : "changed";
}

const ALLOWED: Record<ConfirmState, ConfirmAction[]> = { unconfirmed: ["confirm"], confirmed: ["withdraw"], changed: ["confirm", "withdraw"] };

/** The action, when the page saw the state the server has and the action fits it. */
export function confirmTransition(state: ConfirmState, action: unknown, expected: unknown): ConfirmAction {
  if (expected !== state) throw D.confirmationChanged();
  if (typeof action !== "string" || !(ALLOWED[state] as string[]).includes(action)) throw D.confirmActionNotAllowed();
  return action as ConfirmAction;
}

/** JSON with object keys sorted at every level, so the same content always gives the same text and hash. */
export function stableJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map((v) => (v === undefined ? "null" : stableJson(v))).join(",")}]`;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj)
    .filter((k) => obj[k] !== undefined)
    .sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableJson(obj[k])}`).join(",")}}`;
}

/**
 * What a confirmation confirms: the fact's frame (kind, subject, negated, status, date) and its value. Sources,
 * certainty and notes are left out: a re-read page that quotes the same value differently is still the same statement.
 * The server stores the SHA-256 of this text as value_sha256.
 */
export function confirmedContent(fact: Pick<Fact, "kind" | "subject" | "negated" | "status" | "date" | "value">): string {
  return stableJson({ kind: fact.kind, subject: fact.subject, negated: fact.negated, status: fact.status, date: fact.date, value: fact.value });
}
