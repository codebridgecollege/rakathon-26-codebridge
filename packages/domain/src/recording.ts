// Pure rules of the AI recorder "AI záznam" (PRODUCT.md F-25, screen S-5) as the old page applies them in server mode
// (spanPid(), recMessage(), recSendLines(), joinPcm(), recAudioPush(), recPutPart(), recLoad(), REC_ERR and REC_FINAL
// in mocks/src/v3-template.html). The browser parts (microphone, socket) and the request loop live in the app; what is
// here decides which words go where, what is sent in one request and how a server reply becomes the view.

// Must match audio_format=pcm_16000, which the server puts in the socket URL.
export const REC_RATE = 16000;

// One recording's timeline: when it started and which case was open from which second. Each socket keeps a reference to
// its own, so a late sentence from a stopped recording is never mapped onto a new one.
export type Span = { from: number; pid: string | null };
export type RecTimeline = { t0: number; spans: Span[] };

// A transcript line as the page shows it: wall clock in ms, the words, the speaker number after the speaker pass, and
// the client line id once the line was queued for the server.
export type TxLine = { wall: number; text: string[]; spk?: number | null; cid?: string };

// Live words are split between cases by their timestamps (seconds on the recording's timeline), not by when the text
// arrives: the service commits a sentence only after a pause, possibly after the doctor has switched cases.
export function spanPid(ses: RecTimeline, t: number): string | null {
  let pid: string | null = null;
  for (const sp of ses.spans) {
    if (sp.from <= t) pid = sp.pid;
    else break;
  }
  return pid;
}

// The microphone's float samples as 16-bit PCM. Audio spoken while no open case can take it is replaced by silence
// before it is sent, so it never leaves the browser.
export function toPcm16(f32: ArrayLike<number>, keep: boolean): Int16Array {
  const pcm = new Int16Array(f32.length);
  if (keep) for (let i = 0; i < f32.length; i++) pcm[i] = Math.max(-1, Math.min(1, f32[i]!)) * 32767;
  return pcm;
}

export type SttWord = { type?: string; text: string; start?: number };
export type MadeLine = { pid: string; line: TxLine };

// The lines one committed sentence makes: consecutive words of the same case form one line. base is the socket's start
// on the timeline (a reconnect keeps the timeline). covered(pid, wall) says the case's speaker pass already holds that
// moment, so a sentence committed late is not shown twice.
export function committedLines(
  words: readonly SttWord[] | undefined,
  base: number,
  ses: RecTimeline,
  covered: (pid: string, wall: number) => boolean,
): MadeLine[] {
  const made: MadeLine[] = [];
  let cur: MadeLine | null = null;
  for (const w of words ?? []) {
    if (w.type !== "word") continue;
    const t = base + (w.start ?? 0);
    const pid = spanPid(ses, t);
    const wall = ses.t0 + t * 1000;
    if (!pid || covered(pid, wall)) {
      cur = null;
      continue;
    }
    if (!cur || cur.pid !== pid) {
      cur = { pid, line: { wall, text: [] } };
      made.push(cur);
    }
    cur.line.text.push(w.text);
  }
  return made;
}

// ---------- live lines to the server ----------

export type QueuedLine = { pid: string; recId: string; line: { client_line_id: string; wall_ms: number; text: string } };

// A case's queue is sent once it holds this many lines, and by the 2 s timer otherwise.
export const LINE_SEND_AT = 20;
export const LINE_BATCH_MAX = 100;
// Well under the server's 64 KB body limit (a line is at most 5000 characters).
export const LINE_BATCH_BYTES = 48000;
const lineBytes = (text: string) => text.length * 3 + 120;

// The next request's lines of one case: at most 100 lines and about 48 000 bytes, all of the recording of the case's
// oldest queued line (the server takes lines of one recording per request). Always at least one line.
export function nextBatch(queue: readonly QueuedLine[], pid: string): QueuedLine[] {
  const first = queue.find((x) => x.pid === pid);
  if (!first) return [];
  const batch: QueuedLine[] = [];
  let bytes = 0;
  for (const x of queue) {
    if (x.pid !== pid || x.recId !== first.recId) continue;
    const n = lineBytes(x.line.text);
    if (batch.length && (batch.length >= LINE_BATCH_MAX || bytes + n > LINE_BATCH_BYTES)) break;
    batch.push(x);
    bytes += n;
  }
  return batch;
}

// The client line ids the server is done with: stored, already stored, or rejected for good.
export function settledLineIds(reply: { accepted?: string[]; duplicate?: string[]; rejected?: { client_line_id: string }[] } | null | undefined): Set<string> {
  const r = reply ?? {};
  return new Set([...(r.accepted ?? []), ...(r.duplicate ?? []), ...(r.rejected ?? []).map((x) => x.client_line_id)]);
}

// A refusal that will not change on retry: the line or part is dropped (the case is closed, approved, off the agenda).
export const REC_FINAL: ReadonlySet<string> = new Set([
  "no_recording",
  "recording_ended",
  "not_recorder",
  "case_closed",
  "case_approved",
  "not_on_agenda",
  "session_not_running",
  "audio_too_long",
  "bad_audio_part",
  "invalid_input",
  "not_member",
  "role_forbidden",
  "case_not_found",
  "data_reset",
]);
export const isFinalCode = (code: string | null | undefined): boolean => !!code && REC_FINAL.has(code);

// Waits between attempts. Lines: 1, 2, 4 ... 30 s after the n-th failure in a row. Audio parts: the same series by
// attempt, six attempts. The live socket: 2, 4, 8 s after one, two, three quick closes.
export const lineBackoff = (fails: number): number => Math.min(30000, 1000 * 2 ** (fails - 1));
export const partBackoff = (attempt: number): number => Math.min(30000, 1000 * 2 ** attempt);
export const PART_ATTEMPTS = 6;
export const reconnectDelay = (fails: number): number => 1000 * 2 ** fails;
// A socket that closes within 10 s is failing (quota, key); three of those in a row stop the recording. One that ran
// longer was ended by the service as usual and resets the count.
export const QUICK_CLOSE_MS = 10000;
export const MAX_QUICK_FAILS = 3;
export const nextSocketFails = (fails: number, openedAt: number | null, now: number): number =>
  openedAt && now - openedAt > QUICK_CLOSE_MS ? 0 : fails + 1;

// Approval waits at most this long for the case's last lines and audio (alerts inform, they never block).
export const FLUSH_LIMIT_MS = 15000;
// After a stop the socket waits 3 s for the last sentence; the recording ends on the server after that.
export const COMMIT_WAIT_MS = 3000;
export const END_AFTER_MS = 3500;

// ---------- case audio to the server ----------

// Default size of one audio part: exactly 5 MiB (R2 multipart), so the page holds at most one part in memory and a
// closed tab loses at most about 2.7 minutes.
export const AUDIO_PART_BYTES = 5242880;
export const partSamples = (partBytes: number | null | undefined): number => (partBytes || AUDIO_PART_BYTES) / 2;

export function joinPcm(chunks: readonly Int16Array[], n: number): Int16Array {
  const out = new Int16Array(n);
  let o = 0;
  for (const c of chunks) {
    const k = Math.min(c.length, n - o);
    out.set(c.subarray(0, k), o);
    o += k;
    if (o >= n) break;
  }
  return out;
}

// Where in the upload's audio a visit of the case starts, and when.
export type AudioSeg = { start_sample: number; wall_ms: number };
// One case's audio upload within one recording. base counts the samples already cut into parts; n is the next part.
export type AudioUpload = { recId: string; n: number; chunks: Int16Array[]; samples: number; base: number; segs: AudioSeg[] };
export type AudioPart = { n: number; data: Int16Array; segs: AudioSeg[] };

export const newUpload = (recId: string): AudioUpload => ({ recId, n: 1, chunks: [], samples: 0, base: 0, segs: [] });

// Adds the case's audio and cuts every full part off; the parts go to the server in order. A fresh upload always
// starts with a visit mark (the case open at "Spustit záznam" had none yet).
export function pushAudio(u: AudioUpload, pcm: Int16Array, newSeg: boolean, now: number, per: number): AudioPart[] {
  if (!u.base && !u.samples && !u.segs.length) newSeg = true;
  if (newSeg) u.segs.push({ start_sample: u.base + u.samples, wall_ms: now });
  u.chunks.push(pcm);
  u.samples += pcm.length;
  const parts: AudioPart[] = [];
  while (u.samples >= per) {
    const all = joinPcm(u.chunks, u.samples);
    const data = all.slice(0, per);
    u.chunks = [all.slice(per)];
    u.samples -= per;
    const from = u.base;
    const n = u.n;
    u.base += per;
    u.n++;
    parts.push({ n, data, segs: u.segs.filter((x) => x.start_sample >= from && x.start_sample < from + per) });
  }
  return parts;
}

// The tail since the last full part, sent as the final part. It stays in memory until approval: if the approval fails
// and the discussion goes on, the next flush sends the same part number again, longer.
export const tailPart = (u: AudioUpload): AudioPart => ({ n: u.n, data: joinPcm(u.chunks, u.samples), segs: u.segs.filter((x) => x.start_sample >= u.base) });

// ---------- the stored transcript ----------

export type PassState = "running" | "done" | "error" | "purged" | "empty" | string;
export type TxPass = {
  id?: string;
  jobId: string | null;
  when: number | null;
  state: PassState;
  phase?: string | null;
  err?: string | null;
  reason?: string | null;
  audioKept?: boolean;
};
export type TxSummary = { state: string; text?: string; basis?: string | null; err?: string | null };
export type TxView = { lines: TxLine[]; passes: TxPass[]; summary: TxSummary | null; polls: string[] };

type ServerLine = { client_line_id?: string | null; wall_ms: number; speaker?: number | null; text: string };
type ServerPass = {
  id?: string;
  job_id?: string | null;
  cutoff_wall_ms?: number | null;
  state?: string;
  job_state?: string | null;
  job_phase?: string | null;
  error_code?: string | null;
  job_error?: string | null;
  purge_reason?: string | null;
  audio_kept?: boolean | null;
};
type ServerSummary = { state: string; text?: string | null; basis?: string | null; error_code?: string | null };
export type ServerTranscript = { lines?: ServerLine[]; passes?: ServerPass[]; summaries?: ServerSummary[] };

const active = (s: string | null | undefined) => s === "queued" || s === "running";

// What the server stored for the case (lines, passes and the latest summary). Lines still waiting in this page's queue
// stay shown until the server has them. polls are the jobs still running, which the page then polls.
export function transcriptView(d: ServerTranscript, local: readonly TxLine[], pending: readonly string[]): TxView {
  const serverLines = d.lines ?? [];
  const stored = new Set(serverLines.map((l) => l.client_line_id).filter(Boolean));
  const keep = local.filter((l) => l.cid && pending.includes(l.cid) && !stored.has(l.cid));
  const lines: TxLine[] = [
    ...serverLines.map((l) => ({ wall: l.wall_ms, spk: l.speaker ?? null, text: [l.text], cid: l.client_line_id ?? undefined })),
    ...keep,
  ].sort((a, b) => a.wall - b.wall);
  const ps = d.passes ?? [];
  const passes: TxPass[] = ps.map((x) => ({
    id: x.id,
    jobId: x.job_id ?? null,
    when: x.cutoff_wall_ms ?? null,
    state: active(x.state) ? "running" : (x.state ?? ""),
    phase: x.job_phase ?? null,
    err: x.error_code || x.job_error || null,
    reason: x.purge_reason ?? null,
    audioKept: !!x.audio_kept,
  }));
  const last = (d.summaries ?? []).at(-1);
  const summing = ps.some((x) => active(x.job_state) && x.job_phase === "summary");
  const summary: TxSummary | null = summing
    ? { state: "running" }
    : last
      ? { state: last.state, text: last.text || "", basis: last.basis ?? null, err: last.error_code ?? null }
      : null;
  const polls = ps.filter((x) => active(x.job_state) && x.job_id).map((x) => x.job_id!);
  return { lines, passes, summary, polls };
}

// A job is polled every 2 s for the first 30 s, then every 5 s, for at most 30 minutes.
export const JOB_POLL_LIMIT_MS = 30 * 60000;
export const jobPollDelay = (elapsed: number): number => (elapsed < 30000 ? 2000 : 5000);

// ---------- error codes in words ----------

// Codes the server or the speaker pass may report, as catalog message IDs; the server never sends provider text.
const REC_ERR_CODES = [
  "eleven_429",
  "eleven_5xx",
  "eleven_4xx",
  "network",
  "audio_missing",
  "audio_purged",
  "start_failed",
  "workflow_errored",
  "workflow_terminated",
  "workflow_incomplete",
  "transcript_too_long",
  "azure_429",
  "azure_5xx",
  "azure_4xx",
  "internal",
] as const;
export const REC_ERR_IDS: Readonly<Record<string, string>> = Object.fromEntries(REC_ERR_CODES.map((c) => [c, `discussion-rec-err-${c.replace(/_/g, "-")}`]));

// An unknown code is shown as it is, a missing one as "unknown error".
export function recErrMsg(code: string | null | undefined): { id: string } | { text: string } {
  if (code && REC_ERR_IDS[code]) return { id: REC_ERR_IDS[code]! };
  return code ? { text: code } : { id: "discussion-rec-err-unknown" };
}
