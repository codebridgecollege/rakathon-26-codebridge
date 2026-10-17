// Intake on the server (step 6): what decides an intake, and removing an intake that was never completed (the dialog
// closed, "Zpět", or the cron sweep after 24 hours).
import type { Viewer } from "../domain/access";
import { evaluateIntake, intakeFixtureOf, type IntakeDoc } from "../domain/intake";
import { auditStatement } from "./write";
import { actorFor } from "./audio";
import { fixtureFiles } from "./documents";

// Open intakes older than this are removed with their files: an abandoned upload is data nobody will look at.
export const INTAKE_MAX_AGE_MS = 24 * 3600_000;

export async function intakeState(db: D1Database, caseId: string) {
  const docs = (
    await db.prepare("SELECT id, sha256, fixture_id, file_name FROM documents WHERE case_id = ?1 AND origin = 'upload' ORDER BY created_at, id").bind(caseId).all<IntakeDoc>()
  ).results;
  const fid = intakeFixtureOf(docs);
  const [files, fp, patient, attached] = await Promise.all([
    fid ? fixtureFiles(db, fid, "upload") : Promise.resolve([]),
    fid ? db.prepare("SELECT full_name, birth_number FROM fixture_patients WHERE fixture_id = ?1").bind(fid).first<{ full_name: string; birth_number: string | null }>() : null,
    db.prepare("SELECT p.full_name, p.birth_number FROM cases c JOIN patients p ON p.id = c.patient_id WHERE c.id = ?1").bind(caseId).first<{ full_name: string; birth_number: string | null }>(),
    fid ? db.prepare("SELECT 1 AS x FROM cases WHERE intake_fixture = ?1 AND intake_open = 0").bind(fid).first() : null,
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
export async function discardIntake(env: Env, caseId: string, actor: Viewer | null, requestId: string | null, why: "user" | "sweep") {
  const db = env.DB;
  const c = await db.prepare("SELECT patient_id, created_by FROM cases WHERE id = ?1 AND intake_open = 1").bind(caseId).first<{ patient_id: string; created_by: string | null }>();
  if (!c) return false;
  const who = actor ?? (await actorFor(db, c.created_by ?? "system", env.AUTH_MODE === "access" ? "access" : "demo"));
  await db.batch([
    db.prepare("INSERT INTO write_guards (batch_id, code, ok) SELECT ?1, 'intake_open', CASE WHEN (SELECT intake_open FROM cases WHERE id = ?2) = 1 THEN 1 ELSE 0 END").bind(`discard-${caseId}`, caseId),
    db.prepare("DELETE FROM pages WHERE document_id IN (SELECT id FROM documents WHERE case_id = ?1)").bind(caseId),
    db.prepare("DELETE FROM document_parts WHERE document_id IN (SELECT id FROM documents WHERE case_id = ?1)").bind(caseId),
    db.prepare("DELETE FROM documents WHERE case_id = ?1").bind(caseId),
    db.prepare("DELETE FROM case_members WHERE case_id = ?1").bind(caseId),
    // Grants cannot be made on an open intake today; removed anyway so a stray row never blocks the discard.
    db.prepare("DELETE FROM case_access_grants WHERE case_id = ?1").bind(caseId),
    db.prepare("DELETE FROM pipeline_runs WHERE case_id = ?1").bind(caseId),
    db.prepare("DELETE FROM cases WHERE id = ?1").bind(caseId),
    // The patient row was created with this intake; another case never shares it (POST /cases makes one per case).
    db.prepare("DELETE FROM patients WHERE id = ?1 AND NOT EXISTS (SELECT 1 FROM cases WHERE patient_id = ?1)").bind(c.patient_id),
    auditStatement(db, who, { action: "intake.discard", what_cs: why === "user" ? "zrušil(a) rozpracovaný příjem pacienta (dokumenty smazány)" : "rozpracovaný příjem pacienta smazán po 24 hodinách (dokumenty smazány)", case_id: caseId }, { requestId, epoch: null }),
    db.prepare("DELETE FROM write_guards WHERE batch_id = ?1").bind(`discard-${caseId}`),
  ]);
  await deletePrefix(env.DOCS, `uploads/${caseId}/`);
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

export async function sweepIntakes(env: Env, nowMs: number) {
  const old = (
    await env.DB.prepare("SELECT id FROM cases WHERE intake_open = 1 AND created_at < ?1 LIMIT 20").bind(new Date(nowMs - INTAKE_MAX_AGE_MS).toISOString()).all<{ id: string }>()
  ).results;
  let removed = 0;
  for (const r of old) if (await discardIntake(env, r.id, null, null, "sweep").catch(() => false)) removed++;
  return removed;
}

// Pipeline runs (step 6) whose Workflow died outside a step, or whose fail step itself failed, would stay "zpracovává
// se" and block every rerun (one active run per document). A run untouched for 30 minutes is checked against the engine;
// one the engine no longer runs, or that has run for over two hours, is marked failed with a fixed code.
export const PIPELINE_STALE_MS = 30 * 60_000;
const PIPELINE_MAX_MS = 2 * 3600_000;

export async function reconcilePipelineRuns(env: Env, nowMs: number) {
  const rows = (
    await env.DB.prepare("SELECT id, document_id, created_at FROM pipeline_runs WHERE state IN ('queued','running') AND updated_at < ?1 LIMIT 20")
      .bind(new Date(nowMs - PIPELINE_STALE_MS).toISOString())
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
      env.DB.prepare("UPDATE pipeline_runs SET state = 'error', error_code = 'stalled', finished_at = ?1, updated_at = ?1 WHERE id = ?2 AND state IN ('queued','running')").bind(at, r.id),
      env.DB.prepare("UPDATE documents SET state = 'failed', state_detail_cs = 'zpracování se nedokončilo; zkuste to znovu' WHERE id = ?1 AND origin = 'upload' AND state IN ('queued','processing')").bind(r.document_id),
    ]);
    failed++;
  }
  return failed;
}
