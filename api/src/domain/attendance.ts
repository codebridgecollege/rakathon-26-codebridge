// Who was at the MDT: one set per seminar day, or per case without a slot. Each person is active, in the department
// they are listed under, and listed once. Approved decisions keep their own frozen copy, so later edits never change
// an approved report.
import { D } from "@codebridge/domain/errors";
import { isIsoDay } from "@codebridge/domain/time";

export type StaffDept = { id: string; name: string; people: { id: string; name: string }[] };

export function validSetKey(key: string): boolean {
  return isIsoDay(key) || /^case:[A-Za-z0-9_-]{1,40}$/.test(key);
}

export type AttRow = { dept_id: string; position: number; user_id: string; user_name: string };

export function setAttendance(byDept: unknown, depts: StaffDept[], expectedVersion: unknown, version: number): AttRow[] {
  if (expectedVersion !== version) throw D.attendanceConflict();
  if (!byDept || typeof byDept !== "object" || Array.isArray(byDept)) throw D.invalidInput();
  const rows: AttRow[] = [];
  const seen = new Set<string>();
  for (const [deptId, ids] of Object.entries(byDept as Record<string, unknown>)) {
    const dept = depts.find((d) => d.id === deptId);
    if (!dept || !Array.isArray(ids) || ids.length > 50) throw D.attendeeInvalid();
    ids.forEach((id, position) => {
      const person = dept.people.find((p) => p.id === id);
      if (typeof id !== "string" || !person || seen.has(id)) throw D.attendeeInvalid();
      seen.add(id);
      rows.push({ dept_id: dept.id, position, user_id: id, user_name: person.name });
    });
  }
  return rows;
}
