// POST /api/stt/diarize: the case's WAV (raw body, audio/wav) goes on to ElevenLabs Scribe with speaker separation.
// The body is streamed through, never stored and never logged; the answer carries only the words the page renders.
import { fail, ok, sameOrigin, num, logCall, sttConfigured, misconfigured } from "../../_lib/http.js";

const ERR = "Služba přepisu odpověděla chybou.";

export async function onRequestPost(context) {
  const { request, env } = context, started = Date.now();
  if (!sameOrigin(request)) return fail(403, "bad_origin", "Požadavek nepřišel z této aplikace.");
  if (!env.ELEVENLABS_API_KEY) return fail(503, "not_configured", "Tato služba na tomto serveru není zapnutá.");
  if (!sttConfigured(env)) return misconfigured();
  let max;
  try { max = num(env.STT_MAX_AUDIO_BYTES, "STT_MAX_AUDIO_BYTES"); } catch { return misconfigured(); }
  const type = (request.headers.get("content-type") || "").toLowerCase();
  if (!type.startsWith("audio/wav") && !type.startsWith("audio/x-wav")) return fail(415, "unsupported_media_type", "Nepodporovaný formát dat.");
  // Chunked uploads are refused because the outgoing multipart body needs a known length.
  const lenHeader = request.headers.get("content-length");
  if (!lenHeader || !/^\d+$/.test(lenHeader)) return fail(411, "length_required", "Chybí velikost nahrávaného záznamu.");
  const length = Number(lenHeader);
  if (length > max) return fail(413, "too_large", "Záznam případu je příliš dlouhý (nad 50 minut).");
  if (length < 44 || !request.body) return fail(400, "bad_audio", "Záznam není ve formátu WAV.");

  // Read just enough to check the RIFF/WAVE header; those bytes are written on first below.
  const reader = request.body.getReader();
  let first = new Uint8Array(0);
  // A client that drops the upload here gets our JSON error, not the platform's HTML 500.
  try {
    while (first.length < 12) {
      const { done, value } = await reader.read();
      if (done) break;
      const joined = new Uint8Array(first.length + value.length); joined.set(first); joined.set(value, first.length); first = joined;
    }
  } catch { return fail(400, "bad_audio", "Záznam není ve formátu WAV."); }
  const tag = (o, n) => String.fromCharCode(...first.subarray(o, o + n));
  if (first.length < 12 || tag(0, 4) !== "RIFF" || tag(8, 4) !== "WAVE") {
    reader.cancel().catch(() => {});
    return fail(400, "bad_audio", "Záznam není ve formátu WAV.");
  }

  const enc = new TextEncoder(), b = `----codebridge${crypto.randomUUID()}`;
  const field = (name, value) => `--${b}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`;
  const head = enc.encode(
    field("model_id", env.STT_BATCH_MODEL) + field("language_code", env.STT_LANGUAGE) +
    field("diarize", "true") + field("timestamps_granularity", "word") +
    `--${b}\r\nContent-Disposition: form-data; name="file"; filename="mdt.wav"\r\nContent-Type: audio/wav\r\n\r\n`);
  const tail = enc.encode(`\r\n--${b}--\r\n`);
  // FixedLengthStream gives the outgoing request a Content-Length without holding up to 100 MB of audio in memory.
  // If the client sends fewer bytes than it declared, the stream errors and the upstream call fails (502).
  const { readable, writable } = new FixedLengthStream(head.length + length + tail.length);
  const pump = (async () => {
    const w = writable.getWriter();
    try {
      await w.write(head); await w.write(first);
      for (;;) { const { done, value } = await reader.read(); if (done) break; await w.write(value); }
      await w.write(tail); await w.close();
    } catch (e) {
      // When the upstream answers early (an error), stop reading the browser's upload as well.
      reader.cancel(e).catch(() => {}); await w.abort(e).catch(() => {});
    }
  })();
  context.waitUntil(pump);

  // No server-side retry: the body is a one-shot stream. The page keeps the audio and offers "Zkusit znovu".
  let r;
  try {
    r = await fetch(`${env.ELEVENLABS_API_BASE}/v1/speech-to-text`, {
      method: "POST", body: readable, signal: AbortSignal.timeout(300000),
      headers: { "xi-api-key": env.ELEVENLABS_API_KEY, "content-type": `multipart/form-data; boundary=${b}` },
    });
  } catch (e) {
    const timeout = e?.name === "TimeoutError";
    logCall("stt/diarize", timeout ? 504 : 502, null, 1, started);
    return timeout ? fail(504, "upstream_timeout", "Služba neodpověděla včas.") : fail(502, "upstream_error", ERR);
  }
  if (r.status === 429 || r.status === 503) {
    logCall("stt/diarize", 503, r.status, 1, started);
    return fail(503, "upstream_busy", "Služba je přetížená, zkuste to znovu za chvíli.");
  }
  const d = r.ok ? await r.json().catch(() => null) : null;
  if (!r.ok) await r.body?.cancel().catch(() => {});
  if (!d) {
    logCall("stt/diarize", 502, r.status, 1, started);
    return fail(502, "upstream_error", ERR);
  }
  logCall("stt/diarize", 200, r.status, 1, started);
  // Only what the page renders: spacing and audio events, logprob and the full text are dropped.
  return ok({
    words: (d.words || []).filter(w => w.type === "word")
      .map(w => ({ text: w.text, start: w.start ?? 0, end: w.end ?? null, speaker_id: w.speaker_id ?? null })),
    language_code: d.language_code ?? null, model: env.STT_BATCH_MODEL,
  });
}
