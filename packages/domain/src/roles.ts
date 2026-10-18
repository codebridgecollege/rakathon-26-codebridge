// Who may change what (step-4.md section 2). Pure: the route loads membership and passes it in. Every rule checks the
// acting user's role; the access log stores who acted and in which role.
import type { Role } from "./access";
import { D } from "./errors";
import { COORDINATOR_ACTS_ON_ALERTS, COORDINATOR_EDITS_PROTOCOL } from "./config";

export type Actor = { id: string; name: string; role: Role };

export type Action =
  | "status.move" // manual status change, close, reopen
  | "slot.write" // book, move, free a slot
  | "protocol.edit" // notes, conclusion draft, steps
  | "decision.approve"
  | "decision.new_version"
  | "question.confirm"
  | "fact.edit"
  | "suggestion.decide" // edit, confirm, dismiss a drafted task
  | "task.done"
  | "alert.act"
  | "session.write" // start and end an MDT, attendance
  | "case.create"
  | "digest.send"
  | "staff.write"
  | "break_glass"
  | "demo.reset"
  | "recording.write" // start and stop the AI recording
  | "transcript.write" // store live lines and audio of a case, retry its speaker pass
  | "document.upload" // upload a document to a case or remove an unprocessed upload (step 6)
  | "document.process"; // start the document pipeline on a stored document (step 6)

// Actions on one case need the doctor to be on its team (or to hold a break-the-glass grant).
const CASE_SCOPED: ReadonlySet<Action> = new Set([
  "status.move", "slot.write", "protocol.edit", "decision.approve", "decision.new_version", "question.confirm",
  "fact.edit", "suggestion.decide", "task.done", "alert.act", "transcript.write", "document.upload", "document.process",
]);

// The permission matrix. A row missing for a role means "no". Clinical confirmations are doctors' only.
const MATRIX: Record<Action, ReadonlySet<Role>> = {
  "status.move": new Set(["doctor", "coordinator"]),
  "slot.write": new Set(["doctor", "coordinator"]),
  "protocol.edit": new Set(COORDINATOR_EDITS_PROTOCOL ? ["doctor", "coordinator"] : ["doctor"]),
  "decision.approve": new Set(["doctor"]),
  "decision.new_version": new Set(["doctor"]),
  "question.confirm": new Set(["doctor"]),
  "fact.edit": new Set(["doctor"]),
  "suggestion.decide": new Set(["doctor"]),
  "task.done": new Set(["doctor", "coordinator"]),
  "alert.act": new Set(COORDINATOR_ACTS_ON_ALERTS ? ["doctor", "coordinator"] : ["doctor"]),
  "session.write": new Set(["doctor", "coordinator"]),
  "case.create": new Set(["doctor", "coordinator"]),
  "digest.send": new Set(["doctor", "coordinator"]),
  "staff.write": new Set(["coordinator", "admin"]),
  "break_glass": new Set(["doctor"]),
  "demo.reset": new Set(["admin"]),
  // Who runs the meeting runs the recorder: the same roles as starting an MDT (session.write).
  "recording.write": new Set(["doctor", "coordinator"]),
  "transcript.write": new Set(["doctor", "coordinator"]),
  // The page's canUpload: doctors and the coordinator bring documents to a case; the administrator does not.
  "document.upload": new Set(["doctor", "coordinator"]),
  // Re-reading a document is not a clinical confirmation, so the same roles as uploading it.
  "document.process": new Set(["doctor", "coordinator"]),
};

// Doctor-only clinical actions refuse with the wording the page used before (who does it), not a generic one.
const DOCTOR_REFUSAL: Partial<Record<Action, () => Error>> = {
  "decision.approve": () => D.notDoctorApprove(),
  "decision.new_version": () => D.notDoctorApprove(),
  "question.confirm": () => D.notDoctor(),
  "fact.edit": () => D.notDoctorEdit(),
  "suggestion.decide": () => D.notDoctorSuggestion(),
  "protocol.edit": () => D.notDoctor(),
};

export type CaseAccess = {
  member: boolean; // the user or one of the user's departments is on the case
  grant: boolean; // an unexpired break-the-glass grant
  assignee?: boolean; // the task's assignee (task.done only)
};

export function allowed(actor: Actor, action: Action, ctx?: CaseAccess): boolean {
  try {
    assertCan(actor, action, ctx);
    return true;
  } catch {
    return false;
  }
}

// Throws the refusal; returns nothing when allowed.
export function assertCan(actor: Actor, action: Action, ctx?: CaseAccess): void {
  // The assignee may close their own task even without a role on the case (a coordinator task assigned to a nurse).
  if (action === "task.done" && ctx?.assignee) return;
  if (!MATRIX[action].has(actor.role)) throw (DOCTOR_REFUSAL[action] ?? D.roleForbidden)();
  if (CASE_SCOPED.has(action) && actor.role === "doctor" && !(ctx?.member || ctx?.grant)) throw D.notMember();
}

// Grants are valid until their expiry; the clock is injected.
export const grantValid = (expiresAt: string, now: Date) => expiresAt > now.toISOString();
