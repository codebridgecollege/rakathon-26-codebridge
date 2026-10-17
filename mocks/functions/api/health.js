// GET /api/health: tells the page which server features this copy has. The booleans only say whether a secret is
// set; no key material and no user data leave here.
import { ok, sttConfigured } from "../_lib/http.js";

export function onRequestGet({ env }) {
  return ok({
    ok: true, service: "codebridge-mdt", runtime: "pages", version: env.GIT_SHA || "unknown",
    features: { stt: !!env.ELEVENLABS_API_KEY && sttConfigured(env), summarize: !!env.AZURE_OPENAI_KEY, data: false },
    limits: { stt_audio_bytes: Number(env.STT_MAX_AUDIO_BYTES) || 0, summary_chars: Number(env.SUMMARY_MAX_CHARS) || 40000 },
  });
}
