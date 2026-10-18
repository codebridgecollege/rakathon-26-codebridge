// Rules of the running MDT (screen S-4) and of the discussion record "Projednání na MDT" (screen S-5), as the old page
// applies them (sessionBar(), ensureProto(), applyProto(), protoEditable(), mdtCard(), recTarget() in
// mocks/src/v3-template.html). Pure, so the app and its tests share one copy of each rule.
import type { Step } from "./protocol";

export type SessionLike = { day: string; started_at: string; ended_at: string | null; started_by?: string | null };
export type CaseLike = { file: string; id: string; status: string; slot: { day: string; time: string } | null };

// The running seminar is the session that has not ended; with several open, the latest start wins (applySessions()).
export function runningSession<S extends SessionLike>(sessions: readonly S[]): S | null {
  return (
    sessions
      .filter((s) => !s.ended_at)
      .slice()
      .sort((a, b) => String(a.started_at).localeCompare(String(b.started_at)))
      .at(-1) ?? null
  );
}

// A case belongs to the running seminar when its slot is on the seminar's day.
export const inSession = (p: Pick<CaseLike, "slot"> | null | undefined, session: Pick<SessionLike, "day"> | null | undefined): boolean =>
  !!(session && p?.slot && p.slot.day === session.day);

// Attendance is entered once per seminar day; a case without a slot has its own list, keyed "case:<case id>" as on the
// server (attDay()).
export const attKey = (p: Pick<CaseLike, "slot" | "id">): string => p.slot?.day || `case:${p.id}`;

// The discussion record as the page holds it. Mode is view state of this page; the rest comes from the server.
export type ProtoState = "draft" | "approved";
export type Proto = {
  notes: string;
  concl: string;
  steps: Step[];
  state: ProtoState;
  version: number;
  updated_by: string | null;
  updated_at: string | null;
  approver: string | null;
  approved_at: string | null;
};
export const emptyProto = (): Proto => ({
  notes: "",
  concl: "",
  steps: [],
  state: "draft",
  version: 0,
  updated_by: null,
  updated_at: null,
  approver: null,
  approved_at: null,
});

const stepsOf = (x: unknown): Step[] =>
  (Array.isArray(x) ? x : []).map((s) => {
    const o = (s ?? {}) as Record<string, unknown>;
    return { text: String(o.text ?? ""), who: String(o.who ?? ""), due: String(o.due ?? "") };
  });

// The server's protocol object (store/work.ts) in the page's shape; "conclusion" is the stored name of "concl".
export function protoFromServer(sp: Record<string, unknown> | null | undefined): Proto {
  const s = sp ?? {};
  return {
    notes: String(s.notes ?? ""),
    concl: String(s.concl ?? s.conclusion ?? ""),
    steps: stepsOf(s.steps),
    state: s.state === "approved" ? "approved" : "draft",
    version: Number(s.version ?? 0) || 0,
    updated_by: (s.updated_by as string | null | undefined) ?? null,
    updated_at: (s.updated_at as string | null | undefined) ?? null,
    approver: (s.approver as string | null | undefined) ?? null,
    approved_at: (s.approved_at as string | null | undefined) ?? null,
  };
}

// The server's protocol replaces the page's copy, except while this page holds typed text the server has not stored
// yet (dirty fields or a save on its way): then the typed text and the version it was typed against stay, so the next
// save either succeeds or reports the conflict. An answer read before this page's latest autosave carries an older
// version and must not roll the text back. The state, who changed it and the approval always come from the server.
// keepLocal tells the caller whether its unsaved marks survive (applyProto()).
export function mergeProto(local: Proto | null, server: Proto, pending: boolean): { proto: Proto; keepLocal: boolean } {
  if (!local) return { proto: { ...server, steps: server.steps.map((s) => ({ ...s })) }, keepLocal: false };
  const older = server.state === local.state && server.version < local.version;
  const keep = (pending && server.state !== "approved") || older;
  const text = keep
    ? { notes: local.notes, concl: local.concl, steps: local.steps, version: local.version }
    : { notes: server.notes, concl: server.concl, steps: server.steps.map((s) => ({ ...s })), version: server.version };
  return {
    proto: { ...text, state: server.state, updated_by: server.updated_by, updated_at: server.updated_at, approver: server.approver, approved_at: server.approved_at },
    keepLocal: keep,
  };
}

// Who may write the discussion record: doctors and the coordinator (the server's COORDINATOR_EDITS_PROTOCOL), while
// the conclusion is a draft and the case is open. The page does not offer what the server would refuse.
export const protoEditable = (canRunCases: boolean, state: ProtoState, caseStatus: string): boolean =>
  canRunCases && state !== "approved" && caseStatus !== "closed";

// The card's open state: the doctor's own open or closed choice wins; otherwise open when the case is discussed in the
// running seminar, has a written draft or an approved conclusion (mdtCard()).
export const cardOpen = (choice: boolean | undefined, live: boolean, hasConcl: boolean, approved: boolean): boolean =>
  choice ?? (live || hasConcl || approved);

// The chip next to the card's heading: approved, an unapproved draft, or the number of the valid conclusion while a
// new one has not been started (mdtChip()).
export type ChipCode = { kind: "approved" } | { kind: "draft" } | { kind: "valid"; n: number } | null;
export function cardChip(state: ProtoState, concl: string, decisions: number): ChipCode {
  if (state === "approved") return { kind: "approved" };
  if (concl.trim()) return { kind: "draft" };
  return decisions ? { kind: "valid", n: decisions } : null;
}

// Assignees of a next step: the coordinator, the case owner and the people present, each once, and only people on the
// staff list (the server refuses anyone else, such as a referring doctor from outside).
export function assignees(coord: string | null, owner: string, present: readonly string[], staffNames: ReadonlySet<string>): string[] {
  return [coord ?? "", owner, ...present].filter((v, i, a) => !!v && a.indexOf(v) === i && staffNames.has(v));
}

// The frozen attendance an approval sends: today's list plus the approving doctor, who was at the meeting (round 20);
// the server adds them the same way and refuses an approval whose list differs.
export const approvalAttendance = (present: readonly string[], approver: string): string[] =>
  present.includes(approver) ? [...present] : [...present, approver];

// One idempotency key per approval: a retry after a lost answer sends the same body and reuses the key, so the server
// replays its answer instead of making a second decision; a changed approval gets a new key.
// The frozen report is part of the body, so a retry whose report changed (steps edited meanwhile) gets a new key
// instead of a refusal for a different body under the same key.
export const approvalSignature = (b: { protocol_version: number; conclusion: string; attendance_expected: string[]; picked_sections: string[]; report_html?: string }) =>
  JSON.stringify([b.protocol_version, b.conclusion, b.attendance_expected, b.picked_sections, b.report_html ?? ""]);

// Words of the AI recording go only to an open case still being discussed: the doctor's choice of case decides, never
// a guess. During a seminar only its own cases take words; a patient opened to look something up does not (recTarget()).
export function recordingTarget(open: CaseLike | null, approved: boolean, session: Pick<SessionLike, "day"> | null): string | null {
  if (!open || open.status === "closed" || approved) return null;
  return !session || inSession(open, session) ? open.file : null;
}

// When every case of the running seminar is approved or closed, the recording stops by itself (recAfterApprove()).
export const allDone = (agenda: readonly CaseLike[], approved: (file: string) => boolean): boolean =>
  agenda.length > 0 && agenda.every((a) => approved(a.file) || a.status === "closed");
