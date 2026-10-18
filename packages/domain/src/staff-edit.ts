// The staff screen's checks before a request (screen S-8,).
// The server checks again (api/src/domain/staff.ts); these only let the page refuse at once with the same wording.
import { staffName } from "./names";
import type { StaffDirectory, StaffPerson } from "./wire";

// Every name the directory holds, by person id (the administrator included), to tell a duplicate from a rename.
export function namesById(dir: StaffDirectory): Map<string, string> {
  const m = new Map<string, string>();
  if (dir.coord) m.set(dir.coord.id, staffName(dir.coord));
  if (dir.admin) m.set(dir.admin.id, staffName(dir.admin));
  for (const d of dir.depts) for (const p of d.people) m.set(p.id, staffName(p));
  return m;
}

// A display name already used by someone else. Names are unique across the list, so the picker never shows two
// people under one name.
export const nameTaken = (dir: StaffDirectory, name: string, exceptId?: string) => [...namesById(dir)].some(([id, n]) => id !== exceptId && n === name);

// The role of a new person: "MUDr." in a title makes a doctor, anyone else is staff. The server stores the role and its
// rules follow it.
export const roleGuess = (pre: string, post: string): "doctor" | "staff" => (/MUDr\./.test(`${pre} ${post}`) ? "doctor" : "staff");

export const STAFF_FIELDS = ["pre", "sur", "post", "fn"] as const;
export type StaffField = (typeof STAFF_FIELDS)[number];

export type EditCheck = { ok: true } | { ok: false; reason: "unchanged" } | { ok: false; reason: "surname_required" } | { ok: false; reason: "name_taken"; name: string };

// One field of a person changed. A surname is never emptied (the person is removed with ✕ instead), and a rename may
// not take another person's name.
export function checkFieldEdit(dir: StaffDirectory, x: StaffPerson, f: StaffField, value: string): EditCheck {
  const v = value.trim();
  if (f === "sur" && !v) return { ok: false, reason: "surname_required" };
  const before = staffName(x);
  const next = staffName({ ...x, [f]: v });
  if (next !== before && nameTaken(dir, next, x.id)) return { ok: false, reason: "name_taken", name: next };
  if ((x[f] || "") === v) return { ok: false, reason: "unchanged" };
  return { ok: true };
}

// The person and department of an id (the coordinator has no department).
export function findPerson(dir: StaffDirectory, id: string): { person: StaffPerson; dept: StaffDirectory["depts"][number] | null } | null {
  if (dir.coord?.id === id) return { person: dir.coord, dept: null };
  for (const d of dir.depts) {
    const p = d.people.find((y) => y.id === id);
    if (p) return { person: p, dept: d };
  }
  return null;
}

// Department names are unique regardless of case, as the server checks them.
export const deptNameTaken = (dir: StaffDirectory, name: string) => dir.depts.some((d) => d.name.toLowerCase() === name.toLowerCase());
