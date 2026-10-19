// Staff list writes (Personál pracoviště): coordinator and administrator, in their own org. A person (users) can belong
// to several orgs; what this screen changes is their membership here (role, function, department, leaving the list),
// except the name, which is the person's. People are soft-deleted (the membership ends), so history rows that stored a
// name keep it; a rename follows the person's open tasks, drafted tasks and draft steps in this org.
import { Hono } from "hono";
import type { Context } from "hono";
import type { AppEnv } from "../types";
import { D } from "@codebridge/domain/errors";
import { assertCan } from "@codebridge/domain/roles";
import { removePerson, renamePerson, validateDeptName, validatePerson, STAFF_DEFAULTS } from "../domain/staff";
import { staffName } from "../domain/rows";
import type { Tx } from "../store/write";
import { actorOf, answer, isoNow, label, newId, orgQuery, tx, work } from "./write-context";

async function staffState(c: Context<AppEnv>) {
  const s = await c.var.stores.dir.staff();
  return { staff: { ...s, seq: 0, source: "server" } };
}

const shortId = () => newId().replace(/-/g, "").slice(0, 8);

// The person must still have a membership in this org; a name field is the person's, so the guard reads users.
const MEMBER_HERE = "EXISTS (SELECT 1 FROM memberships WHERE org_id = ?org AND user_id = ? AND active_until IS NULL)";

// A person leaving the list also leaves every attendance set of this org; decisions keep their frozen copy.
function dropFromAttendance(t: Tx, userId: string, by: string, at: string) {
  t.run(
    `UPDATE attendance_sets SET version = version + 1, updated_by = ?2, updated_at = ?3
     WHERE org_id = ?org AND set_key IN (SELECT DISTINCT set_key FROM attendance WHERE org_id = ?org AND user_id = ?1)`,
    userId, by, at,
  );
  t.run("DELETE FROM attendance WHERE org_id = ?org AND user_id = ?1", userId);
}

export const writeStaff = new Hono<AppEnv>()
  .post("/staff/departments", async (c) => {
    label(c, "personál: nové pracoviště");
    assertCan(actorOf(c), "staff.write");
    const w = work(c);
    const staff = await w.staff();
    const name = validateDeptName(c.var.body.name, staff.depts);
    const t = tx(c);
    t.guard("name_free", "NOT EXISTS (SELECT 1 FROM departments WHERE org_id = ?org AND lower(name) = lower(?))", [name], () => D.deptNameTaken(name));
    t.run("INSERT INTO departments (org_id, id, name, sort) VALUES (?org, ?1, ?2, (SELECT COALESCE(MAX(sort), 0) + 1 FROM departments WHERE org_id = ?org))", `d${shortId()}`, name);
    t.audit({ action: "staff.dept_add", what_cs: `přidal(a) pracoviště do personálu: ${name}` });
    await t.commit();
    return answer(c, {}, await staffState(c));
  })
  .delete("/staff/departments/:id", async (c) => {
    label(c, "personál: odebrání pracoviště");
    assertCan(actorOf(c), "staff.write");
    const id = c.req.param("id");
    const staff = await work(c).staff();
    const d = staff.depts.find((x) => x.id === id);
    if (!d) throw D.deptNotFound();
    if (d.people.length) throw D.deptNotEmpty();
    const t = tx(c);
    t.guard(
      "empty",
      `NOT EXISTS (SELECT 1 FROM dept_members dm JOIN memberships m ON m.org_id = dm.org_id AND m.user_id = dm.user_id JOIN users u ON u.id = dm.user_id
         WHERE dm.org_id = ?org AND dm.dept_id = ? AND u.active = 1 AND m.active_until IS NULL)`,
      [id],
      () => D.deptNotEmpty(),
    );
    // Attendance rows of a department are history of who sat there; a department that has any stays.
    t.guard("no_attendance", "NOT EXISTS (SELECT 1 FROM attendance WHERE org_id = ?org AND dept_id = ?)", [id], () => D.deptNotEmpty());
    t.run("DELETE FROM case_members WHERE org_id = ?org AND dept_id = ?1", id);
    t.run("DELETE FROM dept_members WHERE org_id = ?org AND dept_id = ?1", id);
    t.run("DELETE FROM departments WHERE org_id = ?org AND id = ?1", id);
    t.audit({ action: "staff.dept_remove", what_cs: `odebral(a) pracoviště z personálu: ${d.name}` });
    await t.commit();
    return answer(c, {}, await staffState(c));
  })
  .post("/staff/departments/:id/people", async (c) => {
    label(c, "personál: nová osoba");
    assertCan(actorOf(c), "staff.write");
    const id = c.req.param("id");
    const staff = await work(c).staff();
    const d = staff.depts.find((x) => x.id === id);
    if (!d) throw D.deptNotFound();
    const p = validatePerson(c.var.body, staff.users);
    const uid = `${id}p${shortId()}`;
    const at = isoNow();
    const t = tx(c);
    // A new person and their membership here; the membership id is the person's id, as for the seeded staff.
    t.run("INSERT INTO users (id, pre, sur, post, active, created_at) VALUES (?1, ?2, ?3, ?4, 1, ?5)", uid, p.pre, p.sur, p.post, at);
    t.run("INSERT INTO memberships (id, org_id, user_id, role_id, fn, active_from, created_at) VALUES (?1, ?org, ?1, ?2, ?3, ?4, ?4)", uid, p.role, p.fn, at);
    t.run("INSERT INTO dept_members (org_id, dept_id, user_id, position) VALUES (?org, ?1, ?2, (SELECT COALESCE(MAX(position), -1) + 1 FROM dept_members WHERE org_id = ?org AND dept_id = ?1))", id, uid);
    t.audit({ action: "staff.person_add", what_cs: `přidal(a) do personálu: ${d.name}, ${staffName(p)}`, target_type: "user", target_id: uid });
    await t.commit();
    return answer(c, { id: uid }, await staffState(c));
  })
  .patch("/staff/people/:id", async (c) => {
    label(c, "personál: úprava osoby");
    assertCan(actorOf(c), "staff.write");
    const id = c.req.param("id");
    const staff = await work(c).staff();
    // Only someone on this org's list: a person of another org reads as missing.
    const u = staff.users.find((x) => x.id === id && x.active === 1);
    if (!u) throw D.personNotFound();
    const b = c.var.body;
    const next = renamePerson(u, b.field, b.value, b.expected, staff.users);
    const f = b.field as "pre" | "sur" | "post" | "fn";
    const before = staffName(u);
    const after = staffName(next);
    const t = tx(c);
    const at = isoNow();
    t.guard("member", MEMBER_HERE, [id], () => D.staffChanged());
    if (f === "fn") {
      // The function is the membership's: the same person may have another one in another org.
      t.guard("unchanged", "(SELECT fn FROM memberships WHERE org_id = ?org AND user_id = ?) = ?", [id, u.fn], () => D.staffChanged());
      t.run("UPDATE memberships SET fn = ?1 WHERE org_id = ?org AND user_id = ?2", next.fn, id);
    } else {
      t.guard("unchanged", `(SELECT ${f} FROM users WHERE id = ?) = ?`, [id, u[f]], () => D.staffChanged());
      t.run(`UPDATE users SET ${f} = ?1 WHERE id = ?2`, next[f], id);
    }
    if (before !== after) {
      // Open assignments in this org follow the person; history rows keep the name they stored.
      t.run("UPDATE tasks SET assignee_name = ?1 WHERE org_id = ?org AND assignee_user_id = ?2 AND done = 0", after, id);
      t.run("UPDATE task_suggestions SET who = ?1 WHERE org_id = ?org AND who = ?2 AND state = 'draft'", after, before);
      t.run("UPDATE attendance SET user_name = ?1 WHERE org_id = ?org AND user_id = ?2", after, id);
      const drafts = await orgQuery(c, "SELECT case_id, steps_json, version FROM protocols WHERE org_id = ?org AND state = 'draft' AND instr(steps_json, ?1) > 0", before).all<{
        case_id: string;
        steps_json: string;
        version: number;
      }>();
      for (const p of drafts.results) {
        const steps = (JSON.parse(p.steps_json) as { who: string }[]).map((s) => (s.who === before ? { ...s, who: after } : s));
        // The steps were read above; a doctor's autosave since then must not be overwritten.
        t.guard("draft_unchanged", "EXISTS (SELECT 1 FROM protocols WHERE org_id = ?org AND case_id = ? AND version = ?)", [p.case_id, p.version], () => D.staffChanged());
        t.run("UPDATE protocols SET steps_json = ?1, version = version + 1, updated_at = ?2 WHERE org_id = ?org AND case_id = ?3 AND state = 'draft'", JSON.stringify(steps), at, p.case_id);
      }
    }
    const dept = staff.depts.find((d) => d.people.some((p) => p.id === id))?.name ?? "";
    t.audit({
      action: "staff.person_edit",
      what_cs: f === "fn" ? `změnil(a) funkci v personálu: ${dept}, ${after}: ${next.fn || "bez funkce"}` : `přejmenoval(a) v personálu: ${dept}, ${before} -> ${after}`,
      target_type: "user",
      target_id: id,
    });
    await t.commit();
    return answer(c, {}, await staffState(c));
  })
  .delete("/staff/people/:id", async (c) => {
    label(c, "personál: odebrání osoby");
    assertCan(actorOf(c), "staff.write");
    const id = c.req.param("id");
    const staff = await work(c).staff();
    const u = staff.users.find((x) => x.id === id && x.active === 1);
    if (!u) throw D.personNotFound();
    removePerson(u, c.var.viewer.id);
    const dept = staff.depts.find((d) => d.people.some((p) => p.id === id))?.name ?? "";
    const t = tx(c);
    const at = isoNow();
    t.guard("active", MEMBER_HERE, [id], () => D.staffChanged());
    // The membership ends; the person stays (they may belong to another org) and history keeps pointing at them.
    t.run("UPDATE memberships SET active_until = ?1 WHERE org_id = ?org AND user_id = ?2 AND active_until IS NULL", at, id);
    t.run("DELETE FROM dept_members WHERE org_id = ?org AND user_id = ?1", id);
    dropFromAttendance(t, id, c.var.viewer.id, at);
    t.audit({ action: "staff.person_remove", what_cs: `odebral(a) z personálu: ${dept}, ${staffName(u)}`, target_type: "user", target_id: id });
    await t.commit();
    return answer(c, {}, await staffState(c));
  })
  .post("/staff/reset", async (c) => {
    label(c, "personál: výchozí seznam");
    assertCan(actorOf(c), "staff.write");
    // Each demo org has its own fictional default list; a hospital org has none to go back to.
    const defaults = STAFF_DEFAULTS[c.var.viewer.org];
    if (!defaults) throw D.resetDisabled();
    const staff = await work(c).staff();
    const defaultIds = new Set(defaults.depts.flatMap((d) => d.people.map((p) => p.id)));
    const extra = staff.users.filter((u) => u.active === 1 && (u.role === "doctor" || u.role === "staff") && !defaultIds.has(u.id));
    // A person outside the defaults with open tasks cannot silently leave; the full reset-demo is the tool then.
    if (extra.length) {
      const busy = await orgQuery(c, "SELECT 1 AS x FROM tasks WHERE org_id = ?org AND done = 0 AND assignee_user_id IN (SELECT value FROM json_each(?1)) LIMIT 1", JSON.stringify(extra.map((u) => u.id))).first();
      if (busy) throw D.staffInUse();
    }
    const t = tx(c);
    const at = isoNow();
    for (const u of extra) {
      t.run("UPDATE memberships SET active_until = ?1 WHERE org_id = ?org AND user_id = ?2 AND active_until IS NULL", at, u.id);
      t.run("DELETE FROM dept_members WHERE org_id = ?org AND user_id = ?1", u.id);
      dropFromAttendance(t, u.id, c.var.viewer.id, at);
    }
    // A few statements whatever the list's size (json_each), so the batch stays small. Every upsert updates a row only
    // when it is this org's: an id that belongs to another org is left alone.
    const depts = defaults.depts.map((d) => ({ id: d.id, name: d.name, sort: d.sort }));
    const people = defaults.depts.flatMap((d) => d.people.map((p) => ({ ...p, dept: d.id })));
    const coord = defaults.coordinator;
    t.run(
      `INSERT INTO departments (org_id, id, name, sort) SELECT ?org, json_extract(value, '$.id'), json_extract(value, '$.name'), json_extract(value, '$.sort')
       FROM json_each(?1) WHERE true ON CONFLICT(id) DO UPDATE SET name = excluded.name, sort = excluded.sort WHERE departments.org_id = excluded.org_id`,
      JSON.stringify(depts),
    );
    // The default people are this org's own (their ids carry the org's prefix), so their names are restored too.
    t.run(
      `INSERT INTO users (id, pre, sur, post, active) SELECT json_extract(value, '$.id'), json_extract(value, '$.pre'), json_extract(value, '$.sur'), '', 1
       FROM json_each(?1) WHERE true ON CONFLICT(id) DO UPDATE SET pre = excluded.pre, sur = excluded.sur, post = '', active = 1
       WHERE EXISTS (SELECT 1 FROM memberships m WHERE m.org_id = ?org AND m.user_id = users.id)`,
      JSON.stringify(people),
    );
    t.run(
      `INSERT INTO memberships (id, org_id, user_id, role_id, fn, active_from) SELECT json_extract(value, '$.id'), ?org, json_extract(value, '$.id'), 'doctor', '', ?2
       FROM json_each(?1) WHERE true ON CONFLICT(id) DO UPDATE SET role_id = 'doctor', fn = '', active_until = NULL WHERE memberships.org_id = excluded.org_id`,
      JSON.stringify(people),
      at,
    );
    t.run(
      `INSERT INTO dept_members (org_id, dept_id, user_id, position) SELECT ?org, json_extract(value, '$.dept'), json_extract(value, '$.id'), json_extract(value, '$.position')
       FROM json_each(?1) WHERE true ON CONFLICT(org_id, dept_id, user_id) DO UPDATE SET position = excluded.position`,
      JSON.stringify(people),
    );
    t.run(
      "UPDATE users SET pre = ?1, sur = ?2, post = ?3 WHERE id = ?4 AND EXISTS (SELECT 1 FROM memberships m WHERE m.org_id = ?org AND m.user_id = users.id)",
      coord.pre, coord.sur, coord.post, coord.id,
    );
    t.run("UPDATE memberships SET fn = ?1 WHERE org_id = ?org AND user_id = ?2", coord.fn, coord.id);
    // Departments outside the defaults go when nobody is left in them and no attendance names them.
    t.run(
      `DELETE FROM case_members WHERE org_id = ?org AND dept_id IN (SELECT id FROM departments WHERE org_id = ?org AND id NOT IN (SELECT value FROM json_each(?1))
         AND NOT EXISTS (SELECT 1 FROM dept_members WHERE org_id = ?org AND dept_id = departments.id) AND NOT EXISTS (SELECT 1 FROM attendance WHERE org_id = ?org AND dept_id = departments.id))`,
      JSON.stringify(defaults.depts.map((d) => d.id)),
    );
    t.run(
      `DELETE FROM departments WHERE org_id = ?org AND id NOT IN (SELECT value FROM json_each(?1))
         AND NOT EXISTS (SELECT 1 FROM dept_members WHERE org_id = ?org AND dept_id = departments.id) AND NOT EXISTS (SELECT 1 FROM attendance WHERE org_id = ?org AND dept_id = departments.id)`,
      JSON.stringify(defaults.depts.map((d) => d.id)),
    );
    t.audit({ action: "staff.reset", what_cs: "obnovil(a) výchozí personál (smyšlená jména)" });
    await t.commit();
    return answer(c, {}, await staffState(c));
  });
