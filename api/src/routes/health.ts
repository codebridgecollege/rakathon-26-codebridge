import { Hono } from "hono";
import type { AppEnv } from "../types";

// Public: it holds no data and no key material; the booleans only say whether a secret is set, so the page
// knows which features this host offers. features.data stays false until the data routes exist (step 2).
export const health = new Hono<AppEnv>().get("/", (c) =>
  c.json({
    ok: true,
    service: "codebridge-mdt",
    runtime: "worker",
    version: c.env.GIT_SHA || "unknown",
    auth_mode: c.env.AUTH_MODE,
    features: { stt: !!c.env.ELEVENLABS_API_KEY, summarize: !!c.env.AZURE_OPENAI_KEY, data: false },
    limits: {
      stt_audio_bytes: Number(c.env.STT_MAX_AUDIO_BYTES) || 0,
      summary_chars: Number(c.env.SUMMARY_MAX_CHARS) || 40000,
    },
  }),
);
