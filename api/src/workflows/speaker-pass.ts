// SpeakerPassWorkflow (step-5.md "As implemented", section 4): after a doctor approves a case's conclusion, the case's
// audio goes once through ElevenLabs batch transcription with speaker separation, the speaker lines replace the live
// lines up to the approval, the audio is deleted, and a summary draft is made. A Workflow, because the call may take
// minutes and must survive a closed tab; each step is retried on its own.
//
// Privacy: params and step results hold ids and counts only. The engine keeps them for the instance's retention period
// outside our EU jurisdiction setting, so transcript text, audio and prompts never pass through them.
import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from "cloudflare:workers";
import { NonRetryableError } from "cloudflare:workflows";
import { PCM_BYTES_PER_SECOND, coveredIntervals, keepsAudioAfter, safeCode, transcriptText, wordsToLines, type PassErrorCode } from "../domain/transcript";
import { diarizeUpstream } from "../services/elevenlabs";
import { summarizeTranscript } from "../services/azure-openai";
import { PROMPT, PROMPT_VERSION } from "../prompts/summarize-cs";
import { ApiError } from "../http/errors";
import { actorFor, concatObjects, deleteForPass, finalizeForPass, joinedAudio } from "../store/audio";
import { Tx } from "../store/write";
import { sha256Hex } from "../store/work";

export type SpeakerPassParams = { caseId: string; passId: string; jobId: string };

const FAST = { retries: { limit: 3, delay: "2 seconds", backoff: "exponential" }, timeout: "1 minute" } as const;
const DELETE = { retries: { limit: 10, delay: "5 seconds", backoff: "exponential" }, timeout: "1 minute" } as const;

// "eleven:429:30" or "azure:503": honour Retry-After, else exponential from 10 s, capped at 5 minutes. Six attempts span
// about ten minutes, enough for the shared hackathon endpoint's short 429 bursts (CLAUDE.md, calling LLMs).
export const providerDelay = ({ ctx, error }: { ctx: { attempt: number }; error: Error }) => {
  const m = /:(\d{3}|network):(\d+)$/.exec(error?.message ?? "");
  const after = m?.[2] ? Number(m[2]) : 0;
  const expo = 10 * 2 ** Math.max(0, ctx.attempt - 1);
  return `${Math.min(300, Math.max(after, expo))} seconds` as const;
};
// backoff "constant": the delay function already computes the whole wait; with the default (exponential) the engine
// multiplies its result by 2^(attempt-1) again (miniflare's calcRetryDuration), which stretches six attempts to hours.
const DIARIZE = { retries: { limit: 6, delay: providerDelay, backoff: "constant" }, timeout: "20 minutes" } as const;
const SUMMARY = { retries: { limit: 6, delay: providerDelay, backoff: "constant" }, timeout: "3 minutes" } as const;

const iso = () => new Date().toISOString();
const partBytes = (env: Env) => Number(env.AUDIO_PART_BYTES) || 5_242_880;

type JobRow = { id: string; case_id: string; created_by: string; state: string };

async function jobOf(env: Env, jobId: string): Promise<JobRow> {
  const j = await env.DB.prepare("SELECT id, case_id, created_by, state FROM jobs WHERE id = ?1").bind(jobId).first<JobRow>();
  if (!j) throw new NonRetryableError("internal");
  return j;
}

async function actor(env: Env, jobId: string) {
  const j = await jobOf(env, jobId);
  return actorFor(env.DB, j.created_by, env.AUTH_MODE === "access" ? "access" : "demo");
}

const phase = (env: Env, jobId: string, ph: string) =>
  env.DB.prepare("UPDATE jobs SET state = 'running', phase = ?1, updated_at = ?2 WHERE id = ?3 AND state IN ('queued','running')").bind(ph, iso(), jobId).run();

// ---------- steps ----------

async function markRunning(env: Env, p: SpeakerPassParams) {
  await env.DB.batch([
    env.DB.prepare("UPDATE jobs SET state = 'running', phase = 'audio', error_code = NULL, updated_at = ?1 WHERE id = ?2").bind(iso(), p.jobId),
    // A pass purged before it started stays purged; a retried error pass runs again.
    env.DB.prepare("UPDATE transcript_passes SET state = 'running', error_code = NULL, updated_at = ?1 WHERE id = ?2 AND state IN ('queued','error','running')").bind(iso(), p.passId),
  ]);
  return { state: "running" };
}

async function passState(env: Env, passId: string) {
  return env.DB.prepare("SELECT state, from_wall_ms, cutoff_wall_ms FROM transcript_passes WHERE id = ?1").bind(passId).first<{ state: string; from_wall_ms: number; cutoff_wall_ms: number }>();
}

// Words to staged lines. Staged lines are invisible; a retry starts by deleting what an earlier attempt staged.
async function diarizeToStaged(env: Env, p: SpeakerPassParams) {
  await phase(env, p.jobId, "diarize");
  const ps = await passState(env, p.passId);
  if (!ps || ps.state !== "running") throw new NonRetryableError("audio_purged");
  const { objects, total, marks } = await joinedAudio(env, p.passId);
  if (!total) throw new NonRetryableError("audio_missing");
  for (const o of objects) {
    const h = await env.DOCS.head(o.key);
    if (!h || h.size !== o.size) throw new NonRetryableError("audio_missing");
  }
  const r = await diarizeUpstream(env, concatObjects(env.DOCS, objects), total, { kind: "pcm_s16le_16" }, "workflow/diarize", 18 * 60_000);
  if (!r.ok) {
    // Only the status goes into the message: the provider's body may echo the input.
    if (r.status === "network" || r.status === "timeout") throw new Error("eleven:network:0");
    if (r.status === 429 || r.status >= 500) throw new Error(`eleven:${r.status}:${r.retryAfterS ?? 0}`);
    throw new NonRetryableError(`eleven:${r.status}`);
  }
  const { lines, speakers } = wordsToLines(r.result.words, marks);
  const db = env.DB;
  const at = iso();
  // Only the speech this audio holds is replaced: a lost part or a tail that never arrived keeps its live lines.
  const covered = coveredIntervals(marks, total / PCM_BYTES_PER_SECOND);
  const stmts: D1PreparedStatement[] = [
    db.prepare("DELETE FROM transcript_lines WHERE pass_id = ?1 AND state = 'staged'").bind(p.passId),
    db.prepare("UPDATE transcript_passes SET covered_json = ?1 WHERE id = ?2").bind(JSON.stringify(covered), p.passId),
  ];
  // Many rows per statement through json_each; chunks keep each bound value well under D1's limits.
  let chunk: { id: string; s: number; w: number; t: string }[] = [];
  let size = 0;
  const flush = () => {
    if (!chunk.length) return;
    stmts.push(
      db
        .prepare(
          `INSERT INTO transcript_lines (id, case_id, source, pass_id, speaker, wall_ms, text, state, created_by, created_at)
           SELECT json_extract(value, '$.id'), ?1, 'speaker_pass', ?2, json_extract(value, '$.s'), json_extract(value, '$.w'), json_extract(value, '$.t'), 'staged', 'speaker_pass', ?3
           FROM json_each(?4)`,
        )
        .bind(p.caseId, p.passId, at, JSON.stringify(chunk)),
    );
    chunk = [];
    size = 0;
  };
  for (const l of lines) {
    const text = l.text;
    chunk.push({ id: crypto.randomUUID(), s: l.speaker, w: l.wall_ms, t: text });
    size += text.length * 3 + 80;
    if (size > 60_000 || chunk.length >= 400) flush();
  }
  flush();
  await db.batch(stmts);
  return { lineCount: lines.length, speakerCount: speakers };
}

// One batch: the live lines the pass covers become superseded, the staged lines current, the pass done. Guarded on the
// pass still running, so a case closed meanwhile (purged) keeps its live lines. Re-running changes nothing.
async function activatePass(env: Env, p: SpeakerPassParams, counts: { lineCount: number; speakerCount: number }) {
  const ps = await passState(env, p.passId);
  if (ps?.state === "done") return { activated: true };
  const db = env.DB;
  // No words (silence, or a provider that heard nothing): keep the live text instead of replacing it with nothing.
  if (!ps || ps.state !== "running" || counts.lineCount === 0) {
    await db.batch([
      db.prepare("DELETE FROM transcript_lines WHERE pass_id = ?1 AND state = 'staged'").bind(p.passId),
      db.prepare("UPDATE transcript_passes SET state = 'empty', line_count = 0, speaker_count = 0, updated_at = ?1 WHERE id = ?2 AND state = 'running'").bind(iso(), p.passId),
    ]);
    return { activated: false };
  }
  const t = new Tx(db, await actor(env, p.jobId), { requestId: null, epoch: null });
  const at = iso();
  t.guard("pass_running", "(SELECT state FROM transcript_passes WHERE id = ?) = 'running'", [p.passId], () => new Error("audio_purged"));
  t.run(
    `UPDATE transcript_lines SET state = 'superseded', superseded_by_pass = ?1
     WHERE case_id = ?2 AND source = 'live' AND state = 'current' AND wall_ms > ?3 AND wall_ms <= ?4
       AND EXISTS (SELECT 1 FROM json_each((SELECT covered_json FROM transcript_passes WHERE id = ?1)) j
                   WHERE transcript_lines.wall_ms BETWEEN json_extract(j.value, '$[0]') AND json_extract(j.value, '$[1]'))`,
    p.passId, p.caseId, ps.from_wall_ms, ps.cutoff_wall_ms,
  );
  t.run("UPDATE transcript_lines SET state = 'current' WHERE pass_id = ?1 AND state = 'staged'", p.passId);
  t.run("UPDATE transcript_passes SET state = 'done', line_count = ?1, speaker_count = ?2, updated_at = ?3 WHERE id = ?4", counts.lineCount, counts.speakerCount, at, p.passId);
  t.audit({ action: "recording.speaker_pass", what_cs: "AI záznam: rozlišení mluvčích po schválení závěru", case_id: p.caseId });
  try {
    await t.commit();
  } catch (e) {
    if (e instanceof Error && e.message === "audio_purged") {
      await db.prepare("DELETE FROM transcript_lines WHERE pass_id = ?1 AND state = 'staged'").bind(p.passId).run();
      return { activated: false };
    }
    throw e;
  }
  return { activated: true };
}

async function setPassState(env: Env, p: SpeakerPassParams, state: "empty" | "purged") {
  await env.DB.prepare("UPDATE transcript_passes SET state = ?1, updated_at = ?2 WHERE id = ?3 AND state = 'running'").bind(state, iso(), p.passId).run();
  return { state };
}

async function passError(env: Env, p: SpeakerPassParams, code: PassErrorCode) {
  const db = env.DB;
  await db.batch([
    db.prepare("DELETE FROM transcript_lines WHERE pass_id = ?1 AND state = 'staged'").bind(p.passId),
    // A pass purged meanwhile keeps that state: the audio is gone, so "Zkusit znovu" must not be offered.
    db.prepare("UPDATE transcript_passes SET state = 'error', error_code = ?1, updated_at = ?2 WHERE id = ?3 AND state = 'running'").bind(code, iso(), p.passId),
  ]);
  return { code };
}

async function deleteAudio(env: Env, p: SpeakerPassParams, failed: PassErrorCode | null) {
  const what = failed ? "AI záznam: zvuk smazán po neúspěšném rozlišení mluvčích" : "AI záznam: zvuk po rozlišení mluvčích smazán";
  // The audit row is in the same batch as the state change, so a retried step cannot lose it.
  const n = await deleteForPass(env, p.passId, { actor: await actor(env, p.jobId), what_cs: what, case_id: p.caseId });
  return { deleted: n };
}

async function summarize(env: Env, p: SpeakerPassParams, basis: "speaker_pass" | "live_only", summaryId: string) {
  await phase(env, p.jobId, "summary");
  const db = env.DB;
  const done = await db.prepare("SELECT state FROM transcript_summaries WHERE id = ?1").bind(summaryId).first<{ state: string }>();
  if (done) return { summaryId, state: done.state };
  const ps = await passState(env, p.passId);
  // The pass is gone (reset-demo) or the case was closed: nothing is sent to the model for it any more.
  if (!ps) return { summaryId, state: "skipped" };
  const closed = await db.prepare("SELECT 1 AS x FROM cases WHERE id = ?1 AND status = 'closed'").bind(p.caseId).first();
  // This approval's discussion only: an earlier MDT of the same case has its own summary.
  const lines = closed
    ? []
    : (
        await db
          .prepare("SELECT speaker, text FROM transcript_lines WHERE case_id = ?1 AND state = 'current' AND wall_ms > ?2 AND wall_ms <= ?3 ORDER BY wall_ms, created_at, id")
          .bind(p.caseId, ps.from_wall_ms, ps.cutoff_wall_ms)
          .all<{ speaker: number | null; text: string }>()
      ).results;
  const at = iso();
  const model = env.AZURE_OPENAI_MODEL;
  const row = (state: string, o: { text?: string | null; error_code?: string | null; input_sha?: string | null; cache_hit?: boolean } = {}) =>
    db
      .prepare(
        `INSERT OR REPLACE INTO transcript_summaries (id, case_id, pass_id, state, basis, text, error_code, model, prompt_version, input_sha, cache_hit, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)`,
      )
      .bind(summaryId, p.caseId, p.passId, state, basis, o.text ?? null, o.error_code ?? null, model, PROMPT_VERSION, o.input_sha ?? null, o.cache_hit ? 1 : 0, at);
  if (!lines.length) {
    await row("skipped").run();
    return { summaryId, state: "skipped" };
  }
  const text = transcriptText(lines);
  // Refused rather than cut: a summary of half a discussion would look complete.
  if (text.length > (Number(env.SUMMARY_MAX_CHARS) || 40000)) {
    await row("error", { error_code: "transcript_too_long" }).run();
    return { summaryId, state: "error" };
  }
  const inputSha = await sha256Hex(`${model}\n${PROMPT_VERSION}\n${await sha256Hex(PROMPT)}\n${text}`);
  // Case-scoped prefix, so a case's cache can go with the case; reset-demo deletes cache/summary/.
  const key = `cache/summary/${p.caseId}/${inputSha}.json`;
  const cached = await (await env.DOCS.get(key))?.json<{ summary: string }>().catch(() => null);
  let summary: string;
  if (cached && typeof cached.summary === "string") summary = cached.summary;
  else {
    if (!env.AZURE_OPENAI_KEY) throw new NonRetryableError("azure:503");
    try {
      // One call per attempt: the step's retry policy is the backoff.
      summary = await summarizeTranscript(env, text, { attempts: 1 });
    } catch (e) {
      const st = e instanceof ApiError ? e.upstream : undefined;
      if (st === "network" || st === 429 || (typeof st === "number" && st >= 500)) throw new Error(`azure:${st}:0`);
      throw new NonRetryableError(`azure:${typeof st === "number" ? st : 400}`);
    }
    await env.DOCS.put(key, JSON.stringify({ summary, model, prompt_version: PROMPT_VERSION, created_at: at }), { httpMetadata: { contentType: "application/json" } });
  }
  const t = new Tx(db, await actor(env, p.jobId), { requestId: null, epoch: null });
  t.run(
    `INSERT OR REPLACE INTO transcript_summaries (id, case_id, pass_id, state, basis, text, error_code, model, prompt_version, input_sha, cache_hit, created_at)
     VALUES (?1, ?2, ?3, 'done', ?4, ?5, NULL, ?6, ?7, ?8, ?9, ?10)`,
    summaryId, p.caseId, p.passId, basis, summary, model, PROMPT_VERSION, inputSha, cached ? 1 : 0, at,
  );
  t.audit({ action: "recording.summary", what_cs: "AI záznam: shrnutí diskuse", case_id: p.caseId });
  await t.commit();
  return { summaryId, state: "done" };
}

async function summaryError(env: Env, p: SpeakerPassParams, basis: string, summaryId: string, code: PassErrorCode) {
  await env.DB.prepare(
    `INSERT OR REPLACE INTO transcript_summaries (id, case_id, pass_id, state, basis, error_code, model, prompt_version, created_at)
     VALUES (?1, ?2, ?3, 'error', ?4, ?5, ?6, ?7, ?8)`,
  )
    .bind(summaryId, p.caseId, p.passId, basis, code, env.AZURE_OPENAI_MODEL, PROMPT_VERSION, iso())
    .run();
  return { code };
}

async function finish(env: Env, p: SpeakerPassParams, failed: PassErrorCode | null) {
  await env.DB.prepare("UPDATE jobs SET state = ?1, phase = NULL, error_code = ?2, updated_at = ?3 WHERE id = ?4")
    .bind(failed ? "error" : "done", failed, iso(), p.jobId)
    .run();
  return { state: failed ? "error" : "done" };
}

export class SpeakerPassWorkflow extends WorkflowEntrypoint<Env, SpeakerPassParams> {
  async run(event: WorkflowEvent<SpeakerPassParams>, step: WorkflowStep) {
    const env = this.env;
    const p = event.payload;
    await step.do("mark running", FAST, () => markRunning(env, p));

    let basis: "speaker_pass" | "live_only" = "live_only";
    let failed: PassErrorCode | null = null;
    try {
      const audio = await step.do("finalize audio", FAST, () => finalizeForPass(env, p.passId, partBytes(env)));
      if (audio.state === "ready" && audio.seconds >= 0.5) {
        const counts = await step.do("diarize", DIARIZE, () => diarizeToStaged(env, p));
        const act = await step.do("activate pass lines", FAST, () => activatePass(env, p, counts));
        if (act.activated) basis = "speaker_pass";
      } else {
        await step.do("mark pass without audio", FAST, () => setPassState(env, p, audio.state === "purged" ? "purged" : "empty"));
      }
    } catch (err) {
      const code = safeCode(err);
      failed = (await step.do("mark pass error", FAST, () => passError(env, p, code))).code;
    }
    // Success and an empty pass always delete. After a failure the audio is kept for "Zkusit znovu" (user decision
    // 2026-10-18) unless it is already unusable; closing the case, the cron sweep (at most 7 days) and the R2 lifecycle
    // rule still delete it. A terminated instance skips this step; the cron sweep and the lifecycle rule cover that case.
    if (!failed || !keepsAudioAfter(failed)) await step.do("delete audio", DELETE, () => deleteAudio(env, p, failed));

    // One summary per run, so a manual retry makes a new draft next to the old one.
    const summaryId = `sum-${event.instanceId}`;
    try {
      await step.do("summarize", SUMMARY, () => summarize(env, p, basis, summaryId));
    } catch (err) {
      const code = safeCode(err);
      await step.do("mark summary error", FAST, () => summaryError(env, p, basis, summaryId, code));
    }
    await step.do("finish", FAST, () => finish(env, p, failed));
    return { failed: !!failed };
  }
}
