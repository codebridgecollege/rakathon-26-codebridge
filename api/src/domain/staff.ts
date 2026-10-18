// The staff list (mock round 23): departments of people entered as title and surname. Names are unique across the
// list, the administrator included; removing a person is a soft delete, so history keeps the names it stored.
import { D } from "@codebridge/domain/errors";
import { staffName } from "./rows";

export type StaffUser = { id: string; pre: string; sur: string; post: string; fn: string; role: string; active: number };

export const nameTaken = (name: string, users: StaffUser[], exceptId?: string) =>
  users.some((u) => u.active === 1 && u.id !== exceptId && staffName(u).toLowerCase() === name.toLowerCase());

const field = (x: unknown, max: number) => (typeof x === "string" ? x.trim().slice(0, max) : "");

export type NewPerson = { pre: string; sur: string; post: string; fn: string; role: "doctor" | "staff" };

export function validatePerson(body: Record<string, unknown>, users: StaffUser[]): NewPerson {
  const p = { pre: field(body.pre, 40), sur: field(body.sur, 80), post: field(body.post, 40), fn: field(body.fn, 120) };
  if (!p.sur) throw D.surnameRequired();
  // The role is the staff screen's explicit choice; the server never derives it from a title in the name.
  if (body.role !== "doctor" && body.role !== "staff") throw D.invalidInput({ fields: { role: "Zvolte roli (lékař, nebo personál)." } });
  if (nameTaken(staffName(p), users)) throw D.staffNameTaken(staffName(p));
  return { ...p, role: body.role };
}

export function renamePerson(u: StaffUser, f: unknown, value: unknown, expected: unknown, users: StaffUser[]): StaffUser {
  if (f !== "pre" && f !== "sur" && f !== "post" && f !== "fn") throw D.invalidInput();
  const max = f === "fn" ? 120 : f === "sur" ? 80 : 40;
  const v = field(value, max);
  if (expected !== u[f]) throw D.staffChanged();
  if (f === "sur" && !v) throw D.surnameRequired();
  const next = { ...u, [f]: v };
  if (f !== "fn" && nameTaken(staffName(next), users, u.id)) throw D.staffNameTaken(staffName(next));
  return next;
}

export function validateDeptName(name: unknown, depts: { name: string }[]): string {
  const n = field(name, 80);
  if (!n) throw D.deptNameRequired();
  if (depts.some((d) => d.name.toLowerCase() === n.toLowerCase())) throw D.deptNameTaken(n);
  return n;
}

export function removePerson(u: StaffUser, actorId: string): void {
  if (u.id === actorId) throw D.cannotRemoveSelf();
  // The coordinator and the administrator are roles, not department staff; the staff screen cannot remove them.
  if (u.role === "coordinator" || u.role === "admin") throw D.roleForbidden();
}

// The fictional default staff lives in the shared package, so the app reads the same list.
export { DEFAULT_STAFF, DEFAULT_COORDINATOR } from "@codebridge/domain/staff-default";
