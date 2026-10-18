// The workflow read the page applies at startup, view events for the access log, and the writes that are not about a
// single case's record: tasks and drafted tasks, the coordinator digest, MDT sessions and attendance, and new cases.
import { Hono } from "hono";
import type { AppEnv } from "../types";
import { E } from "../http/errors";
import { D, DomainError } from "@codebridge/domain/errors";
import { canReadCaseHeader, listsAllCases } from "@codebridge/domain/access";
import { allowed, assertCan } from "@codebridge/domain/roles";
import { VIEW_EVENTS } from "../domain/audit";
import { setDone } from "../domain/tasks";
import { confirmTask, editSuggestion, type SuggestionRow } from "../domain/suggestions";
import { endSession, startSession } from "../domain/sessions";
import { setAttendance, validSetKey } from "../domain/attendance";
import { duplicateDecision, intakeCaseId, normalizeRc, samePerson, validateReferral } from "../domain/intake";
import { DIGEST_MIN_INTERVAL_S, NEW_CASE_MEMBERS } from "@codebridge/domain/config";
import { patientRow } from "../domain/rows";
import { IdempotentReplay } from "../store/write";
import { taskOut } from "../store/work";
import { audit } from "../middleware/audit";
import { modeOf, openCase } from "./access-check";
import { actorOf, answer, caseFor, isoNow, label, newId, now, statesFor, tx, work } from "./write-context";
import { bodySha, replayIdempotent, todayPrague } from "./write-cases";
import { hooks } from "./hooks";

// The cases a viewer may read: every case for the coordinator and the administrator; the team's cases and the cases
// with a valid break-the-glass grant for a doctor.
async function visibleCaseIds(c: import("hono").Context<AppEnv>): Promise<string[]> {
  const v = c.var.viewer;
  if (listsAllCases(v)) {
    // An open intake (step 6) is its creator's draft, not yet a case of the MDT.
    const r = await c.env.DB.prepare("SELECT id FROM cases WHERE intake_open = 0 ORDER BY list_order").all<{ id: string }>();
    return r.results.map((x) => x.id);
  }
  const r = await c.env.DB.prepare(
    `SELECT c.id FROM cases c WHERE c.intake_open = 0 AND (EXISTS (SELECT 1 FROM case_members m WHERE m.case_id = c.id AND (m.user_id = ?1
       OR m.dept_id IN (SELECT dm.dept_id FROM dept_members dm WHERE dm.user_id = ?1)))
     OR EXISTS (SELECT 1 FROM case_access_grants g WHERE g.case_id = c.id AND g.user_id = ?1 AND g.expires_at > ?2)
     ) ORDER BY c.list_order`,
  )
    .bind(v.id, now().toISOString())
    .all<{ id: string }>();
  return r.results.map((x) => x.id);
}

export const writeWork = new Hono<AppEnv>()
  .get("/workflow", async (c) => {
    const ids = await visibleCaseIds(c);
    // The workflow holds conclusions and report snapshots: header-level content, so the header rule applies per case
    // (in doctors_only mode the administrator gets none). One row names every case it covered.
    if (!ids.length || canReadCaseHeader(c.var.viewer, true, modeOf(c)) !== "ok") return c.json({ data_epoch: (await work(c).epoch())?.data_epoch ?? null, cases: {}, att: {}, sessions: [], mails: [] });
    await audit(c, { action: "workflow.view", what_cs: `načetl(a) stav projednání (${ids.length} případů)`, target_type: "cases", target_id: ids.join(",") });
    const w = work(c);
    const st = await w.epoch();
    const [cases, att, sessions, mails] = await Promise.all([statesFor(c, ids), w.attSets(), w.sessions(), w.mails(ids)]);
    return c.json({ data_epoch: st?.data_epoch ?? null, cases, att, sessions, mails });
  })

  // ---------- view events ----------
  .post("/audit/events", async (c) => {
    label(c, "záznam zobrazení");
    const b = c.var.body;
    const ev = typeof b.code === "string" ? VIEW_EVENTS[b.code] : undefined;
    if (!ev) throw D.invalidInput({ fields: { code: "Neznámý kód události." } });
    const target = b.target === undefined || b.target === null ? null : Number(b.target);
    if (target !== null && (!Number.isInteger(target) || target < 0 || target > 10_000)) throw D.invalidInput({ fields: { target: "Neplatný cíl." } });
    let caseId: string | null = null;
    if (ev.caseScoped) {
      if (typeof b.case_id !== "string") throw D.invalidInput({ fields: { case_id: "Chybí případ." } });
      // The viewer must be allowed to read the case; a refusal is answered and logged like any other.
      await openCase(c, b.case_id, "header");
      caseId = b.case_id;
    }
    await audit(c, { action: `view.${b.code}`, what_cs: ev.what(target), case_id: caseId });
    return answer(c, {});
  })

  // ---------- tasks ----------
  .patch("/tasks/:id", async (c) => {
    const tid = Number(c.req.param("id"));
    const t0 = Number.isInteger(tid) ? await c.env.DB.prepare("SELECT id, case_id, done, assignee_user_id FROM tasks WHERE id = ?1").bind(tid).first<{ id: number; case_id: string; done: number; assignee_user_id: string | null }>() : null;
    label(c, "úloha hotovo", t0?.case_id ?? null);
    if (!t0) throw D.taskNotFound();
    const { breakGlass, access } = await caseFor(c, t0.case_id, "task.done", { assignee: t0.assignee_user_id === c.var.viewer.id });
    // An assignee without a role on the case closes the task but gets back the task only, not the case.
    const fullAccess = allowed(actorOf(c), "task.done", { member: access.member, grant: access.grant });
    const b = c.var.body;
    const done = setDone(t0.done === 1, b.done, b.expected_done);
    const t = tx(c, breakGlass);
    const v = c.var.viewer;
    t.guard("done", "(SELECT done FROM tasks WHERE id = ?) = ?", [tid, t0.done], () => D.taskChanged());
    t.run(
      "UPDATE tasks SET done = ?1, done_by = ?2, done_by_name = ?3, done_at = ?4 WHERE id = ?5",
      done ? 1 : 0, done ? v.id : null, done ? v.name : null, done ? isoNow() : null, tid,
    );
    t.audit({ action: "task.done", what_cs: done ? "označil(a) úlohu jako hotovou" : "vrátil(a) úlohu mezi otevřené", case_id: t0.case_id, target_type: "task", target_id: String(tid) });
    await t.commit();
    if (!fullAccess) {
      const row = await c.env.DB.prepare("SELECT t.*, c.source_file FROM tasks t JOIN cases c ON c.id = t.case_id WHERE t.id = ?1").bind(tid).first<Record<string, unknown>>();
      return answer(c, { task: row ? taskOut(row) : null });
    }
    return answer(c, {}, { cases: await statesFor(c, [t0.case_id]) });
  })

  // ---------- drafted tasks ----------
  .patch("/suggestions/:id", async (c) => suggestionRoute(c, "edit"))
  .post("/suggestions/:id/confirm", async (c) => suggestionRoute(c, "confirm"))
  .post("/suggestions/:id/dismiss", async (c) => suggestionRoute(c, "dismiss"))

  // ---------- coordinator digest (outbox row only) ----------
  .post("/notifications/digest", async (c) => {
    label(c, "přehled úloh e-mailem");
    assertCan(actorOf(c), "digest.send");
    const v = c.var.viewer;
    const since = new Date(now().getTime() - DIGEST_MIN_INTERVAL_S * 1000).toISOString();
    if (await c.env.DB.prepare("SELECT 1 AS x FROM notifications WHERE kind = 'digest' AND created_by = ?1 AND created_at > ?2").bind(v.id, since).first()) throw D.digestTooSoon();
    const ids = await visibleCaseIds(c);
    const j = JSON.stringify(ids);
    const n = await c.env.DB.prepare(
      `SELECT (SELECT COUNT(*) FROM tasks WHERE done = 0 AND case_id IN (SELECT value FROM json_each(?1)))
            + (SELECT COUNT(*) FROM task_suggestions WHERE state = 'draft' AND case_id IN (SELECT value FROM json_each(?1))) AS n`,
    )
      .bind(j)
      .first<{ n: number }>();
    const coord = (await work(c).staff()).coordinator;
    const t = tx(c);
    // Only a count and the link: an e-mail never carries medical data (CLAUDE.md, notifications).
    t.run(
      "INSERT INTO notifications (id, kind, to_user_id, case_id, count, link, created_by, created_by_name, created_at) VALUES (?1, 'digest', ?2, NULL, ?3, '/', ?4, ?5, ?6)",
      newId(), coord?.id ?? null, n?.n ?? 0, v.id, v.name, isoNow(),
    );
    t.audit({ action: "digest.send", what_cs: `odeslal(a) přehled úloh e-mailem (${n?.n ?? 0})` });
    await t.commit();
    return answer(c, { n: n?.n ?? 0 }, { mails: await work(c).mails(ids) });
  })

  // ---------- MDT sessions ----------
  .post("/sessions", async (c) => {
    label(c, "zahájení MDT");
    assertCan(actorOf(c), "session.write");
    const b = c.var.body;
    const day = typeof b.day === "string" ? b.day : "";
    const [booked, open] = await Promise.all([
      c.env.DB.prepare("SELECT case_id FROM slots WHERE day = ?1 ORDER BY time").bind(day).all<{ case_id: string }>(),
      c.env.DB.prepare("SELECT day, ended_at FROM sessions WHERE day = ?1").bind(day).first<{ day: string; ended_at: string | null }>(),
    ]);
    startSession(b.day, booked.results.length, open);
    const t = tx(c);
    const v = c.var.viewer;
    const at = isoNow();
    t.guard("booked", "EXISTS (SELECT 1 FROM slots WHERE day = ?)", [day], () => D.noCasesThatDay());
    t.guard("not_running", "NOT EXISTS (SELECT 1 FROM sessions WHERE day = ? AND ended_at IS NULL)", [day], () => D.sessionRunning());
    // A day's session can be ended and started again; the row is reused.
    t.run(
      `INSERT INTO sessions (day, started_by, started_by_name, started_at, ended_at) VALUES (?1, ?2, ?3, ?4, NULL)
       ON CONFLICT(day) DO UPDATE SET started_by = ?2, started_by_name = ?3, started_at = ?4, ended_at = NULL`,
      day, v.id, v.name, at,
    );
    t.audit({ action: "session.start", what_cs: "zahájil(a) MDT", case_id: booked.results[0]!.case_id });
    await t.commit();
    return answer(c, {}, { sessions: await work(c).sessions() });
  })
  .delete("/sessions/:day", async (c) => {
    label(c, "ukončení MDT");
    assertCan(actorOf(c), "session.write");
    const day = c.req.param("day");
    const open = await c.env.DB.prepare("SELECT day, ended_at FROM sessions WHERE day = ?1").bind(day).first<{ day: string; ended_at: string | null }>();
    endSession(open);
    const first = await c.env.DB.prepare("SELECT case_id FROM slots WHERE day = ?1 ORDER BY time LIMIT 1").bind(day).first<{ case_id: string }>();
    const t = tx(c);
    t.guard("running", "EXISTS (SELECT 1 FROM sessions WHERE day = ? AND ended_at IS NULL)", [day], () => D.sessionNotFound());
    t.run("UPDATE sessions SET ended_at = ?1 WHERE day = ?2", isoNow(), day);
    t.audit({ action: "session.end", what_cs: "ukončil(a) MDT", case_id: first?.case_id ?? null });
    await t.commit();
    await hooks.onSessionEnded(c, day);
    return answer(c, {}, { sessions: await work(c).sessions() });
  })

  // ---------- attendance ----------
  .put("/attendance/:key", async (c) => {
    const key = c.req.param("key");
    const caseId = key.startsWith("case:") ? key.slice(5) : null;
    label(c, "úprava přítomných");
    // The key is checked before it names anything in the log, so typed text never reaches the access log.
    if (!validSetKey(key)) throw D.invalidInput({ fields: { key: "Neplatný den nebo případ." } });
    // An open intake (step 6) has no attendance and is not there for anyone else.
    if (caseId && !((await work(c).caseCore(caseId))?.intake_open === 0)) throw D.caseNotFound();
    label(c, "úprava přítomných", caseId);
    assertCan(actorOf(c), "session.write");
    // A case's own attendance is part of that case: a doctor needs to be on its team (or hold a grant).
    if (caseId && c.var.viewer.role === "doctor") await caseFor(c, caseId, "status.move");
    const w = work(c);
    const [att, staff] = await Promise.all([w.attendance(key), w.staff()]);
    const b = c.var.body;
    let rows;
    try {
      rows = setAttendance(b.by_dept, staff.depts, b.version, att.version);
    } catch (e) {
      if (e instanceof DomainError && e.code === "attendance_conflict") throw D.attendanceConflict((await w.attSets([key]))[key]);
      throw e;
    }
    const t = tx(c);
    const v = c.var.viewer;
    const at = isoNow();
    t.guard("version", "COALESCE((SELECT version FROM attendance_sets WHERE set_key = ?), 0) = ?", [key, att.version], () => D.attendanceConflict());
    t.run("DELETE FROM attendance WHERE set_key = ?1", key);
    if (rows.length)
      t.run(
        `INSERT INTO attendance (set_key, dept_id, position, user_id, user_name)
         SELECT ?1, json_extract(value, '$.d'), json_extract(value, '$.p'), json_extract(value, '$.u'), json_extract(value, '$.n') FROM json_each(?2)`,
        key, JSON.stringify(rows.map((r) => ({ d: r.dept_id, p: r.position, u: r.user_id, n: r.user_name }))),
      );
    t.run(
      `INSERT INTO attendance_sets (set_key, version, updated_by, updated_at) VALUES (?1, 1, ?2, ?3)
       ON CONFLICT(set_key) DO UPDATE SET version = version + 1, updated_by = ?2, updated_at = ?3`,
      key, v.id, at,
    );
    t.audit({ action: "attendance.set", what_cs: `upravil(a) přítomné na MDT (${rows.length})`, case_id: caseId });
    try {
      await t.commit();
    } catch (e) {
      if (e instanceof DomainError && e.code === "attendance_conflict") throw D.attendanceConflict((await w.attSets([key]))[key]);
      throw e;
    }
    return answer(c, {}, { att: await w.attSets([key]) });
  })

  // ---------- new case ----------
  .post("/cases", async (c) => {
    label(c, "založení případu");
    assertCan(actorOf(c), "case.create");
    const key = c.req.header("idempotency-key") || "";
    if (!/^[A-Za-z0-9-]{8,80}$/.test(key)) throw E.idempotencyKeyRequired();
    const sha = await bodySha(c.var.body);
    const replay = await replayIdempotent(c, key, "create_case", sha);
    if (replay) return replay;
    const b = c.var.body;
    const ref = validateReferral(b);
    const rcN = normalizeRc(ref.birth_number);
    const existing = (
      await c.env.DB.prepare(
        // An open intake (step 6) is its creator's draft, not a record yet: it neither counts nor gets named.
        "SELECT c.id AS case_id, c.source_file AS file FROM patients p JOIN cases c ON c.patient_id = p.id WHERE replace(p.birth_number, '/', '') = ?1 AND c.intake_open = 0 ORDER BY c.list_order",
      )
        .bind(rcN)
        .all<{ case_id: string; file: string }>()
    ).results;
    let override: { reason: string | null } | null;
    try {
      override = duplicateDecision(ref.birth_number, existing, b.duplicate_override);
    } catch (e) {
      // The "Otevřít" link names the existing case only to someone who may open it; others learn that a record exists.
      if (e instanceof DomainError && e.code === "duplicate_birth_number") throw D.duplicateBirthNumber(await visibleDuplicate(c, existing));
      throw e;
    }
    // Step 6: "Nový pacient" opens the case for intake; its documents are uploaded to it before it is listed. When the
    // referral names a fixture patient, the case gets the fixture's ID (cosmetic: the attach checks documents and
    // identity again at completion).
    const intake = b.intake === true;
    const referralSha = typeof b.referral_sha256 === "string" && /^[0-9a-f]{64}$/.test(b.referral_sha256) ? b.referral_sha256 : null;
    let fixtureId: string | null = null;
    let fixtureTaken = false;
    if (intake) {
      const fps = (
        await c.env.DB.prepare(
          `SELECT p.fixture_id, p.full_name, p.birth_number FROM fixture_patients p WHERE replace(p.birth_number, '/', '') = ?1
             AND EXISTS (SELECT 1 FROM fixture_files f WHERE f.fixture_id = p.fixture_id AND f.kind = 'upload')`,
        )
          .bind(rcN)
          .all<{ fixture_id: string; full_name: string; birth_number: string }>()
      ).results;
      fixtureId = fps.find((fp) => samePerson(fp, { full_name: `${ref.first_name} ${ref.last_name}`, birth_number: ref.birth_number }))?.fixture_id ?? null;
      if (fixtureId)
        fixtureTaken = !!(await c.env.DB.prepare("SELECT 1 AS x FROM cases WHERE id = ?1 OR intake_fixture = ?2").bind(`NO-${fixtureId}`, fixtureId).first());
    }
    const max = await c.env.DB.prepare(
      "SELECT MAX(CAST(substr(id, 4) AS INTEGER)) AS n, MAX(list_order) AS o FROM cases WHERE id GLOB 'NO-[0-9]*'",
    ).first<{ n: number | null; o: number | null }>();
    const lastOrder = (await c.env.DB.prepare("SELECT MAX(list_order) AS o FROM cases").first<{ o: number | null }>())?.o ?? 0;
    const n = Math.max(100, (max?.n ?? 0) + 1);
    const { id, file } = intakeCaseId(fixtureId, fixtureTaken, n);
    const v = c.var.viewer;
    const at = isoNow();
    const day = todayPrague();
    const owner = ref.owner || v.name;
    const staff = await work(c).staff();
    const data = { case_id: id, file, intake };
    const t = tx(c);
    t.idempotency(key, "create_case", sha, data, 200, at);
    // A second record for a known birth number only with the override; re-checked inside the batch.
    if (!override)
      t.guard("no_duplicate", "NOT EXISTS (SELECT 1 FROM patients p JOIN cases c ON c.patient_id = p.id WHERE replace(p.birth_number, '/', '') = ? AND c.intake_open = 0)", [rcN], () => D.duplicateBirthNumber({}));
    t.guard("id_free", "NOT EXISTS (SELECT 1 FROM cases WHERE id = ?)", [id], () => D.conflict());
    t.run(
      "INSERT INTO patients (id, full_name, name_as_written, birth_number, data_origin, created_at) VALUES (?1, ?2, ?3, ?4, 'codebridge_synthetic', ?5)",
      `pt-${id}`, `${ref.first_name} ${ref.last_name}`, `${ref.last_name} ${ref.first_name}`, ref.birth_number, at,
    );
    t.run(
      `INSERT INTO cases (id, patient_id, source_file, list_order, status, processing_level, question_text, question_explicit, question_purpose,
         diagnosis_text, summary_one_line, owner_user_id, owner_name, referring_dept, submitted_on, updated_on, duplicate_override_reason, created_by, created_at,
         intake_open, referral_sha256)
       VALUES (?1, ?2, ?3, ?4, 'new', 'none', ?5, ?6, NULL, ?7, NULL, ?8, ?9, ?10, ?11, ?11, ?12, ?13, ?14, ?15, ?16)`,
      id, `pt-${id}`, file, lastOrder + 1, ref.question, ref.question ? 1 : 0,
      // The documents decide the diagnosis; until a doctor reviews them the list says so instead of guessing.
      "Čeká na kontrolu lékařem", staff.idByName.get(owner) ?? null, owner, ref.dept, day, override?.reason ?? null, v.id, at, intake ? 1 : 0, referralSha,
    );
    if (NEW_CASE_MEMBERS === "all_mdt_departments")
      t.run("INSERT INTO case_members (case_id, dept_id, reason, added_by, added_at) SELECT ?1, id, 'nový případ: oddělení MDT', ?2, ?3 FROM departments", id, v.id, at);
    t.run("INSERT INTO case_members (case_id, user_id, reason, added_by, added_at) VALUES (?1, ?2, 'založil(a) případ', ?2, ?3)", id, v.id, at);
    const ownerId = staff.idByName.get(owner);
    if (ownerId && ownerId !== v.id) t.run("INSERT INTO case_members (case_id, user_id, reason, added_by, added_at) VALUES (?1, ?2, 'odesílající lékař', ?3, ?4)", id, ownerId, v.id, at);
    t.audit({ action: intake ? "intake.start" : "case.create", what_cs: intake ? "založil(a) příjem nového pacienta (rozpracováno, dokumenty se nahrávají)" : "vytvořil(a) případ", case_id: id });
    // A typed reason is staff free text that may name the patient; it stays with the case, the log only says it exists.
    if (override)
      t.audit({ action: "case.duplicate_override", what_cs: `vytvořil(a) nový záznam, přestože rodné číslo už v databázi je${override.reason ? " (důvod uložen u případu)" : ""}`, case_id: id });
    try {
      await t.commit();
    } catch (e) {
      if (e instanceof IdempotentReplay) {
        const r = await replayIdempotent(c, key, "create_case", sha);
        if (r) return r;
      }
      if (e instanceof DomainError && e.code === "duplicate_birth_number") {
        const dup = await c.env.DB.prepare("SELECT c.id AS case_id, c.source_file AS file FROM patients p JOIN cases c ON c.patient_id = p.id WHERE replace(p.birth_number, '/', '') = ?1 AND c.intake_open = 0").bind(rcN).all<{ case_id: string; file: string }>();
        throw D.duplicateBirthNumber(await visibleDuplicate(c, dup.results));
      }
      throw e;
    }
    // An open intake is not listed yet, so the page gets no patient row until the intake completes.
    if (intake) return answer(c, data);
    const row = await c.var.stores.cases.caseById(id);
    return answer(c, data, { patient: row ? patientRow(row, await c.var.stores.cases.statusHistory(id)) : null, cases: await statesFor(c, [id]) });
  });

async function visibleDuplicate(c: import("hono").Context<AppEnv>, existing: { case_id: string; file: string }[]) {
  const v = c.var.viewer;
  for (const x of existing) if (v.role !== "doctor" || (await c.var.stores.cases.isMember(x.case_id, v))) return x;
  return {};
}

async function suggestionRoute(c: import("hono").Context<AppEnv>, kind: "edit" | "confirm" | "dismiss") {
  const sid = Number(c.req.param("id"));
  const s = Number.isInteger(sid) ? await c.env.DB.prepare("SELECT * FROM task_suggestions WHERE id = ?1").bind(sid).first<SuggestionRow>() : null;
  label(c, kind === "edit" ? "úprava návrhu úlohy" : kind === "confirm" ? "potvrzení návrhu úlohy" : "zamítnutí návrhu úlohy", s?.case_id ?? null);
  if (!s) throw D.suggestionNotFound();
  const { breakGlass } = await caseFor(c, s.case_id, "suggestion.decide");
  const v = c.var.viewer;
  const at = isoNow();
  const t = tx(c, breakGlass);
  if (s.state === "superseded") throw D.suggestionSuperseded();
  t.guard("draft", "(SELECT state FROM task_suggestions WHERE id = ?) = 'draft'", [sid], () => D.suggestionDecided(null));
  if (kind === "edit") {
    const staff = await work(c).staff();
    const b = c.var.body;
    const next = editSuggestion(s, b, v.name, staff.activeNames);
    // Only the fields this edit names are written, so a parallel edit of another field is not lost.
    const sets: string[] = [];
    const args: unknown[] = [];
    const set = (col: string, val: unknown) => (args.push(val), sets.push(`${col} = ?${args.length}`));
    if (b.text !== undefined) set("text", next.text);
    if (b.who !== undefined) set("who", next.who);
    if (b.due !== undefined) (set("due", next.due), set("due_source", next.due_source), set("due_by", next.due_by));
    if (!sets.length) throw D.invalidInput();
    args.push(sid);
    t.run(`UPDATE task_suggestions SET ${sets.join(", ")} WHERE id = ?${args.length}`, ...args);
    t.audit({ action: "suggestion.edit", what_cs: "upravil(a) návrh úlohy", case_id: s.case_id, target_type: "suggestion", target_id: String(sid) });
  } else if (kind === "confirm") {
    const task = confirmTask(s, v.name);
    const staff = await work(c).staff();
    const who = task.who || staff.coordinator?.name || "neurčeno";
    // The task keeps where its due date came from, so the label travels with it.
    t.run(
      `INSERT INTO tasks (case_id, text, assignee_user_id, assignee_name, due, due_source, due_by, timing, from_suggestion_id, confirmed_by, created_by, created_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)`,
      s.case_id, task.text, staff.idByName.get(who) ?? null, who, task.due, task.due_source, task.due_by, task.timing, sid, v.name, v.id, at,
    );
    t.run("UPDATE task_suggestions SET state = 'confirmed', decided_by = ?1, decided_by_name = ?2, decided_at = ?3 WHERE id = ?4", v.id, v.name, at, sid);
    t.audit({ action: "suggestion.confirm", what_cs: "potvrdil(a) návrh úlohy", case_id: s.case_id, target_type: "suggestion", target_id: String(sid) });
  } else {
    if (s.state !== "draft") throw D.suggestionDecided(s.decided_by_name);
    t.run("UPDATE task_suggestions SET state = 'dismissed', decided_by = ?1, decided_by_name = ?2, decided_at = ?3 WHERE id = ?4", v.id, v.name, at, sid);
    t.audit({ action: "suggestion.dismiss", what_cs: "zamítl(a) návrh úlohy", case_id: s.case_id, target_type: "suggestion", target_id: String(sid) });
  }
  try {
    await t.commit();
  } catch (e) {
    if (e instanceof DomainError && e.code === "suggestion_decided") {
      const now2 = await c.env.DB.prepare("SELECT state, decided_by_name FROM task_suggestions WHERE id = ?1").bind(sid).first<{ state: string; decided_by_name: string | null }>();
      if (now2?.state === "superseded") throw D.suggestionSuperseded();
      throw D.suggestionDecided(now2?.decided_by_name ?? null);
    }
    throw e;
  }
  return answer(c, {}, { cases: await statesFor(c, [s.case_id]) });
}
