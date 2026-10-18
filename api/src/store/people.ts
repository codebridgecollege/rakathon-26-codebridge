// People, memberships and orgs (AUTH.md, "Data model"). These are the only lookups that start without an org: they
// establish which org a request acts in. Everything after them goes through the org-bound stores.
import type { Role } from "@codebridge/domain/access";
import { staffName } from "../domain/rows";

export type MemberRow = {
  id: string; // membership id
  org_id: string;
  user_id: string;
  role_id: Role | "staff";
  fn: string;
  pre: string;
  sur: string;
  post: string;
  // 1 only when both the person and this membership are active.
  active: number;
};

export type OrgRow = { id: string; name: string; short_name: string; is_demo: number; case_id_prefix: string };

const MEMBER_SELECT = `SELECT m.id, m.org_id, m.user_id, m.role_id, m.fn, u.pre, u.sur, u.post,
  CASE WHEN u.active = 1 AND m.active_until IS NULL THEN 1 ELSE 0 END AS active
  FROM memberships m JOIN users u ON u.id = m.user_id`;

// A membership can sign in or act only with an app role; 'staff' is a staff entry listed for attendance.
export const actsInApp = (m: MemberRow | null): m is MemberRow & { role_id: Role } => !!m && m.active === 1 && m.role_id !== "staff";

export function membershipById(db: D1Database, id: string) {
  return db.prepare(`${MEMBER_SELECT} WHERE m.id = ?1`).bind(id).first<MemberRow>();
}

// A person's memberships that can act, oldest org first, so a person with several lands in the same one every time
// until step 3 lets them pick (POST /api/session/org).
export async function activeMembershipsOfUser(db: D1Database, userId: string) {
  const r = await db
    .prepare(`${MEMBER_SELECT} JOIN orgs o ON o.id = m.org_id WHERE m.user_id = ?1 AND u.active = 1 AND m.active_until IS NULL AND m.role_id <> 'staff' ORDER BY o.created_at, o.id`)
    .bind(userId)
    .all<MemberRow>();
  return r.results;
}

export async function activeMembershipsOfEmail(db: D1Database, email: string) {
  const u = await db.prepare("SELECT id FROM users WHERE email = ?1").bind(email).first<{ id: string }>();
  return u ? activeMembershipsOfUser(db, u.id) : [];
}

// Demo mode: the picker sends a membership id; an older client or a test may still send a person's id, which then
// means that person's first active membership.
export async function demoMembership(db: D1Database, id: string): Promise<MemberRow | null> {
  const m = await membershipById(db, id);
  if (m) return m;
  return (await activeMembershipsOfUser(db, id))[0] ?? null;
}

export function orgById(db: D1Database, id: string) {
  return db.prepare("SELECT id, name, short_name, is_demo, case_id_prefix FROM orgs WHERE id = ?1").bind(id).first<OrgRow>();
}

export const orgOut = (o: OrgRow) => ({ id: o.id, name: o.name, short_name: o.short_name, is_demo: o.is_demo === 1 });

// The demo picker (AUTH_MODE=demo): every membership that can act, grouped by org, doctors by department first, then
// the coordinator and the administrator, as the picker lists them.
export async function demoPicker(db: D1Database) {
  const [orgs, members] = await db.batch([
    db.prepare("SELECT id, name, short_name, is_demo, case_id_prefix FROM orgs ORDER BY created_at, id"),
    db.prepare(
      `${MEMBER_SELECT}
       LEFT JOIN (SELECT dm.org_id, dm.user_id, MIN(d.sort * 100000 + dm.position) AS k,
                         (SELECT d2.name FROM dept_members dm2 JOIN departments d2 ON d2.id = dm2.dept_id AND d2.org_id = dm2.org_id
                          WHERE dm2.org_id = dm.org_id AND dm2.user_id = dm.user_id ORDER BY d2.sort, d2.id LIMIT 1) AS dept
                  FROM dept_members dm JOIN departments d ON d.id = dm.dept_id AND d.org_id = dm.org_id GROUP BY dm.org_id, dm.user_id) x
         ON x.org_id = m.org_id AND x.user_id = m.user_id
       WHERE u.active = 1 AND m.active_until IS NULL AND m.role_id <> 'staff'
       ORDER BY m.org_id, CASE m.role_id WHEN 'doctor' THEN 0 WHEN 'coordinator' THEN 1 ELSE 2 END, x.k, m.id`,
    ),
  ]);
  const ms = members!.results as (MemberRow & { dept: string | null })[];
  return {
    orgs: (orgs!.results as OrgRow[]).map((o) => ({
      ...orgOut(o),
      people: ms
        .filter((m) => m.org_id === o.id)
        .map((m) => ({ id: m.id, user_id: m.user_id, name: staffName(m), role: m.role_id as Role, fn: m.fn, dept: m.dept ?? null })),
    })),
  };
}

// Every active membership of a person, for GET /me.
export async function membershipsOut(db: D1Database, userId: string) {
  const r = await db
    .prepare(
      `SELECT m.id, m.role_id, m.fn, o.id AS org_id, o.name, o.short_name, o.is_demo, o.case_id_prefix,
         (SELECT d.id FROM dept_members dm JOIN departments d ON d.id = dm.dept_id AND d.org_id = dm.org_id
          WHERE dm.org_id = m.org_id AND dm.user_id = m.user_id ORDER BY d.sort, d.id LIMIT 1) AS dept_id,
         (SELECT d.name FROM dept_members dm JOIN departments d ON d.id = dm.dept_id AND d.org_id = dm.org_id
          WHERE dm.org_id = m.org_id AND dm.user_id = m.user_id ORDER BY d.sort, d.id LIMIT 1) AS dept_name
       FROM memberships m JOIN orgs o ON o.id = m.org_id JOIN users u ON u.id = m.user_id
       WHERE m.user_id = ?1 AND u.active = 1 AND m.active_until IS NULL AND m.role_id <> 'staff' ORDER BY o.created_at, o.id`,
    )
    .bind(userId)
    .all<{ id: string; role_id: Role; fn: string; org_id: string; name: string; short_name: string; is_demo: number; case_id_prefix: string; dept_id: string | null; dept_name: string | null }>();
  return r.results.map((m) => ({
    id: m.id,
    org: orgOut({ id: m.org_id, name: m.name, short_name: m.short_name, is_demo: m.is_demo, case_id_prefix: m.case_id_prefix }),
    role: m.role_id,
    fn: m.fn,
    dept: m.dept_id && m.dept_name ? { id: m.dept_id, name: m.dept_name } : null,
  }));
}
