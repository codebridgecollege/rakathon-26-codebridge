// Reset-demo (step-4.md section 8): the shared demo goes back to its seeded state in one admin action. The audit
// trail since the last reset is archived to R2 first; nothing is deleted when the archive fails.
import { Hono } from "hono";
import type { AppEnv } from "../types";
import { D } from "../domain/errors";
import { assertCan } from "../domain/roles";
import { ApiError } from "../http/errors";
import { auditStatement } from "../store/write";
import { actorOf, answer, isoNow, label } from "./write-context";

// What the app writes, children first, so the deletes never leave a dangling reference mid-batch. patients is handled
// apart: seeded rows stay (identity is never copied out of D1), rows created after the seed go.
const MUTABLE_DELETE_ORDER = [
  "access_log", "jobs", "transcript_lines", "transcript_passes", "write_guards", "idempotency_keys", "case_access_grants",
  "notifications", "alert_events", "edit_log", "fact_edits", "question_confirmations", "tasks", "task_suggestions", "decisions",
  "protocols", "attendance_sets", "attendance", "sessions", "slots", "status_history", "case_members", "cases", "dept_members",
  "departments", "users",
];
// The append-only history archived before the reset (synthetic data only; same prefix as the later audit export).
const ARCHIVED = ["access_log", "decisions", "edit_log", "alert_events", "status_history", "question_confirmations"];
// Prefixes Steps 5 and 6 write; seed objects (pages/, extract/, guidance/, seed/, fixtures/) are never touched.
const R2_TRANSIENT = ["uploads/", "audio/", "jobs/"];

type ResetDoc = { seed_version: string; statements: string[]; patient_ids: string[] };

export const demo = new Hono<AppEnv>().post("/admin/reset-demo", async (c) => {
  label(c, "obnova ukázkových dat");
  assertCan(actorOf(c), "demo.reset");
  if (c.env.DEMO_RESET_ENABLED !== "true") throw D.resetDisabled();
  if (c.var.body.confirm !== "OBNOVIT") throw D.resetConfirm();
  const db = c.env.DB;
  const doc = await (await c.env.DOCS.get("seed/reset.json"))?.json<ResetDoc>();
  if (!doc || !Array.isArray(doc.statements) || !Array.isArray(doc.patient_ids)) throw new ApiError(503, "seed_missing", "Ukázková data na serveru chybí; spusťte seed (api/AGENTS.md).");
  const resetAt = isoNow();

  // 1. Archive. One batch of reads; the JSON lines go to R2 before anything is deleted.
  // Decisions are archived without the report HTML (its hash stays): the archive is a record of who did what, not a
  // second copy of the case content.
  const reads = await db.batch(
    ARCHIVED.map((t) =>
      db.prepare(
        t === "decisions"
          ? "SELECT id, case_id, version, approved_by_user_id, approved_by_name, approved_at, slot_day, slot_time, supersedes_id, json_extract(report_snapshot_json, '$.sha256') AS report_sha256 FROM decisions"
          : `SELECT * FROM ${t}`,
      ),
    ),
  );
  const lines = reads.flatMap((r, i) => (r.results as Record<string, unknown>[]).map((row) => JSON.stringify({ table: ARCHIVED[i], row })));
  // Rows written after this read would be deleted unarchived; the batch below refuses if any appeared.
  const archived = ARCHIVED.map((t, i) => ({ t, count: reads[i]!.results.length }));
  try {
    await c.env.DOCS.put(`audit-archive/${resetAt}.jsonl`, lines.join("\n") + "\n", { httpMetadata: { contentType: "application/x-ndjson" } });
  } catch {
    throw new ApiError(500, "reset_archive_failed", "Archiv záznamů se nepodařilo uložit; data zůstala beze změny.");
  }

  // 2. One D1 batch: open the append-only triggers, empty, reseed, close them, bump the epoch, log the reset.
  // Foreign keys are checked at commit, so the seeded rows can come back in any order.
  const v = c.var.viewer;
  const stmts: D1PreparedStatement[] = [
    db.prepare("PRAGMA defer_foreign_keys = on"),
    db
      .prepare(`INSERT INTO write_guards (batch_id, code, ok) SELECT 'reset', 'archived', CASE WHEN json_array(${archived.map((m) => `(SELECT COUNT(*) FROM ${m.t})`).join(", ")}) = ?1 THEN 1 ELSE 0 END`)
      .bind(JSON.stringify(archived.map((m) => m.count))),
    db.prepare("UPDATE demo_state SET reset_in_progress = 1 WHERE id = 1"),
    ...MUTABLE_DELETE_ORDER.map((t) => db.prepare(`DELETE FROM ${t}`)),
    db.prepare("DELETE FROM patients WHERE id NOT IN (SELECT value FROM json_each(?1))").bind(JSON.stringify(doc.patient_ids)),
    // Row IDs start where the seed left them, so a reset database equals a freshly seeded one.
    db.prepare("DELETE FROM sqlite_sequence WHERE name IN (SELECT value FROM json_each(?1))").bind(JSON.stringify(MUTABLE_DELETE_ORDER)),
    ...doc.statements.map((s) => db.prepare(s)),
    db
      .prepare("UPDATE demo_state SET reset_in_progress = 0, data_epoch = data_epoch + 1, reset_at = ?1, reset_by = ?2, seed_version = ?3 WHERE id = 1")
      .bind(resetAt, v.name, doc.seed_version),
  ];
  const epochAfter = (c.var.epoch ?? 0) + 1;
  stmts.push(
    auditStatement(db, v, { action: "demo.reset", what_cs: `obnovil(a) ukázková data (seed ${doc.seed_version})` }, { requestId: c.req.header("cf-ray") ?? null, epoch: epochAfter }),
  );
  try {
    await db.batch(stmts);
  } catch (e) {
    // A write landed between the archive and the batch; nothing was deleted, the admin runs the reset again.
    if (/CHECK constraint failed/.test(e instanceof Error ? e.message : "")) throw D.conflict();
    throw e;
  }

  // 3. R2 objects written by later steps. A failure is reported and retried by the next reset.
  let left = 0;
  for (const prefix of R2_TRANSIENT) {
    try {
      let cursor: string | undefined;
      do {
        const page = await c.env.DOCS.list({ prefix, cursor, limit: 500 });
        if (page.objects.length) await c.env.DOCS.delete(page.objects.map((o) => o.key));
        cursor = page.truncated ? page.cursor : undefined;
      } while (cursor);
    } catch {
      left += 1;
    }
  }
  c.set("epoch", epochAfter);
  return answer(c, { data_epoch: epochAfter, reset_at: resetAt, seed_version: doc.seed_version, r2_left: left, statements: stmts.length });
});

