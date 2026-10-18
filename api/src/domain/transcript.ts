// Rules for the AI recording on the server (step-5.md "As implemented"): which live lines and audio parts a case
// accepts, how the speaker pass turns words into lines, and the fixed codes a failure may show. Pure: the routes and
// the Workflow load the rows and pass them in.
import { DomainError } from "./errors";

export const PCM_BYTES_PER_SECOND = 32_000; // 16 kHz, 16-bit, mono: what the page records (REC_RATE)
export const MAX_LINES_PER_BATCH = 100;
export const MAX_LINE_CHARS = 5000;
// A sentence is committed up to about a second after a pause and recStop waits 3 s for the last one; 60 s of grace
// after the recording ends covers a slow venue network without leaving the door open.
export const LATE_GRACE_MS = 60_000;
// The browser clock and the server clock differ by a little; a line from far outside the recording is refused.
export const CLOCK_SKEW_MS = 120_000;

const refuse = (status: 409 | 413 | 422 | 403 | 404, code: string, msg: string) => new DomainError(status, code, msg);

export const T = {
  noRecording: () => refuse(409, "no_recording", "AI záznam neběží; přepis ani zvuk se neukládají."),
  recordingEnded: () => refuse(409, "recording_ended", "AI záznam už skončil; další přepis se k němu neukládá."),
  notRecorder: () => refuse(403, "not_recorder", "Přepis a zvuk ukládá jen uživatel, který záznam spustil."),
  sessionNotRunning: () => refuse(409, "session_not_running", "MDT pro tento záznam neprobíhá."),
  notOnAgenda: () => refuse(409, "not_on_agenda", "Případ není na programu tohoto MDT; přepis se k němu neukládá."),
  caseClosed: () => refuse(409, "case_closed", "Uzavřený případ přepis ani zvuk nepřijímá."),
  caseApproved: () => refuse(409, "case_approved", "Závěr případu je schválen; další přepis ani zvuk se k němu neukládají."),
  tooManyLines: () => refuse(413, "too_large", `Najednou lze uložit nejvýš ${MAX_LINES_PER_BATCH} řádků přepisu.`),
  badPart: () => refuse(422, "bad_audio_part", "Část zvuku nemá správnou velikost."),
  audioTooLong: (minutes: number) =>
    refuse(413, "audio_too_long", `Zvuk případu přesáhl limit, rozlišení mluvčích proběhne jen pro prvních ${minutes} minut.`),
  jobNotFound: () => refuse(404, "job_not_found", "Zpracování nebylo nalezeno."),
  notRetryable: () => refuse(409, "not_retryable", "Zpracování nelze zopakovat: zvuk už byl smazán nebo zpracování běží."),
};

export type RecordingRow = {
  id: string;
  session_day: string | null;
  started_by: string;
  started_at: string;
  ended_at: string | null;
};

// The recording may take data from its own browser while it runs and for LATE_GRACE_MS after it stopped.
export function checkRecording(r: RecordingRow | null, viewerId: string, now: Date): void {
  if (!r) throw T.noRecording();
  if (r.started_by !== viewerId) throw T.notRecorder();
  if (r.ended_at && now.getTime() - Date.parse(r.ended_at) > LATE_GRACE_MS) throw T.recordingEnded();
}

export type CaseForRecording = {
  status: string;
  slot_day: string | null;
  session_running: boolean; // the recording's session (if any) has not ended
};

// recTarget() on the server: an open case, and during a seminar only a case on its agenda.
export function checkCaseTakes(r: RecordingRow, c: CaseForRecording): void {
  if (c.status === "closed") throw T.caseClosed();
  if (r.session_day) {
    if (c.slot_day !== r.session_day) throw T.notOnAgenda();
    if (!c.session_running && !r.ended_at) throw T.sessionNotRunning();
  }
}

export type LineIn = { client_line_id: string; wall_ms: number; text: string };
export type LineVerdict = { client_line_id: string; code: "case_approved" | "covered_by_pass" | "out_of_recording" | "invalid" };
// Margin around a visit's audio when deciding whether a live line is covered by it: a line's time is its first
// word, which the live and the batch transcription place a little differently.
export const COVER_SLACK_MS = 1500;
export type Interval = [number, number];

// The wall-time intervals the joined audio covers: each visit mark to the next one (or the end of the audio).
export function coveredIntervals(marks: Mark[], totalSeconds: number): Interval[] {
  const ms = [...marks].filter((m) => m.at_s < totalSeconds).sort((a, b) => a.at_s - b.at_s);
  return ms.map((m, i) => {
    const end = i + 1 < ms.length ? ms[i + 1]!.at_s : totalSeconds;
    return [Math.round(m.wall_ms - COVER_SLACK_MS), Math.round(m.wall_ms + (end - m.at_s) * 1000 + COVER_SLACK_MS)] as Interval;
  });
}
export const inIntervals = (t: number, iv: Interval[]) => iv.some(([a, b]) => t >= a && t <= b);

export const CLIENT_ID = /^[A-Za-z0-9-]{8,64}$/;

// Shape check of the request body. A line without a usable id refuses the batch (nothing could name it in the answer);
// any other bad line is refused alone ("invalid"), so one odd sentence does not cost the rest of the batch.
export function parseLines(raw: unknown): { lines: LineIn[]; invalid: string[] } {
  if (!Array.isArray(raw) || raw.length === 0) throw refuse(422, "invalid_input", "Řádky přepisu chybí.");
  if (raw.length > MAX_LINES_PER_BATCH) throw T.tooManyLines();
  const seen = new Set<string>();
  const lines: LineIn[] = [];
  const invalid: string[] = [];
  for (const x of raw) {
    const o = x as Record<string, unknown>;
    const id = o?.client_line_id, wall = o?.wall_ms, text = o?.text;
    if (typeof id !== "string" || !CLIENT_ID.test(id) || seen.has(id)) throw refuse(422, "invalid_input", "Řádek přepisu nemá platné ID.");
    seen.add(id);
    if (typeof wall !== "number" || !Number.isInteger(wall) || wall < 0 || typeof text !== "string" || !text.trim() || text.length > MAX_LINE_CHARS) {
      invalid.push(id);
      continue;
    }
    lines.push({ client_line_id: id, wall_ms: wall, text: text.trim() });
  }
  return { lines, invalid };
}

export type CaseTranscriptState = {
  protocol_approved: boolean; // the latest conclusion is approved and no new draft was started
  latest_decision_ms: number | null;
  covered: Interval[]; // what finished passes hold as speaker lines
};

// One version of each sentence: a line is taken only while the case is discussed (or, after approval, if it was spoken
// before the approval), and never when a finished speaker pass already holds that moment.
export function lineVerdict(l: LineIn, rec: RecordingRow, s: CaseTranscriptState, now: Date): LineVerdict["code"] | null {
  const from = Date.parse(rec.started_at) - CLOCK_SKEW_MS;
  const to = (rec.ended_at ? Date.parse(rec.ended_at) : now.getTime()) + CLOCK_SKEW_MS;
  if (l.wall_ms < from || l.wall_ms > to) return "out_of_recording";
  if (inIntervals(l.wall_ms, s.covered)) return "covered_by_pass";
  if (s.protocol_approved && (s.latest_decision_ms === null || l.wall_ms > s.latest_decision_ms)) return "case_approved";
  return null;
}

// ---------- audio parts ----------

export type PartIn = { n: number; bytes: number; final: boolean };

// R2 multipart: every part except the last has the same size (5 MiB by default); the last may be smaller. Whole
// samples only (an even byte count).
export function checkPart(p: PartIn, partBytes: number, maxBytes: number, maxMinutes: number): void {
  if (!Number.isInteger(p.n) || p.n < 1 || p.n > 10000) throw T.badPart();
  if (!Number.isInteger(p.bytes) || p.bytes <= 0 || p.bytes % 2 !== 0 || p.bytes > partBytes) throw T.badPart();
  if (!p.final && p.bytes !== partBytes) throw T.badPart();
  if ((p.n - 1) * partBytes + p.bytes > maxBytes) throw T.audioTooLong(maxMinutes);
}

export type SegmentIn = { start_sample: number; wall_ms: number };

export function parseSegments(header: string | undefined, maxStartSample: number): SegmentIn[] {
  if (!header) return [];
  if (header.length > 4096) throw T.badPart();
  let raw: unknown;
  try {
    raw = JSON.parse(header);
  } catch {
    throw T.badPart();
  }
  if (!Array.isArray(raw) || raw.length > 50) throw T.badPart();
  return raw.map((x) => {
    const o = x as Record<string, unknown>;
    if (!Number.isInteger(o?.start_sample) || !Number.isInteger(o?.wall_ms)) throw T.badPart();
    const s = o.start_sample as number, w = o.wall_ms as number;
    if (s < 0 || s > maxStartSample || w < 0) throw T.badPart();
    return { start_sample: s, wall_ms: w };
  });
}

// Which stored parts make the object: 1..k without a gap; only the last may be short. A gap (a part lost for good)
// keeps the audio before it, so the pass still covers what arrived in order.
export function partsToComplete(parts: { part_number: number; bytes: number }[], partBytes: number) {
  const sorted = [...parts].sort((a, b) => a.part_number - b.part_number);
  const out: typeof sorted = [];
  for (const p of sorted) {
    if (p.part_number !== out.length + 1) break;
    out.push(p);
    if (p.bytes !== partBytes) break; // a short part is the end
  }
  return out;
}

// ---------- the speaker pass ----------

export type Word = { text: string; start: number; speaker_id: string | null };
export type Mark = { at_s: number; wall_ms: number }; // a visit starts at at_s seconds into the joined audio
export type SpeakerLine = { speaker: number; wall_ms: number; text: string };
const LINE_SPLIT_CHARS = 2000;

// As recPostPass did in the page: speakers numbered 0, 1, 2 in order of first appearance; a word's time of day from
// the last visit mark at or before it; a new line when the speaker changes. Also a new line when a new visit to the
// case starts, so a line never spans two visits and every line's time is the time its first word was spoken.
export function wordsToLines(words: Word[], marks: Mark[]): { lines: SpeakerLine[]; speakers: number } {
  const ms = [...marks].sort((a, b) => a.at_s - b.at_s);
  const spk = new Map<string, number>();
  const lines: { speaker: number; visit: number; chars: number; wall_ms: number; words: string[] }[] = [];
  let cur: (typeof lines)[number] | null = null;
  for (const w of words) {
    const key = w.speaker_id ?? "?";
    if (!spk.has(key)) spk.set(key, spk.size);
    const s = spk.get(key)!;
    let visit = 0;
    ms.forEach((x, i) => {
      if (x.at_s <= w.start) visit = i;
    });
    // A very long turn (one voice for minutes) is split too, so no line outgrows what the page and D1 handle well.
    if (!cur || cur.speaker !== s || cur.visit !== visit || cur.chars > LINE_SPLIT_CHARS) {
      const m: Mark = ms[visit] ?? { at_s: 0, wall_ms: 0 };
      cur = { speaker: s, visit, chars: 0, wall_ms: Math.max(0, Math.round(m.wall_ms + (w.start - m.at_s) * 1000)), words: [] };
      lines.push(cur);
    }
    cur.words.push(w.text);
    cur.chars += w.text.length + 1;
  }
  return { lines: lines.map((l) => ({ speaker: l.speaker, wall_ms: l.wall_ms, text: l.words.join(" ") })).filter((l) => l.text.trim()), speakers: spk.size };
}

// The summary input, built as recSummarize did: one line per transcript line, "Mluvčí N: " for speaker lines.
export function transcriptText(lines: { speaker: number | null; text: string }[]): string {
  return lines.map((l) => `${l.speaker !== null ? `Mluvčí ${l.speaker + 1}: ` : ""}${l.text}`).join("\n");
}

// A failed speaker pass keeps its audio for "Zkusit znovu" until the case closes or a pass succeeds, at most
// KEPT_AUDIO_MAX_AGE_MS (user decision 2026-10-18, DATA-PROTECTION.md "Meeting audio"). These failures leave nothing
// worth keeping: the audio is gone already, or the pass was purged.
export const FAILURES_WITHOUT_AUDIO: readonly PassErrorCode[] = ["audio_missing", "audio_purged"];
export const keepsAudioAfter = (code: PassErrorCode): boolean => !FAILURES_WITHOUT_AUDIO.includes(code);

// The fixed codes a failed step may show. Provider text never reaches the database, the page or the logs.
export const PASS_ERROR_CODES = ["eleven_429", "eleven_5xx", "eleven_4xx", "network", "audio_missing", "audio_purged", "transcript_too_long", "azure_429", "azure_5xx", "azure_4xx", "internal"] as const;
export type PassErrorCode = (typeof PASS_ERROR_CODES)[number];

// Messages are built as "<provider>:<status>[:<retry-after s>]" or a bare code, so they carry no request data.
export function safeCode(err: unknown): PassErrorCode {
  const msg = err instanceof Error ? err.message : String(err ?? "");
  const m = /(eleven|azure):(\d{3}|network)/.exec(msg);
  if (m) {
    if (m[2] === "network") return "network";
    const st = Number(m[2]);
    const p = m[1] as "eleven" | "azure";
    return st === 429 ? `${p}_429` : st >= 500 ? `${p}_5xx` : `${p}_4xx`;
  }
  const bare = (PASS_ERROR_CODES as readonly string[]).find((c) => msg.includes(c));
  return (bare as PassErrorCode) ?? "internal";
}

// The Workflow engine's states as the job row shows them.
export function engineToJob(status: string): "queued" | "running" | "done" | "error" {
  if (status === "queued") return "queued";
  if (status === "complete") return "done";
  if (status === "errored" || status === "terminated") return "error";
  return "running";
}
