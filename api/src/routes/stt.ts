import { Hono } from "hono";
import type { AppEnv } from "../types";
import { E, numVar } from "../http/errors";
import { rateLimit } from "../http/rate-limit";
import { diarizeStream, mintRealtimeToken } from "../services/elevenlabs";

const WAV_HEADER_BYTES = 44;

export const stt = new Hono<AppEnv>()
  .post("/token", rateLimit("RL_STT_TOKEN"), async (c) => {
    if (!c.env.ELEVENLABS_API_KEY) throw E.notConfigured();
    return c.json(await mintRealtimeToken(c.env));
  })
  .post("/diarize", rateLimit("RL_STT_BATCH"), async (c) => {
    if (!c.env.ELEVENLABS_API_KEY) throw E.notConfigured();
    const type = (c.req.header("content-type") ?? "").toLowerCase();
    if (!type.startsWith("audio/wav") && !type.startsWith("audio/x-wav")) throw E.unsupportedMediaType();
    // Chunked uploads are refused: the outgoing multipart needs its exact length up front.
    const lengthHeader = c.req.header("content-length");
    if (!lengthHeader || !/^\d+$/.test(lengthHeader)) throw E.lengthRequired();
    const length = Number(lengthHeader);
    // Checked before reading any byte, so an oversized upload costs nothing.
    if (length > numVar(c.env.STT_MAX_AUDIO_BYTES)) throw E.audioTooLarge();
    if (length < WAV_HEADER_BYTES) throw E.badAudio();
    const raw = c.req.raw.body;
    if (!raw) throw E.badAudio();

    // Peek at the first 12 bytes (RIFF....WAVE) without buffering the rest of the audio.
    const reader = raw.getReader();
    const chunks: Uint8Array[] = [];
    let have = 0;
    while (have < 12) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      have += value.length;
    }
    const prefix = concat(chunks, have);
    const ascii = (from: number, to: number) => String.fromCharCode(...prefix.subarray(from, to));
    if (have < 12 || ascii(0, 4) !== "RIFF" || ascii(8, 12) !== "WAVE") {
      await reader.cancel().catch(() => {});
      throw E.badAudio();
    }
    // Hands the already read bytes on first, then the rest of the upload as it arrives.
    const body = new ReadableStream<Uint8Array>({
      start(ctrl) {
        ctrl.enqueue(prefix);
      },
      async pull(ctrl) {
        const { done, value } = await reader.read();
        if (done) ctrl.close();
        else ctrl.enqueue(value);
      },
      cancel(reason) {
        return reader.cancel(reason);
      },
    });
    return c.json(await diarizeStream(c.env, body, length, c.executionCtx));
  });

function concat(chunks: Uint8Array[], total: number): Uint8Array {
  const out = new Uint8Array(total);
  let at = 0;
  for (const ch of chunks) {
    out.set(ch, at);
    at += ch.length;
  }
  return out;
}
