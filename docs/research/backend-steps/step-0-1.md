# Backend migration, steps 0 and 1: implementation design

Status: design for two GitHub issues, 2026-10-17. Branch `backend`.
Sources: `CLAUDE.md`, `docs/research/2026-10-17-backend-migration.md`
(sections "Foundations every step builds on", "Decisions", "Migration
plan"), `docs/design/DATA-PROTECTION.md`, `docs/design/INTEGRATION.md`,
`mocks/src/v3-template.html`, `mocks/functions/api/summarize.js`,
`mocks/deploy.sh`, `.github/workflows/deploy-mock.yml`.

Terms: a **Worker** is a Cloudflare Workers script; a **Pages Function**
is the same runtime attached to a Cloudflare Pages site (today's demo
host, `codebridge-mdt.pages.dev`); **Wrangler** is Cloudflare's CLI;
**Access** is Cloudflare Access (Zero Trust login in front of an app).

## Versions looked up (npm, 2026-10-17)

Pinned to releases about two weeks old, not the newest, so a broken
release has had time to be noticed.

| Package | Pin | Latest seen | Note |
|---|---|---|---|
| `wrangler` | `4.147.0` (2026-10-02) | 4.151.1 | Also the exact Wrangler the test plugin bundles, so one copy is installed |
| `hono` | `4.13.13` (2026-10-04) | 4.13.13 | |
| `jose` | `6.2.12` (2026-09-05) | 6.2.12 | Foundations say "jose 5"; v6 is WebCrypto-only and ESM, which is what Workers wants. 5.10.0 is the fallback if the team insists. Update the research note either way |
| `@cloudflare/vitest-plugin` | `1.3.6` (2026-10-02) | 1.4.4 | The old `@cloudflare/vitest-pool-workers` is deprecated and renamed to this; it bundles `wrangler@4.147.0` |
| `vitest` | `4.1.11` (2026-08-18) | 5.0.5 | The plugin 1.3.x peers on `^4.1.0` |
| `typescript` | `5.9.3` | 7.0.2 | TS 6/7 are new major lines; stay on 5.9 for tool compatibility |

Node 22 (as the Pages workflow already uses).

`compatibility_date`: **`2026-09-30`** (not later than the workerd that
ships with Wrangler 4.147.0, so `wrangler dev` does not warn).

Verified in docs or the CLI today:
- `run_worker_first` accepts `true` or an array of route patterns.
- Rate limiting binding: `ratelimits: [{ name, namespace_id, simple: { limit, period } }]`, period only 10 or 60 s, per Cloudflare location, eventually consistent; `env.X.limit({ key })` returns `{ success }`.
- **Pages config does not support `ratelimits`** (Pages Wrangler configuration page lists d1, DO, hyperdrive, kv, queues producers, r2, vectorize, services, analytics engine, ai, vars). This shapes step 0.
- Access JWT: header `Cf-Access-Jwt-Assertion`, JWKS at `https://<team>.cloudflareaccess.com/cdn-cgi/access/certs`, issuer = team domain, audience = the application AUD tag.
- ElevenLabs: `POST /v1/single-use-token/{realtime_scribe|batch_scribe|tts_websocket}` with `xi-api-key`, returns `{ token }`, valid 15 minutes, single use. `POST /v1/speech-to-text` multipart: `model_id`, `file`, `language_code`, `diarize`, `num_speakers`, `timestamps_granularity`; words carry `text, type, start, end, speaker_id, logprob`. `enable_logging=false` (zero retention) is enterprise-only.
- `wrangler versions upload --preview-alias <name> --var K:V` and `wrangler deploy --var K:V` exist in 4.147.0.
- Test plugin 1.3.6 exports `cloudflareTest()` (a Vite plugin) and types at `@cloudflare/vitest-plugin/types`; `fetchMock` is gone, global `fetch` spies work because the Worker runs in the test isolate.

## Sequencing decision

Revoking the leaked key breaks recording on the live site at once, because
the page uses that key. So the fastest restoration path matters more
than the cleanest one:

1. **Step 0 ships on Pages Functions**, next to today's `summarize.js`,
   because Pages is the live demo on `main` and the Worker does not exist
   yet. It restores recording on `codebridge-mdt.pages.dev` within hours.
   Pages cannot bind a rate limiter (verified above), so on Pages the
   guard is a credit-capped key plus origin, type and size checks. This is
   a stated trade-off, not a silent one.
2. **Step 1 creates the Worker** and ports all three server routes
   (`summarize`, `stt/token`, `stt/diarize`) to TypeScript with the rate
   limiter, retries and auth. The Pages Functions stay unchanged until the
   Worker URL is proven and Pages is retired (a later cleanup issue, named
   in step 1's acceptance list, deletes `mocks/functions/`).

The frontend change is written once (step 0) against the same route
contract both hosts serve, so the page works on Pages, on the Worker, and
degrades cleanly from a file or `mocks/serve.py`.

Shared route contract (both hosts):

| Route | Request | Success response |
|---|---|---|
| `GET /api/health` | - | `200 { ok: true, service: "codebridge-mdt", runtime: "pages" \| "worker", version: string, features: { stt: bool, summarize: bool, data: false }, limits: { stt_audio_bytes: number, summary_chars: number } }` |
| `POST /api/stt/token` | no body | `200 { ws_url: string, expires_in_s: 900 }` |
| `POST /api/stt/diarize` | body: raw WAV, `Content-Type: audio/wav`, `Content-Length` required | `200 { words: [{ text, start, end, speaker_id }], language_code: string \| null, model: string }` |
| `POST /api/summarize` | `{ transcript: string }` | `200 { summary: string, model: string, prompt_version: string }` |

Errors on every route: HTTP status plus
`{ "error": { "code": string, "message_cs": string } }` (the foundations
format; the UI shows `message_cs`). `features.data` stays `false` until
step 2, so the step 2 "use the API instead of embedded data" switch keys
on `features.data`, not on health answering at all. This refines the
foundation bullet "when health answers, the page uses the API", which
would otherwise misfire on Pages.

Error codes (both hosts):

| Status | `code` | `message_cs` |
|---|---|---|
| 400 | `bad_request` | Neplatný požadavek. |
| 400 | `bad_audio` | Záznam není ve formátu WAV. |
| 401 | `unauthenticated` | Přihlášení chybí nebo vypršelo. Obnovte stránku. |
| 403 | `bad_origin` | Požadavek nepřišel z této aplikace. |
| 404 | `not_found` | Neznámá adresa API. |
| 411 | `length_required` | Chybí velikost nahrávaného záznamu. |
| 413 | `too_large` | summarize: "Přepis je příliš dlouhý ke shrnutí."; diarize: "Záznam případu je příliš dlouhý (nad 50 minut)." |
| 415 | `unsupported_media_type` | Nepodporovaný formát dat. |
| 429 | `rate_limited` | Příliš mnoho požadavků, zkuste to za minutu. (plus `Retry-After: 60`) |
| 500 | `internal` | Interní chyba serveru. |
| 500 | `misconfigured` | Server není správně nastaven. (auth mode unknown or Access vars empty; fail closed) |
| 502 | `upstream_error` | Služba přepisu (or "jazykového modelu") odpověděla chybou. |
| 503 | `not_configured` | Tato služba na tomto serveru není zapnutá. (missing secret) |
| 503 | `upstream_busy` | Služba je přetížená, zkuste to znovu za chvíli. (429/503 after retries) |
| 504 | `upstream_timeout` | Služba neodpověděla včas. |

Rules: never put the upstream HTTP status, upstream body or the key in a
response. Log only route, our status, upstream status, attempt count and
duration; never a transcript, audio size per patient name, or token.
All `/api/*` responses carry `Cache-Control: no-store`.

---

# Issue: Step 0 - Move ElevenLabs out of the browser

## Goal

The ElevenLabs API key leaves the page and the git tree. The page asks
our server for a single-use realtime token and sends the case audio to
our server for the speaker pass; only the server holds
`ELEVENLABS_API_KEY`. Recording works again on
`codebridge-mdt.pages.dev`, and where no server exists (file, artifact
viewer, `mocks/serve.py`) the recorder says it is unavailable instead of
failing mid-meeting.

## Scope

- Revoke the leaked key (the one in `STT_DEMO_KEY`, committed, published, in public git history). Create a new key restricted to speech-to-text with a credit cap.
- Pages Functions: `GET /api/health`, `POST /api/stt/token`, `POST /api/stt/diarize`.
- A Pages Wrangler config so model names and limits come from configuration.
- Frontend: remove the key and `stt-config.js` entirely; call the new routes; feature-detect via `/api/health`.
- A CI guard in the Pages workflow that refuses to publish an embedded ElevenLabs key.
- Docs: `mocks/README.md`, `docs/design/TECHNOLOGIES.md`, `docs/design/DATA-PROTECTION.md`, `.env.example`, `docs/agent/HACKATHON.md`, the research note's "First, today" bullet, `mocks/deploy.sh` comments.

## Out of scope

- Rate limiting binding (Pages cannot bind one; the Worker gets it in step 1).
- A WebSocket proxy: the browser keeps streaming to ElevenLabs with the token (research note: not needed for the demo).
- Moving the speaker pass to a server job, storing audio, or a transcript API (step 5).
- Rewriting git history. Revocation makes the old key worthless; a history rewrite on a published repo would not unpublish it.
- `summarize.js` changes (ported in step 1).

## Design

### 0. Revoke first (no code, 10 minutes)

1. In the ElevenLabs dashboard, delete the key behind `STT_DEMO_KEY`. Confirm with `curl -s -o /dev/null -w '%{http_code}' -X POST -H "xi-api-key: $OLD" https://api.elevenlabs.io/v1/single-use-token/realtime_scribe` returning 401 (read `$OLD` from the file without echoing it).
2. Create a new key: permission "Speech to Text" only, with a credit limit (the dashboard offers a per-key credit quota; verify the field exists, otherwise rely on the account's cap). This cap is the real abuse guard on Pages.
3. `npx -y wrangler@4.147.0 pages secret put ELEVENLABS_API_KEY --project-name codebridge-mdt` (paste the key at the prompt; never on the command line, never in Slack).

From this moment recording on pages.dev is broken until the code below is
deployed. Announce it in the team channel.

### File tree (new and changed)

```
mocks/
  functions/
    _lib/http.js            NEW  json error helper, origin check, config reader
    api/health.js           NEW  GET /api/health
    api/stt/token.js        NEW  POST /api/stt/token
    api/stt/diarize.js      NEW  POST /api/stt/diarize
    api/summarize.js        unchanged in step 0
  pages-wrangler.toml       NEW  copied by deploy.sh to $OUT/wrangler.toml
  deploy.sh                 CHANGED  copies the toml; comment on stt-config removed
  src/v3-template.html      CHANGED  see "Frontend changes"
  v3.html                   REBUILT  (uv run mocks/build.py), key gone from the build
  stt-config.example.js     DELETED
  README.md                 CHANGED
.github/workflows/deploy-mock.yml  CHANGED  key guard step
.gitignore                  CHANGED  `.dev.vars`; drop `mocks/stt-config.js` line
.env.example                CHANGED
```

`_lib/http.js` exports no `onRequest*` handler, so Pages creates no route
for it; the handlers import it relatively and Wrangler bundles it.
(Verify on the first `wrangler pages dev` run: `/_lib/http` must 404.)

### `mocks/pages-wrangler.toml`

```toml
# Pages config for the transitional demo host. deploy.sh copies it to the
# deploy folder as wrangler.toml. Secrets (ELEVENLABS_API_KEY,
# AZURE_OPENAI_KEY) are set with `wrangler pages secret put`, never here.
name = "codebridge-mdt"
pages_build_output_dir = "./public"
compatibility_date = "2026-09-30"

[vars]
ELEVENLABS_API_BASE = "https://api.elevenlabs.io"
STT_REALTIME_MODEL = "scribe_v2_realtime"
STT_BATCH_MODEL = "scribe_v2"
STT_LANGUAGE = "cs"
# 100 MB is the Workers/Pages request body limit on Free and Pro; at 16 kHz
# 16-bit mono (32 000 B/s) it is about 52 minutes of one case's audio.
STT_MAX_AUDIO_BYTES = "100000000"
SUMMARY_MAX_CHARS = "40000"
GIT_SHA = "pages"
```

`deploy.sh` change, after the `cp -R mocks/functions` line:

```bash
# Model names and limits come from configuration (CLAUDE.md), not from the functions' code.
cp mocks/pages-wrangler.toml "$OUT/wrangler.toml"
```

and replace the comment `# stt-config.js holds a local key override and is never published.` with nothing (the file no longer exists). The deploy command stays `wrangler pages deploy public ...` run inside `$OUT`; Wrangler reads `$OUT/wrangler.toml`. Bump `wrangler@4` to `wrangler@4.147.0` in deploy.sh for pinning.

Caveat: once a Pages project deploys with a `wrangler.toml`, dashboard
variables for it are overridden by the file. Secrets are not affected.

### `mocks/functions/_lib/http.js`

```js
// Shared by the Pages Functions. Errors use the app's format { error: { code, message_cs } }.
export const fail = (status, code, message_cs, headers = {}) =>
  Response.json({ error: { code, message_cs } }, { status, headers: { "cache-control": "no-store", ...headers } });
export const ok = data => Response.json(data, { headers: { "cache-control": "no-store" } });

// A same-origin check stops other websites from spending our quota through a visitor's browser.
// It does not stop a script that forges Origin; the key's credit cap does that on Pages.
export function sameOrigin(request) {
  const origin = request.headers.get("origin");
  if (request.headers.get("sec-fetch-site") === "cross-site") return false;
  return origin === new URL(request.url).origin;
}
export const num = (v, name) => { const n = Number(v); if (!Number.isFinite(n) || n <= 0) throw new Error(`bad var ${name}`); return n; };
```

### `GET /api/health` (`mocks/functions/api/health.js`)

```js
export function onRequestGet({ env }) {
  return ok({
    ok: true, service: "codebridge-mdt", runtime: "pages", version: env.GIT_SHA || "unknown",
    features: { stt: !!env.ELEVENLABS_API_KEY, summarize: !!env.AZURE_OPENAI_KEY, data: false },
    limits: { stt_audio_bytes: Number(env.STT_MAX_AUDIO_BYTES) || 0, summary_chars: Number(env.SUMMARY_MAX_CHARS) || 40000 },
  });
}
```

No user data, no key material; the booleans only say whether a secret is set.

### `POST /api/stt/token` (`mocks/functions/api/stt/token.js`)

Flow:
1. `sameOrigin` false -> 403 `bad_origin`.
2. No `ELEVENLABS_API_KEY` -> 503 `not_configured`.
3. `fetch(`${base}/v1/single-use-token/realtime_scribe`, { method: "POST", headers: { "xi-api-key": key }, signal: AbortSignal.timeout(10000) })`. One retry on 429 or 503 after 1 s (plus jitter). Timeout -> 504 `upstream_timeout`; 429/503 after the retry -> 503 `upstream_busy`; other non-2xx -> 502 `upstream_error`.
4. Build the socket URL on the server, so the realtime model and options are configuration:

```js
// audio_format must match REC_RATE (16000) in v3-template.html; the browser resamples to it.
const q = new URLSearchParams({
  model_id: env.STT_REALTIME_MODEL, language_code: env.STT_LANGUAGE, commit_strategy: "vad",
  vad_silence_threshold_secs: "0.8", include_timestamps: "true", audio_format: "pcm_16000", token,
});
return ok({ ws_url: `${env.ELEVENLABS_API_BASE.replace(/^https/, "wss")}/v1/speech-to-text/realtime?${q}`, expires_in_s: 900 });
```

The token is single use and expires in 15 minutes, so returning it to the
browser is the intended use. It is never logged.

### `POST /api/stt/diarize` (`mocks/functions/api/stt/diarize.js`)

Request: the browser posts the WAV it already builds (`wavOf`) as the raw
body. Raw body instead of multipart, because the server then streams it on
without buffering: a Worker has 128 MB of memory and the body may be
100 MB.

Checks, in order:
1. `sameOrigin` -> 403 `bad_origin`.
2. Secret present -> else 503 `not_configured`.
3. `Content-Type` starts with `audio/wav` (or `audio/x-wav`) -> else 415.
4. `Content-Length` present and an integer -> else 411 `length_required`. Chunked uploads are refused because the outgoing multipart length must be known.
5. `44 <= length <= STT_MAX_AUDIO_BYTES` -> else 413 `too_large` (or 400 `bad_audio` when under 44).
6. Peek the first 12 bytes: `RIFF....WAVE` -> else 400 `bad_audio`.

Upstream call, streamed:

```js
const enc = new TextEncoder(), b = `----codebridge${crypto.randomUUID()}`;
const field = (name, value) => `--${b}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`;
const head = enc.encode(
  field("model_id", env.STT_BATCH_MODEL) + field("language_code", env.STT_LANGUAGE) +
  field("diarize", "true") + field("timestamps_granularity", "word") +
  `--${b}\r\nContent-Disposition: form-data; name="file"; filename="mdt.wav"\r\nContent-Type: audio/wav\r\n\r\n`);
const tail = enc.encode(`\r\n--${b}--\r\n`);
// FixedLengthStream gives the outgoing request a Content-Length without holding the audio in memory.
const { readable, writable } = new FixedLengthStream(head.length + length + tail.length);
const pump = (async () => {
  const w = writable.getWriter();
  try {
    await w.write(head); await w.write(firstChunk);           // firstChunk = the bytes already read for the RIFF check
    for (;;) { const { done, value } = await reader.read(); if (done) break; await w.write(value); }
    await w.write(tail); await w.close();
  } catch (e) { await w.abort(e); }
})();
context.waitUntil(pump);
const r = await fetch(`${env.ELEVENLABS_API_BASE}/v1/speech-to-text`, {
  method: "POST", body: readable, signal: AbortSignal.timeout(300000),
  headers: { "xi-api-key": env.ELEVENLABS_API_KEY, "content-type": `multipart/form-data; boundary=${b}` },
});
```

No server-side retry: the body is a one-shot stream. A 429/503 maps to
503 `upstream_busy` and the page already offers "Zkusit znovu" (it keeps
the audio for an errored pass). If the client sends fewer bytes than it
declared, `FixedLengthStream` errors, the upstream fetch fails, and the
route answers 502 `upstream_error`.

Response mapping (drops `spacing` and `audio_event` items, `logprob`, and
the full `text`, so the browser gets only what it renders):

```js
const d = await r.json();
return ok({
  words: (d.words || []).filter(w => w.type === "word").map(w => ({ text: w.text, start: w.start ?? 0, end: w.end ?? null, speaker_id: w.speaker_id ?? null })),
  language_code: d.language_code ?? null, model: env.STT_BATCH_MODEL,
});
```

The function stores nothing and logs nothing about the audio.

### Frontend changes (`mocks/src/v3-template.html`, line numbers at commit 04968a4)

1. **Lines 850-851**: delete the comment and `<script src="stt-config.js"></script>`.
2. **Lines 2423-2430** (block comment): replace "Demo only: ..." last line with: `The page never holds a speech key: our server mints the single-use realtime token and forwards the case audio for the speaker pass (/api/stt/*). Demo only: in operation the same two passes run on a transcription server inside FNO (for example Whisper).`
3. **Line 2431**: `const STT_API = "https://api.elevenlabs.io", REC_RATE = 16000;` becomes
   `/* REC_RATE must match audio_format=pcm_16000, which the server puts in the socket URL. */ const REC_RATE = 16000;`
4. **Lines 2435-2438**: delete the `STT_DEMO_KEY` comment and constant and `sttKey`. Add in their place:

```js
/* What this copy of the page can reach. Opened from a file, in an artifact viewer or under mocks/serve.py there is
   no speech server, and the recorder says so instead of failing during the meeting. */
S.api = { stt: false, summarize: false, data: false, limits: {} };
async function apiProbe() {
  try {
    const r = await fetch("/api/health", { cache: "no-store", signal: AbortSignal.timeout(3000) });
    /* A static host answers unknown paths with an HTML 404 page; only a JSON answer counts. */
    if (r.ok && (r.headers.get("content-type") || "").includes("application/json")) {
      const h = await r.json(); Object.assign(S.api, h.features || {}, { limits: h.limits || {} });
    }
  } catch { /* no server: features stay off */ }
  recUI();
}
/* The server's Czech message when it sent one; our own status otherwise. Upstream statuses never reach the page. */
async function apiErr(r, fallback) {
  try { const m = (await r.json())?.error?.message_cs; if (m) return m; } catch {}
  return `${fallback} (HTTP ${r.status})`;
}
```

5. **Lines 2461-2466** (`recConnect` start): replace the comment, the token fetch, the error line, the destructuring and the `new WebSocket(...)` line with:

```js
async function recConnect() {
  /* Our server mints ElevenLabs' single-use token and builds the socket URL; the API key never reaches the page. */
  const r = await fetch("/api/stt/token", { method: "POST" });
  if (!r.ok) throw new Error(await apiErr(r, "Server nevydal přístup k přepisu"));
  const { ws_url } = await r.json();
  if (!S.rec.on) return; // stopped while the token was on its way
  const ws = new WebSocket(ws_url);
```

   The rest of `recConnect` (from `ws.ses = S.rec.ses;`) is unchanged, including the reconnect with backoff, which now mints a fresh token through the server each time.
6. **`recStart` (line 2448)**: first line becomes `if (!S.api.stt) { recStop("AI záznam v této kopii aplikace není dostupný (chybí server pro přepis)."); return; }`.
7. **Lines 2559-2563** (`recPostPass` request): replace the `FormData` block and fetch with:

```js
    const wav = wavOf(segs.flatMap(sg => sg.chunks)), max = S.api.limits.stt_audio_bytes;
    /* The server refuses bodies over its limit; checking here keeps the audio and offers a retry-free message. */
    if (max && wav.size > max) throw new Error("záznam případu je delší, než server přijme (asi 50 minut)");
    /* Raw WAV, not multipart: the server streams it on to the speech service without holding it in memory. */
    const r = await fetch("/api/stt/diarize", { method: "POST", headers: { "content-type": "audio/wav" }, body: wav });
    if (!r.ok) throw new Error(await apiErr(r, "Server odmítl záznam"));
```

8. **Line 2567** (`if (w.type !== "word") continue;` inside the `recPostPass` loop): delete; the server returns words only. `w.speaker_id`, `w.start`, `w.text` keep their names.
9. **Lines 2580-2590** (`recSummarize`): change the comment "Same-origin Cloudflare Pages Function (mocks/functions/api/summarize.js)" to "Same-origin server route (Pages Function today, the Worker from step 1)", and `if (!r.ok) throw new Error(\`HTTP ${r.status}\`);` to `if (!r.ok) throw new Error(await apiErr(r, "Shrnutí selhalo"));`. Today's `summarize.js` returns `{ error: "..." }` without `message_cs`, so the fallback text shows until step 1; acceptable.
10. **`recCtlHtml` (lines 2622-2626)**: when the server lacks STT, render a disabled button and a plain explanation:

```js
function recCtlHtml(p) {
  const r = S.rec;
  if (!S.api.stt && !r.on) return `<div class="recbar"><button class="btn recbtn" disabled>● Spustit záznam</button>
      <span class="small">AI záznam v této kopii aplikace není dostupný (chybí server pro přepis). Závěr lze zapsat ručně.</span></div>`;
  ...existing body unchanged
}
```

11. **Line 3607**: `else if (a === "recon") { if (!S.api.stt) return; logAccess(...); recStart(); }` so a stale button cannot write a false access-log entry.
12. **Lines 3894-3895**: after `render();` add `apiProbe();` (async; `recUI()` refreshes the recorder when it answers, no full render, so focus is not stolen).

Then `uv run mocks/build.py` to regenerate `mocks/v3.html`, and confirm
`grep -c "sk_" mocks/v3.html mocks/src/v3-template.html` prints 0 for both.

Developers who have a local `mocks/stt-config.js` delete it; nothing reads it any more.

### CI guard (`.github/workflows/deploy-mock.yml`)

Add before "Deploy to Cloudflare Pages":

```yaml
      # The page must never carry a speech or model key again (the key in STT_DEMO_KEY leaked this way).
      - name: Refuse to publish an embedded API key
        run: |
          if grep -RInE 'sk_[0-9a-f]{40,}|xi-api-key' mocks/v3.html mocks/src/v3-template.html; then
            echo "An API key or a direct ElevenLabs auth header is in the page." >&2; exit 1; fi
```

(`xi-api-key` may only appear in `mocks/functions/`, which the grep does
not scan.) Add `mocks/pages-wrangler.toml` to the workflow's `paths`
list. Nothing else in the workflow changes.

### Local development (step 0)

```
cd mocks
printf "ELEVENLABS_API_KEY=\nAZURE_OPENAI_KEY=\n" > .dev.vars   # then fill in the keys; .dev.vars is gitignored
npx -y wrangler@4.147.0 pages dev . --compatibility-date=2026-09-30 \
  --binding ELEVENLABS_API_BASE=https://api.elevenlabs.io --binding STT_REALTIME_MODEL=scribe_v2_realtime \
  --binding STT_BATCH_MODEL=scribe_v2 --binding STT_LANGUAGE=cs --binding STT_MAX_AUDIO_BYTES=100000000 --binding GIT_SHA=local
```

Open `http://localhost:8788/v3.html` in Chrome (localhost counts as a
secure context, so the microphone works). `mocks/serve.py` keeps serving
the prognosis API and shows the recorder as unavailable. Simpler
alternative if the flag list is annoying: a `mocks/dev-pages.sh` that
stages exactly like `deploy.sh` and runs `wrangler pages dev public`
inside `$OUT`, which reads the copied toml.

## Secrets and config

| Name | Kind | Where |
|---|---|---|
| `ELEVENLABS_API_KEY` | secret | `wrangler pages secret put ... --project-name codebridge-mdt`; locally `mocks/.dev.vars` |
| `AZURE_OPENAI_KEY` | secret | unchanged |
| `ELEVENLABS_API_BASE`, `STT_REALTIME_MODEL`, `STT_BATCH_MODEL`, `STT_LANGUAGE`, `STT_MAX_AUDIO_BYTES`, `SUMMARY_MAX_CHARS`, `GIT_SHA` | vars | `mocks/pages-wrangler.toml` |

`.gitignore`: add `.dev.vars` (any folder) and remove the
`mocks/stt-config.js` line. Keep `.elevenlabs-key` (used by
`scripts/transcribe.py`). Suggest adding `Read(./**/.dev.vars)` to the
deny list in `.claude/settings.json` so agents do not read local secrets.

`.env.example` additions (keys empty):

```
# Speech-to-text for "AI záznam" (server-side only; the page never holds it).
ELEVENLABS_API_KEY=
ELEVENLABS_API_BASE=https://api.elevenlabs.io
STT_REALTIME_MODEL=scribe_v2_realtime
STT_BATCH_MODEL=scribe_v2
STT_LANGUAGE=cs
STT_MAX_AUDIO_BYTES=100000000
# Summary of a recorded MDT discussion (hackathon Azure OpenAI gateway, EU).
AZURE_OPENAI_KEY=
AZURE_OPENAI_BASE=https://apim-rakathon-q7146n.azure-api.net/openai/v1
AZURE_OPENAI_MODEL=gpt-6-luna-dz-eu
```

Add one comment line: the Workers and Pages runtimes read these from
`.dev.vars` / Wrangler config, `.env` is for the Python scripts; the
names are the same.

## Docs to update

- `mocks/README.md`, "AI záznam" section: drop the demo key and `stt-config.js` sentences; say the page gets a single-use token from `/api/stt/token` and sends the case audio to `/api/stt/diarize`, which hold the key; the recorder is shown as unavailable without a server; local run with `wrangler pages dev` as above. Also the summary bullet now names the route generically.
- `docs/design/TECHNOLOGIES.md`: ElevenLabs row "through our server routes (key server-side, single-use token in the browser)"; Pages row: "Pages Functions for /api/summarize and /api/stt/*".
- `docs/design/DATA-PROTECTION.md`, AI záznam paragraph: the case audio passes through our server (Cloudflare, not stored, not logged, size-limited) to ElevenLabs; ElevenLabs may keep request logs because zero retention (`enable_logging=false`) is enterprise-only; demo uses fictitious speech only; the key is server-side.
- `docs/agent/HACKATHON.md`: tools list, "Cloudflare Pages (with Pages Functions for the speech and summary routes)"; a dated line that the demo ElevenLabs key was revoked on 2026-10-17 after being published.
- `docs/research/2026-10-17-backend-migration.md`: mark "First, today" as done with the date; the "Calls made straight from the browser" bullet now describes only the realtime socket.
- `.env.example` as above.

## Tests

No test runner exists on Pages; step 1 brings Vitest and covers the same
contract on the Worker. Recorded checks for step 0 (note results in the PR):

1. `curl -s https://codebridge-mdt.pages.dev/api/health` returns `features.stt: true`.
2. `curl -s -X POST https://codebridge-mdt.pages.dev/api/stt/token` without Origin returns 403 `bad_origin`; with `-H "Origin: https://codebridge-mdt.pages.dev"` returns a `ws_url` (do not paste the token anywhere).
3. Diarize with a 3 s synthetic WAV (`say`/`ffmpeg` of a Czech test sentence, 16 kHz mono) returns `words` with `speaker_id`; a text file with `Content-Type: audio/wav` returns 400 `bad_audio`; `Content-Length: 200000000` returns 413.
4. End to end in Chrome with the fake microphone, as `mocks/README.md` already describes: start recording, live words appear, approve the conclusion, "Mluvčí 1/2" lines replace the live text, summary appears.
5. Open `mocks/v3.html` from a file: recorder shows the unavailable text and the button is disabled; no console errors beyond the failed health fetch.
6. `grep` guard step fails when the old line is reintroduced (run the workflow step locally against a scratch copy).

## Acceptance criteria

- [ ] Old ElevenLabs key revoked; token mint with it returns 401.
- [ ] New key is speech-to-text only, with a credit cap, stored only as a Pages secret and in local `.dev.vars`.
- [ ] `STT_DEMO_KEY`, `sttKey`, `STT_CONFIG`, `stt-config.js` and `xi-api-key` are absent from `mocks/src/v3-template.html` and `mocks/v3.html`; `mocks/stt-config.example.js` deleted.
- [ ] `/api/health`, `/api/stt/token`, `/api/stt/diarize` deployed on pages.dev and match the shared contract and error format.
- [ ] Recording, speaker pass and summary work end to end on pages.dev (fake-mic check recorded).
- [ ] Without a server the recorder is disabled with the Czech explanation; the typed-conclusion path is unaffected.
- [ ] No response contains an upstream status, upstream body or key; nothing logs audio or tokens.
- [ ] CI key guard added; Pages workflow still deploys on push to `main`.
- [ ] Docs listed above updated; `.gitignore` and `.env.example` in step.
- [ ] A separate agent reviewed the change for key leaks and privacy (CLAUDE.md mechanism 4) and its findings are folded in.

## Risks and unknowns

- **No rate limit on Pages.** Anyone who forges an Origin header can mint tokens or send audio and spend credits until the cap. Mitigation: credit cap on the key; step 1 moves the routes behind the Worker's limiter and, later, Access.
- **`_lib/` routing** on Pages is assumed (a module without handlers creates no route). Check `/_lib/http` returns 404 after deploy.
- **Pages `wrangler.toml` adoption** changes how the Pages project reads config; if it misbehaves, fall back to reading vars with in-code defaults in `_lib/http.js` for the transition and say so in the PR.
- **ElevenLabs retains requests** unless enterprise zero retention; acceptable only for fictitious speech (already the rule).
- **Upload time.** A 50-minute case is about 96 MB of WAV; on venue Wi-Fi that can take minutes. Typical case discussions are minutes long (a few MB). Compressing to Opus in the browser is a step 5 topic.
- **Alternative not chosen:** a `batch_scribe` single-use token would let the browser send audio straight to ElevenLabs, avoiding our body limit, but it would keep the speaker pass outside the server, where step 5 needs it.

## Effort

3-4 hours: revoke and secret 0.25 h, functions 1.5 h, frontend 1 h, docs and checks 1 h.

---

# Issue: Step 1 - Worker with static assets and the API foundation

## Goal

A Wrangler project in `api/` deploys a Worker named `codebridge-mdt` that
serves the built mock as static assets and the API under `/api`, with
configuration from vars, keys from secrets, retries on 429, size and rate
limits, an auth middleware that runs in `demo` mode now and verifies
Cloudflare Access when switched to `access`, Vitest integration tests,
and a CI workflow. Pages keeps running unchanged until the Worker URL is
proven.

## Scope

- `api/` project: TypeScript strict, Hono, Wrangler config, staging script, local dev, tests.
- Routes: `GET /api/health`, `POST /api/summarize` (port of `mocks/functions/api/summarize.js`), `POST /api/stt/token`, `POST /api/stt/diarize` (port of step 0).
- Middleware: errors, no-store, auth (`AUTH_MODE=demo|access`), same-origin check, rate limits.
- Optional AI Gateway (off by default).
- CI: `.github/workflows/deploy-worker.yml` (test, then deploy); `deploy-mock.yml` untouched apart from step 0's guard.

## Out of scope

- D1, R2, Workflows, seed, any data route (`features.data` stays `false`), `domain/` and `store/` folders (created by step 2 when they get content).
- Configuring Access itself (a dashboard task; this step ships the verifier and a runbook, `AUTH_MODE` stays `demo`).
- Prognosis service port (decided later per the research note).
- Summary output cache (CLAUDE.md asks for one for demo patients; it needs R2, so it lands with step 5; until then the 429 backoff is the protection).
- Replacing Pages, custom domain, deleting `mocks/functions/` (follow-up issue "Retire Pages").

## Design

### File tree

```
api/
  package.json
  package-lock.json
  tsconfig.json
  wrangler.jsonc
  vitest.config.ts
  .dev.vars.example
  AGENTS.md                      short: how to run, test, deploy; where secrets go
  scripts/stage-assets.sh
  src/
    index.ts                     Hono app, middleware order, export default
    worker-configuration.d.ts    generated by `npm run types`, committed
    types.ts                     AppEnv { Bindings: Env; Variables: { user: User } }
    http/errors.ts               ApiError, error table, onError, notFound
    http/origin.ts               sameOrigin middleware for non-GET
    http/rate-limit.ts           rateLimit(bindingName) middleware factory
    auth/middleware.ts           auth() by AUTH_MODE
    auth/access.ts               verifyAccessJwt with jose, JWKS cache per team
    services/retry.ts            fetchWithRetry
    services/azure-openai.ts     chat completion call, AI Gateway option
    services/elevenlabs.ts       mintRealtimeToken, diarizeStream
    prompts/summarize-cs.ts      PROMPT and PROMPT_VERSION
    routes/health.ts
    routes/summarize.ts
    routes/stt.ts
  test/
    tsconfig.json
    helpers.ts                   testEnv(overrides), req(path, init), mockFetch()
    health.test.ts
    summarize.test.ts
    stt.test.ts
    auth.test.ts
  .assets/                       gitignored, written by stage-assets.sh
.github/workflows/deploy-worker.yml
```

Root `.gitignore` additions: `api/.assets/` (`.wrangler/`,
`node_modules/` and `.dev.vars` are already or newly covered).

### `api/package.json`

```json
{
  "name": "codebridge-api",
  "private": true,
  "type": "module",
  "engines": { "node": ">=22" },
  "scripts": {
    "stage": "bash scripts/stage-assets.sh",
    "dev": "npm run stage && wrangler dev",
    "types": "wrangler types src/worker-configuration.d.ts",
    "typecheck": "tsc --noEmit && tsc --noEmit -p test",
    "pretest": "node -e \"require('fs').mkdirSync('.assets',{recursive:true})\"",
    "test": "vitest run",
    "deploy": "npm run stage && wrangler deploy"
  },
  "dependencies": {
    "hono": "4.13.13",
    "jose": "6.2.12"
  },
  "devDependencies": {
    "@cloudflare/vitest-plugin": "1.3.6",
    "typescript": "5.9.3",
    "vitest": "4.1.11",
    "wrangler": "4.147.0"
  }
}
```

`pretest` exists because Wrangler refuses a config whose
`assets.directory` is missing, and tests do not need the 11 MB of staged
pages. Commit `package-lock.json`; CI uses `npm ci`.

### `api/wrangler.jsonc`

```jsonc
{
  "$schema": "./node_modules/wrangler/config-schema.json",
  "name": "codebridge-mdt",
  "main": "src/index.ts",
  // Pinned so the runtime behaves the same on every deploy; not later than Wrangler 4.147.0's workerd.
  "compatibility_date": "2026-09-30",
  "workers_dev": true,
  // The backend branch deploys as a preview alias (backend-codebridge-mdt.<subdomain>.workers.dev).
  "preview_urls": true,
  "assets": {
    "directory": "./.assets",
    "binding": "ASSETS",
    // Only the API runs code; pages and images are served as files, as on Pages today.
    // Switch to true when AUTH_MODE=access so the Worker checks the session before any file (second line behind Access).
    "run_worker_first": ["/api/*"],
    "not_found_handling": "404-page"
  },
  // Logs hold route, status and timing only; handlers never log transcripts, audio or tokens.
  "observability": { "enabled": true },
  "vars": {
    "AUTH_MODE": "demo",
    "ACCESS_TEAM_DOMAIN": "",
    "ACCESS_AUD": "",
    "AZURE_OPENAI_BASE": "https://apim-rakathon-q7146n.azure-api.net/openai/v1",
    "AZURE_OPENAI_MODEL": "gpt-6-luna-dz-eu",
    "AI_GATEWAY_BASE": "",
    "LLM_MAX_ATTEMPTS": "4",
    "LLM_RETRY_BASE_MS": "1000",
    "SUMMARY_MAX_CHARS": "40000",
    "ELEVENLABS_API_BASE": "https://api.elevenlabs.io",
    "STT_REALTIME_MODEL": "scribe_v2_realtime",
    "STT_BATCH_MODEL": "scribe_v2",
    "STT_LANGUAGE": "cs",
    "STT_MAX_AUDIO_BYTES": "100000000",
    "GIT_SHA": "dev"
  },
  // Limits are per Cloudflare location and approximate (eventually consistent). Generous on purpose:
  // in demo mode the key is the client IP, and the whole jury may share one venue Wi-Fi address.
  "ratelimits": [
    { "name": "RL_STT_TOKEN", "namespace_id": "26101", "simple": { "limit": 30, "period": 60 } },
    { "name": "RL_STT_BATCH", "namespace_id": "26102", "simple": { "limit": 10, "period": 60 } },
    { "name": "RL_LLM", "namespace_id": "26103", "simple": { "limit": 20, "period": 60 } }
  ]
}
```

`namespace_id` values must be unique in the account (bindings with the
same id share counters); check none exist before the first deploy.

### `api/tsconfig.json`

```json
{
  "compilerOptions": {
    "target": "ES2023", "module": "ESNext", "moduleResolution": "Bundler",
    "lib": ["ES2023"], "types": [], "strict": true, "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": false, "isolatedModules": true, "noEmit": true, "skipLibCheck": true
  },
  "include": ["src/**/*.ts"]
}
```

The Worker runtime types come from the generated
`src/worker-configuration.d.ts` (`wrangler types`), not from
`@cloudflare/workers-types`. Regenerate it whenever `wrangler.jsonc`
changes; CI fails `typecheck` if it is stale (step: `npm run types && git diff --exit-code src/worker-configuration.d.ts`).

`api/test/tsconfig.json`:

```json
{
  "extends": "../tsconfig.json",
  "compilerOptions": { "types": ["@cloudflare/vitest-plugin/types"] },
  "include": ["./**/*.ts", "../src/worker-configuration.d.ts"]
}
```

### `api/vitest.config.ts`

```ts
import { cloudflareTest } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [cloudflareTest({ wrangler: { configPath: "./wrangler.jsonc" } })],
});
```

### `api/scripts/stage-assets.sh`

```bash
#!/usr/bin/env bash
# Copies the built mock into api/.assets, the Worker's static-asset folder.
# mocks/build.py stays the one build of the page; this only stages its output, as mocks/deploy.sh does for Pages.
set -euo pipefail
cd "$(dirname "$0")/.."
MOCKS=../mocks
rm -rf .assets && mkdir -p .assets
cp "$MOCKS/v3.html" .assets/index.html
cp -R "$MOCKS/pages" .assets/pages
# The intake demo patient's documents as a ZIP, linked from the "Nový pacient" dialog.
cp -R "$MOCKS/ukazka" .assets/ukazka
# A real 404 keeps old links from looking alive (not_found_handling: 404-page).
printf '<!doctype html><meta charset="utf-8"><title>Stránka nenalezena</title><p>Stránka nenalezena. Aplikace je na <a href="/">úvodní stránce</a>.</p>\n' > .assets/404.html
```

Like CI for Pages, it deploys the committed build and does not run
`build.py`.

### `src/index.ts` (structure)

```ts
import { Hono } from "hono";
import type { AppEnv } from "./types";
import { onError, notFound } from "./http/errors";
import { sameOrigin } from "./http/origin";
import { auth } from "./auth/middleware";
import { health } from "./routes/health";
import { summarize } from "./routes/summarize";
import { stt } from "./routes/stt";

const app = new Hono<AppEnv>().basePath("/api");
// Nothing under /api may be cached by the browser or an intermediary: answers can carry case text.
app.use("*", async (c, next) => { await next(); c.header("Cache-Control", "no-store"); });
app.route("/health", health);          // public: no data, tells the page which features this host has
app.use("*", auth());                  // everything below needs a user (demo: anonymous demo user)
app.use("*", sameOrigin());            // non-GET from another origin is refused (CSRF and quota abuse)
app.route("/summarize", summarize);
app.route("/stt", stt);
app.notFound(notFound);
app.onError(onError);
export default app;
```

Route-level middleware order inside each route: `rateLimit(...)`, then
body checks, then the handler.

### `src/types.ts`

```ts
export type User = { mode: "demo"; email: null; sub: null } | { mode: "access"; email: string; sub: string };
export type AppEnv = { Bindings: Env; Variables: { user: User } };
```

### Errors (`src/http/errors.ts`)

```ts
export class ApiError extends Error {
  constructor(public status: ContentfulStatusCode, public code: string, public message_cs: string, public headers: Record<string, string> = {}) { super(code); }
}
export const E = {
  badRequest: () => new ApiError(400, "bad_request", "Neplatný požadavek."),
  // ... one factory per row of the shared error table
};
export const onError: ErrorHandler<AppEnv> = (err, c) => {
  if (err instanceof ApiError) return c.json({ error: { code: err.code, message_cs: err.message_cs } }, err.status, err.headers);
  // Unknown errors: log the type and route only; the message may hold request text.
  console.error(JSON.stringify({ route: c.req.path, error: err?.name ?? "Error" }));
  return c.json({ error: { code: "internal", message_cs: "Interní chyba serveru." } }, 500);
};
export const notFound: NotFoundHandler<AppEnv> = c => c.json({ error: { code: "not_found", message_cs: "Neznámá adresa API." } }, 404);
```

Hono's `HTTPException` from `bodyLimit` is mapped in `onError` to 413
`too_large`.

### Auth (`src/auth/middleware.ts`, `src/auth/access.ts`)

```ts
export const auth = (): MiddlewareHandler<AppEnv> => async (c, next) => {
  const mode = c.env.AUTH_MODE;
  if (mode === "demo") {
    // Demo mode trusts no client claim: there is no login, and the UI says roles are a stand-in.
    c.set("user", { mode: "demo", email: null, sub: null });
    return next();
  }
  if (mode === "access") {
    if (!c.env.ACCESS_TEAM_DOMAIN.startsWith("https://") || !c.env.ACCESS_AUD) throw E.misconfigured(); // fail closed
    const token = c.req.header("cf-access-jwt-assertion");
    if (!token) throw E.unauthenticated();
    try {
      const p = await verifyAccessJwt(token, c.env.ACCESS_TEAM_DOMAIN, c.env.ACCESS_AUD);
      if (typeof p.email !== "string" || typeof p.sub !== "string") throw new Error("claims");
      c.set("user", { mode: "access", email: p.email.toLowerCase(), sub: p.sub });
    } catch { throw E.unauthenticated(); }   // the reason (expired, wrong aud) is not echoed
    return next();
  }
  throw E.misconfigured();                 // unknown mode never falls back to open
};
```

```ts
import { createRemoteJWKSet, jwtVerify, type JWTPayload } from "jose";
// One JWKS per team domain per isolate; jose caches keys and refetches on an unknown kid (with a cooldown).
const sets = new Map<string, ReturnType<typeof createRemoteJWKSet>>();
export async function verifyAccessJwt(token: string, teamDomain: string, aud: string): Promise<JWTPayload> {
  const team = teamDomain.replace(/\/+$/, "");
  let jwks = sets.get(team);
  if (!jwks) { jwks = createRemoteJWKSet(new URL(`${team}/cdn-cgi/access/certs`)); sets.set(team, jwks); }
  const { payload } = await jwtVerify(token, jwks, { issuer: team, audience: aud, algorithms: ["RS256"], clockTolerance: 30 });
  return payload;
}
```

Header only, not the `CF_Authorization` cookie: Access always adds the
header on requests it lets through, and reading one source keeps the code
simple.

Access runbook (in `api/AGENTS.md`, done when the team switches on
Access, not in this issue): in Zero Trust, protect the `workers.dev` route
and the preview URLs (Workers settings "Cloudflare Access" toggle, or a
self-hosted application for `codebridge-mdt.<subdomain>.workers.dev` and
`*-codebridge-mdt.<subdomain>.workers.dev`); policy: team emails, mentors,
jury, by one-time PIN or GitHub; copy the AUD tag; set
`ACCESS_TEAM_DOMAIN`, `ACCESS_AUD`, `AUTH_MODE=access`, and
`run_worker_first: true`; redeploy.

### Same-origin check (`src/http/origin.ts`)

For every method other than GET and HEAD: refuse with 403 `bad_origin`
when `Sec-Fetch-Site` is `cross-site`, or when `Origin` is missing or not
equal to `new URL(c.req.url).origin`. No CORS headers are ever sent, so
browsers on other sites cannot read answers either.

### Rate limit (`src/http/rate-limit.ts`)

```ts
export const rateLimit = (name: "RL_STT_TOKEN" | "RL_STT_BATCH" | "RL_LLM"): MiddlewareHandler<AppEnv> => async (c, next) => {
  const u = c.get("user");
  // Access mode limits per person; demo mode has no identity, so the client IP is the best key available.
  const key = u.mode === "access" ? `u:${u.sub}` : `ip:${c.req.header("cf-connecting-ip") ?? "unknown"}`;
  const { success } = await c.env[name].limit({ key });
  if (!success) throw new ApiError(429, "rate_limited", "Příliš mnoho požadavků, zkuste to za minutu.", { "Retry-After": "60" });
  return next();
};
```

`sub` rather than email as key, so no e-mail address sits in the
limiter's keys.

### Retry (`src/services/retry.ts`)

```ts
type RetryOpts = { attempts: number; baseMs: number; maxDelayMs?: number; timeoutMs: number; retryOn?: number[] };
// About 70 teams share the hackathon endpoint (CLAUDE.md): back off exponentially on 429 and 503, honor Retry-After, cap the wait.
export async function fetchWithRetry(url: string, init: RequestInit, o: RetryOpts): Promise<{ res: Response; attempts: number }> {
  const retryOn = o.retryOn ?? [429, 503], maxDelay = o.maxDelayMs ?? 8000;
  for (let i = 1; ; i++) {
    const res = await fetch(url, { ...init, signal: AbortSignal.timeout(o.timeoutMs) });
    if (!retryOn.includes(res.status) || i >= o.attempts) return { res, attempts: i };
    const ra = Number(res.headers.get("retry-after"));
    const base = Number.isFinite(ra) && ra > 0 ? ra * 1000 : o.baseMs * 2 ** (i - 1);
    await res.body?.cancel();
    // Jitter spreads retries from many isolates so they do not hit the endpoint in lockstep.
    await new Promise(r => setTimeout(r, Math.min(maxDelay, base) * (0.8 + Math.random() * 0.4)));
  }
}
```

Only for string or `ArrayBuffer` bodies (re-sendable). With the defaults
(4 attempts, 1 s base) the worst case is about 1+2+4 s of waiting plus
the calls. `AbortSignal.timeout` errors map to 504 `upstream_timeout`.

### `POST /api/summarize` (`src/routes/summarize.ts`, `src/services/azure-openai.ts`)

Middleware: `rateLimit("RL_LLM")`, `bodyLimit({ maxSize: 256 * 1024 })`
(hono/body-limit; 40 000 Czech characters is at most about 160 KB UTF-8).

Handler:
1. `Content-Type` must be `application/json` -> else 415.
2. Parse; `transcript` must be a non-empty string -> else 400 `bad_request`.
3. `transcript.length > Number(SUMMARY_MAX_CHARS)` -> 413 `too_large` "Přepis je příliš dlouhý ke shrnutí." (refused rather than cut silently, as today).
4. No `AZURE_OPENAI_KEY` -> 503 `not_configured`.
5. Call:

```ts
const base = (env.AI_GATEWAY_BASE || env.AZURE_OPENAI_BASE).replace(/\/+$/, "");
const headers: Record<string, string> = { "api-key": env.AZURE_OPENAI_KEY, "content-type": "application/json" };
// AI Gateway is optional: only when AI_GATEWAY_BASE is set; an authenticated gateway also needs its own token.
if (env.AI_GATEWAY_BASE && env.AI_GATEWAY_TOKEN) headers["cf-aig-authorization"] = `Bearer ${env.AI_GATEWAY_TOKEN}`;
// The model accepts only its default temperature; the strict prompt does the work instead.
const body = JSON.stringify({ model: env.AZURE_OPENAI_MODEL, max_completion_tokens: 400,
  messages: [{ role: "system", content: PROMPT }, { role: "user", content: transcript }] });
const { res, attempts } = await fetchWithRetry(`${base}/chat/completions`, { method: "POST", headers, body },
  { attempts: Number(env.LLM_MAX_ATTEMPTS), baseMs: Number(env.LLM_RETRY_BASE_MS), timeoutMs: 60000 });
console.log(JSON.stringify({ route: "summarize", upstream: res.status, attempts }));
if (res.status === 429 || res.status === 503) throw E.upstreamBusy();
if (!res.ok) throw E.upstreamError("jazykového modelu");
const d = await res.json<{ choices?: { message?: { content?: string } }[] }>();
return c.json({ summary: (d.choices?.[0]?.message?.content ?? "").trim(), model: env.AZURE_OPENAI_MODEL, prompt_version: PROMPT_VERSION });
```

`src/prompts/summarize-cs.ts` holds the prompt text from
`summarize.js` verbatim and `export const PROMPT_VERSION = "summarize-cs@1";`
(bump on any wording change; reproducibility rule).

AI Gateway design (optional, off by default): set `AI_GATEWAY_BASE` to
the gateway's URL for the provider, e.g. an "Azure OpenAI" or "custom
provider" gateway pointing at `apim-rakathon-q7146n.azure-api.net`, plus
the `AI_GATEWAY_TOKEN` secret if the gateway is authenticated. Before
turning it on, check on a scratch gateway: (a) whether the Azure provider
accepts our APIM host and the `/openai/v1/chat/completions` path, (b)
whether it retries 429 itself (if so, lower `LLM_MAX_ATTEMPTS` to avoid
doubled retries), (c) gateway logging is off (its logs have no EU
control). Our own backoff stays either way.

### `POST /api/stt/token` and `POST /api/stt/diarize` (`src/routes/stt.ts`, `src/services/elevenlabs.ts`)

Same behavior and shapes as step 0, ported to TypeScript:
- token: `rateLimit("RL_STT_TOKEN")`; `fetchWithRetry` with `attempts: 2`, `timeoutMs: 10000`; returns `{ ws_url, expires_in_s: 900 }`.
- diarize: `rateLimit("RL_STT_BATCH")`; the streamed multipart with `FixedLengthStream` and `c.executionCtx.waitUntil(pump)`; `AbortSignal.timeout(300000)`; no retry; response mapped to `{ words, language_code, model }`.
- Reads only vars, never constants, for base URL, models, language and limit.

`diarizeStream` signature, so step 5's Workflow can reuse it with an R2 object body:

```ts
export async function diarizeStream(env: Env, body: ReadableStream<Uint8Array>, length: number, ctx: ExecutionContext): Promise<DiarizeResult>
```

### `GET /api/health` (`src/routes/health.ts`)

Same shape as step 0 with `runtime: "worker"`, `version: env.GIT_SHA`,
`features.stt = !!env.ELEVENLABS_API_KEY`, `features.summarize = !!env.AZURE_OPENAI_KEY`,
`features.data = false`, and `auth_mode: env.AUTH_MODE` (so the UI can
later label the demo login stand-in).

### CI (`.github/workflows/deploy-worker.yml`)

```yaml
# Tests the API Worker and deploys it: main -> production (codebridge-mdt.<subdomain>.workers.dev),
# backend -> preview alias "backend". Pages (deploy-mock.yml) keeps deploying main until the Worker replaces it.
name: Deploy worker

on:
  push:
    branches: [main, backend]
    paths: ["api/**", "mocks/v3.html", "mocks/pages/**", "mocks/ukazka/**", ".github/workflows/deploy-worker.yml"]
  pull_request:
    paths: ["api/**"]
  workflow_dispatch:

# One Worker, so one deploy at a time across branches; a newer push replaces a queued one.
concurrency:
  group: deploy-worker
  cancel-in-progress: true

jobs:
  test:
    runs-on: ubuntu-24.04
    defaults: { run: { working-directory: api } }
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: "22", cache: npm, cache-dependency-path: api/package-lock.json }
      - run: npm ci
      - name: Generated runtime types match wrangler.jsonc
        run: npm run types && git diff --exit-code src/worker-configuration.d.ts
      - run: npm run typecheck
      - run: npm test

  deploy:
    needs: test
    if: github.event_name != 'pull_request'
    runs-on: ubuntu-24.04
    defaults: { run: { working-directory: api } }
    env:
      CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}
      CLOUDFLARE_ACCOUNT_ID: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: "22", cache: npm, cache-dependency-path: api/package-lock.json }
      - run: npm ci
      - run: npm run stage
      - name: Deploy production (main)
        if: github.ref == 'refs/heads/main'
        run: npx wrangler deploy --var GIT_SHA:${{ github.sha }}
      - name: Upload preview version (backend)
        if: github.ref == 'refs/heads/backend'
        run: npx wrangler versions upload --preview-alias backend --var GIT_SHA:${{ github.sha }}
```

The existing `CLOUDFLARE_API_TOKEN` must also carry "Workers Scripts:
Edit" (and "Account Settings: Read" for `wrangler` account lookups); check
before the first run, since today it may only have Pages permissions.
`deploy-mock.yml` keeps its trigger on `main` and its paths; both
workflows run on a push to `main` that changes `mocks/v3.html`, which is
intended during the transition.

Secrets are set once by hand, never in CI:

```
cd api
npx wrangler secret put ELEVENLABS_API_KEY
npx wrangler secret put AZURE_OPENAI_KEY
# optional
npx wrangler secret put AI_GATEWAY_TOKEN
```

Preview versions share the Worker's secrets.

### Local development

```
cd api
npm ci
cp .dev.vars.example .dev.vars    # fill in keys; gitignored
npm run dev                       # stages assets, runs wrangler dev on http://localhost:8787
```

`api/.dev.vars.example`:

```
# Local secrets for `wrangler dev`. Copy to .dev.vars (gitignored). Never commit real values.
ELEVENLABS_API_KEY=
AZURE_OPENAI_KEY=
# Optional, only with AI_GATEWAY_BASE set in wrangler.jsonc vars:
AI_GATEWAY_TOKEN=
# To try access mode locally, override vars here: AUTH_MODE=access, ACCESS_TEAM_DOMAIN=..., ACCESS_AUD=...
```

`wrangler dev` simulates the rate limiter locally. Opening
`http://localhost:8787/` gives the full app with recording (localhost is
a secure context).

### Frontend

No change beyond step 0: the page already uses relative `/api/...` routes
and `GET /api/health`. On the Worker, `features.stt` and
`features.summarize` turn on when the secrets are set. Optional small
follow-up: show "ukázková data" banner state from `auth_mode` (belongs to
step 2's loader).

## Secrets and config

| Name | Kind | Purpose |
|---|---|---|
| `ELEVENLABS_API_KEY` | secret | Token mint and batch STT |
| `AZURE_OPENAI_KEY` | secret | Summary |
| `AI_GATEWAY_TOKEN` | secret, optional | Authenticated AI Gateway |
| `AUTH_MODE` | var | `demo` now, `access` later; anything else fails closed |
| `ACCESS_TEAM_DOMAIN`, `ACCESS_AUD` | vars | Access verification |
| `AZURE_OPENAI_BASE`, `AZURE_OPENAI_MODEL`, `AI_GATEWAY_BASE`, `LLM_MAX_ATTEMPTS`, `LLM_RETRY_BASE_MS`, `SUMMARY_MAX_CHARS` | vars | Summary |
| `ELEVENLABS_API_BASE`, `STT_REALTIME_MODEL`, `STT_BATCH_MODEL`, `STT_LANGUAGE`, `STT_MAX_AUDIO_BYTES` | vars | Speech |
| `GIT_SHA` | var | Set by CI, shown in health |
| `RL_STT_TOKEN`, `RL_STT_BATCH`, `RL_LLM` | rate limit bindings | Per user or IP, per minute |
| `ASSETS` | assets binding | Static files |

Update `.env.example` with `AUTH_MODE`, `ACCESS_TEAM_DOMAIN`,
`ACCESS_AUD`, `AI_GATEWAY_BASE`, `AI_GATEWAY_TOKEN` (empty), next to the
step 0 entries.

## Tests (`api/test/`, Vitest with the Workers plugin)

Tests call the Hono app directly with an explicit env, so each test picks
its own `AUTH_MODE` and fake limiter while running inside workerd:

```ts
// test/helpers.ts
import app from "../src/index";
import { env as baseEnv } from "cloudflare:workers";
import { createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
export const allow = { limit: async () => ({ success: true }) };
export const deny = { limit: async () => ({ success: false }) };
export function testEnv(over: Partial<Env> = {}): Env {
  return { ...baseEnv, ELEVENLABS_API_KEY: "test-el", AZURE_OPENAI_KEY: "test-az", LLM_RETRY_BASE_MS: "1",
           RL_STT_TOKEN: allow, RL_STT_BATCH: allow, RL_LLM: allow, ...over } as Env;
}
export async function call(path: string, init: RequestInit = {}, env = testEnv()) {
  const ctx = createExecutionContext();
  const headers = new Headers(init.headers);
  if (init.method && init.method !== "GET" && !headers.has("origin")) headers.set("origin", "https://example.test");
  const res = await app.fetch(new Request(`https://example.test${path}`, { ...init, headers }), env, ctx);
  await waitOnExecutionContext(ctx);
  return res;
}
```

Outbound calls are faked with `vi.spyOn(globalThis, "fetch")` returning
canned `Response`s, restored in `afterEach`. Tests assert that the spy got
the expected URL, `api-key` / `xi-api-key` header and body fields.

Cases:
- **health.test.ts**: 200 and shape; `features.stt` false without the secret; no `Cache-Control` other than `no-store`; health works with `AUTH_MODE=access` and no JWT.
- **summarize.test.ts**: happy path returns `summary`, `model`, `prompt_version`, and sends `model` from vars to `${AZURE_OPENAI_BASE}/chat/completions`; 429, 429, 200 -> 200 after 3 calls; four 429s -> 503 `upstream_busy` and the body contains no "429"; upstream 500 -> 502 `upstream_error`, body has no upstream status or text; transcript over `SUMMARY_MAX_CHARS` -> 413; body over 256 KB -> 413; bad JSON -> 400; wrong content type -> 415; missing key -> 503 `not_configured`; `AI_GATEWAY_BASE` set -> request goes to the gateway URL with `cf-aig-authorization` when the token is set; limiter `deny` -> 429 with `Retry-After: 60`; foreign `Origin` -> 403.
- **stt.test.ts**: token: returns `ws_url` starting `wss://api.elevenlabs.io/v1/speech-to-text/realtime?` with `model_id=scribe_v2_realtime`, `language_code=cs`, `audio_format=pcm_16000` and the token; upstream 401 -> 502 with no "401" in body. Diarize: a generated 1 s silent WAV -> upstream receives `multipart/form-data` whose parsed form has `model_id=scribe_v2`, `diarize=true`, `language_code=cs` and a `file` of the same bytes (the spy reads `await req.formData()`); response keeps only `type: "word"` items mapped to `{ text, start, end, speaker_id }`; non-WAV bytes -> 400 `bad_audio`; `Content-Type: text/plain` -> 415; missing `Content-Length` (a streamed body) -> 411; `Content-Length` above `STT_MAX_AUDIO_BYTES` (set to `"1000"` in the test env) -> 413 without reading the body; limiter `deny` -> 429.
- **auth.test.ts**: generate an RS256 key pair with `jose.generateKeyPair("RS256", { extractable: true })`, export the public JWK with a `kid`, serve `{ keys: [jwk] }` from the fetch spy for `https://team.cloudflareaccess.com/cdn-cgi/access/certs`; sign tokens with `SignJWT`. Cases: valid token -> 200 on `/api/stt/token` and the limiter key uses `u:<sub>`; missing header -> 401; wrong `aud` -> 401; wrong `iss` -> 401; expired (beyond 30 s tolerance) -> 401; signed by another key -> 401; HS256 token -> 401; `AUTH_MODE=access` with empty `ACCESS_AUD` -> 500 `misconfigured`; `AUTH_MODE=bogus` -> 500 `misconfigured`; demo mode needs no header.
- **Assets** (one recorded manual check, not Vitest): after `npm run dev`, `/` serves the app, `/pages/10_pacient/p1.png` serves an image, `/nope` returns the 404 page with status 404, `/api/nope` returns the JSON 404.

## Acceptance criteria

- [ ] `api/` exists with the files above; `npm ci && npm run typecheck && npm test` pass locally and in CI.
- [ ] `wrangler.jsonc` pins `compatibility_date: 2026-09-30`; `package.json` pins the exact versions in the table; lockfile committed.
- [ ] `npm run dev` serves the full app at `http://localhost:8787/` with recording, speaker pass and summary working (fake-mic check recorded).
- [ ] Production Worker live at `codebridge-mdt.<subdomain>.workers.dev` from `main`; `backend` pushes produce the `backend` preview alias; health shows the deployed `GIT_SHA`.
- [ ] `codebridge-mdt.pages.dev` still deploys and works (both workflows green on a `main` push).
- [ ] All `/api` answers use `{ error: { code, message_cs } }`; no upstream status, body or key in any response; logs carry no transcript, audio or token.
- [ ] Endpoint, model, language and limits come from vars; keys only from secrets; `.env.example` and `.dev.vars.example` list every name the code reads.
- [ ] 429 backoff covered by tests; rate limiter returns 429 with `Retry-After`.
- [ ] `AUTH_MODE=access` verifies signature, issuer, audience and expiry, and fails closed on missing config; Access runbook in `api/AGENTS.md`. Worker ships with `AUTH_MODE=demo`.
- [ ] AI Gateway is a var, off by default, with the three verification points recorded before anyone turns it on.
- [ ] Docs updated: `docs/design/TECHNOLOGIES.md` (Workers, static assets, Hono 4.13.13, jose 6.2.12, Wrangler 4.147.0, Vitest 4.1.11 with `@cloudflare/vitest-plugin` 1.3.6, rate limiting binding, optional AI Gateway), `docs/agent/HACKATHON.md` tools list, root `README.md` (how to run and test `api/`, formatter/typecheck commands), `mocks/README.md` (the Worker as the second host), research note (jose 6 instead of 5; step 1 done; health `features.data` switch).
- [ ] Follow-up issue "Retire Pages" filed: switch the demo link to the Worker, delete `mocks/functions/` and `mocks/pages-wrangler.toml`, remove `deploy-mock.yml`.
- [ ] A separate agent reviewed auth, origin, limits and logging adversarially (CLAUDE.md mechanism 4); findings folded in.

## Risks and unknowns

- **Two copies of the server routes** (Pages JS and Worker TS) until Pages retires. Any change to the STT or summary contract must touch both; the follow-up issue ends it. Alternative if the transition drags: make the Pages Functions thin proxies to the Worker through a `services` binding (supported on Pages).
- **Test plugin is newly renamed** (`@cloudflare/vitest-plugin`, first published 2026-08). If `cloudflareTest()` misbehaves with Vitest 4.1.11, fall back to calling `app.fetch` from plain Vitest in Node for the pure parts, and say so.
- **`FixedLengthStream` and `waitUntil` streaming** under the test runtime and with 100 MB bodies: test with a 1 s WAV in Vitest; check one 20 MB upload manually against ElevenLabs.
- **Rate limiter keyed by IP in demo mode**: venue NAT means one key for many people; limits are set generous and are per location and approximate. Not a security control; Access and the key's credit cap are.
- **API token permissions** for Workers deploys may be missing from the existing GitHub secret.
- **Access on workers.dev and preview URLs**: protection of preview URLs is a separate toggle; verify both URLs ask for login before setting `AUTH_MODE=access`.
- **AI Gateway fit with the APIM host** is unverified (research note); it stays off.
- **Workers Logs** are kept by Cloudflare outside our EU control; we log no patient text, which is why the logging rule above matters.
- **compatibility_date** is behind today's date by design; raise it only with a Wrangler bump.

## Effort

About 1 day: project scaffold, config and staging 1.5 h; middleware and auth 2 h; route ports 1.5 h; tests 2 h; CI and first deploy 1 h; docs and review 1 h.
