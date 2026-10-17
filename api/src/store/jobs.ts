// Jobs the page polls (step-5.md "As implemented", status reporting). A job row points to one Workflow instance; the
// engine's own status is read only when the row looks stuck, and its error text is never copied out.
import { engineToJob } from "../domain/transcript";
import type { SpeakerPassParams } from "../workflows/speaker-pass";

export type JobRow = {
  id: string;
  kind: string;
  case_id: string;
  workflow: string;
  instance_id: string;
  attempt: number;
  state: "queued" | "running" | "done" | "error";
  phase: string | null;
  error_code: string | null;
  result_ref: string | null;
  created_by: string;
  updated_at: string;
};

// Instance state is kept as briefly as the engine allows us to ask for; it holds ids and counts only anyway.
const RETENTION = { successRetention: "1 day", errorRetention: "3 days" } as const;
// A row not touched for this long while queued or running is checked against the engine.
export const STALE_MS = 2 * 60_000;

export const jobById = (db: D1Database, id: string) =>
  db.prepare("SELECT id, kind, case_id, workflow, instance_id, attempt, state, phase, error_code, result_ref, created_by, updated_at FROM jobs WHERE id = ?1").bind(id).first<JobRow>();

// Creates the job's Workflow instance. The instance id is fixed by the job row, so a second start of the same attempt
// finds the instance already there and does nothing. A failure leaves the job as error/start_failed for a retry.
export async function startJob(env: Env, jobId: string): Promise<boolean> {
  const j = await jobById(env.DB, jobId);
  if (!j || !j.result_ref) return false;
  const params: SpeakerPassParams = { caseId: j.case_id, passId: j.result_ref, jobId: j.id };
  try {
    await env.SPEAKER_PASS.create({ id: j.instance_id, params, retention: RETENTION, locationHint: "weur" });
    return true;
  } catch (e) {
    const msg = e instanceof Error ? e.message : "";
    if (/already exists|already_exists|duplicate/i.test(msg)) return true;
    // The type only: the message may name the instance or the account.
    console.error(JSON.stringify({ job: "start_failed", error: e instanceof Error ? e.name : "Error" }));
    // The pass too, so the page offers "Zkusit znovu" instead of "Rozlišuji mluvčí…", and the seminar's end and the sweep
    // treat its audio as not in use.
    const at = new Date().toISOString();
    await env.DB.batch([
      env.DB.prepare("UPDATE jobs SET state = 'error', error_code = 'start_failed', updated_at = ?1 WHERE id = ?2 AND instance_id = ?3").bind(at, jobId, j.instance_id),
      env.DB.prepare("UPDATE transcript_passes SET state = 'error', error_code = 'start_failed', updated_at = ?1 WHERE id = ?2 AND state = 'queued'").bind(at, j.result_ref),
    ]);
    return false;
  }
}

// Brings a stuck row in line with the engine: a dead instance (errored, terminated) or one that finished without
// writing its last step. The engine's error message is not stored or returned.
export async function reconcile(env: Env, j: JobRow, now = Date.now()): Promise<JobRow> {
  if (j.state !== "queued" && j.state !== "running") return j;
  if (now - Date.parse(j.updated_at) < STALE_MS) return j;
  let status: string;
  try {
    status = (await (await env.SPEAKER_PASS.get(j.instance_id)).status()).status;
  } catch {
    // No instance at all: the start never reached the engine.
    status = "missing";
  }
  const mapped = status === "missing" ? "error" : engineToJob(status);
  if (mapped === "queued" || mapped === "running") return j;
  const code = status === "missing" ? "start_failed" : mapped === "error" ? `workflow_${status}` : "workflow_incomplete";
  const at = new Date(now).toISOString();
  await env.DB.batch([
    env.DB.prepare("UPDATE jobs SET state = 'error', phase = NULL, error_code = ?1, updated_at = ?2 WHERE id = ?3 AND state IN ('queued','running')").bind(code, at, j.id),
    env.DB.prepare("UPDATE transcript_passes SET state = 'error', error_code = ?1, updated_at = ?2 WHERE job_id = ?3 AND state IN ('queued','running')").bind(code, at, j.id),
  ]);
  return { ...j, state: "error", phase: null, error_code: code, updated_at: at };
}

export const jobView = (j: JobRow) => ({
  id: j.id,
  kind: j.kind,
  case_id: j.case_id,
  state: j.state,
  phase: j.phase,
  error_code: j.error_code,
  result_ref: j.result_ref,
  attempt: j.attempt,
  updated_at: j.updated_at,
});
