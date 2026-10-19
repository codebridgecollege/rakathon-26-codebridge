// Alert state is the latest event: open, acknowledged or resolved. Nothing is edited or removed. Missing-document
// alerts are always on: no event or setting switches the kind off (CLAUDE.md, team decision 2026-10-17).
import { D } from "@codebridge/domain/errors";

export type AlertAction = "ack" | "resolved" | "reopen";
export type AlertState = "open" | "ack" | "resolved";

export function alertState(events: { action: AlertAction }[]): AlertState {
  const last = events.at(-1);
  return !last || last.action === "reopen" ? "open" : last.action;
}

const ALLOWED: Record<AlertState, AlertAction[]> = { open: ["ack", "resolved"], ack: ["resolved", "reopen"], resolved: ["reopen"] };

export function transition(state: AlertState, action: unknown, expected: unknown): AlertAction {
  if (expected !== state) throw D.alertStateChanged();
  if (typeof action !== "string" || !(ALLOWED[state] as string[]).includes(action)) throw D.alertActionNotAllowed();
  return action as AlertAction;
}

// The brief's missing-document signal: every missing alert that is not resolved. Acknowledging keeps it counted.
export function missingSignal(alerts: { kind: string; state: AlertState }[]): number {
  return alerts.filter((a) => a.kind === "missing" && a.state !== "resolved").length;
}

export const ALERT_ACT_CS: Record<AlertAction, string> = {
  ack: "vzal(a) upozornění na vědomí",
  resolved: "označil(a) upozornění jako vyřešené",
  reopen: "vrátil(a) upozornění mezi otevřená",
};
export const ALERT_KIND_CS: Record<string, string> = {
  missing: "Chybí",
  contradiction: "Rozpor",
  chronology: "Chronologie",
  unclear: "Nejasné",
  poor_copy: "Špatná kopie",
  identity: "Jiný pacient",
};

// An alert ID of codebridge.extraction/2: "al-" and 8 hex digits (keys.ts alertId), unique within a case.
export const ALERT_ID = /^al-[0-9a-f]{8}$/;
