// The AI recorder against a mocked API and a stand-in microphone and socket: which case takes the words, what goes to
// the server and when, what approval, closing and a user switch do, and what the panel and the header pill say.
// Synthetic values only; no audio or real speech service.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises } from "@vue/test-utils";
import type { Health } from "@codebridge/api-client";
import RecorderPanel from "../app/components/discussion/RecorderPanel.vue";
import RecorderPill from "../app/components/RecorderPill.vue";
import { useRecorderStore } from "../app/stores/recorder";
import { useCasesStore } from "../app/stores/cases";
import { useSessionStore } from "../app/stores/session";
import { useWorkflowStore } from "../app/stores/workflow";
import { usePatientsStore } from "../app/stores/patients";
import { msgId } from "../app/lib/msg";
import { mountInCase, setupPatient, type PatientSetup } from "./patient";

type FakeWs = { url: string; h: { onOpen(): void; onMessage(m: Record<string, unknown>): void; onClose(): void }; readyState: number; sent: Record<string, unknown>[]; closed: boolean; send(d: string): void; close(): void };
const audio = vi.hoisted(() => ({ onChunk: null as ((f: Float32Array) => void) | null, sockets: [] as FakeWs[], micStops: 0, micError: null as unknown }));

// The browser parts are replaced; the real ones are checked separately below.
vi.mock("../app/lib/recorder-audio", async (orig) => {
  const real = await orig<typeof import("../app/lib/recorder-audio")>();
  return {
    ...real,
    openMic: async (fn: (f: Float32Array) => void) => {
      if (audio.micError) throw audio.micError;
      audio.onChunk = fn;
      return { stop: () => void audio.micStops++ };
    },
    openSocket: (url: string, h: FakeWs["h"]) => {
      const ws: FakeWs = {
        url,
        h,
        readyState: 0,
        sent: [],
        closed: false,
        send(d: string) {
          this.sent.push(JSON.parse(d) as Record<string, unknown>);
        },
        close() {
          this.closed = true;
          this.readyState = 3;
        },
      };
      audio.sockets.push(ws);
      return ws;
    },
  };
});

const FILE = "10_pacient.pdf";
const ID = "NO-010";
const reply = (data: unknown) => ({ data, data_epoch: null, state: {} });
const refusal = (status: number, code: string, message_cs: string | null = null) => [status, { error: { code, message_cs } }];

function setup(o: { stt?: boolean; transcripts?: boolean; partBytes?: number; routes?: Record<string, unknown> } & PatientSetup = {}) {
  const s = setupPatient({
    ...o,
    routes: {
      "/stt/token": { ws_url: "wss://stt.test/realtime?token=t", expires_in_s: 900 },
      "/recordings": reply({ recording_id: "r1" }),
      "/recordings/r1": reply({}),
      [`/cases/${ID}/transcript`]: { lines: [], passes: [], summaries: [] },
      [`/cases/${ID}/transcript/lines`]: (_u: string, init: RequestInit) => {
        const b = JSON.parse(String(init.body)) as { lines: { client_line_id: string }[] };
        return reply({ accepted: b.lines.map((l) => l.client_line_id), duplicate: [], rejected: [] });
      },
      [`/cases/${ID}/transcript/audio/parts/1`]: reply({}),
      [`/cases/${ID}/transcript/audio/parts/2`]: reply({}),
      ...o.routes,
    },
  });
  useSessionStore().health = {
    ok: true,
    service: "codebridge-mdt",
    features: { stt: o.stt ?? true, summarize: true, data: true, transcripts: o.transcripts ?? true, pipeline: false },
    limits: { audio_part_bytes: o.partBytes ?? 16 },
  } as unknown as Health;
  return s;
}

const callsTo = (calls: { url: string; init: RequestInit }[], path: string, method?: string) =>
  calls.filter((c) => c.url.replace(/^\/api/, "").split("?")[0] === path && (!method || (c.init.method ?? "GET") === method));

// Starts recording on the open case and opens the socket.
async function startOn(file: string | null = FILE) {
  useCasesStore().setOpen(file);
  const rec = useRecorderStore();
  await rec.start();
  const ws = audio.sockets.at(-1)!;
  ws.readyState = 1;
  ws.h.onOpen();
  return { rec, ws };
}
const speak = (n = 4, v = 0.25) => audio.onChunk!(new Float32Array(n).fill(v));
const words = (ws: FakeWs, texts: string[], start = 0) =>
  ws.h.onMessage({ message_type: "committed_transcript_with_timestamps", words: texts.map((text, i) => ({ type: "word", text, start: start + i * 0.0001 })) });

beforeEach(() => {
  audio.onChunk = null;
  audio.sockets = [];
  audio.micStops = 0;
  audio.micError = null;
  vi.useFakeTimers({ now: new Date("2026-10-22T13:00:00Z") });
});
afterEach(() => {
  vi.useRealTimers();
});

describe("which case takes the words", () => {
  it("only an open case that is not closed or approved, and during a seminar only its own cases", () => {
    setup({ p: { slot: { day: "2026-10-22", time: "14:00" } } });
    const rec = useRecorderStore();
    expect(rec.target).toBeNull();
    useCasesStore().setOpen(FILE);
    expect(rec.target).toBe(FILE);
    useWorkflowStore().sessions = [{ day: "2026-10-23", started_at: "2026-10-23T08:00:00Z", ended_at: null, started_by: null }];
    expect(rec.target).toBeNull();
    useWorkflowStore().sessions = [{ day: "2026-10-22", started_at: "2026-10-22T08:00:00Z", ended_at: null, started_by: null }];
    expect(rec.target).toBe(FILE);
    usePatientsStore().rows[0]!.status = "closed";
    expect(rec.target).toBeNull();
  });

  it("not a case with an approved conclusion", () => {
    setup({ wf: { protocol: { state: "approved", version: 3 } } as never });
    useCasesStore().setOpen(FILE);
    expect(useRecorderStore().target).toBeNull();
  });
});

describe("recording in server mode", () => {
  it("starts a recording on the server, streams the case's audio and silence for no case, and files words by time", async () => {
    const { calls } = setup();
    const { rec, ws } = await startOn();
    expect(JSON.parse(String(callsTo(calls, "/recordings", "POST")[0]!.init.body))).toEqual({ session_day: null, case_id: ID });
    expect(ws.url).toBe("wss://stt.test/realtime?token=t");
    expect(rec.status).toBe("on");
    speak();
    expect(ws.sent.at(-1)).toMatchObject({ message_type: "input_audio_chunk", commit: false, sample_rate: 16000 });
    ws.h.onMessage({ message_type: "partial_transcript", text: "ložisko" });
    expect(rec.partial).toBe("ložisko");
    words(ws, ["Ložisko", "v", "mozečku."]);
    expect(rec.partial).toBe("");
    expect(rec.tx(FILE).lines.map((l) => l.text.join(" "))).toEqual(["Ložisko v mozečku."]);
    // Leaving the patient: the audio becomes silence and no words are filed.
    useCasesStore().setOpen(null);
    speak();
    const silent = ws.sent.at(-1)!.audio_base_64 as string;
    expect(atob(silent).split("").every((c) => c === "\0")).toBe(true);
    words(ws, ["nikam"], 4 / 16000);
    expect(rec.tx(FILE).lines).toHaveLength(1);
    expect(rec.on).toBe(true);
  });

  it("sends finished lines every 2 s in one request, and at once when 20 wait", async () => {
    const { calls } = setup();
    const { ws } = await startOn();
    speak();
    words(ws, ["první"]);
    expect(callsTo(calls, `/cases/${ID}/transcript/lines`)).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(2000);
    const sent = callsTo(calls, `/cases/${ID}/transcript/lines`);
    expect(sent).toHaveLength(1);
    const body = JSON.parse(String(sent[0]!.init.body)) as { recording_id: string; lines: { text: string; wall_ms: number; client_line_id: string }[] };
    expect(body.recording_id).toBe("r1");
    expect(body.lines.map((l) => l.text)).toEqual(["první"]);
    expect(body.lines[0]!.client_line_id).toBeTruthy();
    // A message making 20 lines (words of other cases between them split lines) sends without waiting for the timer.
    for (let i = 0; i < 20; i++) words(ws, [`věta ${i}`]);
    await flushPromises();
    expect(callsTo(calls, `/cases/${ID}/transcript/lines`)).toHaveLength(2);
  });

  it("drops lines on a final refusal and retries others with backoff", async () => {
    let answer: unknown = refusal(409, "case_approved");
    const { calls } = setup({ routes: { [`/cases/${ID}/transcript/lines`]: () => answer } });
    const { rec, ws } = await startOn();
    speak();
    words(ws, ["a"]);
    await vi.advanceTimersByTimeAsync(2000);
    expect(callsTo(calls, `/cases/${ID}/transcript/lines`)).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(4000);
    // Dropped: nothing left to send.
    expect(callsTo(calls, `/cases/${ID}/transcript/lines`)).toHaveLength(1);
    expect(await rec.flush(FILE)).toBe(true);

    answer = refusal(503, "unavailable");
    words(ws, ["b"]);
    await vi.advanceTimersByTimeAsync(2000);
    expect(callsTo(calls, `/cases/${ID}/transcript/lines`)).toHaveLength(2);
    // Waiting out the 1 s backoff counts as not stored.
    expect(await rec.flush(FILE)).toBe(false);
    answer = reply({ accepted: [], duplicate: [], rejected: [] });
    await vi.advanceTimersByTimeAsync(2000);
    expect(callsTo(calls, `/cases/${ID}/transcript/lines`)).toHaveLength(3);
  });

  it("cuts the case's audio into parts of the server's size and sends the tail as the final part", async () => {
    const { calls } = setup({ partBytes: 16 });
    const { rec } = await startOn();
    speak(5);
    expect(callsTo(calls, `/cases/${ID}/transcript/audio/parts/1`)).toHaveLength(0);
    speak(5);
    await flushPromises();
    const p1 = callsTo(calls, `/cases/${ID}/transcript/audio/parts/1`);
    expect(p1).toHaveLength(1);
    expect(p1[0]!.url).toContain("recording_id=r1");
    expect(p1[0]!.url).toContain("final=0");
    expect((p1[0]!.init.body as Uint8Array).byteLength).toBe(16);
    expect(JSON.parse(new Headers(p1[0]!.init.headers).get("X-Audio-Segments")!)).toEqual([{ start_sample: 0, wall_ms: Date.now() }]);
    expect(await rec.flush(FILE)).toBe(true);
    const p2 = callsTo(calls, `/cases/${ID}/transcript/audio/parts/2`);
    expect(p2).toHaveLength(1);
    expect(p2[0]!.url).toContain("final=1");
    expect((p2[0]!.init.body as Uint8Array).byteLength).toBe(4);
  });

  it("retries a failed part and gives the part up on a final refusal", async () => {
    let n = 0;
    const { calls } = setup({
      partBytes: 8,
      routes: {
        [`/cases/${ID}/transcript/audio/parts/1`]: () => (++n === 1 ? refusal(500, "error") : reply({})),
        [`/cases/${ID}/transcript/audio/parts/2`]: () => refusal(413, "audio_too_long", "Záznam případu je příliš dlouhý."),
      },
    });
    const { rec } = await startOn();
    speak(4);
    await flushPromises();
    expect(callsTo(calls, `/cases/${ID}/transcript/audio/parts/1`)).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1000);
    expect(callsTo(calls, `/cases/${ID}/transcript/audio/parts/1`)).toHaveLength(2);
    speak(4);
    await vi.advanceTimersByTimeAsync(0);
    expect(callsTo(calls, `/cases/${ID}/transcript/audio/parts/2`)).toHaveLength(1);
    expect(rec.msg).toEqual({ text: "Záznam případu je příliš dlouhý." });
    speak(4);
    await vi.advanceTimersByTimeAsync(5000);
    expect(callsTo(calls, `/cases/${ID}/transcript/audio/parts/2`)).toHaveLength(1);
    expect(calls.filter((c) => c.url.includes("/audio/parts/3"))).toHaveLength(0);
  });

  it("stops: asks for the last sentence, then stores what is queued and ends the recording", async () => {
    const { calls } = setup();
    const { rec, ws } = await startOn();
    speak();
    rec.stop();
    expect(rec.on).toBe(false);
    expect(rec.status).toBe("off");
    expect(audio.micStops).toBe(1);
    expect(ws.sent.at(-1)).toMatchObject({ commit: true });
    // The last sentence arrives while the socket waits.
    words(ws, ["poslední"]);
    await vi.advanceTimersByTimeAsync(3000);
    expect(ws.closed).toBe(true);
    await vi.advanceTimersByTimeAsync(500);
    await flushPromises();
    expect(JSON.parse(String(callsTo(calls, `/cases/${ID}/transcript/lines`)[0]!.init.body)).lines[0].text).toBe("poslední");
    expect(callsTo(calls, `/cases/${ID}/transcript/audio/parts/1`)).toHaveLength(1);
    expect(JSON.parse(String(callsTo(calls, "/recordings/r1", "PATCH")[0]!.init.body))).toEqual({ end_reason: "stopped", case_id: ID });
  });

  it("reconnects after the service closes, and stops after three quick failures", async () => {
    setup();
    const { rec, ws } = await startOn();
    ws.h.onClose();
    expect(rec.status).toBe("connecting");
    await vi.advanceTimersByTimeAsync(2000);
    expect(audio.sockets).toHaveLength(2);
    audio.sockets[1]!.h.onClose();
    await vi.advanceTimersByTimeAsync(4000);
    audio.sockets[2]!.h.onClose();
    expect(rec.on).toBe(false);
    expect(rec.msg).toEqual(msgId("discussion-rec-socket-failed"));
  });

  it("a start stopped and started again while the microphone was asked for opens one microphone only", async () => {
    setup();
    useCasesStore().setOpen(FILE);
    const rec = useRecorderStore();
    const first = rec.start();
    rec.stop();
    const second = rec.start();
    await first;
    await second;
    // The first start's microphone was let go; one socket for the running start.
    expect(audio.micStops).toBe(1);
    expect(rec.on).toBe(true);
    expect(audio.sockets).toHaveLength(1);
  });

  it("says why the start failed", async () => {
    setup({ routes: { "/stt/token": refusal(503, "stt_unavailable") } });
    useCasesStore().setOpen(FILE);
    const rec = useRecorderStore();
    await rec.start();
    expect(rec.on).toBe(false);
    expect(rec.msg).toEqual(msgId("discussion-rec-start-failed", { status: 503, reasonId: "discussion-rec-token-failed" }));
    audio.micError = new Error("Permission denied");
    await rec.start();
    expect(rec.msg).toEqual(msgId("discussion-rec-start-failed", { reason: "Permission denied" }));
  });
});

describe("without server mode", () => {
  it("shows live words but stores nothing and sends no audio", async () => {
    const { calls } = setup({ transcripts: false, partBytes: 8 });
    const { rec, ws } = await startOn();
    speak(16);
    words(ws, ["jen", "živě"]);
    await vi.advanceTimersByTimeAsync(10000);
    expect(rec.tx(FILE).lines.map((l) => l.text.join(" "))).toEqual(["jen živě"]);
    expect(calls.filter((c) => !c.url.includes("/stt/token"))).toEqual([]);
  });
});

describe("approval, closing and a user switch", () => {
  it("afterApprove polls the speaker pass until done, then reloads the stored transcript", async () => {
    const jobs = [{ state: "running", phase: "speakers" }, { state: "running", phase: "summary" }, { state: "done", phase: "summary" }];
    const { calls } = setup({ routes: { "/jobs/j1": () => jobs.shift() ?? { state: "done" } } });
    useCasesStore().setOpen(FILE);
    const rec = useRecorderStore();
    rec.afterApprove(FILE, "j1");
    expect(rec.tx(FILE).passes).toMatchObject([{ state: "running", jobId: "j1" }]);
    await vi.advanceTimersByTimeAsync(2000);
    expect(rec.tx(FILE).passes[0]!.phase).toBe("speakers");
    await vi.advanceTimersByTimeAsync(2000);
    expect(rec.tx(FILE).summary).toEqual({ state: "running" });
    await vi.advanceTimersByTimeAsync(2000);
    await flushPromises();
    expect(callsTo(calls, "/jobs/j1")).toHaveLength(3);
    expect(callsTo(calls, `/cases/${ID}/transcript`)).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(10000);
    expect(callsTo(calls, "/jobs/j1")).toHaveLength(3);
  });

  it("stops polling on an error state or a missing job", async () => {
    const { calls } = setup({ routes: { "/jobs/j1": { state: "error" }, "/jobs/j2": refusal(404, "not_found") } });
    const rec = useRecorderStore();
    rec.afterApprove(FILE, "j1");
    rec.afterApprove(FILE, "j2");
    await vi.advanceTimersByTimeAsync(2000);
    await flushPromises();
    await vi.advanceTimersByTimeAsync(10000);
    expect(callsTo(calls, "/jobs/j1")).toHaveLength(1);
    expect(callsTo(calls, "/jobs/j2")).toHaveLength(1);
  });

  it("afterApprove claims the uploaded audio and stops when every case of the seminar is done", async () => {
    const { calls } = setup({ partBytes: 16, p: { slot: { day: "2026-10-22", time: "14:00" } } });
    useWorkflowStore().sessions = [{ day: "2026-10-22", started_at: "2026-10-22T08:00:00Z", ended_at: null, started_by: null }];
    const { rec } = await startOn();
    speak(4);
    // The approval arrives in the workflow state before afterApprove runs.
    useSessionStore().applyState({ cases: { [ID]: { case_id: ID, file: FILE, protocol: { state: "approved", version: 2 } } } } as never);
    await flushPromises();
    rec.afterApprove(FILE, null);
    expect(rec.on).toBe(false);
    expect(rec.msg).toEqual(msgId("discussion-rec-all-approved"));
    expect(await rec.flush(FILE)).toBe(true);
    await vi.advanceTimersByTimeAsync(3500);
    await flushPromises();
    expect(calls.filter((c) => c.url.includes("/audio/parts/"))).toHaveLength(0);
    expect(JSON.parse(String(callsTo(calls, "/recordings/r1", "PATCH")[0]!.init.body)).end_reason).toBe("all_approved");
  });

  it("purge drops a closed case's audio and reloads it when it is open", async () => {
    const { calls } = setup({ partBytes: 16 });
    const { rec } = await startOn();
    speak(4);
    await rec.load(FILE);
    expect(callsTo(calls, `/cases/${ID}/transcript`)).toHaveLength(1);
    rec.purge([FILE], "closed");
    await flushPromises();
    expect(callsTo(calls, `/cases/${ID}/transcript`)).toHaveLength(2);
    expect(await rec.flush(FILE)).toBe(true);
    expect(calls.filter((c) => c.url.includes("/audio/parts/"))).toHaveLength(0);
  });

  it("retry runs a failed pass again, and a pass that can no longer run reloads instead", async () => {
    const { calls } = setup({
      routes: {
        [`/cases/${ID}/transcript`]: { passes: [{ id: "p1", job_id: "j1", state: "error", job_state: "error", error_code: "eleven_5xx", audio_kept: true }] },
        "/jobs/j1/retry": reply({}),
        "/jobs/j1": { state: "running" },
      },
    });
    const rec = useRecorderStore();
    await rec.load(FILE);
    await rec.retry(FILE, 0);
    expect(callsTo(calls, "/jobs/j1/retry", "POST")).toHaveLength(1);
    expect(rec.tx(FILE).passes[0]).toMatchObject({ state: "running", err: null });
  });

  it("a sentence arriving after a user switch is neither shown nor sent", async () => {
    const { calls } = setup({ routes: { "/me": { user: { id: "u2", name: "MUDr. Novák", role: "doctor", dept: null } } } });
    const { rec, ws } = await startOn();
    speak();
    await useSessionStore().switchUser("u2");
    words(ws, ["pozdě"]);
    expect(rec.tx(FILE).lines).toEqual([]);
    await vi.advanceTimersByTimeAsync(5000);
    expect(callsTo(calls, `/cases/${ID}/transcript/lines`)).toHaveLength(0);
  });

  it("a failed transcript read is not repeated in a loop", async () => {
    const s = setup({ routes: { [`/cases/${ID}/transcript`]: refusal(403, "not_member") } });
    mountInCase(RecorderPanel, s, { file: FILE });
    await flushPromises();
    await vi.advanceTimersByTimeAsync(5000);
    expect(callsTo(s.calls, `/cases/${ID}/transcript`)).toHaveLength(1);
  });

  it("stops the recorder and forgets the transcripts before a user switch", async () => {
    setup();
    const { rec } = await startOn();
    rec.tx(FILE);
    await rec.load(FILE);
    expect(rec.tx(FILE).loaded).toBe(true);
    await useSessionStore().switchUser("other");
    expect(rec.on).toBe(false);
    expect(rec.msg).toEqual(msgId("discussion-rec-stopped-user-switch"));
    expect(rec.tx(FILE).loaded).toBe(false);
  });
});

describe("the panel and the header pill", () => {
  it("off: the start button and 'off'; connecting and recording: the stop button", async () => {
    const s = setup();
    useCasesStore().setOpen(FILE);
    const w = mountInCase(RecorderPanel, s, { file: FILE });
    await flushPromises();
    expect(w.get("#recctl button").text()).toBe("● Spustit záznam");
    expect(w.get("#recctl .recbar .small").text()).toBe("Záznam je vypnutý.");
    const started = useRecorderStore().start();
    await flushPromises();
    expect(w.get("#recctl button").text()).toBe("■ Zastavit záznam");
    expect(w.get("#recctl .recbar .small").text()).toBe("Připojuji…");
    await started;
    const ws = audio.sockets.at(-1)!;
    ws.readyState = 1;
    ws.h.onOpen();
    speak();
    ws.h.onMessage({ message_type: "partial_transcript", text: "ložisko" });
    await flushPromises();
    expect(w.get("#recctl .recbar .small").text()).toBe("Nahrávám.");
    expect(w.find("#recctl .recdot").exists()).toBe(true);
    expect(w.get("#rectx").attributes("aria-live")).toBe("polite");
    expect(w.get("#rectx .partial").text()).toBe("ložisko…");
    await w.get("#recctl button").trigger("click");
    expect(useRecorderStore().on).toBe(false);
  });

  it("without a speech service: a disabled button and the manual-conclusion text", async () => {
    const s = setup({ stt: false, transcripts: false });
    const w = mountInCase(RecorderPanel, s, { file: FILE });
    await flushPromises();
    expect(w.get("#recctl button").attributes("disabled")).toBeDefined();
    expect(w.get("#recctl .small").text()).toBe("AI záznam v této kopii aplikace není dostupný (chybí server pro přepis). Závěr lze zapsat ručně.");
  });

  it("states on other cases while recording", async () => {
    const s = setup({ wf: { protocol: { state: "approved", version: 1 } } as never });
    const w = mountInCase(RecorderPanel, s, { file: FILE });
    await startOn(null);
    await flushPromises();
    expect(w.get("#recctl .recbar .small").text()).toBe("Záznam běží, závěr pacienta je schválen.");
  });

  it("the summary leads and the transcript folds into a closed panel", async () => {
    const s = setup({
      routes: {
        [`/cases/${ID}/transcript`]: {
          lines: [{ client_line_id: "a", wall_ms: Date.parse("2026-10-22T12:05:00"), speaker: 0, text: "Doporučujeme ozáření." }],
          passes: [{ id: "p1", job_id: "j1", state: "error", job_state: "error", error_code: "eleven_429", audio_kept: false }],
          summaries: [{ state: "done", text: "Ozáření mozečku.", basis: "live_only" }],
        },
      },
    });
    const w = mountInCase(RecorderPanel, s, { file: FILE });
    await flushPromises();
    expect(w.get(".recsum .chip").text()).toBe("Shrnutí AI · návrh");
    expect(w.get(".recsum").text()).toBe("Shrnutí AI · návrh Ozáření mozečku. (ze živého přepisu bez rozlišení mluvčích)");
    expect(w.get("#recpasses p").text()).toBe("Rozlišení mluvčích selhalo (služba přepisu je přetížená). Zvuk byl smazán, zůstává živý přepis.");
    const det = w.get("details.srcs");
    expect(det.attributes("open")).toBeUndefined();
    expect(det.get("summary").text()).toBe("Přepis diskuse");
    expect(det.get("#rectx .ln .tm").text()).toBe("12:05");
    expect(det.get("#rectx .ln .spk").text()).toBe("Mluvčí 1:");
    expect(det.get("#rectx .ln .spk").classes()).toContain("sp0");
  });

  it("passes: running, start failure with retry, kept audio with retry", async () => {
    const s = setup({
      routes: {
        [`/cases/${ID}/transcript`]: {
          passes: [
            { id: "p1", job_id: "j1", state: "running", job_state: "running", job_phase: "speakers" },
            { id: "p2", job_id: "j2", state: "error", error_code: "start_failed" },
            { id: "p3", job_id: "j3", state: "error", error_code: "odd_code", audio_kept: true },
          ],
        },
        "/jobs/j1": { state: "running" },
      },
    });
    const w = mountInCase(RecorderPanel, s, { file: FILE });
    await flushPromises();
    expect(w.findAll("#recpasses p").map((p) => p.text())).toEqual([
      "Rozlišuji mluvčí…",
      "Zpracování se nespustilo. Zkusit znovu",
      "Rozlišení mluvčích selhalo (odd_code). Zkusit znovu",
    ]);
  });

  it("the pill names the case taking the words, or says nothing is stored", async () => {
    const s = setup();
    const pill = mountInCase(RecorderPill, s);
    expect(pill.find("button").exists()).toBe(false);
    await startOn();
    await flushPromises();
    const b = pill.get("button.recpill");
    expect(b.text()).toBe("Záznam · NO-010 · Zastavit");
    expect(b.attributes("title")).toBe("Zastavit záznam");
    expect(b.find(".recdot").exists()).toBe(true);
    useCasesStore().setOpen(null);
    await flushPromises();
    expect(pill.get("button").text()).toBe("Záznam běží, přepis se nikam neukládá · Zastavit");
    await pill.get("button").trigger("click");
    expect(useRecorderStore().on).toBe(false);
  });
});

describe("browser audio messages", () => {
  it("sends base64 PCM chunks and a final commit of 100 ms silence", async () => {
    const real = await vi.importActual<typeof import("../app/lib/recorder-audio")>("../app/lib/recorder-audio");
    const sent: string[] = [];
    const ws = { readyState: 1, send: (d: string) => void sent.push(d), close: () => {} };
    real.sendChunk(ws, Int16Array.of(1, -1));
    real.sendCommit(ws);
    const [a, b] = sent.map((x) => JSON.parse(x) as Record<string, unknown>);
    expect(a).toEqual({ message_type: "input_audio_chunk", audio_base_64: btoa("\x01\x00\xff\xff"), commit: false, sample_rate: 16000 });
    expect(b!.commit).toBe(true);
    expect(atob(String(b!.audio_base_64))).toHaveLength(3200);
  });
});
