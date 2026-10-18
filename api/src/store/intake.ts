// Intake on the server (step 6): what decides an intake, and removing an intake that was never completed (the dialog
// closed, "Zpět", or the cron sweep after 24 hours).
import type { Viewer } from "@codebridge/domain/access";
import { evaluateIntake, intakeFixtureOf, type IntakeDoc } from "../domain/intake";
import { auditStatement } from "./write";
import { actorFor } from "./audio";
import { fixtureFiles } from "./documents";
import { orgKey, orgStmt } from "./sql";
import { LEGACY_ORG } from "../domain/orgs";

// Open intakes older than this are removed with their files: an abandoned upload is data nobody will look at.
export const INTAKE_MAX_AGE_MS = 24 * 3600_000;

export async function intakeState(db: D1Database, org: string, caseId: string) {
  const docs = (
    await orgStmt(db, org, "SELECT id, sha256, fixture_id, file_name FROM documents WHERE org_id = ?org AND case_id = ?1 AND origin = 'upload' ORDER BY created_at, id", caseId).all<IntakeDoc>()
  ).results;
  const fid = intakeFixtureOf(docs);
  const [files, fp, patient, attached] = await Promise.all([
    fid ? fixtureFiles(db, fid, "upload") : Promise.resolve([]),
    fid ? db.prepare("SELECT full_name, birth_number FROM fixture_patients WHERE fixture_id = ?1").bind(fid).first<{ full_name: string; birth_number: string | null }>() : null,
    orgStmt(db, org, "SELECT p.full_name, p.birth_number FROM cases c JOIN patients p ON p.id = c.patient_id AND p.org_id = c.org_id WHERE c.org_id = ?org AND c.id = ?1", caseId).first<{ full_name: string; birth_number: string | null }>(),
    fid ? orgStmt(db, org, "SELECT 1 AS x FROM cases WHERE org_id = ?org AND intake_fixture = ?1 AND intake_open = 0", fid).first() : null,
  ]);
  const verdict = evaluateIntake({
    docs,
    fixture: fid && fp ? { id: fid, files, patient: fp } : null,
    patient: patient ?? { full_name: "", birth_number: null },
    attachedElsewhere: !!attached,
  });
  return { docs, files, verdict };
}

// One batch removes the intake's rows; its files go after the commit. Nothing else can reference an open intake: the
// write routes refuse every change but uploads to it (routes/write-context.ts).
export async function discardIntake(env: Env, org: string, caseId: string, actor: Viewer | null, requestId: string | null, why: "user" | "sweep") {
  const db = env.DB;
  const c = await orgStmt(db, org, "SELECT patient_id, created_by FROM cases WHERE org_id = ?org AND id = ?1 AND intake_open = 1", caseId).first<{ patient_id: string; created_by: string | null }>();
  if (!c) return false;
  const who = actor ?? (await actorFor(db, org, c.created_by ?? "system", env.AUTH_MODE === "access" ? "access" : "demo"));
  await db.batch([
    orgStmt(db, org, "INSERT INTO write_guards (org_id, batch_id, code, ok) SELECT ?org, ?1, 'intake_open', CASE WHEN (SELECT intake_open FROM cases WHERE org_id = ?org AND id = ?2) = 1 THEN 1 ELSE 0 END", `discard-${caseId}`, caseId),
    orgStmt(db, org, "DELETE FROM pages WHERE org_id = ?org AND document_id IN (SELECT id FROM documents WHERE org_id = ?org AND case_id = ?1)", caseId),
    orgStmt(db, org, "DELETE FROM document_parts WHERE org_id = ?org AND document_id IN (SELECT id FROM documents WHERE org_id = ?org AND case_id = ?1)", caseId),
    orgStmt(db, org, "DELETE FROM documents WHERE org_id = ?org AND case_id = ?1", caseId),
    orgStmt(db, org, "DELETE FROM case_members WHERE org_id = ?org AND case_id = ?1", caseId),
    // Grants cannot be made on an open intake today; removed anyway so a stray row never blocks the discard.
    orgStmt(db, org, "DELETE FROM case_access_grants WHERE org_id = ?org AND case_id = ?1", caseId),
    orgStmt(db, org, "DELETE FROM pipeline_runs WHERE org_id = ?org AND case_id = ?1", caseId),
    orgStmt(db, org, "DELETE FROM cases WHERE org_id = ?org AND id = ?1", caseId),
    // A phone still holding this intake's QR code must not reach a later case that reuses the ID (PHONE-UPLOAD.md).
    orgStmt(db, org, "UPDATE upload_sessions SET closed_at = ?2 WHERE org_id = ?org AND case_id = ?1 AND closed_at IS NULL", caseId, new Date().toISOString()),
    // The patient row was created with this intake; another case never shares it (POST /cases makes one per case).
    orgStmt(db, org, "DELETE FROM patients WHERE org_id = ?org AND id = ?1 AND NOT EXISTS (SELECT 1 FROM cases WHERE org_id = ?org AND patient_id = ?1)", c.patient_id),
    auditStatement(db, who, { action: "intake.discard", what_cs: why === "user" ? "zrušil(a) rozpracovaný příjem pacienta (dokumenty smazány)" : "rozpracovaný příjem pacienta smazán po 24 hodinách (dokumenty smazány)", case_id: caseId }, { requestId, epoch: null }),
    orgStmt(db, org, "DELETE FROM write_guards WHERE org_id = ?org AND batch_id = ?1", `discard-${caseId}`),
  ]);
  // The intake's files: under the org, and for demo org A also under the prefix used before orgs.
  await deletePrefix(env.DOCS, orgKey(org, `uploads/${caseId}/`));
  if (org === LEGACY_ORG) await deletePrefix(env.DOCS, `uploads/${caseId}/`);
  return true;
}

export async function deletePrefix(bucket: R2Bucket, prefix: string) {
  let cursor: string | undefined;
  do {
    const page = await bucket.list({ prefix, cursor, limit: 500 });
    if (page.objects.length) await bucket.delete(page.objects.map((o) => o.key));
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
}

export async function sweepIntakes(env: Env, org: string, nowMs: number) {
  const old = (
    await orgStmt(env.DB, org, "SELECT id FROM cases WHERE org_id = ?org AND intake_open = 1 AND created_at < ?1 LIMIT 20", new Date(nowMs - INTAKE_MAX_AGE_MS).toISOString()).all<{ id: string }>()
  ).results;
  let removed = 0;
  for (const r of old) if (await discardIntake(env, org, r.id, null, null, "sweep").catch(() => false)) removed++;
  return removed;
}

// Pipeline runs (step 6) whose Workflow died outside a step, or whose fail step itself failed, would stay "zpracovává
// se" and block every rerun (one active run per document). A run untouched for 30 minutes is checked against the engine;
// one the engine no longer runs, or that has run for over two hours, is marked failed with a fixed code.
export const PIPELINE_STALE_MS = 30 * 60_000;
const PIPELINE_MAX_MS = 2 * 3600_000;

export async function reconcilePipelineRuns(env: Env, org: string, nowMs: number) {
  const rows = (
    await orgStmt(env.DB, org, "SELECT id, document_id, created_at FROM pipeline_runs WHERE org_id = ?org AND state IN ('queued','running') AND updated_at < ?1 LIMIT 20", new Date(nowMs - PIPELINE_STALE_MS).toISOString())
      .all<{ id: string; document_id: string; created_at: string }>()
  ).results;
  let failed = 0;
  for (const r of rows) {
    let alive = false;
    try {
      const st = await (await env.PROCESS_DOCUMENT.get(r.id)).status();
      alive = ["queued", "running", "waiting", "paused", "waitingForPause"].includes(st.status);
    } catch {
      alive = false; // no such instance: it never started or its record expired
    }
    if (alive && nowMs - Date.parse(r.created_at) < PIPELINE_MAX_MS) continue;
    const at = new Date(nowMs).toISOString();
    await env.DB.batch([
      orgStmt(env.DB, org, "UPDATE pipeline_runs SET state = 'error', error_code = 'stalled', finished_at = ?1, updated_at = ?1 WHERE org_id = ?org AND id = ?2 AND state IN ('queued','running')", at, r.id),
      orgStmt(env.DB, org, "UPDATE documents SET state = 'failed', state_detail_cs = 'zpracování se nedokončilo; zkuste to znovu' WHERE org_id = ?org AND id = ?1 AND origin = 'upload' AND state IN ('queued','processing')", r.document_id),
    ]);
    failed++;
  }
  return failed;
}
