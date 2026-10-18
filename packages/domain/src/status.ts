// Case lifecycle (demo round 20): Nový -> Naplánován (booking) -> Připraven -> Projednán (approval) -> Uzavřen.
// "Vyžaduje pozornost" is a side state. "Naplánován" and "Projednán" are never manual targets: only the booking and
// the approval set them.
import { D } from "./errors";

export const STATUSES = ["new", "scheduled", "attention", "ready", "done", "closed"] as const;
export type Status = (typeof STATUSES)[number];
export const isStatus = (s: unknown): s is Status => typeof s === "string" && (STATUSES as readonly string[]).includes(s);

export const STATUS_CS: Record<Status, string> = {
  new: "Nový",
  scheduled: "Naplánován",
  attention: "Vyžaduje pozornost",
  ready: "Připraven",
  done: "Projednán",
  closed: "Uzavřen",
};

export type CaseHead = { status: Status; hasSlot: boolean };
export type HistRow = { from: Status; to: Status };

export function manualMoves(c: CaseHead, hist: HistRow[]): Status[] {
  const base: Status = c.hasSlot ? "scheduled" : "new";
  if (c.status === "closed") {
    // Reopening returns to the status the case was closed from; closing may have freed the slot, so a case closed
    // from "Naplánován" without a slot reopens as "Nový".
    const h = hist.filter((x) => x.to === "closed").at(-1);
    const back = h?.from ?? base;
    return [back === "scheduled" && !c.hasSlot ? "new" : back];
  }
  const m: Partial<Record<Status, Status[]>> = {
    new: ["ready", "attention", "closed"],
    scheduled: ["ready", "attention", "closed"],
    attention: [base, "ready", "closed"],
    ready: [base, "attention", "closed"],
    done: ["closed"],
  };
  return (m[c.status] ?? []).filter((v, i, a) => v !== c.status && a.indexOf(v) === i);
}

export type StatusChange = { from: Status; to: Status; how: string };

// A manual move: refused unless it is one of the offered moves and the caller saw the current status.
export function moveStatus(c: CaseHead, hist: HistRow[], to: unknown, expected: unknown): StatusChange {
  if (expected !== c.status) throw D.statusChanged();
  if (!isStatus(to) || !manualMoves(c, hist).includes(to)) throw D.statusMoveNotAllowed();
  return { from: c.status, to, how: c.status === "closed" ? "ručně, znovu otevřeno" : "ručně" };
}

// Automatic moves; null when the status stays.
export const autoOnSchedule = (s: Status): StatusChange | null =>
  s === "new" ? { from: s, to: "scheduled", how: "automaticky při rezervaci termínu" } : null;
export const autoOnUnschedule = (s: Status): StatusChange | null =>
  s === "scheduled" ? { from: s, to: "new", how: "automaticky po uvolnění termínu" } : null;
export const autoOnApprove = (s: Status): StatusChange | null =>
  s === "done" ? null : { from: s, to: "done", how: "automaticky při schválení závěru" };
// A new conclusion reopens a discussed case to what its slot says.
export const autoOnNewVersion = (s: Status, hasSlot: boolean): StatusChange | null => {
  const to: Status = hasSlot ? "scheduled" : "new";
  return s === to ? null : { from: s, to, how: "automaticky při novém závěru" };
};

export const statusLine = (ch: StatusChange) => `změnil(a) stav případu: ${STATUS_CS[ch.from]} -> ${STATUS_CS[ch.to]} (${ch.how})`;
