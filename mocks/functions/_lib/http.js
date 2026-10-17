// Shared by the Pages Functions. Errors use the app's format { error: { code, message_cs } }, so the page can show
// a Czech message without ever seeing an upstream status, an upstream body or a key.
// This module exports no onRequest handler, so Pages creates no route for it.

export const fail = (status, code, message_cs, headers = {}) =>
  Response.json({ error: { code, message_cs } }, { status, headers: { "cache-control": "no-store", ...headers } });

// no-store on every answer: a token or a transcript must never sit in a browser or proxy cache.
export const ok = data => Response.json(data, { headers: { "cache-control": "no-store" } });

// A same-origin check stops other websites from spending our quota through a visitor's browser.
// It does not stop a script that forges Origin; the key's credit cap does that on Pages.
export function sameOrigin(request) {
  if (request.headers.get("sec-fetch-site") === "cross-site") return false;
  return request.headers.get("origin") === new URL(request.url).origin;
}

// Limits come from configuration (pages-wrangler.toml); a missing or broken value is a setup error, not a default.
export const num = (v, name) => {
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) throw new Error(`bad var ${name}`);
  return n;
};

// The speech routes need these vars from pages-wrangler.toml; without them a call would go to "undefined/v1/..."
// and look like an upstream failure, so a missing one is reported as our own setup error instead.
export const STT_VARS = ["ELEVENLABS_API_BASE", "STT_REALTIME_MODEL", "STT_BATCH_MODEL", "STT_LANGUAGE", "STT_MAX_AUDIO_BYTES"];
export const sttConfigured = env => STT_VARS.every(k => !!env[k]);
export const misconfigured = () => fail(500, "misconfigured", "Server není správně nastaven.");

// Only the route, our status, the upstream status, the attempt count and the duration are logged: never audio,
// a transcript or a token (CLAUDE.md, "Do not log full documents or prompts by default").
export const logCall = (route, status, upstream, attempts, started) =>
  console.log(JSON.stringify({ route, status, upstream, attempts, ms: Date.now() - started }));
