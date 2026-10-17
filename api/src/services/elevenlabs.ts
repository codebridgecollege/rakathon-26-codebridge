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

// Sends one case's WAV to batch speech-to-text with speaker separation. The body is streamed on, never buffered:
// a Worker has 128 MB of memory and the audio may be 100 MB. `length` is the exact byte count of `body`.
// Takes a plain stream so a later step can pass an R2 object body. No retry: the body is a one-shot stream.
export async function diarizeStream(
  env: Env,
  body: ReadableStream<Uint8Array>,
  length: number,
  // Only waitUntil is needed; a narrow type accepts both the runtime context and Hono's.
  ctx: Pick<ExecutionContext, "waitUntil">,
): Promise<DiarizeResult> {
  const enc = new TextEncoder();
  const b = `----codebridge${crypto.randomUUID()}`;
  const field = (name: string, value: string) =>
    `--${b}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`;
  const head = enc.encode(
    field("model_id", env.STT_BATCH_MODEL) +
      field("language_code", env.STT_LANGUAGE) +
      field("diarize", "true") +
      field("timestamps_granularity", "word") +
      `--${b}\r\nContent-Disposition: form-data; name="file"; filename="mdt.wav"\r\nContent-Type: audio/wav\r\n\r\n`,
  );
  const tail = enc.encode(`\r\n--${b}--\r\n`);
  // FixedLengthStream gives the outgoing request a Content-Length without holding the audio in memory.
  // If the client sends fewer or more bytes than declared, the stream errors and the upstream call fails.
  const { readable, writable } = new FixedLengthStream(head.length + length + tail.length);
  const w = writable.getWriter();
  const pump = (async () => {
    const reader = body.getReader();
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
  ctx.waitUntil(pump);

  const base = env.ELEVENLABS_API_BASE.replace(/\/+$/, "");
  const started = Date.now();
  let res: Response;
  try {
    res = await fetch(`${base}/v1/speech-to-text`, {
      method: "POST",
      body: readable,
      signal: AbortSignal.timeout(300000),
      headers: { "xi-api-key": env.ELEVENLABS_API_KEY, "content-type": `multipart/form-data; boundary=${b}` },
    });
  } catch (e) {
    // Unblocks the pump, which would otherwise wait on a stream nobody reads, and stops reading the upload.
    await w.abort(e).catch(() => {});
    console.log(JSON.stringify({ route: "stt/diarize", upstream: "fetch_failed", ms: Date.now() - started }));
    throw isTimeout(e) ? E.upstreamTimeout() : E.upstreamError("přepisu");
  }
  console.log(JSON.stringify({ route: "stt/diarize", upstream: res.status, ms: Date.now() - started }));
  if (res.status === 429 || res.status === 503) throw E.upstreamBusy();
  if (!res.ok) throw E.upstreamError("přepisu");
  type Word = { text?: string; type?: string; start?: number; end?: number; speaker_id?: string };
  let d: { words?: Word[]; language_code?: string };
  try {
    d = await res.json();
  } catch {
    throw E.upstreamError("přepisu");
  }
  // Keeps only what the page renders: drops spacing and audio_event items, logprob, and the full text.
  return {
    words: (d.words ?? [])
      .filter((w) => w.type === "word")
      .map((w) => ({ text: w.text ?? "", start: w.start ?? 0, end: w.end ?? null, speaker_id: w.speaker_id ?? null })),
    language_code: d.language_code ?? null,
    model: env.STT_BATCH_MODEL,
  };
}
