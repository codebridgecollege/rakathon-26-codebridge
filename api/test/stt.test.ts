import { afterEach, describe, expect, it, vi } from "vitest";
import { call, deny, mockFetch, silentWav, testEnv } from "./helpers";

afterEach(() => vi.restoreAllMocks());

const json = (data: unknown, status = 200) => () => Response.json(data, { status });

describe("POST /api/stt/token", () => {
  it("returns a realtime socket URL built from configuration", async () => {
    const { calls } = mockFetch(json({ token: "single-use-tok" }));
    const res = await call("/api/stt/token", { method: "POST" });
    expect(res.status).toBe(200);
    const body = await res.json<{ ws_url: string; expires_in_s: number }>();
    expect(body.expires_in_s).toBe(900);
    expect(body.ws_url.startsWith("wss://api.elevenlabs.io/v1/speech-to-text/realtime?")).toBe(true);
    const q = new URL(body.ws_url).searchParams;
    expect(q.get("model_id")).toBe("scribe_v2_realtime");
    expect(q.get("language_code")).toBe("cs");
    expect(q.get("audio_format")).toBe("pcm_16000");
    expect(q.get("token")).toBe("single-use-tok");
    expect(calls[0]!.url).toBe("https://api.elevenlabs.io/v1/single-use-token/realtime_scribe");
    expect(calls[0]!.headers.get("xi-api-key")).toBe("test-el");
  });

  it("maps an upstream 401 to 502 without its status", async () => {
    mockFetch(json({ detail: "invalid key" }, 401));
    const res = await call("/api/stt/token", { method: "POST" });
    expect(res.status).toBe(502);
    const text = await res.text();
    expect(text).not.toContain("401");
    expect(text).not.toContain("invalid key");
  });

  it("retries once on 429, then answers upstream_busy", async () => {
    const { calls } = mockFetch(() => new Response("busy", { status: 429, headers: { "retry-after": "0" } }));
    const res = await call("/api/stt/token", { method: "POST" });
    expect(res.status).toBe(503);
    expect(calls).toHaveLength(2);
  });

  it("answers not_configured without the key", async () => {
    const res = await call("/api/stt/token", { method: "POST" }, testEnv({ ELEVENLABS_API_KEY: "" }));
    expect(res.status).toBe(503);
  });

  it("returns 429 when the limiter refuses", async () => {
    const res = await call("/api/stt/token", { method: "POST" }, testEnv({ RL_STT_TOKEN: deny }));
    expect(res.status).toBe(429);
    expect(res.headers.get("retry-after")).toBe("60");
  });
});

describe("POST /api/stt/diarize", () => {
  const wav = silentWav();
  const upload = (body: BodyInit, headers: Record<string, string> = {}) => ({
    method: "POST",
    body,
    headers: { "content-type": "audio/wav", "content-length": String(wav.length), ...headers },
  });
  const words = {
    language_code: "ces",
    text: "Dobrý den.",
    words: [
      { text: "Dobrý", type: "word", start: 0.1, end: 0.4, speaker_id: "speaker_0", logprob: -0.1 },
      { text: " ", type: "spacing", start: 0.4, end: 0.45, speaker_id: "speaker_0" },
      { text: "(kašel)", type: "audio_event", start: 0.45, end: 0.5, speaker_id: "speaker_1" },
      { text: "den.", type: "word", start: 0.5, speaker_id: "speaker_1" },
    ],
  };

  it("streams the WAV as multipart and keeps only words", async () => {
    let form: FormData | undefined;
    const { calls } = mockFetch(async (req) => {
      form = await req.formData();
      return Response.json(words);
    });
    const res = await call("/api/stt/diarize", upload(wav));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      words: [
        { text: "Dobrý", start: 0.1, end: 0.4, speaker_id: "speaker_0" },
        { text: "den.", start: 0.5, end: null, speaker_id: "speaker_1" },
      ],
      language_code: "ces",
      model: "scribe_v2",
    });
    expect(calls[0]!.url).toBe("https://api.elevenlabs.io/v1/speech-to-text");
    expect(calls[0]!.headers.get("xi-api-key")).toBe("test-el");
    expect(calls[0]!.headers.get("content-type")).toMatch(/^multipart\/form-data; boundary=/);
    expect(form!.get("model_id")).toBe("scribe_v2");
    expect(form!.get("diarize")).toBe("true");
    expect(form!.get("language_code")).toBe("cs");
    expect(form!.get("timestamps_granularity")).toBe("word");
    const file = form!.get("file") as File;
    expect(new Uint8Array(await file.arrayBuffer())).toEqual(wav);
  });

  it("refuses bytes that are not WAV", async () => {
    const { calls } = mockFetch(json(words));
    const notWav = new Uint8Array(wav.length).fill(65);
    const res = await call("/api/stt/diarize", upload(notWav));
    expect(res.status).toBe(400);
    expect((await res.json<{ error: { code: string } }>()).error.code).toBe("bad_audio");
    expect(calls).toHaveLength(0);
  });

  it("refuses a body shorter than a WAV header", async () => {
    const res = await call("/api/stt/diarize", upload(wav.slice(0, 20), { "content-length": "20" }));
    expect(res.status).toBe(400);
  });

  it("refuses a wrong content type", async () => {
    const res = await call("/api/stt/diarize", upload(wav, { "content-type": "text/plain" }));
    expect(res.status).toBe(415);
  });

  it("refuses an upload without Content-Length", async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(wav);
        c.close();
      },
    });
    const res = await call("/api/stt/diarize", {
      method: "POST",
      body: stream,
      headers: { "content-type": "audio/wav" },
    });
    expect(res.status).toBe(411);
  });

  it("refuses a declared length over STT_MAX_AUDIO_BYTES before reading the body", async () => {
    const { calls } = mockFetch(json(words));
    const res = await call("/api/stt/diarize", upload(wav), testEnv({ STT_MAX_AUDIO_BYTES: "1000" }));
    expect(res.status).toBe(413);
    expect((await res.json<{ error: { message_cs: string } }>()).error.message_cs).toBe(
      "Záznam případu je příliš dlouhý (nad 50 minut).",
    );
    expect(calls).toHaveLength(0);
  });

  it("maps an upstream 429 to upstream_busy without retrying the stream", async () => {
    const { calls } = mockFetch(async (req) => {
      await req.arrayBuffer();
      return new Response("busy", { status: 429 });
    });
    const res = await call("/api/stt/diarize", upload(wav));
    expect(res.status).toBe(503);
    expect(await res.text()).not.toContain("429");
    expect(calls).toHaveLength(1);
  });

  it("returns 429 when the limiter refuses", async () => {
    const res = await call("/api/stt/diarize", upload(wav), testEnv({ RL_STT_BATCH: deny }));
    expect(res.status).toBe(429);
  });

  it("refuses a media type that only starts like WAV", async () => {
    const res = await call("/api/stt/diarize", upload(wav, { "content-type": "audio/wavx" }));
    expect(res.status).toBe(415);
    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  it("reassembles a WAV whose first chunks are shorter than the RIFF header", async () => {
    let file: Uint8Array | undefined;
    mockFetch(async (req) => {
      file = new Uint8Array(await ((await req.formData()).get("file") as File).arrayBuffer());
      return Response.json(words);
    });
    const stream = new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(wav.slice(0, 3));
        c.enqueue(wav.slice(3, 7));
        c.enqueue(wav.slice(7, 13));
        c.enqueue(wav.slice(13));
        c.close();
      },
    });
    const res = await call("/api/stt/diarize", upload(stream));
    expect(res.status).toBe(200);
    expect(file).toEqual(wav);
  });

  it("answers 502 when the client sends fewer bytes than it declared", async () => {
    mockFetch(async (req) => {
      await req.formData();
      return Response.json(words);
    });
    const short = new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(wav.slice(0, 1000));
        c.close();
      },
    });
    const res = await call("/api/stt/diarize", upload(short));
    expect(res.status).toBe(502);
  });

  it("maps an upstream error to 502 without its status or body", async () => {
    mockFetch(async (req) => {
      await req.arrayBuffer();
      return new Response("internal secret-detail", { status: 500 });
    });
    const res = await call("/api/stt/diarize", upload(wav));
    expect(res.status).toBe(502);
    const text = await res.text();
    expect(text).not.toContain("500");
    expect(text).not.toContain("secret-detail");
  });

  it("maps an upstream timeout to 504", async () => {
    mockFetch(() => {
      throw new DOMException("timed out", "TimeoutError");
    });
    const res = await call("/api/stt/diarize", upload(wav));
    expect(res.status).toBe(504);
  });
});
