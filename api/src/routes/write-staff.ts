// Staff list writes (Personál pracoviště): coordinator and administrator. People are soft-deleted, so history rows that
// stored a name keep it; a rename follows the person's open tasks, drafted tasks and draft steps.
import { Hono } from "hono";
import type { Context } from "hono";
import type { AppEnv } from "../types";
import { D } from "../domain/errors";
import { assertCan } from "../domain/roles";
import { removePerson, renamePerson, validateDeptName, validatePerson, DEFAULT_STAFF, DEFAULT_COORDINATOR } from "../domain/staff";
import { staffName } from "../domain/rows";
import type { Tx } from "../store/write";
import { actorOf, answer, isoNow, label, newId, tx, work } from "./write-context";

async function staffState(c: Context<AppEnv>) {
  const s = await c.var.stores.dir.staff();
  return { staff: { ...s, seq: 0, source: "server" } };
}

const shortId = () => newId().replace(/-/g, "").slice(0, 8);

// A person leaving the list also leaves every attendance set; decisions keep their frozen copy.
function dropFromAttendance(t: Tx, userId: string, by: string, at: string) {
  t.run(
    `UPDATE attendance_sets SET version = version + 1, updated_by = ?2, updated_at = ?3
     WHERE set_key IN (SELECT DISTINCT set_key FROM attendance WHERE user_id = ?1)`,
    userId, by, at,
  );
  t.run("DELETE FROM attendance WHERE user_id = ?1", userId);
}

export const writeStaff = new Hono<AppEnv>()
  .post("/staff/departments", async (c) => {
    label(c, "personál: nové pracoviště");
    assertCan(actorOf(c), "staff.write");
    const w = work(c);
    const staff = await w.staff();
    const name = validateDeptName(c.var.body.name, staff.depts);
    const t = tx(c);
    t.guard("name_free", "NOT EXISTS (SELECT 1 FROM departments WHERE lower(name) = lower(?))", [name], () => D.deptNameTaken(name));
    t.run("INSERT INTO departments (id, name, sort) VALUES (?1, ?2, (SELECT COALESCE(MAX(sort), 0) + 1 FROM departments))", `d${shortId()}`, name);
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
    t.guard("empty", "NOT EXISTS (SELECT 1 FROM dept_members dm JOIN users u ON u.id = dm.user_id WHERE dm.dept_id = ? AND u.active = 1)", [id], () => D.deptNotEmpty());
    // Attendance rows of a department are history of who sat there; a department that has any stays.
    t.guard("no_attendance", "NOT EXISTS (SELECT 1 FROM attendance WHERE dept_id = ?)", [id], () => D.deptNotEmpty());
    t.run("DELETE FROM case_members WHERE dept_id = ?1", id);
    t.run("DELETE FROM dept_members WHERE dept_id = ?1", id);
    t.run("DELETE FROM departments WHERE id = ?1", id);
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
    const t = tx(c);
    t.run("INSERT INTO users (id, pre, sur, post, fn, role_id, active) VALUES (?1, ?2, ?3, ?4, ?5, ?6, 1)", uid, p.pre, p.sur, p.post, p.fn, p.role);
    t.run("INSERT INTO dept_members (dept_id, user_id, position) VALUES (?1, ?2, (SELECT COALESCE(MAX(position), -1) + 1 FROM dept_members WHERE dept_id = ?1))", id, uid);
    t.audit({ action: "staff.person_add", what_cs: `přidal(a) do personálu: ${d.name}, ${staffName(p)}`, target_type: "user", target_id: uid });
    await t.commit();
    return answer(c, { id: uid }, await staffState(c));
  })
  .patch("/staff/people/:id", async (c) => {
    label(c, "personál: úprava osoby");
    assertCan(actorOf(c), "staff.write");
    const id = c.req.param("id");
    const staff = await work(c).staff();
    const u = staff.users.find((x) => x.id === id && x.active === 1);
    if (!u) throw D.personNotFound();
    const b = c.var.body;
    const next = renamePerson(u, b.field, b.value, b.expected, staff.users);
    const f = b.field as "pre" | "sur" | "post" | "fn";
    const before = staffName(u);
    const after = staffName(next);
    const t = tx(c);
    const at = isoNow();
    t.guard("unchanged", `(SELECT ${f} FROM users WHERE id = ?) = ?`, [id, u[f]], () => D.staffChanged());
    t.run(`UPDATE users SET ${f} = ?1 WHERE id = ?2`, next[f], id);
    if (before !== after) {
      // Open assignments follow the person; history rows keep the name they stored.
      t.run("UPDATE tasks SET assignee_name = ?1 WHERE assignee_user_id = ?2 AND done = 0", after, id);
      t.run("UPDATE task_suggestions SET who = ?1 WHERE who = ?2 AND state = 'draft'", after, before);
      t.run("UPDATE attendance SET user_name = ?1 WHERE user_id = ?2", after, id);
      const drafts = await c.env.DB.prepare("SELECT case_id, steps_json FROM protocols WHERE state = 'draft' AND instr(steps_json, ?1) > 0").bind(before).all<{ case_id: string; steps_json: string }>();
      for (const p of drafts.results) {
        const steps = (JSON.parse(p.steps_json) as { who: string }[]).map((s) => (s.who === before ? { ...s, who: after } : s));
        t.run("UPDATE protocols SET steps_json = ?1, version = version + 1, updated_at = ?2 WHERE case_id = ?3 AND state = 'draft'", JSON.stringify(steps), at, p.case_id);
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
    t.guard("active", "(SELECT active FROM users WHERE id = ?) = 1", [id], () => D.staffChanged());
    t.run("UPDATE users SET active = 0 WHERE id = ?1", id);
    t.run("DELETE FROM dept_members WHERE user_id = ?1", id);
    dropFromAttendance(t, id, c.var.viewer.id, at);
    t.audit({ action: "staff.person_remove", what_cs: `odebral(a) z personálu: ${dept}, ${staffName(u)}`, target_type: "user", target_id: id });
    await t.commit();
    return answer(c, {}, await staffState(c));
  })
  .post("/staff/reset", async (c) => {
    label(c, "personál: výchozí seznam");
    assertCan(actorOf(c), "staff.write");
    const staff = await work(c).staff();
    const defaultIds = new Set(DEFAULT_STAFF.flatMap((d) => d.people.map((p) => p.id)));
    const extra = staff.users.filter((u) => u.active === 1 && (u.role === "doctor" || u.role === "staff") && !defaultIds.has(u.id));
    // A person outside the defaults with open tasks cannot silently leave; the full reset-demo is the tool then.
    if (extra.length) {
      const busy = await c.env.DB.prepare("SELECT 1 AS x FROM tasks WHERE done = 0 AND assignee_user_id IN (SELECT value FROM json_each(?1)) LIMIT 1").bind(JSON.stringify(extra.map((u) => u.id))).first();
      if (busy) throw D.staffInUse();
    }
    const t = tx(c);
    const at = isoNow();
    for (const u of extra) {
      t.run("UPDATE users SET active = 0 WHERE id = ?1", u.id);
      t.run("DELETE FROM dept_members WHERE user_id = ?1", u.id);
      dropFromAttendance(t, u.id, c.var.viewer.id, at);
    }
    // Three statements whatever the list's size (json_each), so the batch stays small.
    const depts = DEFAULT_STAFF.map((d) => ({ id: d.id, name: d.name, sort: d.sort }));
    const people = DEFAULT_STAFF.flatMap((d) => d.people.map((p) => ({ ...p, dept: d.id })));
    t.run(
      `INSERT INTO departments (id, name, sort) SELECT json_extract(value, '$.id'), json_extract(value, '$.name'), json_extract(value, '$.sort')
       FROM json_each(?1) WHERE true ON CONFLICT(id) DO UPDATE SET name = excluded.name, sort = excluded.sort`,
      JSON.stringify(depts),
    );
    t.run(
      `INSERT INTO users (id, pre, sur, post, fn, role_id, active) SELECT json_extract(value, '$.id'), json_extract(value, '$.pre'),
         json_extract(value, '$.sur'), '', '', 'doctor', 1 FROM json_each(?1) WHERE true
       ON CONFLICT(id) DO UPDATE SET pre = excluded.pre, sur = excluded.sur, post = '', fn = '', role_id = 'doctor', active = 1`,
      JSON.stringify(people),
    );
    t.run(
      `INSERT INTO dept_members (dept_id, user_id, position) SELECT json_extract(value, '$.dept'), json_extract(value, '$.id'), json_extract(value, '$.position')
       FROM json_each(?1) WHERE true ON CONFLICT(dept_id, user_id) DO UPDATE SET position = excluded.position`,
      JSON.stringify(people),
    );
    t.run("UPDATE users SET pre = ?1, sur = ?2, post = ?3, fn = ?4 WHERE id = ?5", DEFAULT_COORDINATOR.pre, DEFAULT_COORDINATOR.sur, DEFAULT_COORDINATOR.post, DEFAULT_COORDINATOR.fn, DEFAULT_COORDINATOR.id);
    // Departments outside the defaults go when nobody is left in them and no attendance names them.
    t.run(
      `DELETE FROM case_members WHERE dept_id IN (SELECT id FROM departments WHERE id NOT IN (SELECT value FROM json_each(?1))
         AND NOT EXISTS (SELECT 1 FROM dept_members WHERE dept_id = departments.id) AND NOT EXISTS (SELECT 1 FROM attendance WHERE dept_id = departments.id))`,
      JSON.stringify(DEFAULT_STAFF.map((d) => d.id)),
    );
    t.run(
      `DELETE FROM departments WHERE id NOT IN (SELECT value FROM json_each(?1))
         AND NOT EXISTS (SELECT 1 FROM dept_members WHERE dept_id = departments.id) AND NOT EXISTS (SELECT 1 FROM attendance WHERE dept_id = departments.id)`,
      JSON.stringify(DEFAULT_STAFF.map((d) => d.id)),
    );
    t.audit({ action: "staff.reset", what_cs: "obnovil(a) výchozí personál (smyšlená jména)" });
    await t.commit();
    return answer(c, {}, await staffState(c));
  });
