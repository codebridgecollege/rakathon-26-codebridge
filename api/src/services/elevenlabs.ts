import { E, isTimeout } from "../http/errors";
import { fetchWithRetry } from "./retry";

export type DiarizedWord = { text: string; start: number; end: number | null; speaker_id: string | null };
export type DiarizeResult = { words: DiarizedWord[]; language_code: string | null; model: string };

// Mints a single-use realtime token and builds the socket URL on the server, so the realtime model and options are
// configuration. The token is single use and expires in 15 minutes, so handing it to the browser is its intended
// use. It is never logged.
export async function mintRealtimeToken(env: Env): Promise<{ ws_url: string; expires_in_s: number }> {
  const base = env.ELEVENLABS_API_BASE.replace(/\/+$/, "");
  const started = Date.now();
  let res: Response, attempts: number;
  try {
    ({ res, attempts } = await fetchWithRetry(
      `${base}/v1/single-use-token/realtime_scribe`,
      { method: "POST", headers: { "xi-api-key": env.ELEVENLABS_API_KEY } },
      { attempts: 2, baseMs: 1000, timeoutMs: 10000 },
    ));
  } catch (e) {
    console.log(JSON.stringify({ route: "stt/token", upstream: "fetch_failed", ms: Date.now() - started }));
    throw isTimeout(e) ? E.upstreamTimeout() : E.upstreamError("přepisu");
  }
  console.log(JSON.stringify({ route: "stt/token", upstream: res.status, attempts, ms: Date.now() - started }));
  if (res.status === 429 || res.status === 503) throw E.upstreamBusy();
  if (!res.ok) throw E.upstreamError("přepisu");
  let token: unknown;
  try {
    ({ token } = await res.json<{ token?: unknown }>());
  } catch {
    throw E.upstreamError("přepisu");
  }
  if (typeof token !== "string" || !token) throw E.upstreamError("přepisu");
  // audio_format must match REC_RATE (16000) in v3-template.html; the browser resamples to it.
  const q = new URLSearchParams({
    model_id: env.STT_REALTIME_MODEL,
    language_code: env.STT_LANGUAGE,
    commit_strategy: "vad",
    vad_silence_threshold_secs: "0.8",
    include_timestamps: "true",
    audio_format: "pcm_16000",
    token,
  });
  return { ws_url: `${base.replace(/^https/, "wss")}/v1/speech-to-text/realtime?${q}`, expires_in_s: 900 };
}

export type DiarizeFormat = { kind: "wav" } | { kind: "pcm_s16le_16" };
export type DiarizeOutcome =
  | { ok: true; status: number; result: DiarizeResult }
  | { ok: false; status: number | "network" | "timeout"; retryAfterS: number | null };

// Sends one case's audio to batch speech-to-text with speaker separation. The body is streamed on, never buffered:
// a Worker has 128 MB of memory and the audio may be 100 MB. `length` is the exact byte count of `body`.
// Takes a plain stream so the speaker pass Workflow can pass R2 object bodies. No retry here: the body is a one-shot
// stream; the route answers busy and the Workflow retries the whole step. Never returns the provider's text.
export async function diarizeUpstream(
  env: Env,
  body: ReadableStream<Uint8Array>,
  length: number,
  format: DiarizeFormat,
  logRoute: string,
  timeoutMs = 300000,
): Promise<DiarizeOutcome> {
  const enc = new TextEncoder();
  const b = `----codebridge${crypto.randomUUID()}`;
  const field = (name: string, value: string) =>
    `--${b}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`;
  // Raw PCM needs no header: file_format tells the service the layout (16 kHz, 16-bit, mono, little endian).
  const fileHead =
    format.kind === "wav"
      ? `--${b}\r\nContent-Disposition: form-data; name="file"; filename="mdt.wav"\r\nContent-Type: audio/wav\r\n\r\n`
      : `--${b}\r\nContent-Disposition: form-data; name="file"; filename="mdt.pcm"\r\nContent-Type: application/octet-stream\r\n\r\n`;
  const head = enc.encode(
    field("model_id", env.STT_BATCH_MODEL) +
      field("language_code", env.STT_LANGUAGE) +
      field("diarize", "true") +
      field("timestamps_granularity", "word") +
      (format.kind === "pcm_s16le_16" ? field("file_format", "pcm_s16le_16") : "") +
      // Best-effort determinism for a rerun of the same audio (CLAUDE.md, reproducible outputs).
      (env.STT_BATCH_SEED ? field("seed", env.STT_BATCH_SEED) + field("temperature", "0") : "") +
      fileHead,
  );
  const tail = enc.encode(`\r\n--${b}--\r\n`);
  // FixedLengthStream gives the outgoing request a Content-Length without holding the audio in memory.
  // If the source sends fewer or more bytes than declared, the stream errors and the upstream call fails.
  const { readable, writable } = new FixedLengthStream(head.length + length + tail.length);
  const w = writable.getWriter();
  const reader = body.getReader();
  const pump = (async () => {
    try {
      await w.write(head);
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        await w.write(value);
      }
      await w.write(tail);
      await w.close();
    } catch (e) {
      await w.abort(e).catch(() => {});
      await reader.cancel().catch(() => {});
    }
  })();

  const base = env.ELEVENLABS_API_BASE.replace(/\/+$/, "");
  const started = Date.now();
  let res: Response;
  try {
    res = await fetch(`${base}/v1/speech-to-text`, {
      method: "POST",
      body: readable,
      signal: AbortSignal.timeout(timeoutMs),
      headers: { "xi-api-key": env.ELEVENLABS_API_KEY, "content-type": `multipart/form-data; boundary=${b}` },
    });
  } catch (e) {
    // Unblocks the pump, which would otherwise wait on a stream nobody reads, and stops reading the source.
    await w.abort(e).catch(() => {});
    await reader.cancel().catch(() => {});
    await pump;
    console.log(JSON.stringify({ route: logRoute, upstream: "fetch_failed", ms: Date.now() - started }));
    return { ok: false, status: isTimeout(e) ? "timeout" : "network", retryAfterS: null };
  }
  // The answer is in: a source still being read (an early refusal) is not needed any more. After a full upload the
  // writer is already closed and this does nothing.
  await w.abort(new Error("answered")).catch(() => {});
  await pump;
  console.log(JSON.stringify({ route: logRoute, upstream: res.status, ms: Date.now() - started }));
  if (!res.ok) {
    const ra = Number(res.headers.get("retry-after"));
    await res.body?.cancel().catch(() => {});
    return { ok: false, status: res.status, retryAfterS: Number.isFinite(ra) && ra > 0 ? ra : null };
  }
  type Word = { text?: string; type?: string; start?: number; end?: number; speaker_id?: string };
  let d: { words?: Word[]; language_code?: string };
  try {
    d = await res.json();
  } catch {
    return { ok: false, status: 502, retryAfterS: null };
  }
  // Keeps only what the page renders: drops spacing and audio_event items, logprob, and the full text.
  return {
    ok: true,
    status: res.status,
    result: {
      words: (d.words ?? [])
        .filter((w) => w.type === "word")
        .map((w) => ({ text: w.text ?? "", start: w.start ?? 0, end: w.end ?? null, speaker_id: w.speaker_id ?? null })),
      language_code: d.language_code ?? null,
      model: env.STT_BATCH_MODEL,
    },
  };
}

// The synchronous route of step 0 (embedded mode on the Worker): the outcome as the page's error table.
export async function diarizeStream(env: Env, body: ReadableStream<Uint8Array>, length: number): Promise<DiarizeResult> {
  const r = await diarizeUpstream(env, body, length, { kind: "wav" }, "stt/diarize");
  if (r.ok) return r.result;
  if (r.status === "timeout") throw E.upstreamTimeout();
  if (r.status === 429 || r.status === 503) throw E.upstreamBusy();
  throw E.upstreamError("přepisu");
}
