// What the write routes of step 4 do for the AI recording (step 5): an approval claims the case's audio and live lines
// for a speaker pass in its own batch and starts the Workflow after the commit; closing a case and ending a seminar
// delete audio that no pass will use. The audio work after a commit never fails the route: the change is stored, and
// the cron sweep and the R2 lifecycle rule delete what a failed purge left.
import type { Context } from "hono";
import type { AppEnv } from "../types";
import type { Tx } from "../store/write";
import { purgeUploads, uploadsAtSessionEnd, uploadsOfCase } from "../store/audio";
import { startJob } from "../store/jobs";
import { orgQuery } from "./write-context";

// The speaker pass needs the Workflow binding and the data API; without them approval works as before (no pass).
export const transcriptsOn = (env: Env) => env.DATA_API === "on" && !!env.SPEAKER_PASS && !!env.DB && !!env.DOCS;

export const passIdFor = (decisionId: string) => `sp-${decisionId}`;
// Deleting audio needs only the storage, never the feature switch: switching the recorder off must not keep audio.
const storageOn = (env: Env) => !!env.DB && !!env.DOCS;

async function safely(what: string, f: () => Promise<unknown>) {
  try {
    await f();
  } catch (e) {
    console.error(JSON.stringify({ hook: what, error: e instanceof Error ? e.name : "Error" }));
  }
}

export const hooks = {
  // Read before the approval batch: does the case have audio or live lines since its last pass? Returns where the new
  // pass starts on the timeline, or null when there is nothing to process.
  async planSpeakerPass(c: Context<AppEnv>, caseId: string): Promise<{ from: number } | null> {
    if (!transcriptsOn(c.env)) return null;
    try {
      return await this.readPlan(c, caseId);
    } catch (e) {
      // An approval never fails because of the recording; the case's audio then waits for close, seminar end or cron.
      console.error(JSON.stringify({ hook: "plan_speaker_pass", error: e instanceof Error ? e.name : "Error" }));
      return null;
    }
  },

  async readPlan(c: Context<AppEnv>, caseId: string): Promise<{ from: number } | null> {
    const prev = await orgQuery(c, "SELECT COALESCE(MAX(cutoff_wall_ms), 0) AS ms FROM transcript_passes WHERE org_id = ?org AND case_id = ?1", caseId).first<{ ms: number }>();
    const from = prev?.ms ?? 0;
    const has = await orgQuery(c, `SELECT EXISTS (SELECT 1 FROM audio_uploads WHERE org_id = ?org AND case_id = ?1 AND pass_id IS NULL AND state = 'open') AS audio,
                EXISTS (SELECT 1 FROM transcript_lines WHERE org_id = ?org AND case_id = ?1 AND source = 'live' AND state = 'current' AND wall_ms > ?2) AS lines`, caseId, from)
      .first<{ audio: number; lines: number }>();
    // Nothing recorded for this approval: no pass, as recAfterApprove did in the page.
    if (!has?.audio && !has?.lines) return null;
    return { from };
  },

  // Adds the job and pass rows to the approval batch, after the decision row they refer to, and claims the case's open
  // uploads (no part is accepted after that).
  addSpeakerPass(c: Context<AppEnv>, t: Tx, plan: { from: number }, caseId: string, decisionId: string, atMs: number, atIso: string): string {
    const from = plan.from;
    const id = passIdFor(decisionId);
    const v = c.var.viewer;
    t.run(
      `INSERT INTO jobs (org_id, id, kind, case_id, workflow, instance_id, attempt, state, phase, result_ref, created_by, created_by_name, created_by_role, created_at, updated_at)
       VALUES (?org, ?1, 'speaker_pass', ?2, 'SPEAKER_PASS', ?1, 1, 'queued', NULL, ?1, ?3, ?4, ?5, ?6, ?6)`,
      id, caseId, v.id, v.name, v.role, atIso,
    );
    t.run(
      `INSERT INTO transcript_passes (org_id, id, case_id, decision_id, job_id, from_wall_ms, cutoff_wall_ms, state, created_at, updated_at)
       VALUES (?org, ?1, ?2, ?3, ?1, ?4, ?5, 'queued', ?6, ?6)`,
      id, caseId, decisionId, from, Math.max(from, atMs), atIso,
    );
    t.run("UPDATE audio_uploads SET pass_id = ?1 WHERE org_id = ?org AND case_id = ?2 AND pass_id IS NULL AND state = 'open'", id, caseId);
    t.audit({ action: "recording.speaker_pass_queued", what_cs: "AI záznam: rozlišení mluvčích naplánováno po schválení závěru", case_id: caseId, target_type: "job", target_id: id });
    return id;
  },

  // After the approval committed. A failed start leaves the job as start_failed; the page offers "Zkusit znovu" and the
  // cron sweep tries again.
  async onApproved(c: Context<AppEnv>, jobId: string | null): Promise<void> {
    if (!jobId) return;
    await safely("start_speaker_pass", () => startJob(c.env, c.var.viewer.org, jobId));
  },

  async onCaseClosed(c: Context<AppEnv>, caseId: string): Promise<void> {
    if (!storageOn(c.env)) return;
    await safely("purge_on_close", async () => purgeUploads(c.env, c.var.viewer.org, await uploadsOfCase(c.env.DB, c.var.viewer.org, caseId), "případ uzavřen", c.var.viewer, c.req.header("cf-ray") ?? null));
  },

  // The seminar ended: its recordings end, and unapproved audio goes. Audio a failed pass kept for "Zkusit znovu" stays
  // until the case closes (user decision 2026-10-18).
  async onSessionEnded(c: Context<AppEnv>, day: string): Promise<void> {
    if (!storageOn(c.env)) return;
    await safely("end_recordings", () =>
      orgQuery(c, "UPDATE recordings SET ended_at = ?1, end_reason = 'session_end' WHERE org_id = ?org AND session_day = ?2 AND ended_at IS NULL", new Date().toISOString(), day).run(),
    );
    await safely("purge_on_session_end", async () => purgeUploads(c.env, c.var.viewer.org, await uploadsAtSessionEnd(c.env.DB, c.var.viewer.org, day), "konec MDT", c.var.viewer, c.req.header("cf-ray") ?? null));
  },
};
