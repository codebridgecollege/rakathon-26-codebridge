// POST /api/stt/token: mints an ElevenLabs single-use realtime token, so the API key stays on the server.
// The token is single use and expires in 15 minutes, so handing it to the browser is its intended use. It is never logged.
import { fail, ok, sameOrigin, logCall, sttConfigured, misconfigured } from "../../_lib/http.js";

const sleep = ms => new Promise(r => setTimeout(r, ms));

export async function onRequestPost({ request, env }) {
  const started = Date.now();
  if (!sameOrigin(request)) return fail(403, "bad_origin", "Požadavek nepřišel z této aplikace.");
  if (!env.ELEVENLABS_API_KEY) return fail(503, "not_configured", "Tato služba na tomto serveru není zapnutá.");
  if (!sttConfigured(env)) return misconfigured();
  let r, attempts = 0;
  try {
    // One retry on 429/503: many teams share the service, and a short wait usually clears it.
    for (;;) {
      attempts++;
      r = await fetch(`${env.ELEVENLABS_API_BASE}/v1/single-use-token/realtime_scribe`, {
        method: "POST", headers: { "xi-api-key": env.ELEVENLABS_API_KEY }, signal: AbortSignal.timeout(10000),
      });
      if (attempts >= 2 || (r.status !== 429 && r.status !== 503)) break;
      // An unread body keeps the connection busy; drop it before asking again.
      await r.body?.cancel().catch(() => {});
      await sleep(1000 + Math.random() * 500);
    }
  } catch (e) {
    const timeout = e?.name === "TimeoutError";
    logCall("stt/token", timeout ? 504 : 502, null, attempts, started);
    return timeout ? fail(504, "upstream_timeout", "Služba neodpověděla včas.") : fail(502, "upstream_error", "Služba přepisu odpověděla chybou.");
  }
  if (r.status === 429 || r.status === 503) {
    logCall("stt/token", 503, r.status, attempts, started);
    return fail(503, "upstream_busy", "Služba je přetížená, zkuste to znovu za chvíli.");
  }
  const token = r.ok ? (await r.json().catch(() => ({}))).token : null;
  if (!token) {
    if (!r.ok) await r.body?.cancel().catch(() => {});
    logCall("stt/token", 502, r.status, attempts, started);
    return fail(502, "upstream_error", "Služba přepisu odpověděla chybou.");
  }
  // The socket URL is built here, so the realtime model and its options are configuration, not page code.
  // audio_format must match REC_RATE (16000) in v3-template.html; the browser resamples to it.
  const q = new URLSearchParams({
    model_id: env.STT_REALTIME_MODEL, language_code: env.STT_LANGUAGE, commit_strategy: "vad",
    vad_silence_threshold_secs: "0.8", include_timestamps: "true", audio_format: "pcm_16000", token,
  });
  logCall("stt/token", 200, r.status, attempts, started);
  return ok({ ws_url: `${env.ELEVENLABS_API_BASE.replace(/^https/, "wss")}/v1/speech-to-text/realtime?${q}`, expires_in_s: 900 });
}
