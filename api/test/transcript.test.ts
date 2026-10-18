// Step 5 (a): the AI recording on the server. Route tests (recordings, live lines, audio parts, purge, cron) and the
// SpeakerPassWorkflow with ElevenLabs and Azure mocked at fetch. Transcripts are synthetic Czech with typos and Latin.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { env } from "cloudflare:workers";
import { introspectWorkflow } from "cloudflare:test";
import { call, mockFetch, testEnv } from "./helpers";
import { FAKE_NAME, SQL, loadFixture } from "./data";
import { sweep } from "../src/scheduled";
import { providerDelay } from "../src/workflows/speaker-pass";
import { wordsToLines, safeCode, partsToComplete, transcriptText } from "../src/domain/transcript";
import { sha256Hex } from "../src/store/work";
import { PROMPT, PROMPT_VERSION } from "../src/prompts/summarize-cs";

type Body = { data?: any; state?: any; error?: { code: string; message_cs: string } };
const PART = 5_242_880;
const DAY = "2026-10-22";

async function w(method: string, path: string, body: unknown = {}, user = "d2p1", headers: Record<string, string> = {}, e: Env = testEnv()) {
  const r = await call(`/api${path}`, { method, headers: { "content-type": "application/json", "x-demo-user": user, "x-data-epoch": "1", ...headers }, body: JSON.stringify(body) }, e);
  return { status: r.status, body: (await r.json()) as Body };
}
async function get(path: string, user = "d2p1", e: Env = testEnv()) {
  const r = await call(`/api${path}`, { headers: { "x-demo-user": user } }, e);
  return { status: r.status, body: (await r.json()) as any };
}
async function part(caseId: string, n: number, bytes: Uint8Array, q: { rec: string; final?: boolean }, segs: unknown[] = [], user = "d2p1", e: Env = testEnv()) {
  const r = await call(
    `/api/cases/${caseId}/transcript/audio/parts/${n}?recording_id=${q.rec}&final=${q.final ? 1 : 0}`,
    {
      method: "PUT",
      headers: { "content-type": "application/octet-stream", "content-length": String(bytes.length), "x-demo-user": user, "x-data-epoch": "1", "x-audio-segments": JSON.stringify(segs) },
      body: bytes,
    },
    e,
  );
  return { status: r.status, body: (await r.json()) as Body };
}
const q = async <T = Record<string, any>>(sql: string, ...args: unknown[]) => (await env.DB.prepare(sql).bind(...args).all<T>()).results;
const one = async <T = Record<string, any>>(sql: string, ...args: unknown[]) => (await q<T>(sql, ...args))[0]!;
const log = () => q<{ action: string; what_cs: string; case_id: string | null; actor_user_id: string }>("SELECT * FROM access_log ORDER BY id");

// Speech-like PCM (a quiet tone), so a test can tell the stored bytes apart.
const pcm = (seconds: number, seed = 1) => {
  const n = Math.round(seconds * 16000);
  const out = new Uint8Array(n * 2);
  const v = new DataView(out.buffer);
  for (let i = 0; i < n; i++) v.setInt16(i * 2, Math.round(Math.sin((i * seed) / 9) * 800), true);
  return out;
};
const LINES = ["pacientka po resekci, pT2 N0 M0, bez známek recidivy", "doporučuji kontrolní CT hrudníku za tři měsíce", "souhlasím, adjuvance neindikována"];

let recStartedAt = 0;
async function startRecording(day: string | null = DAY, user = "d2p1") {
  const r = await w("POST", "/recordings", { session_day: day, case_id: "NO-A" }, user);
  expect(r.status).toBe(201);
  recStartedAt = Date.parse(r.body.data.started_at);
  return r.body.data.recording_id as string;
}
const lineBody = (rec: string, lines: { id: string; at: number; text: string }[]) => ({
  recording_id: rec,
  lines: lines.map((l) => ({ client_line_id: l.id, wall_ms: l.at, text: l.text })),
});
const lid = (n: number) => `line-0000-${String(n).padStart(4, "0")}`;
async function approve(user = "d2p1", e: Env = testEnv()) {
  await w("PUT", "/cases/NO-A/protocol", { version: 0, concl: "Kontrolní CT za 3 měsíce." }, user, {}, e);
  return w(
    "POST",
    "/cases/NO-A/decisions",
    { protocol_version: 1, conclusion: "Kontrolní CT za 3 měsíce.", picked_sections: ["summary"], report_html: "<p>report</p>", attendance_expected: ["MUDr. Svobodová"] },
    user,
    { "idempotency-key": `appr-${crypto.randomUUID()}` },
    e,
  );
}

// ElevenLabs answers with two speakers whose words start at the given seconds of the joined audio.
const elevenWords = (words: [string, number, string][]) =>
  Response.json({ language_code: "ces", text: "ignored", words: words.flatMap(([t, s, sp]) => [{ text: t, type: "word", start: s, end: s + 0.3, speaker_id: sp }, { text: " ", type: "spacing", start: s + 0.3, end: s + 0.31 }]) });
const azure = (text: string) => Response.json({ choices: [{ message: { content: text } }] });

// Tests that approve only to reach a later state still start a pass; it runs to its end inside the test, so it never
// writes into the next test's database.
async function quietPasses() {
  const wf = await introspectWorkflow(env.SPEAKER_PASS);
  await wf.modifyAll(async (m) => {
    await m.disableRetryDelays();
  });
  return wf;
}
async function settle(wf: Awaited<ReturnType<typeof introspectWorkflow>>) {
  for (const i of await wf.get()) await i.waitForStatus("complete");
}

beforeEach(async () => {
  await loadFixture();
  await env.DB.prepare("INSERT INTO sessions (day, started_by, started_at) VALUES (?1, 'd2p1', ?2)").bind(DAY, new Date(Date.now() - 3600_000).toISOString()).run();
});
afterEach(() => vi.restoreAllMocks());

describe("recordings", () => {
  it("starts for doctors and the coordinator, not for the administrator; needs a running seminar when named", async () => {
    expect((await w("POST", "/recordings", { session_day: DAY })).status).toBe(201);
    expect((await w("POST", "/recordings", { session_day: null }, "coord")).status).toBe(201);
    expect((await w("POST", "/recordings", {}, "admin")).status).toBe(403);
    const r = await w("POST", "/recordings", { session_day: "2026-10-23" });
    expect(r.body.error?.code).toBe("session_not_running");
    expect((await log()).filter((l) => l.action === "recording.on")).toHaveLength(2);
  });

  it("stops once; only the browser that started it may stop it", async () => {
    const rec = await startRecording();
    expect((await w("PATCH", `/recordings/${rec}`, { end_reason: "stopped" }, "d1p1")).body.error?.code).toBe("not_recorder");
    expect((await w("PATCH", `/recordings/${rec}`, { end_reason: "nonsense" })).status).toBe(422);
    expect((await w("PATCH", `/recordings/${rec}`, { end_reason: "stopped" })).status).toBe(200);
    expect((await w("PATCH", `/recordings/${rec}`, { end_reason: "stopped" })).status).toBe(200);
    expect((await log()).filter((l) => l.action === "recording.off")).toHaveLength(1);
  });
});

describe("live lines", () => {
  it("stores lines idempotently and logs once per case and recording, never the text", async () => {
    const rec = await startRecording();
    const t = Date.now();
    const b = lineBody(rec, LINES.map((text, i) => ({ id: lid(i), at: t + i * 1000, text })));
    const r1 = await w("POST", "/cases/NO-A/transcript/lines", b);
    expect(r1.status).toBe(200);
    expect(r1.body.data.accepted).toHaveLength(3);
    const r2 = await w("POST", "/cases/NO-A/transcript/lines", b);
    expect(r2.body.data).toMatchObject({ accepted: [], duplicate: [lid(0), lid(1), lid(2)] });
    await w("POST", "/cases/NO-A/transcript/lines", lineBody(rec, [{ id: lid(9), at: t + 5000, text: "další věta" }]));
    expect((await q("SELECT * FROM transcript_lines")).length).toBe(4);
    const l = await log();
    expect(l.filter((x) => x.action === "transcript.store")).toHaveLength(1);
    const all = JSON.stringify(l);
    for (const text of LINES) expect(all).not.toContain(text);
    // Read back for the case view, with its own access-log row.
    const g = await get("/cases/NO-A/transcript");
    expect(g.body.lines.map((x: any) => x.text)).toEqual([...LINES, "další věta"]);
    expect((await log()).at(-1)!.action).toBe("transcript.view");
  });

  it("refuses without a recording, from another user's recording, for a closed or off-agenda case, and oversize batches", async () => {
    const t = Date.now();
    const line = [{ id: lid(1), at: t, text: "text" }];
    expect((await w("POST", "/cases/NO-A/transcript/lines", lineBody("no-such-recording", line))).body.error?.code).toBe("no_recording");
    const rec = await startRecording();
    expect((await w("POST", "/cases/NO-A/transcript/lines", lineBody(rec, line), "coord")).body.error?.code).toBe("not_recorder");
    // NO-B has no slot on the seminar day.
    expect((await w("POST", "/cases/NO-B/transcript/lines", lineBody(rec, line))).body.error?.code).toBe("not_on_agenda");
    const many = Array.from({ length: 101 }, (_, i) => ({ id: lid(i), at: t, text: "x" }));
    expect((await w("POST", "/cases/NO-A/transcript/lines", lineBody(rec, many))).status).toBe(413);
    await env.DB.prepare("UPDATE cases SET status = 'closed' WHERE id = 'NO-A'").run();
    expect((await w("POST", "/cases/NO-A/transcript/lines", lineBody(rec, line))).body.error?.code).toBe("case_closed");
    // A doctor outside the case's team cannot store lines for it.
    const rec2 = await startRecording(null, "d1p1");
    expect((await w("POST", "/cases/NO-A/transcript/lines", lineBody(rec2, line), "d1p1")).body.error?.code).toBe("not_member");
  });

  it("refuses a recording that ended more than a minute ago and lines from outside the recording", async () => {
    const rec = await startRecording();
    const far = await w("POST", "/cases/NO-A/transcript/lines", lineBody(rec, [{ id: lid(1), at: recStartedAt - 3600_000, text: "stará věta" }]));
    expect(far.body.data.rejected).toEqual([{ client_line_id: lid(1), code: "out_of_recording" }]);
    await env.DB.prepare("UPDATE recordings SET ended_at = ?1 WHERE id = ?2").bind(new Date(Date.now() - 61_000).toISOString(), rec).run();
    expect((await w("POST", "/cases/NO-A/transcript/lines", lineBody(rec, [{ id: lid(2), at: Date.now() - 62_000, text: "x" }]))).body.error?.code).toBe("recording_ended");
  });

  it("after approval takes only lines spoken before it, and none a finished pass covers", async () => {
    await using wf = await quietPasses();
    const rec = await startRecording();
    mockFetch(() => new Response("no", { status: 500 }));
    const before = Date.now() - 2000;
    await w("POST", "/cases/NO-A/transcript/lines", lineBody(rec, [{ id: lid(1), at: before - 1000, text: "první" }]));
    const a = await approve();
    expect(a.status).toBe(200);
    await settle(wf);
    const approvedAt = Date.parse((await one("SELECT approved_at FROM decisions")).approved_at);
    const r = await w("POST", "/cases/NO-A/transcript/lines", lineBody(rec, [
      { id: lid(2), at: before, text: "pozdě doručená věta z diskuse" },
      { id: lid(3), at: approvedAt + 5000, text: "po schválení" },
    ]));
    expect(r.body.data.accepted).toEqual([lid(2)]);
    expect(r.body.data.rejected).toEqual([{ client_line_id: lid(3), code: "case_approved" }]);
    // A finished pass up to the approval: a late line from before it would be a second version of the same sentence.
    // Only where its audio reached: outside the covered interval a late line is still taken.
    await env.DB.prepare("UPDATE transcript_passes SET state = 'done', covered_json = ?1").bind(JSON.stringify([[before - 3000, before + 1000]])).run();
    const r2 = await w("POST", "/cases/NO-A/transcript/lines", lineBody(rec, [
      { id: lid(4), at: before + 500, text: "ještě pozdější" },
      { id: lid(5), at: before + 1500, text: "věta bez zvuku" },
    ]));
    expect(r2.body.data.rejected).toEqual([{ client_line_id: lid(4), code: "covered_by_pass" }]);
    expect(r2.body.data.accepted).toEqual([lid(5)]);
    // One malformed line is refused alone, not the batch.
    const r3 = await w("POST", "/cases/NO-A/transcript/lines", lineBody(rec, [{ id: lid(6), at: before + 1600, text: "" }, { id: lid(7), at: before + 1700, text: "platná" }]));
    expect(r3.body.data).toMatchObject({ accepted: [lid(7)], rejected: [{ client_line_id: lid(6), code: "invalid" }] });
  });
});

describe("audio parts", () => {
  it("checks the part size rule, stores segments, replaces a part with its newest etag", async () => {
    const rec = await startRecording();
    expect((await part("NO-A", 1, pcm(1), { rec })).body.error?.code).toBe("bad_audio_part"); // not final, not 5 MiB
    expect((await part("NO-A", 1, new Uint8Array(3), { rec, final: true })).body.error?.code).toBe("bad_audio_part"); // odd
    const r = await part("NO-A", 1, pcm(1), { rec, final: true }, [{ start_sample: 0, wall_ms: Date.now() }]);
    expect(r.status).toBe(200);
    const first = await one("SELECT * FROM audio_parts");
    const r2 = await part("NO-A", 1, pcm(2, 3), { rec, final: true }, [{ start_sample: 0, wall_ms: Date.now() }, { start_sample: 16000, wall_ms: Date.now() + 60_000 }]);
    expect(r2.status).toBe(200);
    const parts = await q("SELECT * FROM audio_parts");
    expect(parts).toHaveLength(1);
    expect(parts[0]!.bytes).toBe(64000);
    expect(parts[0]!.etag).not.toBe(first.etag);
    expect(await q("SELECT start_sample FROM audio_segments ORDER BY start_sample")).toEqual([{ start_sample: 0 }, { start_sample: 16000 }]);
    const up = await one("SELECT * FROM audio_uploads");
    expect(up.r2_key).toBe(`audio/NO-A/${up.id}.pcm`);
    expect(up.r2_key).not.toContain(DAY);
    expect((await log()).filter((l) => l.action === "recording.audio_stored")).toHaveLength(1);
  });

  it("takes full 5 MiB parts, refuses audio over the cap and after approval", async () => {
    await using wf = await quietPasses();
    const rec = await startRecording();
    expect((await part("NO-A", 1, new Uint8Array(PART), { rec })).status).toBe(200);
    const capped = testEnv({ AUDIO_MAX_MINUTES_PER_CASE: "3" }); // 5.76 MB
    const over = await part("NO-A", 2, new Uint8Array(1_000_000), { rec, final: true }, [], "d2p1", capped);
    expect(over.status).toBe(413);
    expect(over.body.error?.code).toBe("audio_too_long");
    mockFetch(() => new Response("no", { status: 500 }));
    await approve();
    expect((await part("NO-A", 2, pcm(1), { rec, final: true })).body.error?.code).toBe("case_approved");
    await settle(wf);
  });

  it("refuses a non-octet-stream body and a stale data epoch", async () => {
    const rec = await startRecording();
    const r = await call(`/api/cases/NO-A/transcript/audio/parts/1?recording_id=${rec}&final=1`, { method: "PUT", headers: { "content-type": "application/json", "x-data-epoch": "1" }, body: "{}" });
    expect(r.status).toBe(415);
    const s = await call(`/api/cases/NO-A/transcript/audio/parts/1?recording_id=${rec}&final=1`, { method: "PUT", headers: { "content-type": "application/octet-stream", "x-data-epoch": "9", "content-length": "4" }, body: new Uint8Array(4) });
    expect(s.status).toBe(409);
  });
});

describe("purge", () => {
  it("deletes a case's audio when it is closed: open uploads aborted, completed objects deleted, audited", async () => {
    const rec = await startRecording();
    await part("NO-A", 1, pcm(1), { rec, final: true });
    const up = await one("SELECT * FROM audio_uploads");
    await env.DB.prepare("INSERT INTO protocols (case_id, conclusion) VALUES ('NO-A', '')").run();
    const r = await w("POST", "/cases/NO-A/status", { to: "closed", expected_status: "ready" });
    expect(r.status).toBe(200);
    expect(await one("SELECT state, delete_reason FROM audio_uploads")).toEqual({ state: "aborted", delete_reason: "případ uzavřen" });
    expect(await env.DOCS.head(up.r2_key)).toBeNull();
    expect((await log()).map((l) => l.what_cs)).toContain("AI záznam: zvuk smazán bez rozlišení mluvčích (případ uzavřen)");
    expect(await q("SELECT * FROM audio_segments")).toEqual([]);
  });

  it("deletes unapproved audio and ends the recordings at the end of the seminar", async () => {
    const rec = await startRecording();
    await part("NO-A", 1, pcm(1), { rec, final: true });
    const r = await w("DELETE", `/sessions/${DAY}`, {});
    expect(r.status).toBe(200);
    expect((await one("SELECT state FROM audio_uploads")).state).toBe("aborted");
    expect((await one("SELECT end_reason FROM recordings")).end_reason).toBe("session_end");
    // A part arriving after the end would start new audio nobody processes.
    expect((await part("NO-A", 1, pcm(1), { rec, final: true })).body.error?.code).toBe("recording_ended");
    expect((await log()).map((l) => l.what_cs)).toContain("AI záznam: zvuk smazán bez rozlišení mluvčích (konec MDT)");
  });

  it("the cron sweep deletes audio older than six hours and leaves fresh audio", async () => {
    const rec = await startRecording(null);
    await part("NO-A", 1, pcm(1), { rec, final: true });
    expect((await sweep(env)).purged).toBe(0);
    expect((await sweep(env, Date.now() + 7 * 3600_000)).purged).toBe(1);
    expect((await one("SELECT state, delete_reason FROM audio_uploads")).delete_reason).toBe("kontrola uchování");
  });

  it("reset-demo deletes the audio objects and the transcript tables", async () => {
    const rec = await startRecording();
    await part("NO-A", 1, pcm(1), { rec, final: true });
    await w("POST", "/cases/NO-A/transcript/lines", lineBody(rec, [{ id: lid(1), at: Date.now(), text: "věta" }]));
    const MUTABLE = /^\s*INSERT INTO (users|departments|dept_members|cases|case_members|slots|tasks) /;
    await env.DOCS.put("seed/reset.json", JSON.stringify({ seed_version: "t", statements: SQL.filter((x) => MUTABLE.test(x)), patient_ids: ["pt-A", "pt-B"] }));
    const r = await w("POST", "/admin/reset-demo", { confirm: "OBNOVIT" }, "admin");
    expect(r.status).toBe(200);
    expect((await env.DOCS.list({ prefix: "audio/" })).objects).toEqual([]);
    for (const t of ["recordings", "transcript_lines", "audio_uploads", "audio_parts", "audio_segments"]) expect(await q(`SELECT * FROM ${t}`)).toEqual([]);
  });
});

describe("pure rules", () => {
  it("numbers speakers by first appearance and times words from visit marks across two visits", () => {
    const t0 = 1_792_240_000_000;
    const { lines, speakers } = wordsToLines(
      [
        { text: "Dobrý", start: 0.2, speaker_id: "speaker_3" },
        { text: "den", start: 0.5, speaker_id: "speaker_3" },
        { text: "CT", start: 1.5, speaker_id: "speaker_0" },
        { text: "hrudníku", start: 1.8, speaker_id: "speaker_0" },
        { text: "souhlas", start: 12.0, speaker_id: "speaker_3" },
        { text: "doplním", start: 14.0, speaker_id: "speaker_3" },
        { text: "onkomarkery", start: 21.0, speaker_id: "speaker_3" },
      ],
      [{ at_s: 0, wall_ms: t0 }, { at_s: 10, wall_ms: t0 + 600_000 }, { at_s: 20, wall_ms: t0 + 900_000 }],
    );
    expect(speakers).toBe(2);
    expect(lines).toEqual([
      { speaker: 0, wall_ms: t0 + 200, text: "Dobrý den" },
      { speaker: 1, wall_ms: t0 + 1500, text: "CT hrudníku" },
      { speaker: 0, wall_ms: t0 + 600_000 + 2000, text: "souhlas doplním" },
      // The same speaker in the next visit starts a new line with that visit's time.
      { speaker: 0, wall_ms: t0 + 900_000 + 1000, text: "onkomarkery" },
    ]);
  });

  it("maps errors to fixed codes without provider text, and parts to a contiguous prefix", () => {
    expect(safeCode(new Error("eleven:429:30"))).toBe("eleven_429");
    expect(safeCode(new Error("eleven:401"))).toBe("eleven_4xx");
    expect(safeCode(new Error("azure:503:0"))).toBe("azure_5xx");
    expect(safeCode(new Error("pacientka Testová řekla"))).toBe("internal");
    expect(partsToComplete([{ part_number: 1, bytes: PART }, { part_number: 3, bytes: 10 }], PART)).toHaveLength(1);
    expect(partsToComplete([{ part_number: 2, bytes: 10 }, { part_number: 1, bytes: PART }], PART)).toHaveLength(2);
    expect(providerDelay({ ctx: { attempt: 1 }, error: new Error("eleven:429:30") })).toBe("30 seconds");
    expect(providerDelay({ ctx: { attempt: 3 }, error: new Error("eleven:503:0") })).toBe("40 seconds");
    expect(providerDelay({ ctx: { attempt: 9 }, error: new Error("x") })).toBe("300 seconds");
  });
});

// ---------- the Workflow ----------

type Mock = { eleven: (() => Response)[]; azure: (() => Response)[] };
// The Workflow runs in its own Durable Object, so request bodies are read inside the handler, not later in the test.
const forms: string[] = [];
function providers(m: Mock) {
  let e = 0, a = 0;
  forms.length = 0;
  return mockFetch(async (req) => {
    const u = new URL(req.url);
    if (u.hostname === "elevenlabs.test") {
      forms.push(await req.text());
      return m.eleven[Math.min(e++, m.eleven.length - 1)]!();
    }
    if (u.hostname === "azure.test") return m.azure[Math.min(a++, m.azure.length - 1)]!();
    return new Response("unexpected", { status: 599 });
  });
}

async function recordCase(seconds = 2) {
  const rec = await startRecording();
  const t = Date.now() - 20_000;
  await w("POST", "/cases/NO-A/transcript/lines", lineBody(rec, LINES.map((text, i) => ({ id: lid(i), at: t + i * 1000, text }))));
  await part("NO-A", 1, pcm(seconds), { rec, final: true }, [{ start_sample: 0, wall_ms: t }]);
  return { rec, t };
}

async function runPass(m: Mock, e: Env = testEnv()) {
  const wf = await introspectWorkflow(env.SPEAKER_PASS);
  await wf.modifyAll(async (x) => {
    await x.disableRetryDelays();
  });
  const f = providers(m);
  const a = await approve("d2p1", e);
  expect(a.status).toBe(200);
  const jobId = a.body.data.speaker_pass_job_id as string;
  const [inst] = await wf.get();
  return { wf, inst: inst!, jobId, calls: f.calls };
}

describe("SpeakerPassWorkflow", () => {
  it("replaces the live lines with speaker lines, deletes the audio, stores the summary as an AI draft", async () => {
    const { t } = await recordCase();
    const { wf, inst, jobId, calls } = await runPass({
      eleven: [() => elevenWords([["pacientka", 0.1, "s1"], ["po", 0.4, "s1"], ["resekci", 0.7, "s1"], ["CT", 1.2, "s2"], ["za", 1.4, "s2"], ["tři", 1.6, "s2"], ["měsíce", 1.8, "s2"]])],
      azure: [() => azure("Kontrolní CT hrudníku za 3 měsíce.")],
    });
    await using _ = wf;
    await inst.waitForStatus("complete");
    const lines = await get("/cases/NO-A/transcript");
    expect(lines.body.lines.map((l: any) => [l.speaker, l.text])).toEqual([[0, "pacientka po resekci"], [1, "CT za tři měsíce"]]);
    expect(lines.body.lines[0].wall_ms).toBe(t + 100);
    expect((await q("SELECT COUNT(*) AS n FROM transcript_lines WHERE state = 'superseded'"))[0]!.n).toBe(3);
    const pass = lines.body.passes[0];
    expect(pass).toMatchObject({ state: "done", line_count: 2, speaker_count: 2, job_state: "done", audio_kept: false });
    expect(lines.body.summaries).toMatchObject([{ state: "done", basis: "speaker_pass", label: "ai_draft", text: "Kontrolní CT hrudníku za 3 měsíce." }]);
    expect((await env.DOCS.list({ prefix: "audio/" })).objects).toEqual([]);
    // The decision and protocol hold the doctor's conclusion only.
    expect((await one("SELECT conclusion FROM decisions")).conclusion).toBe("Kontrolní CT za 3 měsíce.");
    expect((await one("SELECT conclusion FROM protocols")).conclusion).toBe("Kontrolní CT za 3 měsíce.");
    // The request to ElevenLabs: raw PCM with its format, the configured model and language.
    const el = calls.find((c) => c.url.includes("elevenlabs.test"))!;
    const form = forms[0]!;
    expect(form).toContain("mdt.pcm");
    expect(form).toContain('name="file_format"\r\n\r\npcm_s16le_16');
    expect(form).toContain('name="diarize"\r\n\r\ntrue');
    expect(el.headers.get("xi-api-key")).toBe("test-el");
    // Step results hold ids and counts only.
    for (const name of ["mark running", "finalize audio", "diarize", "activate pass lines", "delete audio", "summarize", "finish"]) {
      const r = JSON.stringify(await inst.waitForStepResult({ name }));
      for (const text of [...LINES, "resekci", "Kontrolní", FAKE_NAME]) expect(r).not.toContain(text);
    }
    const job = await get(`/jobs/${jobId}`);
    expect(job.body).toMatchObject({ state: "done", kind: "speaker_pass", error_code: null });
    const what = (await log()).map((l) => l.what_cs);
    expect(what).toEqual(expect.arrayContaining(["AI záznam: rozlišení mluvčích po schválení závěru", "AI záznam: zvuk po rozlišení mluvčích smazán", "AI záznam: shrnutí diskuse"]));
    expect(JSON.stringify(await log())).not.toContain("resekci");
  });

  it("retries ElevenLabs 429 and Azure 429, then completes", async () => {
    await recordCase();
    const busy = () => new Response("busy", { status: 429, headers: { "retry-after": "1" } });
    const { wf, inst, calls } = await runPass({ eleven: [busy, busy, () => elevenWords([["ano", 0.1, "a"]])], azure: [busy, () => azure("Shrnutí.")] });
    await using _ = wf;
    await inst.waitForStatus("complete");
    expect(calls.filter((c) => c.url.includes("elevenlabs.test"))).toHaveLength(3);
    expect(calls.filter((c) => c.url.includes("azure.test"))).toHaveLength(2);
    expect((await one("SELECT state FROM transcript_passes")).state).toBe("done");
    expect((await one("SELECT state FROM transcript_summaries")).state).toBe("done");
  });

  it("a failed pass: a 401 is not retried, the audio stays for Zkusit znovu, the summary uses the live lines", async () => {
    await recordCase();
    const { wf, inst, jobId, calls } = await runPass({ eleven: [() => new Response('{"detail":"Testová Pacientka invalid"}', { status: 401 })], azure: [() => azure("Ze živého přepisu.")] });
    await using _ = wf;
    await inst.waitForStatus("complete");
    expect(calls.filter((c) => c.url.includes("elevenlabs.test"))).toHaveLength(1);
    const tr = await get("/cases/NO-A/transcript");
    expect(tr.body.passes[0]).toMatchObject({ state: "error", error_code: "eleven_4xx", audio_kept: true });
    expect(tr.body.passes[0]).not.toHaveProperty("audio_on_failure");
    expect(tr.body.lines.map((l: any) => l.text)).toEqual(LINES);
    expect(tr.body.summaries[0]).toMatchObject({ state: "done", basis: "live_only" });
    expect((await env.DOCS.list({ prefix: "audio/" })).objects).toHaveLength(1);
    const job = await get(`/jobs/${jobId}`);
    expect(job.body).toMatchObject({ state: "error", error_code: "eleven_4xx" });
    expect(JSON.stringify(job.body)).not.toContain("invalid");

    // Zkusit znovu: a new instance on the kept audio.
    vi.restoreAllMocks();
    providers({ eleven: [() => elevenWords([["CT", 0.1, "x"], ["hrudníku", 0.3, "x"]])], azure: [() => azure("Po opakování.")] });
    // A double click starts one run.
    const [ra, rb] = await Promise.all([w("POST", `/jobs/${jobId}/retry`, {}), w("POST", `/jobs/${jobId}/retry`, {})]);
    const r = ra.status === 200 ? ra : rb;
    expect([ra.status, rb.status].sort()).toEqual([200, 409]);
    expect(r.body.data).toMatchObject({ attempt: 2 });
    expect(await wf.get()).toHaveLength(2);
    const i2 = (await wf.get())[1];
    await i2!.waitForStatus("complete");
    const tr2 = await get("/cases/NO-A/transcript");
    expect(tr2.body.passes[0]).toMatchObject({ state: "done", audio_kept: false });
    expect(tr2.body.lines.map((l: any) => l.text)).toEqual(["CT hrudníku"]);
    expect(tr2.body.summaries.map((s: any) => s.basis)).toEqual(["live_only", "speaker_pass"]);
    // A second retry finds nothing to retry.
    expect((await w("POST", `/jobs/${jobId}/retry`, {})).body.error?.code).toBe("not_retryable");
  });

  it("a retry after the kept audio vanished from R2 runs nothing: the audio is marked gone, the live summary stays", async () => {
    await recordCase();
    const { wf, inst, jobId, calls } = await runPass({ eleven: [() => new Response("x", { status: 400 })], azure: [() => azure("Ze živého přepisu.")] });
    await using _ = wf;
    await inst.waitForStatus("complete");
    expect((await get("/cases/NO-A/transcript")).body.passes[0]).toMatchObject({ state: "error", audio_kept: true });
    // The lifecycle rule removed the object before the cron sweep recorded it.
    for (const o of (await env.DOCS.list({ prefix: "audio/" })).objects) await env.DOCS.delete(o.key);
    const before = calls.length;
    expect((await w("POST", `/jobs/${jobId}/retry`, {})).body.error?.code).toBe("not_retryable");
    expect(await wf.get()).toHaveLength(1);
    expect(calls.length).toBe(before);
    const tr = await get("/cases/NO-A/transcript");
    expect(tr.body.passes[0]).toMatchObject({ state: "error", audio_kept: false });
    expect(tr.body.lines.map((l: any) => l.text)).toEqual(LINES);
    expect(tr.body.summaries[0]).toMatchObject({ state: "done", basis: "live_only" });
    expect((await log()).map((l) => l.what_cs)).toContain("AI záznam: zvuk smazán (už není k dispozici)");
  });

  it("audio missing when the pass runs: the pass deletes the bookkeeping, so no retry is offered", async () => {
    await recordCase();
    const wf = await introspectWorkflow(env.SPEAKER_PASS);
    await using _ = wf;
    providers({ eleven: [() => elevenWords([["x", 0.1, "a"]])], azure: [() => azure("Ze živého přepisu.")] });
    // The part object disappears between the recording and the pass (finalize completes it, diarize finds it gone).
    const head = vi.spyOn(env.DOCS, "head").mockResolvedValue(null);
    await approve();
    const [inst] = await wf.get();
    await inst!.waitForStatus("complete");
    head.mockRestore();
    const tr = await get("/cases/NO-A/transcript");
    expect(tr.body.passes[0]).toMatchObject({ state: "error", error_code: "audio_missing", audio_kept: false });
    expect(tr.body.summaries[0]).toMatchObject({ state: "done", basis: "live_only" });
  });

  it("a case closed before the pass ran: the pass is purged, ElevenLabs is not called, the live lines stay", async () => {
    await recordCase();
    const wf = await introspectWorkflow(env.SPEAKER_PASS);
    await using _ = wf;
    // The job exists but the instance starts only after the close (as if the engine queued it).
    const f = providers({ eleven: [() => elevenWords([["x", 0.1, "a"]])], azure: [() => azure("Shrnutí.")] });
    const create = vi.spyOn(env.SPEAKER_PASS, "create").mockRejectedValueOnce(new Error("engine down"));
    const a = await approve();
    create.mockRestore();
    const jobId = a.body.data.speaker_pass_job_id;
    expect((await get(`/jobs/${jobId}`)).body).toMatchObject({ state: "error", error_code: "start_failed" });
    // The pass says so too, so the page offers "Zkusit znovu" instead of a pass that seems to run.
    expect((await get("/cases/NO-A/transcript")).body.passes[0]).toMatchObject({ state: "error", error_code: "start_failed" });
    await w("POST", "/cases/NO-A/status", { to: "closed", expected_status: "done" });
    expect(await one("SELECT state, purge_reason, audio_deleted_at IS NOT NULL AS gone FROM transcript_passes")).toEqual({ state: "error", purge_reason: "případ uzavřen", gone: 1 });
    await w("POST", `/jobs/${jobId}/retry`, {});
    const [inst] = await wf.get();
    await inst!.waitForStatus("complete");
    expect(f.calls.filter((c) => c.url.includes("elevenlabs.test"))).toHaveLength(0);
    expect((await one("SELECT state FROM transcript_passes")).state).toBe("purged");
    expect((await get("/cases/NO-A/transcript")).body.lines.map((l: any) => l.text)).toEqual(LINES);
    // A closed case's discussion is not sent to the model.
    expect(f.calls.filter((c) => c.url.includes("azure.test"))).toHaveLength(0);
    expect((await one("SELECT state FROM transcript_summaries")).state).toBe("skipped");
  });

  it("replaces only the live lines its audio covers: a tail that never arrived keeps its live text", async () => {
    const rec = await startRecording();
    const t = Date.now() - 60_000;
    // Two seconds of audio for the first visit; the end of the discussion (the conclusion) never reached the server.
    await part("NO-A", 1, pcm(2), { rec, final: true }, [{ start_sample: 0, wall_ms: t }]);
    await w("POST", "/cases/NO-A/transcript/lines", lineBody(rec, [
      { id: lid(1), at: t + 200, text: "pacientka po resekci" },
      { id: lid(2), at: t + 30_000, text: "závěr: kontrolní CT hrudníku" },
      { id: lid(3), at: t + 40_000, text: "adjuvance neindikována" },
    ]));
    const { wf, inst } = await runPass({ eleven: [() => elevenWords([["pacientka", 0.2, "a"], ["po", 0.5, "a"], ["resekci", 0.8, "a"]])], azure: [() => azure("S.")] });
    await using _ = wf;
    await inst.waitForStatus("complete");
    const tr = await get("/cases/NO-A/transcript");
    expect(tr.body.lines.map((l: any) => [l.source, l.text])).toEqual([
      ["speaker_pass", "pacientka po resekci"],
      ["live", "závěr: kontrolní CT hrudníku"],
      ["live", "adjuvance neindikována"],
    ]);
    // A late line in the uncovered part is still taken.
    const late = await w("POST", "/cases/NO-A/transcript/lines", lineBody(rec, [{ id: lid(4), at: t + 1000, text: "x" }, { id: lid(5), at: t + 45_000, text: "pozdě" }]));
    expect(late.body.data.rejected).toEqual([{ client_line_id: lid(4), code: "covered_by_pass" }]);
    expect(late.body.data.accepted).toEqual([lid(5)]);
  });

  it("kept audio of a failed pass outlives the seminar end and the six-hour limit, and goes after seven days or with the case", async () => {
    await recordCase();
    const { wf, inst } = await runPass({ eleven: [() => new Response("x", { status: 400 })], azure: [() => azure("S.")] });
    await using _ = wf;
    await inst.waitForStatus("complete");
    expect((await one("SELECT state FROM audio_uploads")).state).toBe("completed");
    expect((await sweep(env)).purged).toBe(0);
    await env.DB.prepare("UPDATE sessions SET ended_at = ?1").bind(new Date().toISOString()).run();
    expect((await sweep(env)).purged).toBe(0);
    expect((await sweep(env, Date.now() + 6 * 24 * 3600_000)).purged).toBe(0);
    expect((await sweep(env, Date.now() + 7 * 24 * 3600_000 + 60_000)).purged).toBe(1);
    // Closed case: an upload a race left open after the close.
    await env.DB.batch([
      env.DB.prepare("UPDATE cases SET status = 'closed' WHERE id = 'NO-B'"),
      env.DB.prepare("INSERT INTO recordings (id, started_by, started_by_name, started_at) VALUES ('rec-x', 'd2p1', 'x', ?1)").bind(new Date().toISOString()),
      env.DB.prepare("INSERT INTO audio_uploads (id, case_id, recording_id, r2_key, state, created_by, created_at) VALUES ('up-x', 'NO-B', 'rec-x', 'audio/NO-B/up-x.pcm', 'completed', 'd2p1', ?1)").bind(new Date().toISOString()),
    ]);
    await env.DOCS.put("audio/NO-B/up-x.pcm", pcm(1));
    expect((await sweep(env)).purged).toBe(1);
    expect(await env.DOCS.head("audio/NO-B/up-x.pcm")).toBeNull();
  });

  it("no audio and no lines: approval creates no pass", async () => {
    mockFetch(() => new Response("no", { status: 500 }));
    const a = await approve();
    expect(a.body.data.speaker_pass_job_id).toBeNull();
    expect(await q("SELECT * FROM jobs")).toEqual([]);
  });

  it("serves a known transcript from the R2 cache without calling the model", async () => {
    await recordCase();
    const text = transcriptText(LINES.map((t) => ({ speaker: null, text: t })));
    const sha = await sha256Hex(`gpt-6-luna-dz-eu\n${PROMPT_VERSION}\n${await sha256Hex(PROMPT)}\n${text}`);
    await env.DOCS.put(`cache/summary/NO-A/${sha}.json`, JSON.stringify({ summary: "Z mezipaměti." }));
    // Silence from ElevenLabs: no words, so the live lines stay (never replaced by nothing) and are summarized.
    const { wf, inst, calls } = await runPass({ eleven: [() => elevenWords([])], azure: [() => azure("nemá se volat")] });
    await using _ = wf;
    await inst.waitForStatus("complete");
    expect((await one("SELECT state FROM transcript_passes")).state).toBe("empty");
    expect(calls.filter((c) => c.url.includes("azure.test"))).toHaveLength(0);
    expect(await one("SELECT text, cache_hit, basis FROM transcript_summaries")).toEqual({ text: "Z mezipaměti.", cache_hit: 1, basis: "live_only" });
  });

  it("refuses an overlong transcript without a model call, never cut", async () => {
    const rec = await startRecording();
    const t = Date.now() - 20_000;
    const long = Array.from({ length: 9 }, (_, i) => ({ id: lid(i), at: t + i, text: "pacient s karcinomem ".repeat(240).slice(0, 5000) }));
    await w("POST", "/cases/NO-A/transcript/lines", lineBody(rec, long));
    const { wf, inst, calls } = await runPass({ eleven: [() => elevenWords([])], azure: [() => azure("x")] });
    await using _ = wf;
    await inst.waitForStatus("complete");
    expect(calls.filter((c) => c.url.includes("azure.test"))).toHaveLength(0);
    expect(await one("SELECT state, error_code FROM transcript_summaries")).toEqual({ state: "error", error_code: "transcript_too_long" });
  });

  it("GET /jobs checks membership and reconciles a dead instance without its message", async () => {
    await recordCase();
    const { wf, inst, jobId } = await runPass({ eleven: [() => elevenWords([["ano", 0.1, "a"]])], azure: [() => azure("S.")] });
    await using _ = wf;
    await inst.waitForStatus("complete");
    expect((await get(`/jobs/${jobId}`, "d1p1")).status).toBe(403);
    // A row stuck in running whose instance is gone.
    await env.DB.prepare("UPDATE jobs SET state = 'running', instance_id = 'gone', updated_at = '2026-01-01T00:00:00.000Z' WHERE id = ?1").bind(jobId).run();
    expect((await get(`/jobs/${jobId}`)).body).toMatchObject({ state: "error", error_code: "start_failed" });
  });
});
