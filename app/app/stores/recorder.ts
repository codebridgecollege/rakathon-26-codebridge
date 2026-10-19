// The AI recorder "AI záznam" (PRODUCT.md F-25, screen S-5): live transcription of the MDT discussion, in server mode.
//
// - One recording runs for the whole meeting. Each word goes to the case that was open when it was spoken
//   (recordingTarget() in @codebridge/domain/discussion), so moving to the next case moves the transcript with it, and
//   moving back continues the earlier one. Audio spoken while no case can take it is replaced by silence before it is
//   sent, so it never leaves the browser.
// - Server mode (health.features.transcripts): finished live lines and the case's audio go to the server while the case
//   is discussed; approval starts the speaker pass there, which deletes the audio and makes the summary draft. The page
//   polls the job and shows what the server stored.
// - Without server mode the recorder still shows live words, but stores nothing and holds no audio: the in-browser
//   speaker pass runs only on the server, and the app has no mode without it.
// - A Pinia store, so a recording survives route changes. The audio buffers and queues are plain, non-reactive state:
//   they change four times a second and nothing on screen shows them.
// - Nothing here logs transcript text or audio. The server audits its own recording routes.
import { defineStore } from "pinia";
import { computed, reactive, ref, watch } from "vue";
import { ApiError, type WriteReply } from "@codebridge/api-client";
import { allDone, recordingTarget, runningSession } from "@codebridge/domain/discussion";
import { dayAgenda } from "@codebridge/domain/calendar";
import {
  COMMIT_WAIT_MS,
  END_AFTER_MS,
  FLUSH_LIMIT_MS,
  JOB_POLL_LIMIT_MS,
  LINE_SEND_AT,
  MAX_QUICK_FAILS,
  PART_ATTEMPTS,
  REC_RATE,
  committedLines,
  isFinalCode,
  jobPollDelay,
  lineBackoff,
  newUpload,
  nextBatch,
  nextSocketFails,
  partBackoff,
  partSamples,
  pushAudio,
  reconnectDelay,
  settledLineIds,
  tailPart,
  toPcm16,
  transcriptView,
  type AudioSeg,
  type AudioUpload,
  type QueuedLine,
  type RecTimeline,
  type ServerTranscript,
  type TxLine,
  type TxPass,
  type TxSummary,
} from "@codebridge/domain/recording";
import { useApi } from "../lib/api";
import { msgId, type Msg } from "../lib/msg";
import { refused } from "../lib/refused";
import { OPEN, openMic, openSocket, sendChunk, sendCommit, type Mic, type SttSocket } from "../lib/recorder-audio";
import { useCasesStore } from "./cases";
import { useDiscussionStore } from "./discussion";
import { usePatientsStore } from "./patients";
import { useSessionStore } from "./session";
import { useWorkflowStore } from "./workflow";

export type RecStatus = "off" | "connecting" | "on";
export type CaseTx = { lines: TxLine[]; passes: TxPass[]; summary: TxSummary | null; loaded: boolean };

// A socket with what it was opened for: its own timeline and recording, its start on the timeline and when it opened.
type Live = { ws: SttSocket; ses: RecTimeline; recId: string | null; base: number; opened: number | null; gen: number };
type Upload = AudioUpload & { chain: Promise<boolean>; off: boolean };
type LineSend = { busy: Promise<boolean> | null; wait: number; fails: number };

const EMPTY_TX: CaseTx = Object.freeze({ lines: [], passes: [], summary: null, loaded: false }) as CaseTx;
const LINES_TICK_MS = 2000;

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

// A failed token request, told apart from a failed start of the stored recording.
class TokenFailed {
  constructor(public cause: unknown) {}
}
// Why the start or a reconnect failed, as a Msg. The server's Czech message when it sent one; the token route's status
// otherwise; the client's own catalog message when no answer came; the browser's text for a refused microphone.
// reasonId carries a catalog ID that the panel formats into $reason (Fluent cannot nest a message chosen at run time).
function reasonOf(err: unknown): Msg {
  const token = err instanceof TokenFailed;
  const e = token ? err.cause : err;
  if (e instanceof ApiError) {
    if (e.message_cs) return { text: e.message_cs };
    if (token && e.status) return msgId("discussion-rec-token-failed", { status: e.status });
    return msgId(e.message_id ?? "api-error-write-failed");
  }
  return { text: (e as Error)?.message || String(e) };
}
function startFailed(reason: Msg): Msg {
  return "text" in reason
    ? msgId("discussion-rec-start-failed", { reason: reason.text })
    : msgId("discussion-rec-start-failed", { ...reason.args, reasonId: reason.id });
}

export const useRecorderStore = defineStore("recorder", () => {
  const on = ref(false);
  const status = ref<RecStatus>("off");
  const msg = ref<Msg | null>(null);
  const partial = ref("");
  // Per case (list file): the lines, the speaker passes and the summary shown, and whether the stored copy was read.
  const txs = reactive<Record<string, CaseTx>>({});

  const health = computed(() => useSessionStore().health);
  const stt = computed(() => !!health.value?.features?.stt);
  const serverMode = computed(() => !!health.value?.features?.transcripts);
  // The health answer is read at boot; until then the panel says it is checking.
  const probed = computed(() => !!health.value);

  // The case that takes words now: the open case, unless closed or approved, and during a seminar only its own cases.
  const target = computed<string | null>(() => {
    const file = useCasesStore().openFile;
    const p = file ? usePatientsStore().byFile(file) : undefined;
    if (!p) return null;
    return recordingTarget(p, useDiscussionStore().isApproved(p.file), runningSession(useWorkflowStore().sessions));
  });

  // ---------- plain state ----------
  let mic: Mic | null = null;
  let live: Live | null = null;
  let ses: RecTimeline | null = null;
  // Samples sent on the current recording's timeline.
  let sent = 0;
  let lastPid: string | null = null;
  let fails = 0;
  let recId: string | null = null;
  let lq: QueuedLine[] = [];
  const up = new Map<string, Upload>();
  const lsend = new Map<string, LineSend>();
  let linesTimer: ReturnType<typeof setInterval> | null = null;
  const polls = new Set<string>();
  // Bumped before and after a user switch: replies to requests of the previous user, and late sentences of a socket
  // opened under them, are dropped. Reactive, so the panel reads the cleared transcript again for the new user.
  const gen = ref(0);
  // Bumped by every start and stop: a start that was stopped (or stopped and started again) while it waited for the
  // microphone, the server or the token gives up instead of opening a second microphone or socket.
  let attempt = 0;

  const tx = (file: string): CaseTx => txs[file] ?? EMPTY_TX;
  // Read back through txs, so the caller gets the reactive copy: `txs[file] ??= {...}` would return the plain object,
  // and changes made through it would not redraw the panel.
  function txOf(file: string): CaseTx {
    if (!txs[file]) txs[file] = { lines: [], passes: [], summary: null, loaded: false };
    return txs[file]!;
  }
  const caseIdOf = (file: string) => usePatientsStore().byFile(file)?.id ?? null;
  const openCaseId = () => {
    const f = useCasesStore().openFile;
    return f ? caseIdOf(f) : null;
  };
  const api = () => useApi();

  // ---------- start, socket, stop ----------
  async function start() {
    if (!stt.value) {
      stop(msgId("discussion-rec-unavailable"));
      return;
    }
    if (on.value || status.value === "connecting") return;
    const a = ++attempt;
    status.value = "connecting";
    msg.value = null;
    try {
      const m = await openMic(chunk);
      // Stopped while the browser asked for the microphone: let it go at once.
      if (a !== attempt) {
        m.stop();
        return;
      }
      mic = m;
      on.value = true;
      ses = { t0: Date.now(), spans: [] };
      sent = 0;
      lastPid = null;
      partial.value = "";
      fails = 0;
      recId = null;
      // The server refuses lines and audio without a recording, so nothing is stored unless it was switched on here.
      if (serverMode.value) {
        const r = (await api().startRecording({ session_day: runningSession(useWorkflowStore().sessions)?.day ?? null, case_id: openCaseId() })) as WriteReply<{ recording_id: string }>;
        if (a !== attempt) {
          void serverEnd(r.data.recording_id, "stopped");
          return;
        }
        recId = r.data.recording_id;
        startLinesTimer();
      }
      await connect();
    } catch (e) {
      if (a === attempt) stop(startFailed(reasonOf(e)));
    }
  }

  async function connect() {
    const a = attempt;
    let ws_url: string;
    try {
      ({ ws_url } = await api().sttToken());
    } catch (e) {
      throw new TokenFailed(e);
    }
    // Stopped (or stopped and started again) while the token was on its way.
    if (a !== attempt || !on.value || !ses) return;
    const lv: Live = { ws: null as unknown as SttSocket, ses, recId, base: 0, opened: null, gen: gen.value };
    lv.ws = openSocket(ws_url, {
      onOpen() {
        if (live !== lv || !on.value) {
          lv.ws.close();
          return;
        }
        lv.base = sent / REC_RATE;
        lv.opened = Date.now();
        status.value = "on";
      },
      onMessage: (m) => message(m, lv),
      // The service ends long sessions; while recording is on, reconnect with a new token and keep the timeline. A
      // socket that keeps closing within seconds is failing (quota, key), so after three of those in a row it stops.
      onClose() {
        if (live !== lv || !on.value) return;
        live = null;
        fails = nextSocketFails(fails, lv.opened, Date.now());
        if (fails >= MAX_QUICK_FAILS) {
          stop(msgId("discussion-rec-socket-failed"));
          return;
        }
        status.value = "connecting";
        // A stop and a new start within the delay make this timer stale; the new start opens its own socket.
        const a = attempt;
        setTimeout(() => {
          if (a === attempt && on.value && !live) connect().catch((e) => stop(reasonOf(e)));
        }, reconnectDelay(fails));
      },
    });
    live = lv;
  }

  function chunk(f32: Float32Array) {
    if (!on.value || !ses) return;
    const pid = target.value;
    const pcm = toPcm16(f32, !!pid);
    // The case's own audio goes to the server for the speaker pass after approval, one segment per visit.
    if (pid && serverMode.value) audioPush(pid, pcm, pid !== lastPid);
    if (pid !== lastPid) {
      lastPid = pid;
      partial.value = "";
    }
    const lv = live;
    if (!lv || lv.ws.readyState !== OPEN) return;
    const at = sent / REC_RATE;
    if (ses.spans.at(-1)?.pid !== pid) ses.spans.push({ from: at, pid });
    sendChunk(lv.ws, pcm);
    sent += pcm.length;
  }

  function message(m: Record<string, unknown>, lv: Live) {
    // A sentence arriving after a user switch belongs to the previous user and is not shown or sent.
    if (lv.gen !== gen.value) return;
    const type = String(m.message_type ?? "");
    if (type === "partial_transcript") {
      if (lv === live) partial.value = String(m.text ?? "");
    } else if (type === "committed_transcript_with_timestamps") {
      partial.value = "";
      // A sentence committed late may cover speech the speaker pass already holds; keep one version.
      const covered = (pid: string, wall: number) => txOf(pid).passes.some((x) => x.state === "done" && x.when != null && wall <= x.when);
      for (const { pid, line } of committedLines(m.words as never, lv.base, lv.ses, covered)) {
        // A line is final once its message is processed, so it goes to the server as an immutable record.
        if (lv.recId) line.cid = api().newKey();
        txOf(pid).lines.push(line);
        if (lv.recId) queueLine(pid, line, lv.recId);
      }
    } else if (/error/.test(type)) {
      msg.value = msgId("discussion-rec-stt-error", { reason: String(m.error || m.message || type) });
    }
  }

  // Stops the recording: msg says why, reason goes to the server ("stopped", "all_approved", ...).
  function stop(why: Msg | null = null, reason = "stopped") {
    if (!on.value && status.value === "off") {
      msg.value = why;
      return;
    }
    attempt++;
    on.value = false;
    status.value = "off";
    msg.value = why;
    partial.value = "";
    // After the last sentence (the socket waits 3 s for it), store what is queued and end the recording. The uploads
    // are taken now: a recording started again within the wait gets fresh ones and must not hide these.
    if (recId) {
      const id = recId;
      const ups = [...up].filter(([, u]) => u.recId === id);
      recId = null;
      setTimeout(() => void serverEnd(id, reason, ups), END_AFTER_MS);
    }
    mic?.stop();
    mic = null;
    const lv = live;
    live = null;
    if (lv?.ws.readyState === OPEN) {
      sendCommit(lv.ws);
      setTimeout(() => lv.ws.close(), COMMIT_WAIT_MS);
    } else lv?.ws.close();
  }

  async function serverEnd(id: string, reason: string, ups: [string, Upload][] = []) {
    const pids = [...new Set(lq.filter((x) => x.recId === id).map((x) => x.pid))];
    await Promise.all([...pids.map((pid) => sendLines(pid)), ...ups.map(([pid, u]) => flushUpload(pid, u))]);
    try {
      await api().endRecording(id, { end_reason: reason, case_id: openCaseId() });
    } catch {
      // The server ends it with the seminar or after a minute of silence.
    }
  }

  // ---------- live lines to the server ----------
  function queueLine(pid: string, line: TxLine, rid: string) {
    lq.push({ pid, recId: rid, line: { client_line_id: line.cid!, wall_ms: Math.round(line.wall), text: line.text.join(" ") } });
    if (lq.filter((x) => x.pid === pid).length >= LINE_SEND_AT) void sendLines(pid);
  }

  function startLinesTimer() {
    if (linesTimer) return;
    linesTimer = setInterval(() => {
      for (const pid of new Set(lq.map((x) => x.pid))) void sendLines(pid);
      if (!on.value && !lq.length && linesTimer) {
        clearInterval(linesTimer);
        linesTimer = null;
      }
    }, LINES_TICK_MS);
  }

  // One request at a time per case; a failed send stays queued and retries with backoff. Resolves true when the case's
  // queue is empty, false while lines wait (approval then warns that part of the record may be missing).
  function sendLines(pid: string): Promise<boolean> {
    let st = lsend.get(pid);
    if (!st) lsend.set(pid, (st = { busy: null, wait: 0, fails: 0 }));
    if (st.busy) return st.busy;
    if (!lq.some((x) => x.pid === pid)) return Promise.resolve(true);
    if (Date.now() < st.wait) return Promise.resolve(false);
    const s = st;
    s.busy = (async () => {
      while (lq.some((x) => x.pid === pid)) {
        const batch = nextBatch(lq, pid);
        const ids = new Set(batch.map((x) => x.line.client_line_id));
        try {
          const id = caseIdOf(pid);
          if (!id) throw new Error("case not in the list");
          const r = (await api().transcriptLines(id, { recording_id: batch[0]!.recId, lines: batch.map((x) => x.line) })) as WriteReply<{
            accepted?: string[];
            duplicate?: string[];
            rejected?: { client_line_id: string }[];
          }>;
          const done = settledLineIds(r.data);
          lq = lq.filter((x) => !done.has(x.line.client_line_id));
          s.fails = 0;
          // A reply that settles none of the batch would loop; the rest waits for the next tick.
          if (![...ids].some((i) => done.has(i))) return false;
        } catch (e) {
          if (e instanceof ApiError && isFinalCode(e.code)) {
            lq = lq.filter((x) => !ids.has(x.line.client_line_id));
            continue;
          }
          s.fails++;
          s.wait = Date.now() + lineBackoff(s.fails);
          return false;
        }
      }
      return true;
    })().finally(() => {
      s.busy = null;
    });
    return s.busy;
  }

  // ---------- case audio to the server ----------
  function upOf(pid: string): Upload {
    const u = up.get(pid);
    if (u && u.recId === recId) return u;
    const fresh: Upload = { ...newUpload(recId!), chain: Promise.resolve(true), off: false };
    up.set(pid, fresh);
    return fresh;
  }

  function audioPush(pid: string, pcm: Int16Array, newSeg: boolean) {
    if (!recId) return;
    const u = upOf(pid);
    if (u.off) return;
    for (const part of pushAudio(u, pcm, newSeg, Date.now(), partSamples(health.value?.limits?.audio_part_bytes))) {
      void sendPart(pid, u, part.n, part.data, false, part.segs);
    }
  }

  function sendPart(pid: string, u: Upload, n: number, data: Int16Array, final: boolean, segs: AudioSeg[]): Promise<boolean> {
    u.chain = u.chain.then(() => putPart(pid, u, n, data, final, segs));
    return u.chain;
  }

  async function putPart(pid: string, u: Upload, n: number, data: Int16Array, final: boolean, segs: AudioSeg[]): Promise<boolean> {
    for (let i = 0; i < PART_ATTEMPTS; i++) {
      if (u.off) return false;
      try {
        const id = caseIdOf(pid);
        if (!id) throw new Error("case not in the list");
        await api().audioPart(id, n, new Uint8Array(data.buffer, data.byteOffset, data.byteLength), { recording_id: u.recId, final, segments: segs });
        return true;
      } catch (e) {
        if (e instanceof ApiError && isFinalCode(e.code)) {
          // The upload stops for good; a data reset has its own notice and reload (the API client signals it).
          u.off = true;
          if (e.code === "audio_too_long" && e.message_cs) msg.value = { text: e.message_cs };
          return false;
        }
        // A network error or a passing refusal: tried again below.
      }
      await sleep(partBackoff(i));
    }
    return false;
  }

  function flushUpload(pid: string, u: Upload | undefined): Promise<boolean> {
    if (!u || u.off) return Promise.resolve(true);
    if (!u.samples) return u.chain;
    const t = tailPart(u);
    return sendPart(pid, u, t.n, t.data, true, t.segs);
  }

  // The case's queued lines and the tail of its audio, before approval. Never waits more than 15 s; false when part
  // of it may be missing.
  function flush(file: string): Promise<boolean> {
    const all = Promise.all([sendLines(file), flushUpload(file, up.get(file))]).then((rs) => rs.every((x) => x !== false));
    return Promise.race([all, sleep(FLUSH_LIMIT_MS).then(() => false)]);
  }

  // ---------- after approval, closing, the end of the seminar ----------
  // A case that ends without approval (closed, the seminar ended) loses its audio on the server; queued lines stay
  // queued, because the server still takes them within its grace period and refuses them if not. Only the open case
  // reloads, so no transcript is read (and logged) that nobody opened. why is the cause for the record; the server
  // words its own purge reason. Without server mode the page holds no audio, so there is nothing to drop.
  function purge(files: string[], why: string) {
    void why;
    if (!serverMode.value) return;
    // Parts still on their way stop retrying: the server would refuse them for a closed case or a finished seminar.
    for (const f of files) {
      const u = up.get(f);
      if (u) u.off = true;
      up.delete(f);
    }
    const open = useCasesStore().openFile;
    if (open && files.includes(open) && txs[open]) void load(open);
  }

  // Approval ends the case's transcript and starts its speaker pass (the approval claimed the uploaded audio, so the
  // next visit starts a new upload). When every case of the running seminar is approved or closed, the recording
  // stops by itself.
  function afterApprove(file: string, jobId: string | null) {
    if (serverMode.value) {
      up.delete(file);
      if (jobId) {
        const t = txOf(file);
        if (!t.passes.some((x) => x.jobId === jobId)) t.passes.push({ state: "running", jobId, when: Date.now() });
        void jobPoll(file, jobId);
      }
    }
    const s = runningSession(useWorkflowStore().sessions);
    const agenda = s ? dayAgenda(usePatientsStore().rows, s.day) : [];
    const disc = useDiscussionStore();
    if (on.value && allDone(agenda, (f) => disc.isApproved(f))) stop(msgId("discussion-rec-all-approved"), "all_approved");
  }

  // ---------- the stored transcript ----------
  async function load(file: string) {
    const id = caseIdOf(file);
    if (!id || !serverMode.value) return;
    const t = txOf(file);
    t.loaded = true;
    const g = gen.value;
    let d: ServerTranscript;
    try {
      d = (await api().transcript(id)) as ServerTranscript;
    } catch {
      // Tried again when the case is opened again, not at once (the panel does not watch this flag).
      if (g === gen.value) t.loaded = false;
      return;
    }
    if (g !== gen.value) return;
    const pending = lq.filter((x) => x.pid === file).map((x) => x.line.client_line_id);
    const v = transcriptView(d, t.lines, pending);
    t.lines = v.lines;
    t.passes = v.passes;
    t.summary = v.summary;
    for (const j of v.polls) void jobPoll(file, j);
  }

  // Every 2 s for the first 30 s, then every 5 s, up to 30 minutes; then the stored transcript replaces the view.
  async function jobPoll(file: string, jobId: string) {
    // Per user switch: a poll of the previous user that is still asleep must not hold the job for the new one.
    const g = gen.value;
    const key = `${g}:${jobId}`;
    if (polls.has(key)) return;
    polls.add(key);
    const t0 = Date.now();
    try {
      while (Date.now() - t0 < JOB_POLL_LIMIT_MS && g === gen.value) {
        await sleep(jobPollDelay(Date.now() - t0));
        if (g !== gen.value) return;
        let j: { state?: string; phase?: string };
        try {
          j = (await api().job(jobId)) as { state?: string; phase?: string };
        } catch (e) {
          if (e instanceof ApiError && (e.status === 403 || e.status === 404)) break;
          continue;
        }
        const t = txOf(file);
        const ps = t.passes.find((x) => x.jobId === jobId);
        if (ps) ps.phase = j.phase ?? null;
        if (j.phase === "summary" && t.summary?.state !== "running") t.summary = { state: "running" };
        if (j.state === "done" || j.state === "error") break;
      }
    } finally {
      polls.delete(key);
      if (g === gen.value) await load(file);
    }
  }

  // "Zkusit znovu" on a failed speaker pass. not_retryable: the kept audio is gone (closed case, age limit); the reload
  // shows the live transcript and its summary instead of a refusal.
  async function retry(file: string, i: number) {
    const ps = txs[file]?.passes[i];
    if (!ps?.jobId) return;
    try {
      await api().retryJob(ps.jobId);
    } catch (e) {
      if (!(e instanceof ApiError && e.code === "not_retryable")) refused(e);
      void load(file);
      return;
    }
    ps.state = "running";
    ps.err = null;
    void jobPoll(file, ps.jobId);
  }

  // The recorder belongs to the user who started it (the server takes data only from them), and the transcripts it
  // loaded were read under that user's access: both go with a user switch (switchApiUser()).
  function forget() {
    gen.value++;
    for (const f of Object.keys(txs)) delete txs[f];
  }
  // Stopped also without server storage: the microphone and the live words belong to the previous user.
  useSessionStore().onUserLeaving(() => {
    if (on.value) stop(msgId("discussion-rec-stopped-user-switch"));
    forget();
    // Retries of parts already on their way would otherwise go out under the next user's id.
    for (const u of up.values()) u.off = true;
    up.clear();
    lq = [];
  });
  // A running recording, or lines and audio parts not yet stored, must not be cut off by a lost login (AUTH.md).
  useSessionStore().onUnsavedCheck(() => on.value || lq.length > 0 || up.size > 0);
  // The switch's other hooks are awaited before the new user is set, so a panel may read its transcript again under
  // the previous user meanwhile; once the new user is in place, that copy goes too and the panel reads it again.
  watch(
    () => useSessionStore().me,
    () => {
      if (serverMode.value) forget();
    },
  );

  return {
    on,
    status,
    msg,
    partial,
    txs,
    stt,
    serverMode,
    probed,
    target,
    gen,
    tx,
    start,
    stop,
    purge,
    afterApprove,
    flush,
    load,
    retry,
  };
});
