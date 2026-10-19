// Write routes on one case: status and closing, slots, the protocol draft, approval and new version, the drafted
// question, fact edits, alert events and break-the-glass. Each route: role and membership, the domain rule, one
// guarded D1 batch with its audit rows, then the case's fresh workflow state (step-4.md "As implemented").
import { Hono } from "hono";
import type { AppEnv } from "../types";
import { E } from "../http/errors";
import { D, DomainError } from "@codebridge/domain/errors";
import { moveStatus, statusLine, autoOnNewVersion, type StatusChange } from "@codebridge/domain/status";
import { releasesOnClose, schedule, slotText, unschedule, validateSlot, type Slot } from "@codebridge/domain/slots";
import { newDraft, patchProtocol } from "@codebridge/domain/protocol";
import { approve } from "@codebridge/domain/approve";
import { confirmDraft } from "../domain/question";
import { FACT_ID_RE, factIdOfKey, lineIdOfKey, saveEdit, revertEdit } from "@codebridge/domain/edits";
import { confirmTransition, confirmationState, confirmedContent, type ConfirmAction } from "@codebridge/domain/confirmations";
import { ALERT_ACT_CS, ALERT_ID, ALERT_KIND_CS, alertState, transition, type AlertAction } from "../domain/alerts";
import { currentRun } from "../store/runs";
import { grant } from "../domain/breakglass";
import { PROTOCOL_AUDIT_WINDOW_MIN } from "@codebridge/domain/config";
import { pragueDay } from "@codebridge/domain/time";
import { IdempotentReplay, type Tx } from "../store/write";
import { sha256Hex } from "../store/work";
import { actorOf, answer, caseFor, isoNow, label, newId, now, orgQuery, statesFor, tx, work } from "./write-context";
import { hooks, passIdFor } from "./hooks";
import { patientRow } from "../domain/rows";
import { validateReportHtml } from "../domain/report";

const GAP = "neuvedeno v dostupné dokumentaci";

// The status change and its history row, written together.
function writeStatus(t: Tx, caseId: string, ch: StatusChange, by: { id: string; name: string }, at: string) {
  t.run("UPDATE cases SET status = ?1 WHERE org_id = ?org AND id = ?2", ch.to, caseId);
  t.run(
    "INSERT INTO status_history (org_id, case_id, from_status, to_status, by_user_id, by_name, how, at) VALUES (?org, ?1, ?2, ?3, ?4, ?5, ?6, ?7)",
    caseId, ch.from, ch.to, by.id, by.name, ch.how, at,
  );
  t.audit({ action: "case.status", what_cs: statusLine(ch), case_id: caseId });
}

const slotOf = (core: { slot_day: string | null; slot_time: string | null }): Slot | null =>
  core.slot_day && core.slot_time ? { day: core.slot_day, time: core.slot_time } : null;

// Per org: another org's booking of the same time is not a conflict (and is never revealed).
const SLOT_UNIQUE = /UNIQUE constraint failed: slots\.org_id, slots\.day, slots\.time/;

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
    t.guard("status", "(SELECT status FROM cases WHERE org_id = ?org AND id = ?) = ?", [id, core.status], () => D.statusChanged());
    t.guard("slot", "(SELECT COUNT(*) FROM slots WHERE org_id = ?org AND case_id = ?) = ?", [id, slot ? 1 : 0], () => D.statusChanged());
    writeStatus(t, id, ch, actorOf(c), at);
    let released = false;
    if (ch.to === "closed" && slot && releasesOnClose({ status: core.status, slot }, await w.decisions(id))) {
      // Closing frees a slot that only reserved seminar time; one a decision was made on stays (guarded again here).
      t.guard("slot_unlocked", "NOT EXISTS (SELECT 1 FROM decisions WHERE org_id = ?org AND case_id = ? AND slot_day = ? AND slot_time = ?)", [id, slot.day, slot.time], () => D.slotLocked());
      t.run("DELETE FROM slots WHERE org_id = ?org AND case_id = ?1", id);
      t.audit({ action: "slot.release", what_cs: `uvolnil(a) termín MDT při uzavření případu (${slotText(slot)})`, case_id: id });
      released = true;
    }
    await t.commit();
    if (ch.to === "closed") await hooks.onCaseClosed(c, id);
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
    t.guard("status", "(SELECT status FROM cases WHERE org_id = ?org AND id = ?) = ?", [id, core.status], () => D.statusChanged());
    if (cur) {
      t.guard("slot_same", "EXISTS (SELECT 1 FROM slots WHERE org_id = ?org AND case_id = ? AND day = ? AND time = ?)", [id, cur.day, cur.time], () => D.conflict());
      t.guard("slot_unlocked", "NOT EXISTS (SELECT 1 FROM decisions WHERE org_id = ?org AND case_id = ? AND slot_day = ? AND slot_time = ?)", [id, cur.day, cur.time], () => D.slotLocked());
    } else t.guard("slot_none", "NOT EXISTS (SELECT 1 FROM slots WHERE org_id = ?org AND case_id = ?)", [id], () => D.conflict());
    t.run("DELETE FROM slots WHERE org_id = ?org AND case_id = ?1", id);
    t.run("INSERT INTO slots (org_id, day, time, case_id, booked_by, booked_at) VALUES (?org, ?1, ?2, ?3, ?4, ?5)", next.day, next.time, id, c.var.viewer.id, isoNow());
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
    t.guard("status", "(SELECT status FROM cases WHERE org_id = ?org AND id = ?) = ?", [id, core.status], () => D.statusChanged());
    t.guard("slot_same", "EXISTS (SELECT 1 FROM slots WHERE org_id = ?org AND case_id = ? AND day = ? AND time = ?)", [id, r.was.day, r.was.time], () => D.conflict());
    t.guard("slot_unlocked", "NOT EXISTS (SELECT 1 FROM decisions WHERE org_id = ?org AND case_id = ? AND slot_day = ? AND slot_time = ?)", [id, r.was.day, r.was.time], () => D.slotLocked());
    t.run("DELETE FROM slots WHERE org_id = ?org AND case_id = ?1", id);
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
    t.guard("open", "(SELECT status FROM cases WHERE org_id = ?org AND id = ?) <> 'closed'", [id], () => D.caseClosedEdit());
    if (exists) {
      t.guard("version", "EXISTS (SELECT 1 FROM protocols WHERE org_id = ?org AND case_id = ? AND version = ? AND state = 'draft')", [id, p.version], () => D.conflict());
      t.run(
        `UPDATE protocols SET notes = ?1, conclusion = ?2, steps_json = ?3, version = version + 1, updated_by = ?4, updated_by_name = ?5, updated_at = ?6
         WHERE org_id = ?org AND case_id = ?7`,
        next.notes, next.conclusion, JSON.stringify(next.steps), v.id, v.name, at, id,
      );
    } else {
      t.guard("version", "NOT EXISTS (SELECT 1 FROM protocols WHERE org_id = ?org AND case_id = ?)", [id], () => D.conflict());
      t.run(
        `INSERT INTO protocols (org_id, case_id, notes, conclusion, steps_json, state, version, updated_by, updated_by_name, updated_at)
         VALUES (?org, ?1, ?2, ?3, ?4, 'draft', 1, ?5, ?6, ?7)`,
        id, next.notes, next.conclusion, JSON.stringify(next.steps), v.id, v.name, at,
      );
    }
    // Autosave runs while the doctor types; one access-log row per user, case and window is enough to say who edited.
    const since = new Date(now().getTime() - PROTOCOL_AUDIT_WINDOW_MIN * 60_000).toISOString();
    const recent = await orgQuery(c, "SELECT 1 AS x FROM access_log WHERE org_id = ?org AND actor_user_id = ?1 AND case_id = ?2 AND action = 'protocol.edit' AND at > ?3 LIMIT 1", v.id, id, since).first();
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
      orgQuery(c, "SELECT full_name, name_as_written, birth_number FROM patients WHERE org_id = ?org AND id = ?1", core.patient_id).first<{ full_name: string; name_as_written: string | null; birth_number: string | null }>(),
    ]);
    const exists = p.exists;
    // Only the app's own report markup, and no patient identity in it (identity lives in the patients table only).
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
    // Step 5: the speaker pass is planned before the batch so the stored (and replayed) answer names its job.
    const pass = await hooks.planSpeakerPass(c, id);
    const speakerPassJobId = pass ? passIdFor(d.id) : null;
    const data = { decision_id: d.id, version: d.version, tasks_created: plan.tasks.length, suggestions_created: plan.suggestions.length, speaker_pass_job_id: speakerPassJobId };
    const t = tx(c, breakGlass);
    t.idempotency(key, route, sha, data, 200, at);
    // Order matters for the refusal the loser of a race sees: another approval first, then a newer draft, then the rest.
    t.guard("no_newer_decision", "NOT EXISTS (SELECT 1 FROM decisions WHERE org_id = ?org AND case_id = ? AND version >= ?)", [id, d.version], () => D.alreadyApproved());
    if (exists) {
      t.guard("protocol_state", "EXISTS (SELECT 1 FROM protocols WHERE org_id = ?org AND case_id = ? AND state = 'draft')", [id], () => D.alreadyApproved());
      t.guard("protocol_version", "EXISTS (SELECT 1 FROM protocols WHERE org_id = ?org AND case_id = ? AND version = ?)", [id, p.version], () => D.conflict());
    } else t.guard("protocol", "NOT EXISTS (SELECT 1 FROM protocols WHERE org_id = ?org AND case_id = ?)", [id], () => D.conflict());
    t.guard("status", "(SELECT status FROM cases WHERE org_id = ?org AND id = ?) = ?", [id, core.status], () => D.statusChanged());
    // The decision freezes the slot it was made on, so the slot must still be the one read above.
    if (slot) t.guard("slot", "EXISTS (SELECT 1 FROM slots WHERE org_id = ?org AND case_id = ? AND day = ? AND time = ?)", [id, slot.day, slot.time], () => D.conflict());
    else t.guard("slot", "NOT EXISTS (SELECT 1 FROM slots WHERE org_id = ?org AND case_id = ?)", [id], () => D.conflict());
    t.guard("attendance", "COALESCE((SELECT version FROM attendance_sets WHERE org_id = ?org AND set_key = ?), 0) = ?", [setKey, att.version], () => D.attendanceChanged());
    if (exists) {
      t.run(
        `UPDATE protocols SET conclusion = ?1, state = 'approved', version = version + 1, approved_by_name = ?2, approved_at = ?3,
           updated_by = ?4, updated_by_name = ?2, updated_at = ?3 WHERE org_id = ?org AND case_id = ?5`,
        plan.conclusion, v.name, at, v.id, id,
      );
    } else {
      t.run(
        `INSERT INTO protocols (org_id, case_id, conclusion, state, version, updated_by, updated_by_name, updated_at, approved_by_name, approved_at)
         VALUES (?org, ?1, ?2, 'approved', 1, ?3, ?4, ?5, ?4, ?5)`,
        id, plan.conclusion, v.id, v.name, at,
      );
    }
    t.run(
      `INSERT INTO decisions (org_id, id, case_id, version, conclusion, approved_by_user_id, approved_by_name, approved_at, slot_day, slot_time,
         report_snapshot_json, attendance_snapshot_json, supersedes_id) VALUES (?org, ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)`,
      d.id, id, d.version, plan.conclusion, v.id, v.name, at, d.slot?.day ?? null, d.slot?.time ?? null,
      JSON.stringify(d.report), JSON.stringify(d.attSnap), d.supersedes_id,
    );
    t.audit({ action: "decision.approve", what_cs: "schválil(a) závěr MDT", case_id: id, target_type: "decision", target_id: d.id });
    if (pass) hooks.addSpeakerPass(c, t, pass, id, d.id, t0.getTime(), at);
    if (plan.attendanceAdd) {
      const a = plan.attendanceAdd;
      t.run("INSERT INTO attendance (org_id, set_key, dept_id, position, user_id, user_name) VALUES (?org, ?1, ?2, ?3, ?4, ?5)", setKey, a.dept_id, a.position, a.user_id, a.user_name);
      t.run(
        `INSERT INTO attendance_sets (org_id, set_key, version, updated_by, updated_at) VALUES (?org, ?1, 1, ?2, ?3)
         ON CONFLICT(org_id, set_key) DO UPDATE SET version = version + 1, updated_by = ?2, updated_at = ?3`,
        setKey, v.id, at,
      );
      t.audit({ action: "attendance.add_approver", what_cs: "doplněn(a) mezi přítomné při schválení závěru", case_id: id });
    }
    // Tasks from the steps the doctor wrote; the drafted ones wait for a doctor (multi-row via json_each: D1 allows
    // 100 bound values per statement).
    if (plan.tasks.length)
      t.run(
        `INSERT INTO tasks (org_id, case_id, text, assignee_user_id, assignee_name, due, created_by, created_at)
         SELECT ?org, ?1, json_extract(value, '$.text'), json_extract(value, '$.uid'), json_extract(value, '$.who'), json_extract(value, '$.due'), ?2, ?3
         FROM json_each(?4)`,
        id, v.id, at, JSON.stringify(plan.tasks.map((x) => ({ text: x.text, uid: x.assignee_user_id, who: x.assignee_name, due: x.due }))),
      );
    // Drafts of the decision this one replaces rest on an outdated conclusion; they can no longer become tasks.
    t.run("UPDATE task_suggestions SET state = 'superseded' WHERE org_id = ?org AND case_id = ?1 AND state = 'draft'", id);
    if (plan.suggestions.length)
      t.run(
        `INSERT INTO task_suggestions (org_id, case_id, decision_id, decision_version, text, quote, who, due, due_source, timing, state, created_at)
         SELECT ?org, ?1, ?2, ?3, json_extract(value, '$.text'), json_extract(value, '$.quote'), json_extract(value, '$.who'),
           json_extract(value, '$.due'), json_extract(value, '$.src'), json_extract(value, '$.timing'), 'draft', ?4
         FROM json_each(?5)`,
        id, d.id, d.version, at,
        JSON.stringify(plan.suggestions.map((s) => ({ text: s.text, quote: s.quote, who: s.who, due: s.due || null, src: s.dueSrc, timing: s.timing }))),
      );
    // The e-mail to the coordinator carries the case ID and a count, never the conclusion (CLAUDE.md, notifications).
    if (plan.tasks.length)
      t.run(
        `INSERT INTO notifications (org_id, id, kind, to_user_id, case_id, count, link, created_by, created_by_name, created_at)
         VALUES (?org, ?1, 'approval', ?2, ?3, ?4, '/', ?5, ?6, ?7)`,
        newId(), staff.coordinator?.id ?? null, id, plan.tasks.length, v.id, v.name, at,
      );
    t.run("UPDATE cases SET updated_on = ?1 WHERE org_id = ?org AND id = ?2", plan.approvalDay, id);
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
    await hooks.onApproved(c, speakerPassJobId);
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
    t.guard("status", "(SELECT status FROM cases WHERE org_id = ?org AND id = ?) = ?", [id, core.status], () => D.statusChanged());
    t.guard("approved", "EXISTS (SELECT 1 FROM protocols WHERE org_id = ?org AND case_id = ? AND state = 'approved' AND version = ?)", [id, p.version], () => D.notApprovedYet());
    t.guard("latest", "(SELECT id FROM decisions WHERE org_id = ?org AND case_id = ? ORDER BY version DESC LIMIT 1) = ?", [id, last!.id], () => D.decisionChanged());
    // The approved text lives on in its decision row; the protocol row becomes an empty draft for the next decision.
    t.run(
      `UPDATE protocols SET notes = '', conclusion = '', steps_json = '[]', state = 'draft', version = version + 1, approved_by_name = NULL,
         approved_at = NULL, updated_by = ?1, updated_by_name = ?2, updated_at = ?3 WHERE org_id = ?org AND case_id = ?4`,
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
    const last = await orgQuery(c, "SELECT text, by_name FROM question_confirmations WHERE org_id = ?org AND case_id = ?1 ORDER BY at DESC, id DESC LIMIT 1", id).first<{ text: string; by_name: string }>();
    confirmDraft(draft, sha, c.var.body.draft_sha, last);
    const t = tx(c, breakGlass);
    const at = isoNow();
    const v = c.var.viewer;
    t.guard("draft", "(SELECT question_draft FROM cases WHERE org_id = ?org AND id = ?) = ?", [id, draft], () => D.questionChanged());
    t.guard("once", "NOT EXISTS (SELECT 1 FROM question_confirmations WHERE org_id = ?org AND case_id = ? AND text = ?)", [id, draft], () => D.questionConfirmed("jiný lékař"));
    t.run("INSERT INTO question_confirmations (org_id, case_id, text, by_user_id, by_name, at) VALUES (?org, ?1, ?2, ?3, ?4, ?5)", id, draft, v.id, v.name, at);
    t.run("INSERT INTO edit_log (org_id, case_id, key, orig, text, confirmed, by_user_id, by_name, at) VALUES (?org, ?1, 'q', ?2, ?2, 1, ?3, ?4, ?5)", id, draft, v.id, v.name, at);
    t.audit({ action: "question.confirm", what_cs: "potvrdil(a) návrh otázky pro MDT", case_id: id });
    await t.commit();
    return answer(c, {}, { cases: await statesFor(c, [id]) });
  })

  // ---------- fact edits ----------
  .put("/cases/:id/edits/:key", async (c) => editRoute(c, "save"))
  .delete("/cases/:id/edits/:key", async (c) => editRoute(c, "revert"))

  // ---------- alert events ----------
  // By alert ID of the current run (codebridge.extraction/2). The ID comes from the alert's rule and subject, so the
  // acknowledgement carries over to the next run that raises the same alert.
  .post("/cases/:id/alerts/:alertId/events", async (c) => {
    const id = c.req.param("id");
    label(c, "změna stavu upozornění", id);
    const { breakGlass } = await caseFor(c, id, "alert.act");
    const alertId = c.req.param("alertId");
    if (!ALERT_ID.test(alertId)) throw D.alertNotFound();
    const { row, data } = await currentRun(c.env.DB, c.env.DOCS, c.var.viewer.org, id);
    const alert = data?.alerts.find((a) => a.id === alertId);
    if (!row || !alert) throw D.alertNotFound();
    const events = (
      await orgQuery(c, "SELECT action FROM alert_events WHERE org_id = ?org AND case_id = ?1 AND alert_id = ?2 ORDER BY at, id", id, alertId).all<{ action: AlertAction }>()
    ).results;
    const b = c.var.body;
    const action = transition(alertState(events), b.action, b.expected_state);
    const t = tx(c, breakGlass);
    const v = c.var.viewer;
    t.guard("events", "(SELECT COUNT(*) FROM alert_events WHERE org_id = ?org AND case_id = ? AND alert_id = ?) = ?", [id, alertId, events.length], () => D.alertStateChanged());
    // The alert must still be in the current run when the event lands.
    t.guard("run", "(SELECT id FROM extraction_runs WHERE org_id = ?org AND case_id = ? AND is_current = 1) = ?", [id, row.id], () => D.alertStateChanged());
    // Run storage registers the alert's identity; an alert of a run stored before that existed gets it here.
    t.run(
      `INSERT INTO alert_identities (org_id, case_id, id, rule, subject, kind, first_run_id) VALUES (?org, ?1, ?2, ?3, ?4, ?5, ?6)
       ON CONFLICT (org_id, case_id, id) DO NOTHING`,
      id, alertId, alert.rule, alert.subject, alert.kind, row.id,
    );
    t.run("INSERT INTO alert_events (org_id, case_id, alert_id, action, by_user_id, by_name, at) VALUES (?org, ?1, ?2, ?3, ?4, ?5, ?6)", id, alertId, action, v.id, v.name, isoNow());
    t.audit({ action: "alert.event", what_cs: `${ALERT_ACT_CS[action]}: ${ALERT_KIND_CS[alert.kind] ?? ALERT_KIND_CS.unclear}`, case_id: id, target_type: "alert", target_id: alertId });
    await t.commit();
    return answer(c, {}, { cases: await statesFor(c, [id]) });
  })

  // ---------- fact confirmations ----------
  // A doctor confirms one fact of the current run (or withdraws it). The server computes what was confirmed from the
  // run itself, so the page cannot confirm a value the run does not hold.
  .post("/cases/:id/facts/:factId/confirmations", async (c) => {
    const id = c.req.param("id");
    label(c, "potvrzení údaje", id);
    const { breakGlass } = await caseFor(c, id, "fact.confirm");
    const factId = c.req.param("factId");
    if (!FACT_ID_RE.test(factId)) throw D.factNotFound();
    const { row, data } = await currentRun(c.env.DB, c.env.DOCS, c.var.viewer.org, id);
    const fact = data?.facts.find((f) => f.id === factId);
    if (!row || !fact) throw D.factNotFound();
    // A fact from a page that shows another patient is kept in the run but never shown, so it is never confirmed.
    if (fact.quarantined) throw D.factQuarantined();
    const sha = await sha256Hex(confirmedContent(fact));
    const rows = (
      await orgQuery(c, "SELECT action, value_sha256 FROM fact_confirmations WHERE org_id = ?org AND case_id = ?1 AND fact_id = ?2 ORDER BY at, id", id, factId).all<{
        action: ConfirmAction;
        value_sha256: string;
      }>()
    ).results;
    const b = c.var.body;
    const action = confirmTransition(confirmationState(rows, sha), b.action, b.expected_state);
    const t = tx(c, breakGlass);
    const v = c.var.viewer;
    t.guard("confirmations", "(SELECT COUNT(*) FROM fact_confirmations WHERE org_id = ?org AND case_id = ? AND fact_id = ?) = ?", [id, factId, rows.length], () => D.confirmationChanged());
    t.guard("run", "(SELECT id FROM extraction_runs WHERE org_id = ?org AND case_id = ? AND is_current = 1) = ?", [id, row.id], () => D.confirmationChanged());
    t.run("INSERT INTO fact_ids (org_id, case_id, fact_id, first_run_id) VALUES (?org, ?1, ?2, ?3) ON CONFLICT (org_id, case_id, fact_id) DO NOTHING", id, factId, row.id);
    t.run(
      "INSERT INTO fact_confirmations (org_id, case_id, fact_id, action, value_sha256, run_id, by_user_id, by_name, at) VALUES (?org, ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
      id, factId, action, sha, row.id, v.id, v.name, isoNow(),
    );
    t.audit({
      action: action === "confirm" ? "fact.confirm" : "fact.confirm_withdraw",
      what_cs: action === "confirm" ? "potvrdil(a) údaj" : "zrušil(a) potvrzení údaje",
      case_id: id,
      target_type: "fact",
      target_id: factId,
    });
    await t.commit();
    return answer(c, {}, { cases: await statesFor(c, [id]) });
  })

  // ---------- break-the-glass ----------
  .post("/cases/:id/break-glass", async (c) => {
    const id = c.req.param("id");
    label(c, "přístup mimo tým", id);
    const v = c.var.viewer;
    const core = await work(c).caseCore(id);
    // An open intake (step 6) does not exist for anyone but its creator, and takes no grant.
    if (!core || core.intake_open === 1) throw D.caseNotFound();
    const member = v.role === "doctor" ? await c.var.stores.cases.isMember(id, v) : false;
    const g = grant(actorOf(c), member, c.var.body.reason, now());
    const t = tx(c);
    t.run(
      "INSERT INTO case_access_grants (org_id, id, case_id, user_id, reason, granted_at, expires_at) VALUES (?org, ?1, ?2, ?3, ?4, ?5, ?6)",
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
  const cur = await orgQuery(c, "SELECT log_id, by_name, orig FROM fact_edits WHERE org_id = ?org AND case_id = ?1 AND key = ?2", id, key).first<{ log_id: number | null; by_name: string; orig: string | null }>();
  const b = c.var.body;
  const op = mode === "save" ? saveEdit(key, cur, b.text, b.orig, b.expected_edit_id) : revertEdit(key, cur, b.expected_edit_id);
  if (op.kind === "noop") return answer(c, { changed: false }, { cases: await statesFor(c, [id]) });
  // An edit of a fact ("f:<fact id>") is saved only for a fact the current run shows; reverting one whose fact is gone
  // from the run stays possible, so a doctor can clear an orphaned edit.
  const factId = factIdOfKey(key);
  const lineId = lineIdOfKey(key);
  let runId: string | null = null;
  if (factId && op.kind === "save") {
    const { row, data } = await currentRun(c.env.DB, c.env.DOCS, c.var.viewer.org, id);
    const fact = data?.facts.find((f) => f.id === factId);
    if (!row || !fact) throw D.factNotFound();
    if (fact.quarantined) throw D.factQuarantined();
    runId = row.id;
  }
  // A composed line ("v:<line id>") likewise: only a line of the current run takes a new text.
  if (lineId && op.kind === "save") {
    const { row, data } = await currentRun(c.env.DB, c.env.DOCS, c.var.viewer.org, id);
    const v = data?.views;
    const lines = [...(v?.onco_lines ?? []), ...(v?.other_diagnoses ?? []), ...(v?.timeline ?? [])];
    if (!row || !lines.some((l) => l.id === lineId)) throw D.factNotFound();
    runId = row.id;
  }
  const t = tx(c, breakGlass);
  const at = isoNow();
  const v = c.var.viewer;
  if (runId) t.guard("run", "(SELECT id FROM extraction_runs WHERE org_id = ?org AND case_id = ? AND is_current = 1) = ?", [id, runId], () => D.editConflict(""));
  if (cur) t.guard("edit", "(SELECT log_id FROM fact_edits WHERE org_id = ?org AND case_id = ? AND key = ?) IS ?", [id, key, cur.log_id], () => D.editConflict(""));
  else t.guard("edit", "NOT EXISTS (SELECT 1 FROM fact_edits WHERE org_id = ?org AND case_id = ? AND key = ?)", [id, key], () => D.editConflict(""));
  // orig is what the page showed; the source value itself is never changed.
  const orig = cur ? cur.orig : typeof b.orig === "string" ? b.orig : null;
  if (op.kind === "save") {
    t.run("INSERT INTO edit_log (org_id, case_id, key, orig, text, by_user_id, by_name, at) VALUES (?org, ?1, ?2, ?3, ?4, ?5, ?6, ?7)", id, key, orig, op.text, v.id, v.name, at);
    t.run(
      `INSERT INTO fact_edits (org_id, case_id, key, text, orig, by_user_id, by_name, at, log_id, extraction_run_id, fact_id)
       VALUES (?org, ?1, ?2, ?3, ?4, ?5, ?6, ?7, (SELECT MAX(id) FROM edit_log WHERE org_id = ?org AND case_id = ?1 AND key = ?2),
               (SELECT id FROM extraction_runs WHERE org_id = ?org AND case_id = ?1 AND is_current = 1), ?8)
       ON CONFLICT(case_id, key) DO UPDATE SET text = excluded.text, by_user_id = excluded.by_user_id, by_name = excluded.by_name,
         at = excluded.at, log_id = excluded.log_id, extraction_run_id = excluded.extraction_run_id, fact_id = excluded.fact_id`,
      id, key, op.text, orig, v.id, v.name, at, factId,
    );
    t.audit({ action: "fact.edit", what_cs: `upravil(a) údaj (${key})`, case_id: id, target_type: "fact", target_id: key });
  } else {
    // A revert is a new log row; the earlier edit stays visible in the case history.
    t.run("INSERT INTO edit_log (org_id, case_id, key, orig, text, reverted, by_user_id, by_name, at) VALUES (?org, ?1, ?2, ?3, ?4, 1, ?5, ?6, ?7)", id, key, orig, orig || GAP, v.id, v.name, at);
    t.run("DELETE FROM fact_edits WHERE org_id = ?org AND case_id = ?1 AND key = ?2", id, key);
    t.audit({ action: "fact.revert", what_cs: `vrátil(a) původní údaj (${key})`, case_id: id, target_type: "fact", target_id: key });
  }
  try {
    await t.commit();
  } catch (e) {
    if (e instanceof DomainError && e.code === "edit_conflict") {
      const now2 = await orgQuery(c, "SELECT by_name FROM fact_edits WHERE org_id = ?org AND case_id = ?1 AND key = ?2", id, key).first<{ by_name: string }>();
      throw D.editConflict(now2?.by_name ?? "");
    }
    throw e;
  }
  return answer(c, { changed: true }, { cases: await statesFor(c, [id]) });
}

// A retried request with the same key: the stored answer for the same body, a refusal for a different one.
export async function replayIdempotent(c: import("hono").Context<AppEnv>, key: string, route: string, sha: string) {
  const row = await orgQuery(c, "SELECT user_id, route, body_sha, response_json, status FROM idempotency_keys WHERE org_id = ?org AND user_id = ?2 AND key = ?1", key, c.var.viewer.id).first<{
    user_id: string;
    route: string;
    body_sha: string;
    response_json: string;
    status: number;
  }>();
  if (!row) return null;
  // Keys hold for 24 hours; after that the same key is a new request (the old row goes, it is not history).
  const created = await orgQuery(c, "SELECT created_at FROM idempotency_keys WHERE org_id = ?org AND user_id = ?2 AND key = ?1", key, c.var.viewer.id).first<{ created_at: string }>();
  if (created && created.created_at < new Date(now().getTime() - 24 * 3600_000).toISOString()) {
    await orgQuery(c, "DELETE FROM idempotency_keys WHERE org_id = ?org AND user_id = ?2 AND key = ?1", key, c.var.viewer.id).run();
    return null;
  }
  if (row.user_id !== c.var.viewer.id || row.route !== route || row.body_sha !== sha) throw D.idempotencyMismatch();
  const data = JSON.parse(row.response_json) as { case_id?: string };
  const caseId = route.startsWith("approve:") ? route.slice(8) : data.case_id;
  // A replay shows case data again, so it is an access like any other.
  await tx(c).audit({ action: "request.replay", what_cs: "zopakoval(a) požadavek (stejná odpověď)", case_id: caseId ?? null }).commit();
  const state: Record<string, unknown> = caseId ? { cases: await statesFor(c, [caseId]) } : {};
  if (route.startsWith("approve:") && caseId) state.mails = await work(c).mails([caseId]);
  if (route === "create_case" && caseId && !(data as { intake?: boolean }).intake) {
    const row2 = await c.var.stores.cases.caseById(caseId);
    if (row2) state.patient = patientRow(row2, await c.var.stores.cases.statusHistory(caseId));
  }
  return answer(c, data, state);
}

export const todayPrague = () => pragueDay(now());
