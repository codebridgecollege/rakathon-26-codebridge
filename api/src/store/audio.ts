// A case's audio in R2 and its bookkeeping in D1 (step-5.md "As implemented", section Audio). One upload per case and
// recording, in parts while the case is discussed; the speaker pass completes, reads and deletes it, and every other
// way a case ends (closed, seminar ended, demo reset, the cron sweep) deletes it here.
import type { Viewer } from "../domain/access";
import { staffName } from "../domain/rows";
import { PCM_BYTES_PER_SECOND, partsToComplete, type Mark } from "../domain/transcript";
import { auditStatement } from "./write";

export type UploadRow = {
  id: string;
  case_id: string;
  recording_id: string;
  pass_id: string | null;
  r2_key: string;
  r2_upload_id: string | null;
  state: "open" | "completed" | "deleted" | "aborted";
  bytes: number;
  created_by: string;
  created_at: string;
};

const iso = () => new Date().toISOString();

export const audioKey = (caseId: string, uploadId: string) => `audio/${caseId}/${uploadId}.pcm`;

// The person an automatic step acts for in the access log: the doctor who approved (Workflow) or who recorded (cron).
// The log's role column needs a real role, so the row names a person, and the line says it was the AI recording.
export async function actorFor(db: D1Database, userId: string, authMode: "demo" | "access"): Promise<Viewer> {
  const u = await db.prepare("SELECT id, pre, sur, post, role_id FROM users WHERE id = ?1").bind(userId).first<{ id: string; pre: string; sur: string; post: string; role_id: string }>();
  const role = u && ["doctor", "coordinator", "admin"].includes(u.role_id) ? (u.role_id as Viewer["role"]) : "doctor";
  return { id: userId, name: u ? staffName(u) : userId, role, dept: null, authMode, impersonating: false };
}

const authModeOf = (env: Env): "demo" | "access" => (env.AUTH_MODE === "access" ? "access" : "demo");

// Removes the R2 side of one upload. An open multipart upload is aborted; a completed object is deleted. Both are
// retried by the caller (Workflow step, cron) when they throw; a missing object or upload counts as gone.
async function dropObject(bucket: R2Bucket, u: UploadRow): Promise<void> {
  if (u.state === "open" && u.r2_upload_id) {
    try {
      await bucket.resumeMultipartUpload(u.r2_key, u.r2_upload_id).abort();
    } catch (e) {
      // The R2 docs: resuming does not prove the upload still exists. Gone already is fine; anything else is retried.
      if (!/NoSuchUpload|does not exist|not found|10024/i.test(e instanceof Error ? e.message : String(e))) throw e;
    }
  }
  // Also for an open upload: a completion may have landed between our read and the abort.
  await bucket.delete(u.r2_key);
}

export type PurgeResult = { deleted: number; cases: string[] };

// Deletes the given uploads' audio and records why. Passes that had not finished become 'purged'; the audit gets one
// line per case that lost audio. reason_cs is shown in the UI and the log ("případ uzavřen", "konec MDT", ...).
export async function purgeUploads(env: Env, uploads: UploadRow[], reason_cs: string, actor: Viewer | null, requestId: string | null = null, what_cs?: string): Promise<PurgeResult> {
  const db = env.DB;
  const live = uploads.filter((u) => u.state === "open" || u.state === "completed");
  if (!live.length) return { deleted: 0, cases: [] };
  for (const u of live) await dropObject(env.DOCS, u);
  const at = iso();
  const stmts: D1PreparedStatement[] = [];
  for (const u of live) {
    stmts.push(
      db.prepare("UPDATE audio_uploads SET state = ?1, r2_upload_id = NULL, deleted_at = ?2, delete_reason = ?3 WHERE id = ?4 AND state IN ('open','completed')")
        .bind(u.state === "open" ? "aborted" : "deleted", at, reason_cs, u.id),
      // Segment times are not audio, but they say when the case was discussed; nothing needs them once the audio is gone.
      db.prepare("DELETE FROM audio_segments WHERE upload_id = ?1").bind(u.id),
      db.prepare("DELETE FROM audio_parts WHERE upload_id = ?1").bind(u.id),
    );
    if (u.pass_id) {
      stmts.push(
        db.prepare("UPDATE transcript_passes SET state = 'purged', purge_reason = ?1, audio_deleted_at = ?2, updated_at = ?2 WHERE id = ?3 AND state IN ('queued','running')").bind(reason_cs, at, u.pass_id),
        db.prepare("UPDATE transcript_passes SET audio_deleted_at = ?1, purge_reason = COALESCE(purge_reason, ?2), updated_at = ?1 WHERE id = ?3 AND audio_deleted_at IS NULL").bind(at, reason_cs, u.pass_id),
      );
    }
  }
  const cases = [...new Set(live.map((u) => u.case_id))];
  const mode = authModeOf(env);
  for (const caseId of cases) {
    const who = actor ?? (await actorFor(db, live.find((u) => u.case_id === caseId)!.created_by, mode));
    stmts.push(auditStatement(db, who, { action: "recording.audio_deleted", what_cs: what_cs ?? `AI záznam: zvuk smazán bez rozlišení mluvčích (${reason_cs})`, case_id: caseId }, { requestId, epoch: null }));
  }
  await db.batch(stmts);
  return { deleted: live.length, cases };
}

const UPLOAD_COLS = "u.id, u.case_id, u.recording_id, u.pass_id, u.r2_key, u.r2_upload_id, u.state, u.bytes, u.created_by, u.created_at";

// Every stored audio of a case: it was closed, so nothing will process it.
export async function uploadsOfCase(db: D1Database, caseId: string): Promise<UploadRow[]> {
  return (await db.prepare(`SELECT ${UPLOAD_COLS} FROM audio_uploads u WHERE u.case_id = ?1 AND u.state IN ('open','completed')`).bind(caseId).all<UploadRow>()).results;
}

// The seminar ended: audio of its cases that no pass will use. Audio a failed pass kept for "Zkusit znovu" stays
// until the case closes (user decision 2026-10-18); the cron sweep's age limit still applies to it.
export async function uploadsAtSessionEnd(db: D1Database, day: string): Promise<UploadRow[]> {
  return (
    await db
      .prepare(
        `SELECT ${UPLOAD_COLS} FROM audio_uploads u
         LEFT JOIN transcript_passes p ON p.id = u.pass_id
         WHERE u.state IN ('open','completed')
           AND (u.case_id IN (SELECT case_id FROM slots WHERE day = ?1) OR u.recording_id IN (SELECT id FROM recordings WHERE session_day = ?1))
           AND (u.pass_id IS NULL OR p.state NOT IN ('queued','running','error'))`,
      )
      .bind(day)
      .all<UploadRow>()
  ).results;
}

// The cron sweep: (a) audio no pass has claimed older than the short limit, (b) any audio older than the long limit
// (what a failed pass kept for "Zkusit znovu"), (c) audio of a pass that ended well, (d) unclaimed audio of a recording
// whose seminar has ended, (e) audio of a closed case.
export async function uploadsForSweep(db: D1Database, unclaimedBefore: string, keptBefore: string): Promise<UploadRow[]> {
  return (
    await db
      .prepare(
        `SELECT ${UPLOAD_COLS} FROM audio_uploads u
         LEFT JOIN transcript_passes p ON p.id = u.pass_id
         LEFT JOIN recordings r ON r.id = u.recording_id
         LEFT JOIN sessions s ON s.day = r.session_day
         WHERE u.state IN ('open','completed') AND (
           (u.created_at < ?1 AND u.pass_id IS NULL)
           OR u.created_at < ?2
           OR p.state IN ('done','empty','purged')
           -- Unapproved audio of a seminar that has ended: no pass will use it.
           OR (u.pass_id IS NULL AND r.session_day IS NOT NULL AND s.ended_at IS NOT NULL AND s.ended_at > r.started_at)
           -- A closed case takes no audio; whatever a race left behind goes.
           OR (u.case_id IN (SELECT id FROM cases WHERE status = 'closed') AND (u.pass_id IS NULL OR p.state NOT IN ('queued','running')))
         ) LIMIT 200`,
      )
      .bind(unclaimedBefore, keptBefore)
      .all<UploadRow>()
  ).results;
}

export async function uploadsOfPass(db: D1Database, passId: string): Promise<UploadRow[]> {
  return (await db.prepare(`SELECT ${UPLOAD_COLS} FROM audio_uploads u WHERE u.pass_id = ?1 ORDER BY u.created_at, u.id`).bind(passId).all<UploadRow>()).results;
}

export type FinalizeResult = { state: "ready" | "empty" | "purged"; bytes: number; seconds: number };

// Completes the pass's open uploads from the parts D1 recorded. Retry-safe: a completed upload reports its size, and a
// completion that landed in R2 but not in D1 (a retry after a crash) is found by its object.
export async function finalizeForPass(env: Env, passId: string, partBytes: number): Promise<FinalizeResult> {
  const db = env.DB;
  const ups = await uploadsOfPass(db, passId);
  let bytes = 0;
  let purged = ups.length > 0;
  for (const u of ups) {
    if (u.state === "deleted" || u.state === "aborted") continue;
    purged = false;
    if (u.state === "completed") {
      bytes += u.bytes;
      continue;
    }
    const parts = partsToComplete(
      (await db.prepare("SELECT part_number, bytes, etag FROM audio_parts WHERE upload_id = ?1").bind(u.id).all<{ part_number: number; bytes: number; etag: string }>()).results,
      partBytes,
    ) as { part_number: number; bytes: number; etag: string }[];
    if (!parts.length) {
      await dropObject(env.DOCS, u);
      await db.prepare("UPDATE audio_uploads SET state = 'aborted', r2_upload_id = NULL, deleted_at = ?1, delete_reason = 'bez zvuku' WHERE id = ?2 AND state = 'open'").bind(iso(), u.id).run();
      continue;
    }
    const size = parts.reduce((a, p) => a + p.bytes, 0);
    try {
      await env.DOCS.resumeMultipartUpload(u.r2_key, u.r2_upload_id!).complete(parts.map((p) => ({ partNumber: p.part_number, etag: p.etag })));
    } catch (e) {
      const head = await env.DOCS.head(u.r2_key);
      if (!head || head.size !== size) throw e;
    }
    await db.prepare("UPDATE audio_uploads SET state = 'completed', r2_upload_id = NULL, bytes = ?1, completed_at = ?2 WHERE id = ?3 AND state = 'open'").bind(size, iso(), u.id).run();
    bytes += size;
  }
  if (purged) return { state: "purged", bytes: 0, seconds: 0 };
  return { state: bytes > 0 ? "ready" : "empty", bytes, seconds: bytes / PCM_BYTES_PER_SECOND };
}

// The pass's completed objects in recording order, with the visit marks on the joined timeline.
export async function joinedAudio(env: Env, passId: string): Promise<{ objects: { key: string; size: number }[]; total: number; marks: Mark[] }> {
  const db = env.DB;
  const ups = (await uploadsOfPass(db, passId)).filter((u) => u.state === "completed" && u.bytes > 0);
  const objects: { key: string; size: number }[] = [];
  const marks: Mark[] = [];
  let offset = 0;
  for (const u of ups) {
    const segs = (await db.prepare("SELECT start_sample, wall_ms FROM audio_segments WHERE upload_id = ?1 ORDER BY start_sample").bind(u.id).all<{ start_sample: number; wall_ms: number }>()).results;
    const at0 = offset / PCM_BYTES_PER_SECOND;
    // The page sends a mark at sample 0 with the first part; if it is missing, the recording's start is the best estimate.
    if (!segs.length || segs[0]!.start_sample !== 0) {
      const r = await db.prepare("SELECT started_at FROM recordings WHERE id = ?1").bind(u.recording_id).first<{ started_at: string }>();
      marks.push({ at_s: at0, wall_ms: r ? Date.parse(r.started_at) : 0 });
    }
    for (const s of segs) marks.push({ at_s: at0 + (s.start_sample * 2) / PCM_BYTES_PER_SECOND, wall_ms: s.wall_ms });
    objects.push({ key: u.r2_key, size: u.bytes });
    offset += u.bytes;
  }
  return { objects, total: offset, marks };
}

// One stream over several R2 objects, read one after the other, so the speaker pass sends the case's visits as one
// audio without holding it in memory.
export function concatObjects(bucket: R2Bucket, objects: { key: string; size: number }[]): ReadableStream<Uint8Array> {
  let i = 0;
  let reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
  return new ReadableStream<Uint8Array>({
    async pull(ctrl) {
      for (;;) {
        if (!reader) {
          const o = objects[i];
          if (!o) return ctrl.close();
          const obj = await bucket.get(o.key);
          if (!obj || obj.size !== o.size) return ctrl.error(new Error("audio_missing"));
          reader = (obj.body as ReadableStream<Uint8Array>).getReader();
        }
        const { done, value } = await reader.read();
        if (!done) return ctrl.enqueue(value);
        reader = null;
        i++;
      }
    },
    async cancel() {
      await reader?.cancel().catch(() => {});
    },
  });
}

// The pass's last step: its audio goes, whatever the pass did. The audit line commits with the change.
export async function deleteForPass(env: Env, passId: string, audit: { actor: Viewer; what_cs: string; case_id: string }): Promise<number> {
  const db = env.DB;
  const ups = (await uploadsOfPass(db, passId)).filter((u) => u.state === "open" || u.state === "completed");
  for (const u of ups) await dropObject(env.DOCS, u);
  const at = iso();
  const stmts: D1PreparedStatement[] = [];
  for (const u of ups)
    stmts.push(
      db.prepare("UPDATE audio_uploads SET state = ?1, r2_upload_id = NULL, deleted_at = ?2, delete_reason = 'rozlišení mluvčích skončilo' WHERE id = ?3 AND state IN ('open','completed')")
        .bind(u.state === "open" ? "aborted" : "deleted", at, u.id),
      db.prepare("DELETE FROM audio_segments WHERE upload_id = ?1").bind(u.id),
      db.prepare("DELETE FROM audio_parts WHERE upload_id = ?1").bind(u.id),
    );
  stmts.push(db.prepare("UPDATE transcript_passes SET audio_deleted_at = COALESCE(audio_deleted_at, ?1), updated_at = ?1 WHERE id = ?2").bind(at, passId));
  if (ups.length) stmts.push(auditStatement(db, audit.actor, { action: "recording.audio_deleted", what_cs: audit.what_cs, case_id: audit.case_id }, { requestId: null, epoch: null }));
  await db.batch(stmts);
  return ups.length;
}

// Audio a failed pass kept for "Zkusit znovu", checked in R2 as well as in D1: the lifecycle rule may have removed an
// object the cron sweep had not recorded yet. Audio that is partly gone is deleted here, so the page stops offering a
// retry and the case keeps its live transcript and the summary made from it.
export async function passKeepsAudio(env: Env, passId: string, requestId: string | null): Promise<boolean> {
  const ups = (await uploadsOfPass(env.DB, passId)).filter((u) => u.state === "open" || u.state === "completed");
  if (!ups.length) return false;
  for (const u of ups) {
    if (u.state !== "completed") continue;
    const h = await env.DOCS.head(u.r2_key);
    if (!h || h.size !== u.bytes) {
      await purgeUploads(env, ups, "zvuk už není k dispozici", null, requestId, "AI záznam: zvuk smazán (už není k dispozici)");
      return false;
    }
  }
  return true;
}
