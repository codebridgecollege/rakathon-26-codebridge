// Reset-demo (step-4.md section 8, docs/design/AUTH.md "Demo reset is per org"): one demo org goes back to its seeded
// state in one admin action of that org. The org's audit trail since its last reset is archived to R2 first; nothing
// is deleted when the archive fails. Every read, delete and trigger is scoped to the org, its data epoch alone moves,
// and people (users) and their identities are never deleted, so a reset in org A never touches a demo running in org B.
import { Hono } from "hono";
import type { AppEnv } from "../types";
import { D } from "@codebridge/domain/errors";
import { assertCan } from "@codebridge/domain/roles";
import { ApiError } from "../http/errors";
import { auditStatement } from "../store/write";
import { orgKey, orgStmt } from "../store/sql";
import { orgById } from "../store/people";
import { LEGACY_ORG } from "../domain/orgs";
import { actorOf, answer, isoNow, label } from "./write-context";

// What the app writes in an org, children first, so the deletes never leave a dangling reference mid-batch. patients
// is handled apart: seeded rows stay (identity is never copied out of D1), rows created after the seed go.
// memberships are not deleted either: the reset statements restore the seeded ones and the others are ended below, so
// a membership id (and a login session that acts with it, from step 3) stays valid.
const MUTABLE_DELETE_ORDER = [
  "access_log", "audio_segments", "audio_parts", "audio_uploads", "transcript_summaries", "transcript_lines",
  "transcript_passes", "jobs", "recordings", "write_guards", "idempotency_keys", "case_access_grants",
  "notifications", "alert_events", "edit_log", "fact_edits", "question_confirmations", "tasks", "task_suggestions", "decisions",
  "protocols", "attendance_sets", "attendance", "sessions", "slots", "status_history", "case_members", "cases", "dept_members",
  "departments",
] as const;
// The append-only history archived before the reset (synthetic data only).
const ARCHIVED = ["access_log", "decisions", "edit_log", "alert_events", "status_history", "question_confirmations"] as const;
// Prefixes Steps 5 and 6 write, under the org; seed objects (pages/, docs/, extract/, guidance/, seed/, fixtures/) are
// never touched.
const R2_TRANSIENT = ["uploads/", "audio/", "jobs/", "cache/summary/", "cache/model/"];

// seed/reset.json (written by seed.py): one section per demo org.
type ResetSection = { statements: string[]; patient_ids: string[]; membership_ids: string[] };
type ResetDoc = { seed_version: string; orgs?: Record<string, ResetSection> };

export const demo = new Hono<AppEnv>().post("/admin/reset-demo", async (c) => {
  label(c, "obnova ukázkových dat");
  assertCan(actorOf(c), "demo.reset");
  if (c.env.DEMO_RESET_ENABLED !== "true") throw D.resetDisabled();
  if (c.var.body.confirm !== "OBNOVIT") throw D.resetConfirm();
  const db = c.env.DB;
  const v = c.var.viewer;
  const org = v.org;
  // Only a demo org resets: a hospital org's data is never wiped by this route, whatever the switch says.
  if ((await orgById(db, org))?.is_demo !== 1) throw D.resetDisabled();
  const doc = await (await c.env.DOCS.get("seed/reset.json"))?.json<ResetDoc>();
  const sec = doc?.orgs?.[org];
  if (!doc || !sec || !Array.isArray(sec.statements) || !Array.isArray(sec.patient_ids) || !Array.isArray(sec.membership_ids))
    throw new ApiError(503, "seed_missing", "Ukázková data na serveru chybí; spusťte seed (api/AGENTS.md).");
  const resetAt = isoNow();
  const q = (sql: string, ...args: unknown[]) => orgStmt(db, org, sql, ...args);

  // 1. Archive this org's history. One batch of reads; the JSON lines go to R2 before anything is deleted.
  // Decisions are archived without the report HTML (its hash stays): the archive is a record of who did what, not a
  // second copy of the case content.
  const reads = await db.batch(
    ARCHIVED.map((t) =>
      t === "decisions"
        ? q("SELECT id, case_id, version, approved_by_user_id, approved_by_name, approved_at, slot_day, slot_time, supersedes_id, json_extract(report_snapshot_json, '$.sha256') AS report_sha256 FROM decisions WHERE org_id = ?org")
        : q(`SELECT * FROM ${t} WHERE org_id = ?org`),
    ),
  );
  const lines = reads.flatMap((r, i) => (r.results as Record<string, unknown>[]).map((row) => JSON.stringify({ table: ARCHIVED[i], row })));
  // Rows written after this read would be deleted unarchived; the batch below refuses if any appeared.
  const archived = ARCHIVED.map((t, i) => ({ t, count: reads[i]!.results.length }));
  try {
    await c.env.DOCS.put(orgKey(org, `audit-archive/${resetAt}.jsonl`), lines.join("\n") + "\n", { httpMetadata: { contentType: "application/x-ndjson" } });
  } catch {
    throw new ApiError(500, "reset_archive_failed", "Archiv záznamů se nepodařilo uložit; data zůstala beze změny.");
  }

  // Open multipart uploads of case audio are not listed as objects; abort them while D1 still knows them (step 5).
  // A failure is left to the R2 lifecycle rule, which aborts incomplete uploads under audio/ after a day.
  const open = (await q("SELECT r2_key, r2_upload_id FROM audio_uploads WHERE org_id = ?org AND state = 'open' AND r2_upload_id IS NOT NULL").all<{ r2_key: string; r2_upload_id: string }>()).results;
  for (const u of open) await c.env.DOCS.resumeMultipartUpload(u.r2_key, u.r2_upload_id).abort().catch(() => {});

  // 2. One D1 batch: open the append-only triggers for this org, empty its tables, reseed it, close them, bump its
  // epoch, log the reset. Foreign keys are checked at commit, so the seeded rows can come back in any order.
  const stmts: D1PreparedStatement[] = [
    db.prepare("PRAGMA defer_foreign_keys = on"),
    q(
      `INSERT INTO write_guards (org_id, batch_id, code, ok) SELECT ?org, 'reset', 'archived',
         CASE WHEN json_array(${archived.map((m) => `(SELECT COUNT(*) FROM ${m.t} WHERE org_id = ?org)`).join(", ")}) = ?1 THEN 1 ELSE 0 END`,
      JSON.stringify(archived.map((m) => m.count)),
    ),
    // The triggers of migration 0011 remove this org's uploaded documents, intake runs and upload sessions on it.
    q("UPDATE demo_state SET reset_in_progress = 1 WHERE org_id = ?org"),
    ...MUTABLE_DELETE_ORDER.map((t) => q(`DELETE FROM ${t} WHERE org_id = ?org`)),
    q("DELETE FROM patients WHERE org_id = ?org AND id NOT IN (SELECT value FROM json_each(?1))", JSON.stringify(sec.patient_ids)),
    // Memberships added after the seed end (the people stay); the seeded ones are restored by the statements below.
    q("UPDATE memberships SET active_until = ?1 WHERE org_id = ?org AND active_until IS NULL AND id NOT IN (SELECT value FROM json_each(?2))", resetAt, JSON.stringify(sec.membership_ids)),
    ...sec.statements.map((s) => db.prepare(s)),
    q("UPDATE demo_state SET reset_in_progress = 0, data_epoch = data_epoch + 1, reset_at = ?1, reset_by = ?2, seed_version = ?3 WHERE org_id = ?org", resetAt, v.actor?.name ?? v.name, doc.seed_version),
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

  // 3. R2 objects this org's later steps wrote. Demo org A also had them under the prefixes used before orgs. A
  // failure is reported and retried by the next reset.
  const prefixes = [...R2_TRANSIENT.map((p) => orgKey(org, p)), ...(org === LEGACY_ORG ? R2_TRANSIENT : [])];
  let left = 0;
  for (const prefix of prefixes) {
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
