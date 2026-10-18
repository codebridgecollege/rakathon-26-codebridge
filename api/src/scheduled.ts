// The cron sweep (wrangler.jsonc triggers.crons, every 15 minutes): deletes audio that every other path should already
// have deleted, and starts speaker passes whose start failed. The R2 lifecycle rule on audio/ is the backstop behind
// this (api/AGENTS.md, "AI recording and the speaker pass").
import { purgeUploads, uploadsForSweep } from "./store/audio";
import { reconcile, startJob, type JobRow } from "./store/jobs";
import { transcriptsOn } from "./routes/hooks";
import { reconcilePipelineRuns, sweepIntakes } from "./store/intake";

// Audio no pass has claimed goes after six hours: no case is discussed that long. Audio a failed pass kept for
// "Zkusit znovu" goes after seven days at the latest, the same as the R2 lifecycle rule (user decision 2026-10-18).
export const AUDIO_MAX_AGE_MS = 6 * 3600_000;
export const KEPT_AUDIO_MAX_AGE_MS = 7 * 24 * 3600_000;

export async function sweep(env: Env, nowMs = Date.now()): Promise<{ purged: number; failed: number; restarted: number }> {
  // Deletion depends on the storage only, not on the feature switch: switching the recorder off must not keep audio.
  if (!env.DB || !env.DOCS) return { purged: 0, failed: 0, restarted: 0 };
  let ups: Awaited<ReturnType<typeof uploadsForSweep>> = [];
  let purged = 0;
  let failed = 0;
  try {
    ups = await uploadsForSweep(env.DB, new Date(nowMs - AUDIO_MAX_AGE_MS).toISOString(), new Date(nowMs - KEPT_AUDIO_MAX_AGE_MS).toISOString());
  } catch {
    // A failed audio query must not skip the other clean-ups below (intakes, upload sessions, pipeline runs).
    failed += 1;
  }
  // One at a time, so one stuck object does not keep the others.
  for (const u of ups) {
    try {
      purged += (await purgeUploads(env, [u], "kontrola uchování", null, null, "AI záznam: zvuk smazán (kontrola uchování)")).deleted;
    } catch {
      failed += 1;
    }
  }
  // Step 6: an intake nobody completed within 24 hours goes with its uploaded files.
  try {
    await sweepIntakes(env, nowMs);
  } catch {
    failed += 1;
  }
  // Issue #10: upload sessions are permissions, not records; a day after their expiry nothing needs the row.
  try {
    await env.DB.prepare("DELETE FROM upload_sessions WHERE expires_at < ?1").bind(new Date(nowMs - 24 * 3600_000).toISOString()).run();
  } catch {
    failed += 1;
  }
  // Step 6: pipeline runs the engine no longer runs are marked failed, so a rerun is possible.
  try {
    if (env.PROCESS_DOCUMENT) await reconcilePipelineRuns(env, nowMs);
  } catch {
    failed += 1;
  }
  let restarted = 0;
  if (!transcriptsOn(env)) {
    console.log(JSON.stringify({ cron: "audio_sweep", purged, failed, restarted }));
    return { purged, failed, restarted };
  }
  const jobs = (
    await env.DB.prepare(
      "SELECT id, kind, case_id, workflow, instance_id, attempt, state, phase, error_code, result_ref, created_by, updated_at FROM jobs WHERE (state = 'error' AND error_code = 'start_failed') OR state IN ('queued','running') LIMIT 50",
    ).all<JobRow>()
  ).results;
  for (const j of jobs) {
    try {
      if (j.state === "error") {
        // Back to queued under the same instance id, then started; a job that fails again waits for the next sweep.
        const at = new Date(nowMs).toISOString();
        await env.DB.batch([
          env.DB.prepare("UPDATE jobs SET state = 'queued', error_code = NULL, updated_at = ?1 WHERE id = ?2 AND state = 'error' AND error_code = 'start_failed'").bind(at, j.id),
          env.DB.prepare("UPDATE transcript_passes SET state = 'queued', error_code = NULL, updated_at = ?1 WHERE id = ?2 AND state = 'error' AND error_code = 'start_failed'").bind(at, j.result_ref),
        ]);
        if (await startJob(env, j.id)) restarted += 1;
      } else await reconcile(env, j, nowMs);
    } catch {
      failed += 1;
    }
  }
  // Counts only: no case ids or keys in the Worker log.
  console.log(JSON.stringify({ cron: "audio_sweep", purged, failed, restarted }));
  return { purged, failed, restarted };
}
