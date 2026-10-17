// Write routes on one case: status and closing, slots, the protocol draft, approval and new version, the drafted
// question, fact edits, alert events and break-the-glass. Each route: role and membership, the domain rule, one
// guarded D1 batch with its audit rows, then the case's fresh workflow state (step-4.md "As implemented").
import { Hono } from "hono";
import type { AppEnv } from "../types";
import { E } from "../http/errors";
import { D, DomainError } from "../domain/errors";
import { moveStatus, statusLine, autoOnNewVersion, type StatusChange } from "../domain/status";
import { releasesOnClose, schedule, slotText, unschedule, validateSlot, type Slot } from "../domain/slots";
import { newDraft, patchProtocol } from "../domain/protocol";
import { approve } from "../domain/approve";
import { confirmDraft } from "../domain/question";
import { saveEdit, revertEdit } from "../domain/edits";
import { ALERT_ACT_CS, ALERT_KIND_CS, alertState, parseAlertKey, transition, type AlertAction } from "../domain/alerts";
import { grant } from "../domain/breakglass";
import { PROTOCOL_AUDIT_WINDOW_MIN } from "../domain/config";
import { pragueDay } from "../domain/time";
import { IdempotentReplay, type Tx } from "../store/write";
import { sha256Hex } from "../store/work";
import { actorOf, answer, caseFor, isoNow, label, newId, now, statesFor, tx, work } from "./write-context";
import { hooks } from "./hooks";
import { patientRow } from "../domain/rows";
import { validateReportHtml } from "../domain/report";

const GAP = "neuvedeno v dostupné dokumentaci";

// The status change and its history row, as the page's setStatus() wrote them.
function writeStatus(t: Tx, caseId: string, ch: StatusChange, by: { id: string; name: string }, at: string) {
  t.run("UPDATE cases SET status = ?1 WHERE id = ?2", ch.to, caseId);
  t.run(
    "INSERT INTO status_history (case_id, from_status, to_status, by_user_id, by_name, how, at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
    caseId, ch.from, ch.to, by.id, by.name, ch.how, at,
  );
  t.audit({ action: "case.status", what_cs: statusLine(ch), case_id: caseId });
}

const slotOf = (core: { slot_day: string | null; slot_time: string | null }): Slot | null =>
  core.slot_day && core.slot_time ? { day: core.slot_day, time: core.slot_time } : null;

const SLOT_UNIQUE = /UNIQUE constraint failed: slots\.day, slots\.time/;

export async function bodySha(body: unknown) {
  return sha256Hex(JSON.stringify(body));
}

export const writeCases = new Hono<AppEnv>()
  // ---------- status, close, reopen ----------
  .post("/cases/:id/status", async (c) => {
    const id = c.req.param("id");
    label(c, "změna stavu případu", id);
    const { core, breakGlass } = await caseFor(c, id, "status.move");
    const w = work(c);
    const b = c.var.body;
    const slot = slotOf(core);
    const ch = moveStatus({ status: core.status, hasSlot: !!slot }, await w.statusHist(id), b.to, b.expected_status);
    const t = tx(c, breakGlass);
    const at = isoNow();
    t.guard("status", "(SELECT status FROM cases WHERE id = ?) = ?", [id, core.status], () => D.statusChanged());
    t.guard("slot", "(SELECT COUNT(*) FROM slots WHERE case_id = ?) = ?", [id, slot ? 1 : 0], () => D.statusChanged());
    writeStatus(t, id, ch, actorOf(c), at);
    let released = false;
    if (ch.to === "closed" && slot && releasesOnClose({ status: core.status, slot }, await w.decisions(id))) {
      // Closing frees a slot that only reserved seminar time; one a decision was made on stays (guarded again here).
      t.guard("slot_unlocked", "NOT EXISTS (SELECT 1 FROM decisions WHERE case_id = ? AND slot_day = ? AND slot_time = ?)", [id, slot.day, slot.time], () => D.slotLocked());
      t.run("DELETE FROM slots WHERE case_id = ?1", id);
      t.audit({ action: "slot.release", what_cs: `uvolnil(a) termín MDT při uzavření případu (${slotText(slot)})`, case_id: id });
      released = true;
    }
    await t.commit();
    if (ch.to === "closed") await hooks.onCaseClosed(id);
    return answer(c, { slot_released: released }, { cases: await statesFor(c, [id]) });
  })

  // ---------- slots ----------
  .put("/cases/:id/slot", async (c) => {
    const id = c.req.param("id");
    label(c, "rezervace termínu MDT", id);
    const { core, breakGlass } = await caseFor(c, id, "slot.write");
    const b = c.var.body;
    const next = validateSlot(b.day, b.time);
    const cur = slotOf(core);
    if (cur && cur.day === next.day && cur.time === next.time) return answer(c, { warning_cs: null }, { cases: await statesFor(c, [id]) });
    const r = schedule({ status: core.status, slot: cur }, next, await work(c).decisions(id));
    const t = tx(c, breakGlass).onConstraint(SLOT_UNIQUE, () => D.slotTaken());
    t.guard("status", "(SELECT status FROM cases WHERE id = ?) = ?", [id, core.status], () => D.statusChanged());
    if (cur) {
      t.guard("slot_same", "EXISTS (SELECT 1 FROM slots WHERE case_id = ? AND day = ? AND time = ?)", [id, cur.day, cur.time], () => D.conflict());
      t.guard("slot_unlocked", "NOT EXISTS (SELECT 1 FROM decisions WHERE case_id = ? AND slot_day = ? AND slot_time = ?)", [id, cur.day, cur.time], () => D.slotLocked());
    } else t.guard("slot_none", "NOT EXISTS (SELECT 1 FROM slots WHERE case_id = ?)", [id], () => D.conflict());
    t.run("DELETE FROM slots WHERE case_id = ?1", id);
    t.run("INSERT INTO slots (day, time, case_id, booked_by, booked_at) VALUES (?1, ?2, ?3, ?4, ?5)", next.day, next.time, id, c.var.viewer.id, isoNow());
    t.audit({ action: "slot.book", what_cs: `naplánoval(a) na MDT (${slotText(next)})`, case_id: id });
    if (r.status) writeStatus(t, id, r.status, actorOf(c), isoNow());
    await t.commit();
    return answer(c, { warning_cs: r.warning }, { cases: await statesFor(c, [id]) });
  })
  .delete("/cases/:id/slot", async (c) => {
    const id = c.req.param("id");
    label(c, "uvolnění termínu MDT", id);
    const { core, breakGlass } = await caseFor(c, id, "slot.write");
    const r = unschedule({ status: core.status, slot: slotOf(core) }, await work(c).decisions(id));
    const t = tx(c, breakGlass);
    t.guard("status", "(SELECT status FROM cases WHERE id = ?) = ?", [id, core.status], () => D.statusChanged());
    t.guard("slot_same", "EXISTS (SELECT 1 FROM slots WHERE case_id = ? AND day = ? AND time = ?)", [id, r.was.day, r.was.time], () => D.conflict());
    t.guard("slot_unlocked", "NOT EXISTS (SELECT 1 FROM decisions WHERE case_id = ? AND slot_day = ? AND slot_time = ?)", [id, r.was.day, r.was.time], () => D.slotLocked());
    t.run("DELETE FROM slots WHERE case_id = ?1", id);
    t.audit({ action: "slot.release", what_cs: `uvolnil(a) termín MDT (${slotText(r.was)})`, case_id: id });
    if (r.status) writeStatus(t, id, r.status, actorOf(c), isoNow());
    await t.commit();
    return answer(c, {}, { cases: await statesFor(c, [id]) });
  })

  // ---------- protocol draft (autosave) ----------
  .put("/cases/:id/protocol", async (c) => {
    const id = c.req.param("id");
    label(c, "úprava konceptu protokolu", id);
    const { core, breakGlass } = await caseFor(c, id, "protocol.edit");
    const w = work(c);
    const b = c.var.body;
    const [p, staff] = await Promise.all([w.protocol(id), w.staff()]);
    const exists = p.exists;
    const next = patchProtocol(p, core.status, { notes: b.notes, concl: b.concl, steps: b.steps }, b.version, staff.activeNames);
    const t = tx(c, breakGlass);
    const at = isoNow();
    const v = c.var.viewer;
    t.guard("open", "(SELECT status FROM cases WHERE id = ?) <> 'closed'", [id], () => D.caseClosedEdit());
    if (exists) {
      t.guard("version", "EXISTS (SELECT 1 FROM protocols WHERE case_id = ? AND version = ? AND state = 'draft')", [id, p.version], () => D.conflict());
      t.run(
        `UPDATE protocols SET notes = ?1, conclusion = ?2, steps_json = ?3, version = version + 1, updated_by = ?4, updated_by_name = ?5, updated_at = ?6
         WHERE case_id = ?7`,
        next.notes, next.conclusion, JSON.stringify(next.steps), v.id, v.name, at, id,
      );
    } else {
      t.guard("version", "NOT EXISTS (SELECT 1 FROM protocols WHERE case_id = ?)", [id], () => D.conflict());
      t.run(
        `INSERT INTO protocols (case_id, notes, conclusion, steps_json, state, version, updated_by, updated_by_name, updated_at)
         VALUES (?1, ?2, ?3, ?4, 'draft', 1, ?5, ?6, ?7)`,
        id, next.notes, next.conclusion, JSON.stringify(next.steps), v.id, v.name, at,
      );
    }
    // Autosave runs while the doctor types; one access-log row per user, case and window is enough to say who edited.
    const since = new Date(now().getTime() - PROTOCOL_AUDIT_WINDOW_MIN * 60_000).toISOString();
    const recent = await c.env.DB.prepare("SELECT 1 AS x FROM access_log WHERE actor_user_id = ?1 AND case_id = ?2 AND action = 'protocol.edit' AND at > ?3 LIMIT 1").bind(v.id, id, since).first();
    if (!recent) t.audit({ action: "protocol.edit", what_cs: "upravil(a) koncept protokolu MDT", case_id: id });
    try {
      await t.commit();
    } catch (e) {
      // A parallel save won: answer with the stored draft and who saved it, so the doctor chooses; nothing is overwritten.
      if (e instanceof DomainError && e.code === "conflict") {
        const cur = await w.protocol(id);
        throw D.protocolConflict(cur.updated_by_name ?? "", cur);
      }
      throw e;
    }
    return answer(c, { version: next.version, updated_at: at, updated_by: v.name });
  })

  // ---------- approval ----------
  .post("/cases/:id/decisions", async (c) => {
    const id = c.req.param("id");
    label(c, "schválení závěru MDT", id);
    const key = c.req.header("idempotency-key") || "";
    if (!/^[A-Za-z0-9-]{8,80}$/.test(key)) throw E.idempotencyKeyRequired();
    const route = `approve:${id}`;
    const sha = await bodySha(c.var.body);
    // Access first: a replayed answer carries the case state, so it is shown only to someone who may still act.
    const { core, breakGlass } = await caseFor(c, id, "decision.approve");
    const replay = await replayIdempotent(c, key, route, sha);
    if (replay) return replay;
    const w = work(c);
    const slot = slotOf(core);
    const setKey = slot ? slot.day : `case:${id}`;
    const [p, decs, att, staff, ident] = await Promise.all([
      w.protocol(id),
      w.decisions(id),
      w.attendance(setKey),
      w.staff(),
      c.env.DB.prepare("SELECT full_name, name_as_written, birth_number FROM patients WHERE id = ?1").bind(core.patient_id).first<{ full_name: string; name_as_written: string | null; birth_number: string | null }>(),
    ]);
    const exists = p.exists;
    // Only the page's own report markup, and no patient identity in it (identity lives in the patients table only).
    const surnameFirst = (n: string) => (n.includes(" ") ? `${n.split(" ").slice(-1)[0]} ${n.split(" ").slice(0, -1).join(" ")}` : n);
    validateReportHtml(String(c.var.body.report_html ?? ""), {
      birthNumber: ident?.birth_number ?? null,
      names: ident ? [ident.full_name, ident.name_as_written ?? "", surnameFirst(ident.full_name)] : [],
    });
    const t0 = now();
    const plan = approve({
      actor: actorOf(c),
      actorDeptId: staff.firstDeptOf(c.var.viewer.id),
      caseStatus: core.status,
      slot,
      protocol: p,
      decisions: decs,
      attendance: att.rows,
      body: c.var.body as never,
      reportSha256: await sha256Hex(String(c.var.body.report_html ?? "")),
      staffIdByName: staff.idByName,
      coordinator: staff.coordinator,
      now: t0,
      newId,
    });
    const at = t0.toISOString();
    const v = c.var.viewer;
    const d = plan.decision;
    const data = { decision_id: d.id, version: d.version, tasks_created: plan.tasks.length, suggestions_created: plan.suggestions.length };
    const t = tx(c, breakGlass);
    t.idempotency(key, route, sha, data, 200, at);
    // Order matters for the refusal the loser of a race sees: another approval first, then a newer draft, then the rest.
    t.guard("no_newer_decision", "NOT EXISTS (SELECT 1 FROM decisions WHERE case_id = ? AND version >= ?)", [id, d.version], () => D.alreadyApproved());
    if (exists) {
      t.guard("protocol_state", "EXISTS (SELECT 1 FROM protocols WHERE case_id = ? AND state = 'draft')", [id], () => D.alreadyApproved());
      t.guard("protocol_version", "EXISTS (SELECT 1 FROM protocols WHERE case_id = ? AND version = ?)", [id, p.version], () => D.conflict());
    } else t.guard("protocol", "NOT EXISTS (SELECT 1 FROM protocols WHERE case_id = ?)", [id], () => D.conflict());
    t.guard("status", "(SELECT status FROM cases WHERE id = ?) = ?", [id, core.status], () => D.statusChanged());
    // The decision freezes the slot it was made on, so the slot must still be the one read above.
    if (slot) t.guard("slot", "EXISTS (SELECT 1 FROM slots WHERE case_id = ? AND day = ? AND time = ?)", [id, slot.day, slot.time], () => D.conflict());
    else t.guard("slot", "NOT EXISTS (SELECT 1 FROM slots WHERE case_id = ?)", [id], () => D.conflict());
    t.guard("attendance", "COALESCE((SELECT version FROM attendance_sets WHERE set_key = ?), 0) = ?", [setKey, att.version], () => D.attendanceChanged());
    if (exists) {
      t.run(
        `UPDATE protocols SET conclusion = ?1, state = 'approved', version = version + 1, approved_by_name = ?2, approved_at = ?3,
           updated_by = ?4, updated_by_name = ?2, updated_at = ?3 WHERE case_id = ?5`,
        plan.conclusion, v.name, at, v.id, id,
      );
    } else {
      t.run(
        `INSERT INTO protocols (case_id, conclusion, state, version, updated_by, updated_by_name, updated_at, approved_by_name, approved_at)
         VALUES (?1, ?2, 'approved', 1, ?3, ?4, ?5, ?4, ?5)`,
        id, plan.conclusion, v.id, v.name, at,
      );
    }
    t.run(
      `INSERT INTO decisions (id, case_id, version, conclusion, approved_by_user_id, approved_by_name, approved_at, slot_day, slot_time,
         report_snapshot_json, attendance_snapshot_json, supersedes_id) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)`,
      d.id, id, d.version, plan.conclusion, v.id, v.name, at, d.slot?.day ?? null, d.slot?.time ?? null,
      JSON.stringify(d.report), JSON.stringify(d.attSnap), d.supersedes_id,
    );
    t.audit({ action: "decision.approve", what_cs: "schválil(a) závěr MDT", case_id: id, target_type: "decision", target_id: d.id });
    if (plan.attendanceAdd) {
      const a = plan.attendanceAdd;
      t.run("INSERT INTO attendance (set_key, dept_id, position, user_id, user_name) VALUES (?1, ?2, ?3, ?4, ?5)", setKey, a.dept_id, a.position, a.user_id, a.user_name);
      t.run(
        `INSERT INTO attendance_sets (set_key, version, updated_by, updated_at) VALUES (?1, 1, ?2, ?3)
         ON CONFLICT(set_key) DO UPDATE SET version = version + 1, updated_by = ?2, updated_at = ?3`,
        setKey, v.id, at,
      );
      t.audit({ action: "attendance.add_approver", what_cs: "doplněn(a) mezi přítomné při schválení závěru", case_id: id });
    }
    // Tasks from the steps the doctor wrote; the drafted ones wait for a doctor (multi-row via json_each: D1 allows
    // 100 bound values per statement).
    if (plan.tasks.length)
      t.run(
        `INSERT INTO tasks (case_id, text, assignee_user_id, assignee_name, due, created_by, created_at)
         SELECT ?1, json_extract(value, '$.text'), json_extract(value, '$.uid'), json_extract(value, '$.who'), json_extract(value, '$.due'), ?2, ?3
         FROM json_each(?4)`,
        id, v.id, at, JSON.stringify(plan.tasks.map((x) => ({ text: x.text, uid: x.assignee_user_id, who: x.assignee_name, due: x.due }))),
      );
    // Drafts of the decision this one replaces rest on an outdated conclusion; they can no longer become tasks.
    t.run("UPDATE task_suggestions SET state = 'superseded' WHERE case_id = ?1 AND state = 'draft'", id);
    if (plan.suggestions.length)
      t.run(
        `INSERT INTO task_suggestions (case_id, decision_id, decision_version, text, quote, who, due, due_source, timing, state, created_at)
         SELECT ?1, ?2, ?3, json_extract(value, '$.text'), json_extract(value, '$.quote'), json_extract(value, '$.who'),
           json_extract(value, '$.due'), json_extract(value, '$.src'), json_extract(value, '$.timing'), 'draft', ?4
         FROM json_each(?5)`,
        id, d.id, d.version, at,
        JSON.stringify(plan.suggestions.map((s) => ({ text: s.text, quote: s.quote, who: s.who, due: s.due || null, src: s.dueSrc, timing: s.timing }))),
      );
    // The e-mail to the coordinator carries the case ID and a count, never the conclusion (CLAUDE.md, notifications).
    if (plan.tasks.length)
      t.run(
        `INSERT INTO notifications (id, kind, to_user_id, case_id, count, link, created_by, created_by_name, created_at)
         VALUES (?1, 'approval', ?2, ?3, ?4, '/', ?5, ?6, ?7)`,
        newId(), staff.coordinator?.id ?? null, id, plan.tasks.length, v.id, v.name, at,
      );
    t.run("UPDATE cases SET updated_on = ?1 WHERE id = ?2", plan.approvalDay, id);
    if (plan.status) writeStatus(t, id, plan.status, actorOf(c), at);
    try {
      await t.commit();
    } catch (e) {
      if (e instanceof IdempotentReplay) {
        const r = await replayIdempotent(c, key, route, sha);
        if (r) return r;
      }
      // An autosave by someone else landed between the read and the batch: the doctor looks at the newer draft.
      if (e instanceof DomainError && e.code === "conflict") {
        const cur = await w.protocol(id);
        if (cur.state === "draft" && cur.version !== p.version) throw D.protocolConflict(cur.updated_by_name ?? "", cur);
      }
      throw e;
    }
    await hooks.onApproved(id, d.id);
    return answer(c, data, { cases: await statesFor(c, [id]), att: await w.attSets([setKey]), mails: await w.mails([id]) });
  })
  .post("/cases/:id/decisions/new-version", async (c) => {
    const id = c.req.param("id");
    label(c, "nový koncept závěru", id);
    const { core, breakGlass } = await caseFor(c, id, "decision.new_version");
    const w = work(c);
    const [p, decs] = await Promise.all([w.protocol(id), w.decisions(id)]);
    const last = decs.at(-1) ?? null;
    newDraft(p, core.status, last?.id ?? null, c.var.body.expected_decision_id);
    const t = tx(c, breakGlass);
    const at = isoNow();
    const v = c.var.viewer;
    t.guard("status", "(SELECT status FROM cases WHERE id = ?) = ?", [id, core.status], () => D.statusChanged());
    t.guard("approved", "EXISTS (SELECT 1 FROM protocols WHERE case_id = ? AND state = 'approved' AND version = ?)", [id, p.version], () => D.notApprovedYet());
    t.guard("latest", "(SELECT id FROM decisions WHERE case_id = ? ORDER BY version DESC LIMIT 1) = ?", [id, last!.id], () => D.decisionChanged());
    // The approved text lives on in its decision row; the protocol row becomes an empty draft for the next decision.
    t.run(
      `UPDATE protocols SET notes = '', conclusion = '', steps_json = '[]', state = 'draft', version = version + 1, approved_by_name = NULL,
         approved_at = NULL, updated_by = ?1, updated_by_name = ?2, updated_at = ?3 WHERE case_id = ?4`,
      v.id, v.name, at, id,
    );
    t.audit({ action: "decision.new_version", what_cs: "začal(a) nový koncept závěru", case_id: id });
    const ch = autoOnNewVersion(core.status, !!core.slot_day);
    if (ch) writeStatus(t, id, ch, actorOf(c), at);
    await t.commit();
    return answer(c, {}, { cases: await statesFor(c, [id]) });
  })

  // ---------- drafted question ----------
  .post("/cases/:id/question/confirm", async (c) => {
    const id = c.req.param("id");
    label(c, "potvrzení návrhu otázky", id);
    const { core, breakGlass } = await caseFor(c, id, "question.confirm");
    const draft = core.question_draft;
    const sha = draft ? await sha256Hex(draft) : null;
    const last = await c.env.DB.prepare("SELECT text, by_name FROM question_confirmations WHERE case_id = ?1 ORDER BY at DESC, id DESC LIMIT 1").bind(id).first<{ text: string; by_name: string }>();
    confirmDraft(draft, sha, c.var.body.draft_sha, last);
    const t = tx(c, breakGlass);
    const at = isoNow();
    const v = c.var.viewer;
    t.guard("draft", "(SELECT question_draft FROM cases WHERE id = ?) = ?", [id, draft], () => D.questionChanged());
    t.guard("once", "NOT EXISTS (SELECT 1 FROM question_confirmations WHERE case_id = ? AND text = ?)", [id, draft], () => D.questionConfirmed("jiný lékař"));
    t.run("INSERT INTO question_confirmations (case_id, text, by_user_id, by_name, at) VALUES (?1, ?2, ?3, ?4, ?5)", id, draft, v.id, v.name, at);
    t.run("INSERT INTO edit_log (case_id, key, orig, text, confirmed, by_user_id, by_name, at) VALUES (?1, 'q', ?2, ?2, 1, ?3, ?4, ?5)", id, draft, v.id, v.name, at);
    t.audit({ action: "question.confirm", what_cs: "potvrdil(a) návrh otázky pro MDT", case_id: id });
    await t.commit();
    return answer(c, {}, { cases: await statesFor(c, [id]) });
  })

  // ---------- fact edits ----------
  .put("/cases/:id/edits/:key", async (c) => editRoute(c, "save"))
  .delete("/cases/:id/edits/:key", async (c) => editRoute(c, "revert"))

  // ---------- alert events ----------
  .post("/cases/:id/alerts/:key/events", async (c) => {
    const id = c.req.param("id");
    label(c, "změna stavu upozornění", id);
    const { breakGlass } = await caseFor(c, id, "alert.act");
    const k = parseAlertKey(c.req.param("key"));
    if (!k) throw D.alertNotFound();
    const alert = await c.env.DB.prepare(
      `SELECT a.id, a.kind FROM alerts a JOIN extraction_runs r ON r.id = a.run_id AND r.is_current = 1
       WHERE a.case_id = ?1 AND a.origin = ?2 AND a.position = ?3`,
    )
      .bind(id, k.origin, k.position)
      .first<{ id: string; kind: string }>();
    if (!alert) throw D.alertNotFound();
    const events = (await c.env.DB.prepare("SELECT action FROM alert_events WHERE alert_id = ?1 ORDER BY at, id").bind(alert.id).all<{ action: AlertAction }>()).results;
    const b = c.var.body;
    const action = transition(alertState(events), b.action, b.expected_state);
    const t = tx(c, breakGlass);
    const v = c.var.viewer;
    t.guard("events", "(SELECT COUNT(*) FROM alert_events WHERE alert_id = ?) = ?", [alert.id, events.length], () => D.alertStateChanged());
    t.run("INSERT INTO alert_events (alert_id, action, by_user_id, by_name, at) VALUES (?1, ?2, ?3, ?4, ?5)", alert.id, action, v.id, v.name, isoNow());
    t.audit({ action: "alert.event", what_cs: `${ALERT_ACT_CS[action]}: ${ALERT_KIND_CS[alert.kind] ?? ALERT_KIND_CS.unclear}`, case_id: id, target_type: "alert", target_id: alert.id });
    await t.commit();
    return answer(c, {}, { cases: await statesFor(c, [id]) });
  })

  // ---------- break-the-glass ----------
  .post("/cases/:id/break-glass", async (c) => {
    const id = c.req.param("id");
    label(c, "přístup mimo tým", id);
    const v = c.var.viewer;
    if (!(await work(c).caseCore(id))) throw D.caseNotFound();
    const member = v.role === "doctor" ? await c.var.stores.cases.isMember(id, v) : false;
    const g = grant(actorOf(c), member, c.var.body.reason, now());
    const t = tx(c);
    t.run(
      "INSERT INTO case_access_grants (id, case_id, user_id, reason, granted_at, expires_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
      newId(), id, v.id, g.reason, isoNow(), g.expires_at,
    );
    // The reason sits in its own column, so the review sees it and the "what" line stays free of free text.
    t.audit({ action: "case.break_glass", what_cs: "otevřel(a) případ mimo tým (přístup s důvodem)", case_id: id, break_glass_reason: g.reason });
    await t.commit();
    return answer(c, { expires_at: g.expires_at });
  });

async function editRoute(c: import("hono").Context<AppEnv>, mode: "save" | "revert") {
  const id = c.req.param("id")!;
  const key = c.req.param("key")!;
  label(c, mode === "save" ? "úprava údaje" : "vrácení údaje", id);
  const { breakGlass } = await caseFor(c, id, "fact.edit");
  const cur = await c.env.DB.prepare("SELECT log_id, by_name, orig FROM fact_edits WHERE case_id = ?1 AND key = ?2").bind(id, key).first<{ log_id: number | null; by_name: string; orig: string | null }>();
  const b = c.var.body;
  const op = mode === "save" ? saveEdit(key, cur, b.text, b.orig, b.expected_edit_id) : revertEdit(key, cur, b.expected_edit_id);
  if (op.kind === "noop") return answer(c, { changed: false }, { cases: await statesFor(c, [id]) });
  const t = tx(c, breakGlass);
  const at = isoNow();
  const v = c.var.viewer;
  if (cur) t.guard("edit", "(SELECT log_id FROM fact_edits WHERE case_id = ? AND key = ?) IS ?", [id, key, cur.log_id], () => D.editConflict(""));
  else t.guard("edit", "NOT EXISTS (SELECT 1 FROM fact_edits WHERE case_id = ? AND key = ?)", [id, key], () => D.editConflict(""));
  // orig is what the page showed; the source value itself is never changed.
  const orig = cur ? cur.orig : typeof b.orig === "string" ? b.orig : null;
  if (op.kind === "save") {
    t.run("INSERT INTO edit_log (case_id, key, orig, text, by_user_id, by_name, at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)", id, key, orig, op.text, v.id, v.name, at);
    t.run(
      `INSERT INTO fact_edits (case_id, key, text, orig, by_user_id, by_name, at, log_id, extraction_run_id)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, (SELECT MAX(id) FROM edit_log WHERE case_id = ?1 AND key = ?2),
               (SELECT id FROM extraction_runs WHERE case_id = ?1 AND is_current = 1))
       ON CONFLICT(case_id, key) DO UPDATE SET text = excluded.text, by_user_id = excluded.by_user_id, by_name = excluded.by_name,
         at = excluded.at, log_id = excluded.log_id, extraction_run_id = excluded.extraction_run_id`,
      id, key, op.text, orig, v.id, v.name, at,
    );
    t.audit({ action: "fact.edit", what_cs: `upravil(a) údaj (${key})`, case_id: id, target_type: "fact", target_id: key });
  } else {
    // A revert is a new log row; the earlier edit stays visible in the case history.
    t.run("INSERT INTO edit_log (case_id, key, orig, text, reverted, by_user_id, by_name, at) VALUES (?1, ?2, ?3, ?4, 1, ?5, ?6, ?7)", id, key, orig, orig || GAP, v.id, v.name, at);
    t.run("DELETE FROM fact_edits WHERE case_id = ?1 AND key = ?2", id, key);
    t.audit({ action: "fact.revert", what_cs: `vrátil(a) původní údaj (${key})`, case_id: id, target_type: "fact", target_id: key });
  }
  try {
    await t.commit();
  } catch (e) {
    if (e instanceof DomainError && e.code === "edit_conflict") {
      const now2 = await c.env.DB.prepare("SELECT by_name FROM fact_edits WHERE case_id = ?1 AND key = ?2").bind(id, key).first<{ by_name: string }>();
      throw D.editConflict(now2?.by_name ?? "");
    }
    throw e;
  }
  return answer(c, { changed: true }, { cases: await statesFor(c, [id]) });
}

// A retried request with the same key: the stored answer for the same body, a refusal for a different one.
export async function replayIdempotent(c: import("hono").Context<AppEnv>, key: string, route: string, sha: string) {
  const row = await c.env.DB.prepare("SELECT user_id, route, body_sha, response_json, status FROM idempotency_keys WHERE key = ?1").bind(key).first<{
    user_id: string;
    route: string;
    body_sha: string;
    response_json: string;
    status: number;
  }>();
  if (!row) return null;
  // Keys hold for 24 hours; after that the same key is a new request (the old row goes, it is not history).
  const created = await c.env.DB.prepare("SELECT created_at FROM idempotency_keys WHERE key = ?1").bind(key).first<{ created_at: string }>();
  if (created && created.created_at < new Date(now().getTime() - 24 * 3600_000).toISOString()) {
    await c.env.DB.prepare("DELETE FROM idempotency_keys WHERE key = ?1").bind(key).run();
    return null;
  }
  if (row.user_id !== c.var.viewer.id || row.route !== route || row.body_sha !== sha) throw D.idempotencyMismatch();
  const data = JSON.parse(row.response_json) as { case_id?: string };
  const caseId = route.startsWith("approve:") ? route.slice(8) : data.case_id;
  // A replay shows case data again, so it is an access like any other.
  await tx(c).audit({ action: "request.replay", what_cs: "zopakoval(a) požadavek (stejná odpověď)", case_id: caseId ?? null }).commit();
  const state: Record<string, unknown> = caseId ? { cases: await statesFor(c, [caseId]) } : {};
  if (route.startsWith("approve:") && caseId) state.mails = await work(c).mails([caseId]);
  if (route === "create_case" && caseId) {
    const row2 = await c.var.stores.cases.caseById(caseId);
    if (row2) state.patient = patientRow(row2, await c.var.stores.cases.statusHistory(caseId));
  }
  return answer(c, data, state);
}

export const todayPrague = () => pragueDay(now());
