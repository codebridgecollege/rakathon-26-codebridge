// The AI recording on the server (step-5.md "As implemented"): recordings, live transcript lines, per-case audio parts,
// the stored transcript of a case, and the speaker pass jobs the page polls. Embedded mode never calls these.
import { Hono, type Context } from "hono";
import type { AppEnv } from "../types";
import { D } from "@codebridge/domain/errors";
import { assertCan } from "@codebridge/domain/roles";
import { isIsoDay } from "@codebridge/domain/time";
import {
  CLIENT_ID,
  PCM_BYTES_PER_SECOND,
  T,
  checkCaseTakes,
  checkPart,
  checkRecording,
  lineVerdict,
  parseLines,
  parseSegments,
  type Interval,
  type LineVerdict,
  type RecordingRow,
} from "../domain/transcript";
import { E } from "../http/errors";
import { rateLimit } from "../http/rate-limit";
import { audit } from "../middleware/audit";
import { audioKey, passKeepsAudio } from "../store/audio";
import { jobById, jobView, reconcile, startJob } from "../store/jobs";
import { openCase } from "./access-check";
import { actorOf, answer, caseFor, isoNow, label, newId, now, tx, type CaseCtx } from "./write-context";
import { transcriptsOn } from "./hooks";

const END_REASONS = new Set(["stopped", "all_approved", "failed"]);

const partBytes = (env: Env) => Number(env.AUDIO_PART_BYTES) || 5_242_880;
const maxMinutes = (env: Env) => Number(env.AUDIO_MAX_MINUTES_PER_CASE) || 120;

function requireOn(c: Context<AppEnv>) {
  if (!transcriptsOn(c.env)) throw E.notConfigured();
}

const recordingRow = (db: D1Database, id: unknown) =>
  typeof id === "string" && CLIENT_ID.test(id)
    ? db.prepare("SELECT id, session_day, started_by, started_at, ended_at FROM recordings WHERE id = ?1").bind(id).first<RecordingRow>()
    : Promise.resolve(null);

// The recording may store data for this case: its own browser, running (or just stopped), the case open and, during a
// seminar, on its agenda.
async function recordingFor(c: Context<AppEnv>, ctx: CaseCtx, recordingId: unknown): Promise<RecordingRow> {
  const r = await recordingRow(c.env.DB, recordingId);
  checkRecording(r, c.var.viewer.id, now());
  const running = r!.session_day
    ? !!(await c.env.DB.prepare("SELECT 1 AS x FROM sessions WHERE day = ?1 AND ended_at IS NULL").bind(r!.session_day).first())
    : true;
  checkCaseTakes(r!, { status: ctx.core.status, slot_day: ctx.core.slot_day, session_running: running });
  return r!;
}

async function transcriptState(db: D1Database, caseId: string) {
  const r = await db
    .prepare(
      `SELECT COALESCE((SELECT state FROM protocols WHERE case_id = ?1), 'draft') AS proto,
              (SELECT approved_at FROM decisions WHERE case_id = ?1 ORDER BY version DESC LIMIT 1) AS approved_at,
              (SELECT COUNT(*) FROM transcript_passes WHERE case_id = ?1 AND state = 'done') AS done_n,
              (SELECT json_group_array(json(covered_json)) FROM transcript_passes WHERE case_id = ?1 AND state = 'done' AND covered_json IS NOT NULL) AS covered`,
    )
    .bind(caseId)
    .first<{ proto: string; approved_at: string | null; done_n: number; covered: string | null }>();
  const covered = (JSON.parse(r?.covered || "[]") as Interval[][]).flat();
  return {
    proto: r?.proto ?? "draft",
    doneN: r?.done_n ?? 0,
    s: {
      protocol_approved: r?.proto === "approved",
      latest_decision_ms: r?.approved_at ? Date.parse(r.approved_at) : null,
      covered,
    },
  };
}

export const transcript = new Hono<AppEnv>()
  // ---------- recordings ----------
  .post("/recordings", async (c) => {
    label(c, "spuštění AI záznamu");
    requireOn(c);
    assertCan(actorOf(c), "recording.write");
    const b = c.var.body;
    const day = b.session_day ?? null;
    if (day !== null && (typeof day !== "string" || !isIsoDay(day))) throw D.invalidInput();
    if (day && !(await c.env.DB.prepare("SELECT 1 AS x FROM sessions WHERE day = ?1 AND ended_at IS NULL").bind(day).first())) throw T.sessionNotRunning();
    const caseId = typeof b.case_id === "string" && (await c.env.DB.prepare("SELECT 1 AS x FROM cases WHERE id = ?1").bind(b.case_id).first()) ? b.case_id : null;
    const id = newId();
    const at = isoNow();
    const v = c.var.viewer;
    const t = tx(c);
    if (day) t.guard("session", "EXISTS (SELECT 1 FROM sessions WHERE day = ? AND ended_at IS NULL)", [day], () => T.sessionNotRunning());
    t.run("INSERT INTO recordings (id, session_day, started_by, started_by_name, started_at) VALUES (?1, ?2, ?3, ?4, ?5)", id, day, v.id, v.name, at);
    t.audit({ action: "recording.on", what_cs: "zapnul(a) AI záznam diskuse", case_id: caseId, target_type: "recording", target_id: id });
    await t.commit();
    return answer(c, { recording_id: id, started_at: at, part_bytes: partBytes(c.env) }, {}, 201);
  })
  .patch("/recordings/:id", async (c) => {
    label(c, "zastavení AI záznamu");
    requireOn(c);
    assertCan(actorOf(c), "recording.write");
    const r = await recordingRow(c.env.DB, c.req.param("id"));
    if (!r) throw T.noRecording();
    if (r.started_by !== c.var.viewer.id) throw T.notRecorder();
    const reason = c.var.body.end_reason;
    if (typeof reason !== "string" || !END_REASONS.has(reason)) throw D.invalidInput();
    // A second stop (the page retried) changes nothing.
    if (r.ended_at) return answer(c, { ended_at: r.ended_at });
    const at = isoNow();
    const caseId = typeof c.var.body.case_id === "string" ? c.var.body.case_id : null;
    const t = tx(c);
    t.run("UPDATE recordings SET ended_at = ?1, end_reason = ?2 WHERE id = ?3 AND ended_at IS NULL", at, reason, r.id);
    t.audit({
      action: "recording.off",
      what_cs: reason === "all_approved" ? "AI záznam se zastavil, všechny případy semináře mají schválený závěr" : "vypnul(a) AI záznam diskuse",
      case_id: caseId && (await c.env.DB.prepare("SELECT 1 AS x FROM cases WHERE id = ?1").bind(caseId).first()) ? caseId : null,
      target_type: "recording",
      target_id: r.id,
    });
    await t.commit();
    return answer(c, { ended_at: at });
  })

  // ---------- live lines ----------
  .post("/cases/:id/transcript/lines", async (c) => {
    const id = c.req.param("id");
    label(c, "uložení přepisu AI záznamu", id);
    requireOn(c);
    const ctx = await caseFor(c, id, "transcript.write");
    const b = c.var.body;
    const rec = await recordingFor(c, ctx, b.recording_id);
    const { lines, invalid } = parseLines(b.lines);
    const db = c.env.DB;
    const { proto, doneN, s } = await transcriptState(db, id);
    const existing = new Set(
      (
        await db
          .prepare("SELECT client_line_id AS k FROM transcript_lines WHERE case_id = ?1 AND client_line_id IN (SELECT value FROM json_each(?2))")
          .bind(id, JSON.stringify(lines.map((l) => l.client_line_id)))
          .all<{ k: string }>()
      ).results.map((r) => r.k),
    );
    const accepted: typeof lines = [];
    const duplicate: string[] = [];
    const rejected: LineVerdict[] = invalid.map((k) => ({ client_line_id: k, code: "invalid" as const }));
    const t0 = now();
    for (const l of lines) {
      if (existing.has(l.client_line_id)) {
        duplicate.push(l.client_line_id);
        continue;
      }
      const code = lineVerdict(l, rec, s, t0);
      if (code) rejected.push({ client_line_id: l.client_line_id, code });
      else accepted.push(l);
    }
    if (accepted.length) {
      const first = !(await db.prepare("SELECT 1 AS x FROM transcript_lines WHERE case_id = ?1 AND recording_id = ?2 LIMIT 1").bind(id, rec.id).first());
      const at = isoNow();
      const t = tx(c, ctx.breakGlass);
      // What the verdicts above relied on, checked again inside the batch.
      t.guard("open", "(SELECT status FROM cases WHERE id = ?) <> 'closed'", [id], () => T.caseClosed());
      t.guard("protocol", "COALESCE((SELECT state FROM protocols WHERE case_id = ?), 'draft') = ?", [id, proto], () => T.caseApproved());
      t.guard("pass", "(SELECT COUNT(*) FROM transcript_passes WHERE case_id = ? AND state = 'done') = ?", [id, doneN], () => T.caseApproved());
      t.run(
        `INSERT INTO transcript_lines (id, case_id, recording_id, client_line_id, source, wall_ms, text, state, created_by, created_at)
         SELECT json_extract(value, '$.id'), ?1, ?2, json_extract(value, '$.k'), 'live', json_extract(value, '$.w'), json_extract(value, '$.t'), 'current', ?3, ?4
         FROM json_each(?5) WHERE true
         ON CONFLICT (case_id, client_line_id) DO NOTHING`,
        id, rec.id, c.var.viewer.id, at,
        JSON.stringify(accepted.map((l) => ({ id: newId(), k: l.client_line_id, w: l.wall_ms, t: l.text }))),
      );
      // One line in the access log per case and recording, never per batch and never the text.
      if (first) t.audit({ action: "transcript.store", what_cs: "AI záznam: přepis se ukládá", case_id: id, target_type: "recording", target_id: rec.id });
      await t.commit();
    }
    return answer(c, { accepted: accepted.map((l) => l.client_line_id), duplicate, rejected });
  })

  // ---------- audio parts ----------
  .put("/cases/:id/transcript/audio/parts/:n", rateLimit("RL_AUDIO"), async (c) => {
    const id = c.req.param("id");
    label(c, "uložení zvuku AI záznamu", id);
    requireOn(c);
    const ctx = await caseFor(c, id, "transcript.write");
    const rec = await recordingFor(c, ctx, c.req.query("recording_id"));
    // Late lines get a grace period after the stop; audio does not. The page sends its last part before it ends the
    // recording, and the seminar's end has already deleted the audio a later part would join.
    if (rec.ended_at) throw T.recordingEnded();
    const db = c.env.DB;
    const { proto } = await transcriptState(db, id);
    // The page sends the last part before it approves; after approval the pass owns the audio.
    if (proto === "approved") throw T.caseApproved();
    const n = Number(c.req.param("n"));
    const final = c.req.query("final") === "1";
    const lenHeader = c.req.header("content-length");
    if (!lenHeader || !/^\d+$/.test(lenHeader)) throw E.lengthRequired();
    const len = Number(lenHeader);
    const pb = partBytes(c.env);
    const maxBytes = maxMinutes(c.env) * 60 * PCM_BYTES_PER_SECOND;
    checkPart({ n, bytes: len, final }, pb, maxBytes, maxMinutes(c.env));
    const segs = parseSegments(c.req.header("x-audio-segments"), ((n - 1) * pb + len) / 2);
    // At most one part (5 MiB) in memory; R2 needs the part's length up front and the size was checked above.
    const buf = await c.req.arrayBuffer();
    if (buf.byteLength !== len) throw T.badPart();

    let up = await db
      .prepare("SELECT id, r2_key, r2_upload_id FROM audio_uploads WHERE case_id = ?1 AND recording_id = ?2 AND pass_id IS NULL AND state = 'open'")
      .bind(id, rec.id)
      .first<{ id: string; r2_key: string; r2_upload_id: string }>();
    let created = false;
    if (!up) {
      const uploadId = newId();
      const key = audioKey(id, uploadId);
      // No custom metadata: it would be one more copy of when the case was discussed.
      const mpu = await c.env.DOCS.createMultipartUpload(key, { httpMetadata: { contentType: "application/octet-stream" } });
      try {
        await db
          .prepare("INSERT INTO audio_uploads (id, case_id, recording_id, r2_key, r2_upload_id, state, bytes, created_by, created_at) VALUES (?1, ?2, ?3, ?4, ?5, 'open', 0, ?6, ?7)")
          .bind(uploadId, id, rec.id, key, mpu.uploadId, c.var.viewer.id, isoNow())
          .run();
        up = { id: uploadId, r2_key: key, r2_upload_id: mpu.uploadId };
        created = true;
      } catch (e) {
        // A parallel first part won the unique index: use its upload and drop ours.
        await mpu.abort().catch(() => {});
        up = await db
          .prepare("SELECT id, r2_key, r2_upload_id FROM audio_uploads WHERE case_id = ?1 AND recording_id = ?2 AND pass_id IS NULL AND state = 'open'")
          .bind(id, rec.id)
          .first<{ id: string; r2_key: string; r2_upload_id: string }>();
        if (!up) throw e;
      }
    }
    let etag: string;
    try {
      etag = (await c.env.DOCS.resumeMultipartUpload(up.r2_key, up.r2_upload_id).uploadPart(n, buf)).etag;
    } catch {
      // Gone from D1's view (purged by a close or the seminar's end, or claimed by an approval): not wanted any more.
      // Anything else is a storage hiccup the page retries.
      const st = await db.prepare("SELECT state, pass_id FROM audio_uploads WHERE id = ?1").bind(up.id).first<{ state: string; pass_id: string | null }>();
      if (!st || st.state !== "open" || st.pass_id) throw T.caseApproved();
      throw E.upstreamBusy();
    }
    const t = tx(c, ctx.breakGlass);
    // Everything the checks above read, again inside the batch: a close, an approval or the seminar's end may have
    // landed while the part was on its way.
    t.guard("upload_open", "EXISTS (SELECT 1 FROM audio_uploads WHERE id = ? AND state = 'open' AND pass_id IS NULL)", [up.id], () => T.caseApproved());
    t.guard("protocol", "COALESCE((SELECT state FROM protocols WHERE case_id = ?), 'draft') <> 'approved'", [id], () => T.caseApproved());
    t.guard("open", "(SELECT status FROM cases WHERE id = ?) <> 'closed'", [id], () => T.caseClosed());
    t.guard("recording", "EXISTS (SELECT 1 FROM recordings WHERE id = ? AND ended_at IS NULL)", [rec.id], () => T.recordingEnded());
    if (rec.session_day) t.guard("session", "EXISTS (SELECT 1 FROM sessions WHERE day = ? AND ended_at IS NULL)", [rec.session_day], () => T.sessionNotRunning());
    t.run(
      "INSERT INTO audio_parts (upload_id, part_number, etag, bytes, is_final) VALUES (?1, ?2, ?3, ?4, ?5) ON CONFLICT (upload_id, part_number) DO UPDATE SET etag = excluded.etag, bytes = excluded.bytes, is_final = excluded.is_final",
      up.id, n, etag, len, final ? 1 : 0,
    );
    // A final part ends the upload for now; a part numbered after it would be left from an older attempt.
    if (final) t.run("DELETE FROM audio_parts WHERE upload_id = ?1 AND part_number > ?2", up.id, n);
    if (segs.length)
      t.run(
        `INSERT OR REPLACE INTO audio_segments (upload_id, start_sample, wall_ms)
         SELECT ?1, json_extract(value, '$.start_sample'), json_extract(value, '$.wall_ms') FROM json_each(?2)`,
        up.id, JSON.stringify(segs),
      );
    t.run("UPDATE audio_uploads SET bytes = (SELECT COALESCE(SUM(bytes), 0) FROM audio_parts WHERE upload_id = ?1) WHERE id = ?1", up.id);
    if (created) t.audit({ action: "recording.audio_stored", what_cs: "AI záznam: zvuk případu se ukládá dočasně", case_id: id, target_type: "recording", target_id: rec.id });
    try {
      await t.commit();
    } catch (e) {
      // An upload this request created must not outlive the refusal: nothing else would claim or purge it soon.
      if (created) {
        await c.env.DOCS.resumeMultipartUpload(up.r2_key, up.r2_upload_id).abort().catch(() => {});
        await db.prepare("UPDATE audio_uploads SET state = 'aborted', r2_upload_id = NULL, deleted_at = ?1, delete_reason = 'odmítnuto' WHERE id = ?2 AND state = 'open'").bind(isoNow(), up.id).run();
      }
      throw e;
    }
    return answer(c, { part: n, bytes: len, final });
  })

  // ---------- the stored transcript of a case ----------
  .get("/cases/:id/transcript", async (c) => {
    const id = c.req.param("id");
    requireOn(c);
    await openCase(c, id, "clinical");
    await audit(c, { action: "transcript.view", case_id: id, what_cs: "zobrazil(a) přepis AI záznamu" });
    const db = c.env.DB;
    const [lines, passes, sums] = await db.batch([
      db.prepare("SELECT id, client_line_id, source, speaker, wall_ms, text FROM transcript_lines WHERE case_id = ?1 AND state = 'current' ORDER BY wall_ms, created_at, id").bind(id),
      db.prepare(
        `SELECT p.id, p.state, p.error_code, p.purge_reason, p.cutoff_wall_ms, p.line_count, p.speaker_count, p.created_at, p.audio_deleted_at,
                j.id AS job_id, j.state AS job_state, j.phase AS job_phase, j.error_code AS job_error,
                EXISTS (SELECT 1 FROM audio_uploads u WHERE u.pass_id = p.id AND u.state IN ('open','completed')) AS audio_kept
         FROM transcript_passes p JOIN jobs j ON j.id = p.job_id WHERE p.case_id = ?1 ORDER BY p.cutoff_wall_ms`,
      ).bind(id),
      db.prepare("SELECT id, pass_id, state, basis, text, error_code, label, model, prompt_version, created_at FROM transcript_summaries WHERE case_id = ?1 ORDER BY created_at, id").bind(id),
    ]);
    return c.json({
      lines: lines!.results,
      passes: (passes!.results as Record<string, unknown>[]).map((p) => ({ ...p, audio_kept: !!p.audio_kept })),
      summaries: sums!.results,
    });
  })

  // ---------- jobs ----------
  .get("/jobs/:id", async (c) => {
    requireOn(c);
    const j = await jobById(c.env.DB, c.req.param("id"));
    if (!j) throw T.jobNotFound();
    // A job's state is not case content, but it names the case: the same check as the case header.
    await openCase(c, j.case_id, "header");
    return c.json(jobView(await reconcile(c.env, j)));
  })
  .post("/jobs/:id/retry", async (c) => {
    requireOn(c);
    const j = await jobById(c.env.DB, c.req.param("id"));
    if (!j) throw T.jobNotFound();
    label(c, "nové spuštění rozlišení mluvčích", j.case_id);
    const ctx = await caseFor(c, j.case_id, "transcript.write");
    if (j.state !== "error" || !j.result_ref) throw T.notRetryable();
    const startFailed = j.error_code === "start_failed";
    // A failed pass can run again only on audio it kept; a start that failed reuses its instance id.
    if (!startFailed && !(await passKeepsAudio(c.env, j.result_ref, c.req.header("cf-ray") ?? null))) throw T.notRetryable();
    const attempt = startFailed ? j.attempt : j.attempt + 1;
    const instance = attempt === 1 ? j.id : `${j.id}-${attempt}`;
    const at = isoNow();
    const t = tx(c, ctx.breakGlass);
    t.guard("job", "EXISTS (SELECT 1 FROM jobs WHERE id = ? AND attempt = ? AND state = 'error')", [j.id, j.attempt], () => T.notRetryable());
    t.run("UPDATE jobs SET state = 'queued', phase = NULL, error_code = NULL, attempt = ?1, instance_id = ?2, updated_at = ?3 WHERE id = ?4", attempt, instance, at, j.id);
    t.run("UPDATE transcript_passes SET state = 'queued', error_code = NULL, updated_at = ?1 WHERE id = ?2 AND state IN ('error','queued')", at, j.result_ref);
    t.audit({ action: "recording.speaker_pass_retry", what_cs: "AI záznam: rozlišení mluvčích spuštěno znovu", case_id: j.case_id, target_type: "job", target_id: j.id });
    await t.commit();
    await startJob(c.env, j.id);
    return answer(c, jobView((await jobById(c.env.DB, j.id))!));
  });
