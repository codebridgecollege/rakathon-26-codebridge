// The cron sweep (wrangler.jsonc triggers.crons, every 15 minutes): deletes audio that every other path should already
// have deleted, starts speaker passes whose start failed, and clears expired login sessions. The R2 lifecycle rule on
// audio/ is the backstop behind this (api/AGENTS.md, "AI recording and the speaker pass"). It runs without a request,
// so it goes through the orgs one by one and gives each store function the org as a parameter, as a route would.
import { purgeUploads, uploadsForSweep } from "./store/audio";
import { reconcile, startJob, type JobRow } from "./store/jobs";
import { transcriptsOn } from "./routes/hooks";
import { reconcilePipelineRuns, sweepIntakes } from "./store/intake";
import { orgStmt } from "./store/sql";
import { sweepSessions } from "./auth/session";
import { deleteDocumentObjects } from "./routes/documents";
import { scrubRunsOf } from "./store/case-merge";

// Audio no pass has claimed goes after six hours: no case is discussed that long. Audio a failed pass kept for
// "Zkusit znovu" goes after seven days at the latest, the same as the R2 lifecycle rule (user decision 2026-10-18).
export const AUDIO_MAX_AGE_MS = 6 * 3600_000;
export const KEPT_AUDIO_MAX_AGE_MS = 7 * 24 * 3600_000;

type Counts = { purged: number; failed: number; restarted: number };

export async function sweep(env: Env, nowMs = Date.now()): Promise<Counts> {
  // Deletion depends on the storage only, not on the feature switch: switching the recorder off must not keep audio.
  if (!env.DB || !env.DOCS) return { purged: 0, failed: 0, restarted: 0 };
  const total: Counts = { purged: 0, failed: 0, restarted: 0 };
  let orgs: string[] = [];
  try {
    // The org list is global; everything after it is per org.
    orgs = (await env.DB.prepare("SELECT id FROM orgs ORDER BY created_at, id").all<{ id: string }>()).results.map((o) => o.id);
  } catch {
    total.failed += 1;
  }
  for (const org of orgs) {
    // One org's failure must not stop the sweep of the others.
    const r = await sweepOrg(env, org, nowMs).catch(() => ({ purged: 0, failed: 1, restarted: 0 }));
    total.purged += r.purged;
    total.failed += r.failed;
    total.restarted += r.restarted;
  }
  // Login sessions of every org: the ID token of an expired one goes at once, the row 30 days later (AUTH.md).
  await sweepSessions(env.DB, nowMs).catch(() => {
    total.failed += 1;
  });
  // Counts only: no org, case ids or keys in the Worker log.
  console.log(JSON.stringify({ cron: "audio_sweep", ...total }));
  return total;
}

async function sweepOrg(env: Env, org: string, nowMs: number): Promise<Counts> {
  let ups: Awaited<ReturnType<typeof uploadsForSweep>> = [];
  let purged = 0;
  let failed = 0;
  try {
    ups = await uploadsForSweep(env.DB, org, new Date(nowMs - AUDIO_MAX_AGE_MS).toISOString(), new Date(nowMs - KEPT_AUDIO_MAX_AGE_MS).toISOString());
  } catch {
    // A failed audio query must not skip the other clean-ups below (intakes, upload sessions, pipeline runs).
    failed += 1;
  }
  // One at a time, so one stuck object does not keep the others.
  for (const u of ups) {
    try {
      purged += (await purgeUploads(env, org, [u], "kontrola uchování", null, null, "AI záznam: zvuk smazán (kontrola uchování)")).deleted;
    } catch {
      failed += 1;
    }
  }
  // Step 6: an intake nobody completed within 24 hours goes with its uploaded files.
  try {
    await sweepIntakes(env, org, nowMs);
  } catch {
    failed += 1;
  }
  // Issue #10: upload sessions are permissions, not records; a day after their expiry nothing needs the row.
  try {
    await orgStmt(env.DB, org, "DELETE FROM upload_sessions WHERE org_id = ?org AND expires_at < ?1", new Date(nowMs - 24 * 3600_000).toISOString()).run();
  } catch {
    failed += 1;
  }
  // Issue #18: a document withdrawn as another patient's loses its R2 content right away; a delete that failed then is
  // done again here for a week (deleting nothing twice costs one list call per prefix).
  try {
    const gone = await orgStmt(env.DB, org, "SELECT id, case_id, lifecycle_changed_at FROM documents WHERE org_id = ?org AND lifecycle = 'withdrawn' AND lifecycle_changed_at > ?1 LIMIT 100", new Date(nowMs - 7 * 24 * 3600_000).toISOString())
      .all<{ id: string; case_id: string; lifecycle_changed_at: string }>();
    for (const d of gone.results) {
      await deleteDocumentObjects(env, org, d.case_id, d.id, d.lifecycle_changed_at);
      // And the stored runs that still read it (a scrub the withdraw could not finish, or a merge that raced it).
      await scrubRunsOf(env, org, d.case_id, d.id);
    }
  } catch {
    failed += 1;
  }
  // Step 6: pipeline runs the engine no longer runs are marked failed, so a rerun is possible.
  try {
    if (env.PROCESS_DOCUMENT) await reconcilePipelineRuns(env, org, nowMs);
  } catch {
    failed += 1;
  }
  let restarted = 0;
  if (!transcriptsOn(env)) return { purged, failed, restarted };
  const jobs = (
    await orgStmt(
      env.DB,
      org,
      "SELECT id, org_id, kind, case_id, workflow, instance_id, attempt, state, phase, error_code, result_ref, created_by, updated_at FROM jobs WHERE org_id = ?org AND ((state = 'error' AND error_code = 'start_failed') OR state IN ('queued','running')) LIMIT 50",
    ).all<JobRow>()
  ).results;
  for (const j of jobs) {
    try {
      if (j.state === "error") {
        // Back to queued under the same instance id, then started; a job that fails again waits for the next sweep.
        const at = new Date(nowMs).toISOString();
        await env.DB.batch([
          orgStmt(env.DB, org, "UPDATE jobs SET state = 'queued', error_code = NULL, updated_at = ?1 WHERE org_id = ?org AND id = ?2 AND state = 'error' AND error_code = 'start_failed'", at, j.id),
          orgStmt(env.DB, org, "UPDATE transcript_passes SET state = 'queued', error_code = NULL, updated_at = ?1 WHERE org_id = ?org AND id = ?2 AND state = 'error' AND error_code = 'start_failed'", at, j.result_ref),
        ]);
        if (await startJob(env, org, j.id)) restarted += 1;
      } else await reconcile(env, j, nowMs);
    } catch {
      failed += 1;
    }
  }
  return { purged, failed, restarted };
}
