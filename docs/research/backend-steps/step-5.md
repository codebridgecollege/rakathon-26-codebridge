# Step 5: long jobs as Cloudflare Workflows

Design for step 5 of the backend migration
(`docs/research/2026-10-17-backend-migration.md`, "Migration plan"). It
assumes steps 0-4 exist: the `api/` Worker (Hono, TypeScript), auth in
`demo` and `access` modes, the D1 schema (including `transcript_lines`,
`transcript_passes`, `jobs`, `decisions`), `POST /api/stt/token`, the
synchronous `POST /api/stt/diarize` from step 0, `POST /api/summarize`
from step 1, and the write API from step 4, where approval creates the
decision row.

Terms: a **Workflow** is Cloudflare's durable multi-step job; each
`step.do()` is retried on its own and its return value is stored by the
engine. The **speaker pass** is the second transcription of a case's audio
with speaker separation (ElevenLabs Scribe v2 batch, `diarize=true`). A
**job** is our D1 row that the UI polls; it points to one Workflow
instance.

Sources checked on 2026-10-17 (Cloudflare docs): Workflows Workers API,
Workflows limits, sleeping and retrying, rules of Workflows, Python
Workflows, Vitest test APIs, R2 Workers API, R2 multipart objects, R2
object lifecycles; ElevenLabs `POST /v1/speech-to-text` reference.

## Goal

Move the two jobs that are too long or too fragile for one browser request
onto the server, with the keys only in the Worker:

- **(a) Speaker pass and summary after approval.** Today the browser holds
  each case's raw audio in memory, calls ElevenLabs batch transcription
  itself with the published key, replaces the live lines, and then calls
  `/api/summarize` (`recPostPass`, `recSummarize` in
  `mocks/src/v3-template.html`). After this step the live lines and the
  audio are stored per case on the server, approval starts a
  `SpeakerPassWorkflow`, the audio is deleted by the server whether the
  pass succeeds or fails, and the summary is stored as a labeled draft.
- **(b) Prognosis search.** Today `prognosis/service.py` runs only on a
  developer's machine behind `mocks/serve.py`, holds one global lock and a
  memory cache, and the browser waits up to 330 s on one POST. After this
  step the search runs as a `PrognosisWorkflow` on the Worker, the browser
  polls a job, and the cache lives in R2. Whether the Worker code is a
  TypeScript port or a Python Worker is **pending the user's decision**
  (see "Prognosis: two options").

## Scope

In scope:

- `POST /api/cases/:id/transcript/lines` (batched live lines),
  `GET /api/cases/:id/transcript`.
- Recording sessions on the server (`POST/PATCH .../recordings`) so the
  server can refuse lines and audio when no recording was switched on.
- Audio upload in parts to R2 (multipart through the Worker), its D1
  bookkeeping, server-side purge on case close and session end, a cron
  sweep, and an R2 lifecycle rule as the backstop.
- `SpeakerPassWorkflow`, started by the approval route.
- Summary inside that Workflow: configured model, 429 backoff, R2 cache by
  input hash, stored as a draft apart from the MDT conclusion.
- `jobs` rows, `GET /api/jobs/:id`, frontend polling, UI states.
- `PrognosisWorkflow` with config, profile preview, start, poll, result
  routes; R2 cache; single-flight lock; frontend `prognosis.js` changes.
- Secrets and configuration, tests, docs that this change makes stale.

Out of scope:

- The live socket stays browser to ElevenLabs with the single-use token
  from step 0. No WebSocket proxy.
- Document processing Workflows (step 6).
- A speech server inside FNO, consent records beyond the "switched on by"
  audit entry, speaker naming (voiceprints are not collected).
- Choosing between the TypeScript port and Python Workers for prognosis.
- New prognosis patients: still only case 10 and S01.
- ElevenLabs webhook mode (listed under risks as the fallback for very
  long audio).

## Design

### 1. Recording sessions on the server

CLAUDE.md: record an MDT only when recording is switched on explicitly.
Today only the browser knows that. Add one small table and two routes so
the server can refuse transcript data that has no recording behind it.

```sql
CREATE TABLE recordings (
  id TEXT PRIMARY KEY,              -- uuid from the server
  session_day TEXT NOT NULL,        -- sessions.day the recording belongs to
  started_by TEXT NOT NULL REFERENCES users(id),
  started_at TEXT NOT NULL,
  ended_at TEXT,                    -- NULL while running
  end_reason TEXT                   -- 'stopped' | 'all_approved' | 'session_end' | 'failed'
);
```

- `POST /api/sessions/:day/recordings` (doctor role, a session for `:day`
  is running) returns `{ recording_id }` and writes the audit entry
  "AI záznam spuštěn". The client calls it in `recStart()` before asking
  for the ElevenLabs token.
- `PATCH /api/recordings/:id` `{ end_reason }` sets `ended_at`. Called by
  `recStop()`. The session-end route also closes any open recording.
- The pilot needs a consent record here; the demo keeps the current
  assumption and the UI says so (DATA-PROTECTION.md, "Meeting audio").

### 2. Transcript persistence

**What a line is.** In `recMessage`, each `committed_transcript_with_timestamps`
message produces one or more lines, one per run of words that fall into the
same case's span. A line is final when the message has been processed; it
never grows later. So lines can be sent as immutable records.

**Schema** (refines step 2's `transcript_lines`, `transcript_passes`;
step 2 must carry these columns or step 5 adds them in its migration):

```sql
CREATE TABLE transcript_lines (
  id TEXT PRIMARY KEY,                 -- server uuid
  case_id TEXT NOT NULL REFERENCES cases(id),
  recording_id TEXT REFERENCES recordings(id),
  client_line_id TEXT,                 -- uuid made by the browser, idempotency key (live lines only)
  source TEXT NOT NULL CHECK (source IN ('live','speaker_pass')),
  pass_id TEXT REFERENCES transcript_passes(id),  -- set for speaker_pass lines
  speaker INTEGER,                     -- 0-based per pass; NULL for live lines
  wall_ms INTEGER NOT NULL,            -- when the first word was spoken (epoch ms, from the session timeline)
  text TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'current' CHECK (state IN ('staged','current','superseded')),
  superseded_by_pass TEXT REFERENCES transcript_passes(id),
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE (case_id, client_line_id)
);
CREATE INDEX transcript_lines_case ON transcript_lines(case_id, state, wall_ms);

CREATE TABLE transcript_passes (
  id TEXT PRIMARY KEY,
  case_id TEXT NOT NULL REFERENCES cases(id),
  decision_id TEXT NOT NULL REFERENCES decisions(id),   -- the approval that started it
  job_id TEXT NOT NULL REFERENCES jobs(id),
  from_wall_ms INTEGER NOT NULL,       -- previous pass's cutoff, or 0
  cutoff_wall_ms INTEGER NOT NULL,     -- approval time: the pass covers speech up to here
  audio_upload_id TEXT REFERENCES audio_uploads(id),
  state TEXT NOT NULL CHECK (state IN ('queued','running','done','empty','error','purged')),
  error_code TEXT,
  speaker_count INTEGER,
  line_count INTEGER,
  audio_deleted_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE transcript_summaries (
  id TEXT PRIMARY KEY,
  case_id TEXT NOT NULL REFERENCES cases(id),
  pass_id TEXT NOT NULL REFERENCES transcript_passes(id),
  state TEXT NOT NULL CHECK (state IN ('running','done','error','skipped')),
  basis TEXT CHECK (basis IN ('speaker_pass','live_only')),  -- which lines it was made from
  text TEXT,
  error_code TEXT,
  model TEXT, prompt_sha TEXT, input_sha TEXT,
  label TEXT NOT NULL DEFAULT 'ai_draft',    -- always a draft; never copied into protocols or decisions
  created_at TEXT NOT NULL
);
```

Live lines that a speaker pass replaces are marked `superseded`, not
deleted. They are the assistant's own working text, not source documents,
so this is a choice, not a rule: keeping them makes the replace step
idempotent and lets a failed activation be rolled back. They are hidden in
the UI and deleted with the case under the retention rule.

**Route `POST /api/cases/:id/transcript/lines`.**

Request (JSON, at most 64 KB, at most 100 lines):

```json
{ "recording_id": "…",
  "lines": [ { "client_line_id": "uuid", "wall_ms": 1792240000123, "text": "…" } ] }
```

Server checks, in this order, each refusal as
`{ error: { code, message_cs } }`:

1. Session and role (doctor or coordinator present at the MDT; same rule
   as step 4's attendance).
2. The recording exists, belongs to a running session, and is not ended
   longer than 60 s ago (a sentence is committed up to about a second
   after a pause, and `recStop` waits 3 s for the last one).
3. The case is in that session's agenda (`slots.day = session_day`), and
   its status is not `closed`. This is `recTarget()` on the server.
4. Per line: `text` is 1-5000 characters, `wall_ms` lies within the
   recording's start and end (plus 60 s).
5. Per line, the approval rule. A line is accepted only if it was spoken
   before the case's latest approval took effect and no finished speaker
   pass already covers it:
   - if the case has no decision: accept;
   - if the latest decision exists: accept only when
     `wall_ms <= decision.created_at` and no pass with state `done` has
     `cutoff_wall_ms >= wall_ms`. This keeps one version of each sentence,
     as `recMessage` does today ("A sentence committed late may cover
     speech the speaker pass already holds").
   - otherwise reject with `case_approved`.

Insert is `INSERT ... ON CONFLICT(case_id, client_line_id) DO NOTHING`, so a
retried batch is harmless. Response:

```json
{ "accepted": ["uuid", …], "duplicate": ["uuid"], "rejected": [ { "client_line_id": "uuid", "code": "case_approved" } ] }
```

Audit: one entry per case and recording on the first accepted line ("AI
záznam: přepis ukládán"), not per batch, and never the text.

**Client batching.** `recMessage` pushes each new line into a per-case
queue; a flusher sends the queue every 2 s or at 20 lines, and on
`recStop`, on case switch, and before approval. A failed send stays queued
and retries with backoff (1, 2, 4 … 30 s). The approval click awaits the
flush of that case's queue before posting the decision, so the approval
rule above does not reject the last words. The live view still renders
from memory; the server copy is what a reload, a second device, and the
speaker pass see.

**Route `GET /api/cases/:id/transcript`** returns current lines (state
`current`), passes (state, error code, job id, cutoff), and the latest
summary per pass. The UI uses it on load and after a job finishes.

### 3. Audio

**Format decision: raw 16 kHz mono 16-bit PCM, uploaded in parts.**

| Option | Size per hour | Browser support | Server cost |
|---|---|---|---|
| Raw PCM s16le 16 kHz (today's `recChunk` buffer) | 115 MB | everywhere, already captured | none: ElevenLabs takes it as `file_format=pcm_s16le_16`, no header needed |
| Opus through WebCodecs `AudioEncoder` | about 11 MB at 24 kbit/s | Chromium; Firefox and Safari to verify | needs an Ogg or WebM muxer in the browser; per-case segments are spliced, which needs care at packet boundaries |
| Opus through `MediaRecorder` | about 11 MB | wide | records the whole microphone stream, so the "silence when no case can take it" rule and per-case segments no longer come for free |

Raw PCM wins for the demo: it is exactly what the browser already holds,
segments concatenate byte-wise, ElevenLabs accepts it without a WAV header,
and the speaker pass streams it from R2 without decoding. The size problem
(an hour is about 115 MB, above the 100 MB request limit and close to the
Worker's 128 MB memory) is solved by uploading 5 MiB parts and streaming,
not by compressing. A case discussion is typically 3-15 minutes (6-30 MB).
Compression is the right move for a pilot with long meetings; it is listed
under risks.

**Progressive upload.** The client keeps today's per-case buffer but
flushes it as a part whenever it reaches exactly 5 MiB (163,840 samples
times 16, about 2.7 minutes of that case's speech). This keeps browser
memory flat, survives a tab crash with at most 2.7 minutes lost, and makes
the upload at approval small. Privacy trade-off, to state in
DATA-PROTECTION.md: audio reaches our storage during the discussion, not
only at approval. It already reaches ElevenLabs live, and the purge rules
below delete it on the same events as today.

**Parts and segments.** A case can be visited several times (`tx.audio` is
a list of segments with `wall` start times). The server needs the same
marks to place words in time. Each part request carries the segment starts
that fall inside it.

```sql
CREATE TABLE audio_uploads (
  id TEXT PRIMARY KEY,
  case_id TEXT NOT NULL REFERENCES cases(id),
  recording_id TEXT NOT NULL REFERENCES recordings(id),
  r2_key TEXT NOT NULL,                -- audio/<case_id>/<upload_id>.pcm
  r2_upload_id TEXT,                   -- R2 multipart id while open
  state TEXT NOT NULL CHECK (state IN ('open','completed','deleted','aborted')),
  bytes INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL, completed_at TEXT, deleted_at TEXT, delete_reason TEXT
);
CREATE TABLE audio_parts (
  upload_id TEXT NOT NULL REFERENCES audio_uploads(id),
  part_number INTEGER NOT NULL,        -- 1..10000
  etag TEXT NOT NULL, bytes INTEGER NOT NULL, is_final INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (upload_id, part_number)
);
CREATE TABLE audio_segments (
  upload_id TEXT NOT NULL REFERENCES audio_uploads(id),
  start_sample INTEGER NOT NULL,       -- offset in the upload, in samples
  wall_ms INTEGER NOT NULL,            -- when that segment was spoken
  PRIMARY KEY (upload_id, start_sample)
);
```

**Routes.**

- `PUT /api/cases/:id/transcript/audio/parts/:n?recording_id=…&final=0|1`,
  body `application/octet-stream`, header `X-Audio-Segments:
  [{"start_sample":0,"wall_ms":…}]` (JSON, at most 4 KB).
  - Same checks as the lines route (recording running, case in agenda,
    not closed, no approval yet). A part after approval is refused with
    `case_approved`, so the client flushes the final part before it posts
    the approval.
  - The first part creates the `audio_uploads` row and calls
    `FILES.createMultipartUpload(key)`. Later parts use
    `resumeMultipartUpload(key, r2_upload_id)` and wrap every call in
    error handling (the R2 docs warn the object does not prove an active
    upload).
  - Size rule (R2 multipart): every part except the last is exactly
    5,242,880 bytes; the final part may be smaller and must be even (whole
    samples). `Content-Length` is required; the body is streamed straight
    into `uploadPart`, never buffered beyond the part.
  - Idempotency: the same `n` again replaces the part (R2 allows re-upload
    of a part number) and the `audio_parts` row is upserted with the new
    etag. Part numbers must be contiguous from 1 when the upload completes.
  - Cap: `AUDIO_MAX_MINUTES_PER_CASE` (default 120). Over the cap the
    server refuses with `audio_too_long`; the client stops keeping audio
    for that case and shows "Zvuk případu přesáhl limit, rozlišení mluvčích
    proběhne jen pro prvních 120 minut." Live lines continue.
  - Per-user rate limit (step 4's limiter): 30 parts a minute.
  - No audit entry per part; one on the first part ("AI záznam: zvuk
    případu se ukládá dočasně").
- There is no "complete" route. The Workflow completes the multipart
  upload itself from the `audio_parts` rows, so a tab closed right after
  approval still gets its speaker pass for the parts that arrived.

**Key layout and storage.**

- `audio/<case_id>/<upload_id>.pcm` in the EU-jurisdiction bucket from
  step 2 (binding `FILES`). Case IDs are pseudonymous; no name, birth
  number or session date in the key.
- No custom metadata on the object (it would be one more copy of the
  segment times).
- Encryption: R2 encrypts every object at rest by default with keys
  Cloudflare manages. Optional hardening, to verify before use: SSE-C
  (customer-supplied key per object) through the Workers binding, with a
  random key per upload held only in D1. Deleting the D1 row then makes a
  forgotten object unreadable. Not needed for synthetic audio; listed so
  the pilot design can pick it up.

**Purge (server side `recPurge`).** One function
`audioStore.purgeCase(caseId, reason)`:

- `open` upload: `abort()` the multipart upload, state `aborted`.
- `completed` upload: `FILES.delete(key)`, state `deleted`.
- Sets `delete_reason`, writes the audit entry "AI záznam: zvuk smazán bez
  rozlišení mluvčích (<reason>)" when something was deleted, and marks a
  pass that had not finished as `purged`.

Called from:

- `POST /api/cases/:id/status` when the new status is `closed` (today
  line 1214, `recPurge([p.file], "případ uzavřen")`);
- the session-end route, for every case of the session that has no
  approval (today `endsession`, `recPurge(Object.keys(S.rec.tx), "konec
  MDT")`). Approved cases are handled by their Workflow;
- the reset-demo admin action (deletes the whole `audio/` prefix);
- the cron sweep below.

**Cron sweep** (`triggers.crons: ["*/15 * * * *"]`, `scheduled()` handler):
deletes or aborts any upload that is (a) not `deleted`/`aborted` and older
than 6 hours, or (b) belongs to a case whose pass reached a terminal state,
or (c) belongs to a recording whose session ended. Each deletion is
audited with reason `kontrola uchování`.

**Lifecycle backstop** (R2 lifecycle rules, set by a script
`api/scripts/r2-lifecycle.json` applied with `wrangler r2 bucket lifecycle
set`):

```json
{ "rules": [
  { "id": "audio-expire-1d", "enabled": true, "conditions": { "prefix": "audio/" },
    "deleteObjectsTransition": { "condition": { "type": "Age", "maxAge": 86400 } } },
  { "id": "audio-abort-mpu-1d", "enabled": true, "conditions": { "prefix": "audio/" },
    "abortMultipartUploadsTransition": { "condition": { "type": "Age", "maxAge": 86400 } } }
] }
```

The exact JSON field names follow the lifecycle API's request body; check
them against `wrangler r2 bucket lifecycle list` after applying. Rules are
in whole days and R2 removes objects "typically within 24 hours" after
expiry, so the backstop is **at most about 2 days**. DATA-PROTECTION.md
"Meeting audio" changes to: audio is deleted when its speaker pass ends
(success or failure), when its case is closed or the seminar ends without
approval, by a check every 15 minutes for anything older than 6 hours, and
by a storage rule that removes any remaining audio within about 2 days.

### 4. `SpeakerPassWorkflow`

**Start.** Step 4's approval route (`POST /api/cases/:id/decisions`), after
its D1 transaction commits:

1. Inserts `jobs` (`kind='speaker_pass'`, `state='queued'`) and
   `transcript_passes` (`state='queued'`, `cutoff_wall_ms` = decision
   time, `from_wall_ms` = previous pass cutoff or 0, `audio_upload_id` =
   the case's open upload or NULL).
2. Calls `env.SPEAKER_PASS.create({ id: 'sp-' + passId, params })`. The
   instance ID is derived from the pass, so a retried start cannot run the
   pass twice (`create` throws on a used ID).
3. Returns the decision plus `{ speaker_pass_job_id }`.

If `create` fails, the decision stands (approval must not depend on a
background job), the job is set to `error`/`start_failed`, and
`POST /api/cases/:id/transcript/passes/:passId/start` lets the client or
the cron sweep start it again with the same instance ID. If there is no
audio and no live line, no pass is created (today: `recAfterApprove` does
nothing).

Then step 4's existing logic for "all cases of the seminar approved" ends
the recording (`end_reason='all_approved'`); the client mirrors it with
`recStop`.

**Params** (ids only; the event payload is stored by the engine, so no
patient text goes in it):

```ts
type SpeakerPassParams = { caseId: string; passId: string; jobId: string; uploadId: string | null };
```

**Run outline** (`api/src/workflows/speaker-pass.ts`):

```ts
import { WorkflowEntrypoint, WorkflowEvent, WorkflowStep } from "cloudflare:workers";
import { NonRetryableError } from "cloudflare:workflows";

export class SpeakerPassWorkflow extends WorkflowEntrypoint<Env, SpeakerPassParams> {
  async run(event: WorkflowEvent<SpeakerPassParams>, step: WorkflowStep) {
    const p = event.payload;
    await step.do("mark running", fast, () => jobs.phase(this.env, p, "audio"));

    let basis: "speaker_pass" | "live_only" = "live_only";
    try {
      if (p.uploadId) {
        const audio = await step.do("finalize audio", fast, () => audioStore.finalize(this.env, p.uploadId));
        // { state: 'ready', bytes, seconds } | { state: 'purged' } | { state: 'empty' }
        if (audio.state === "ready" && audio.seconds >= 0.5) {
          await step.do("diarize", diarizeConfig, () => diarizeToStaged(this.env, p));
          await step.do("activate pass lines", fast, () => activatePass(this.env, p));
          basis = "speaker_pass";
        } else {
          await step.do("mark pass " + audio.state, fast, () => passes.set(this.env, p, audio.state === "purged" ? "purged" : "empty"));
        }
      } else {
        await step.do("mark pass empty", fast, () => passes.set(this.env, p, "empty"));
      }
    } catch (err) {
      await step.do("mark pass error", fast, () => passes.error(this.env, p, safeCode(err)));
    } finally {
      // Runs on success and on failure. A terminated instance skips it; the cron sweep and the lifecycle rule cover that.
      await step.do("delete audio", deleteConfig, () => audioStore.deleteForPass(this.env, p));
    }

    await step.do("summarize", summaryConfig, () => summarizeToDraft(this.env, p, basis));
    await step.do("finish", fast, () => jobs.done(this.env, p));
  }
}
```

Step rules followed (Cloudflare "Rules of Workflows"): fixed step names, no
state outside step results, every side effect inside a step, every step
idempotent.

**Step details.**

- **finalize audio.** Reads `audio_parts`; if the upload is `open`,
  checks contiguous part numbers, calls `complete(parts)`, sets
  `completed`. If already `completed`, returns its size (retry-safe). If
  `deleted`/`aborted` (purged meanwhile), returns `purged`. Seconds =
  bytes / 32,000.
- **diarize** (`diarizeToStaged`).
  - Streams the R2 object into a `multipart/form-data` body without
    buffering it: a `FixedLengthStream` of known total length gets the
    form preamble (`model_id=scribe_v2`, `language_code=cs`,
    `diarize=true`, `timestamps_granularity=word`,
    `file_format=pcm_s16le_16`, `temperature=0`, `seed` from config), the
    file part header, the R2 body stream, and the closing boundary. This
    keeps memory flat for long audio. Shared code with step 0's
    `services/elevenlabs.ts`.
  - Maps words to lines as `recPostPass` does: speaker IDs renumbered 0,1,2
    in order of first appearance per pass; each word's wall time from the
    last segment mark at or before its `start` (`audio_segments`); a new
    line when the speaker changes.
  - Writes the lines in one D1 `batch()`: first
    `DELETE FROM transcript_lines WHERE pass_id = ? AND state = 'staged'`,
    then the inserts with `state='staged'`. A retry after a partial write
    therefore starts clean.
  - Returns only `{ lineCount, speakerCount }`. Transcript text never
    becomes a step result, because the engine keeps step results for the
    instance retention period (30 days on Paid, 3 on Free; see risks),
    and because a one-hour transcript's word list would exceed the 1 MiB
    step result limit.
  - Error mapping: HTTP 429 and 5xx and network errors throw a retryable
    `Error("eleven:<status>:<retryAfterSeconds>")`; 400, 401, 403, 413,
    422 throw `NonRetryableError("eleven:<status>")`. The message carries
    only the status, never the provider's body (it may echo input).
- **activate pass lines** (`activatePass`), one D1 `batch()` (atomic):
  `UPDATE transcript_lines SET state='superseded', superseded_by_pass=?
  WHERE case_id=? AND source='live' AND state='current' AND wall_ms >
  from_wall_ms AND wall_ms <= cutoff_wall_ms`;
  `UPDATE transcript_lines SET state='current' WHERE pass_id=? AND
  state='staged'`; pass `done` with counts; audit "AI záznam: rozlišení
  mluvčích po schválení závěru". Re-running it changes nothing.
- **delete audio** (`deleteForPass`): `FILES.delete(key)` or `abort()`,
  upload `deleted`, pass `audio_deleted_at`, audit "zvuk smazán". Retries
  `limit: 10`, exponential from 5 s. If it still fails, the instance
  errors; the cron sweep retries and the lifecycle rule is the backstop.
  The job then shows `error`/`audio_delete_failed`, which is visible to
  the admin.
- **summarize** (`summarizeToDraft`).
  - Reads current lines for the case with `wall_ms <= cutoff_wall_ms`
    (speaker lines when the pass worked, live lines otherwise), builds the
    transcript exactly as `recSummarize` does (`Mluvčí N: …`).
  - No lines: summary `skipped`.
  - Over 40,000 characters (the existing `MAX_CHARS`): `error`,
    `transcript_too_long`, non-retryable. Never cut silently.
  - `input_sha = sha256(model + "\n" + prompt_sha + "\n" + transcript)`.
    Cache: `R2 cache/summary/<case_id>/<input_sha>.json`. Case-scoped
    prefix so a case's cache can be deleted with the case. Hit: use it.
  - Miss: call Azure OpenAI through step 1's `services/summary.ts`
    (endpoint and model from `AZURE_OPENAI_BASE`, `SUMMARY_MODEL`; prompt
    in the repo with its hash; the model accepts only its default
    temperature, as the existing comment says). In the Workflow the 429
    backoff is the step's retry policy, not an in-process sleep loop.
  - Writes `transcript_summaries` (`state='done'`, `basis`, model,
    `prompt_sha`, `input_sha`, `label='ai_draft'`), writes the R2 cache
    object, audits "AI záznam: shrnutí diskuse". Returns `{ summaryId }`.
  - The summary is never written into `protocols`, `decisions` or tasks.
    The approved conclusion already exists when it is made; the summary is
    shown beside the transcript as "Shrnutí AI · návrh".
- **mark pass error.** Records a safe code (`eleven_429`, `eleven_5xx`,
  `eleven_4xx`, `network`, `audio_missing`). The UI shows the code, not
  provider text.

**Retry policies.**

```ts
const fast = { retries: { limit: 3, delay: "2 seconds", backoff: "exponential" }, timeout: "1 minute" } as const;

const providerDelay = ({ ctx, error }) => {
  // eleven:429:30 or azure:429:12 -> honour Retry-After, else exponential, capped at 5 minutes
  const m = /:(\d{3}):(\d+)?$/.exec(error.message ?? "");
  const after = m?.[2] ? Number(m[2]) : 0;
  const expo = 10 * 2 ** (ctx.attempt - 1);
  return `${Math.min(300, Math.max(after, expo))} seconds`;
};
const diarizeConfig = { retries: { limit: 6, delay: providerDelay }, timeout: "20 minutes" };
const summaryConfig = { retries: { limit: 6, delay: providerDelay }, timeout: "3 minutes" };
const deleteConfig  = { retries: { limit: 10, delay: "5 seconds", backoff: "exponential" }, timeout: "1 minute" };
```

Defaults per the docs are `limit 5, delay 10 s, exponential, timeout 10
minutes`. A delay function receives `ctx.attempt` and the error. Whether
`backoff` also applies on top of a delay function is not documented;
the delay function computes the full wait itself and the test with
`disableRetryDelays` cannot check timing, so verify once on the deployed
Worker with a forced 429. Six attempts span about 10 minutes, enough for
the shared hackathon endpoint's short 429 bursts. The diarize timeout of 20
minutes covers an hour of audio; ElevenLabs states no maximum duration.

**Status reporting.**

```sql
-- jobs (from step 2), the columns this step relies on
CREATE TABLE jobs (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('speaker_pass','prognosis')),
  case_id TEXT NOT NULL REFERENCES cases(id),
  workflow TEXT NOT NULL,           -- binding name
  instance_id TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('queued','running','done','error')),
  phase TEXT,                       -- 'audio' | 'diarize' | 'summary' | 'search' | 'normalize'
  error_code TEXT, message_cs TEXT, -- safe text only
  result_ref TEXT,                  -- e.g. pass id or prognosis result key
  created_by TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
```

Each step updates `phase` and `updated_at`. `GET /api/jobs/:id`:

- checks the user may open `jobs.case_id` (membership, as every case route);
- returns `{ id, kind, state, phase, error_code, message_cs, result_ref, updated_at }`;
- when D1 says `queued`/`running` and `updated_at` is older than 2
  minutes, it also reads `env.<BINDING>.get(instance_id).status()`. If the
  engine reports `errored` or `terminated` (or `complete` but D1 was not
  updated), it reconciles the row to `error` with code
  `workflow_<status>` and never copies `error.message` into the response.
  Engine states map as: `queued` to queued; `running`, `waiting` to
  running; `complete` to done; `errored`, `terminated` to error;
  `paused`, `waitingForPause`, `unknown` to running with phase unchanged.

### 5. Frontend for the speaker pass

Changes in `v3-template.html` (or the recorder module once step 3 splits
it), only when `GET /api/health` answers; on Pages the old in-browser path
stays until the Worker replaces it.

- `recStart`: `POST /api/sessions/:day/recordings` first; keep the
  `recording_id` in `S.rec`. `recStop`: `PATCH /api/recordings/:id`.
- `recMessage`: give each new line a `client_line_id`
  (`crypto.randomUUID()`), push it to the case's send queue.
- `recChunk`: after pushing PCM for the case, if the case buffer reaches
  5 MiB, cut a part and upload it (sequential per case, retry with
  backoff). Segment marks: when a new segment starts, record
  `{ start_sample, wall_ms }` with the sample offset in the case's upload.
- Approve click (step 4's handler): `await recFlush(pid)` (lines queue and
  the final audio part with `final=1`), then post the decision. If the
  flush fails after its retries, approval still proceeds and the UI says
  "Část záznamu se nepodařilo uložit; rozlišení mluvčích proběhne z
  uloženého zvuku." Approval never waits on audio indefinitely (alerts
  inform, never block): the flush has a 15 s ceiling.
- `recAfterApprove` no longer calls `recPostPass`; it starts
  `jobPoll(job_id)` with the ID from the approval response and clears the
  case's in-memory audio (it now lives on the server).
- `jobPoll`: GET `/api/jobs/:id` every 2 s for the first 30 s, then every
  5 s, up to 30 minutes; stops on `done`/`error`; then
  `GET /api/cases/:id/transcript` replaces `tx.lines`, `tx.passes`,
  `tx.summary` and calls `recUI()`. Replies for a case no longer shown
  update the cache but do not render. On page load,
  `GET /api/cases/:id/transcript` lists passes with running jobs, and the
  page resumes polling them.
- `recPurge` client side only clears memory; the server purge runs inside
  the close and session-end routes.
- `recPostPass`, `wavOf` and the `/api/stt/diarize` call are removed from
  the API path (step 0's synchronous diarize route is then unused; remove
  it in this step, per Mechanism 3).

**UI states** (`recPassesHtml`), mapped from server pass and summary
states:

| Server state | Shown (Czech UI) | Today's equivalent |
|---|---|---|
| pass `queued`/`running`, job phase `audio`/`diarize` | "Rozlišuji mluvčí…" | `running` |
| pass `done` | speaker lines replace live lines | `done` |
| pass `empty` | nothing; summary from live lines | `empty` |
| pass `purged` | "Zvuk byl smazán bez rozlišení mluvčích (důvod)." | `purged` |
| pass `error` | "Rozlišení mluvčích selhalo (kód). Zvuk byl smazán, zůstává živý přepis." | `error` with retry button |
| summary `running` (job phase `summary`) | "Shrnuji diskusi…" | `running` |
| summary `done` | chip "Shrnutí AI · návrh", and when `basis='live_only'` the note "ze živého přepisu bez rozlišení mluvčích" | `done` ("Shrnutí AI") |
| summary `error` | "Shrnutí selhalo (kód)." | `error` |
| job `error`, code `start_failed` | "Zpracování se nespustilo. [Zkusit znovu]" (calls the start route) | none |

**Behaviour change to flag:** today a failed pass keeps the audio in
memory and offers "Zkusit znovu". The brief requires deleting audio in a
step that also runs on failure, so a manual retry is no longer possible;
the Workflow's own retries (6 attempts over about 10 minutes) replace it,
and the summary is made from the live lines. If the team prefers a manual
retry, the alternative is to keep audio after failure until the case
closes or the session ends (purge and cron still apply). That is a privacy
trade for convenience; listed as a team decision.

### 6. Prognosis

**What exists** (`prognosis/service.py`, 459 lines; `mocks/serve.py`;
`mocks/src/prognosis.js`):

- `profile_for(patient_id, scheduled_date)`: builds the dated, de-identified
  profile from fixture JSON (case 10, S01) and S01's markdown notes.
- `date_end`, `clean_text`, `safe_url`, `url_key`, `excerpt_citations`,
  `quoted`, `normalize_row`, `deduplicate`, `recover_complete_rows`,
  `check_provider_error`: pure functions, the trust logic.
- `remote_json`: urllib transport, no redirects, 240 s budget, 2 MB cap.
- `Service`: config, catalog check (1 h), one global non-blocking lock
  (`409 busy`), memory cache of 32 results, one model call, no retries.
- `prompt.txt`: checked-in prompt.
- Tests: `prognosis/tests/test_service.py` (175 lines).

**Routes (either implementation).** The client stops sending a file name
as `patient_id`; it sends the case ID, and the server maps it to the
fixture.

- `GET /api/prognosis/config`: same shape as today (`configured`,
  `available`, `models`, `synthetic_only`, `max_model_calls: 1`), plus
  `cache: "r2"`.
- `GET /api/cases/:id/prognosis/profile?scheduled_date=YYYY-MM-DD`:
  preview, no model call. Refuses a date that is not the case's slot day
  (today the client always sends the slot day; the server now enforces
  it).
- `POST /api/cases/:id/prognosis` `{ scheduled_date, refresh }`:
  - validates exactly as `Service.run` does (unknown fields, `refresh`
    boolean, supported case);
  - computes the cache key; on a hit without `refresh`: `200 { result,
    cache_hit: true }`, no job;
  - takes the single-flight lock; if held: `409 { error: { code: "busy",
    message_cs: "Již probíhá hledání. Vyčkejte na výsledek." }, job_id }`
    so the second user can follow the running job;
  - inserts a `jobs` row, creates `PrognosisWorkflow` with
    `id = 'pg-' + jobId`, returns `202 { job_id }`;
  - audits "spustil(a) rešerši prognózy ze syntetických podkladů" (moves
    from the client's `logAccess`).
- `GET /api/jobs/:id`: shared with the speaker pass.
- `GET /api/cases/:id/prognosis?scheduled_date=…`: the latest stored
  result for that case and date (from `prognosis_results`, then R2), so a
  reload or another device sees it.

**Storage.**

```sql
CREATE TABLE prognosis_results (
  id TEXT PRIMARY KEY, case_id TEXT NOT NULL, scheduled_date TEXT NOT NULL,
  cache_key TEXT NOT NULL, r2_key TEXT NOT NULL,     -- cache/prognosis/<case_id>/<cache_key>.json
  status TEXT NOT NULL,                              -- 'success' | 'partial' | 'error'
  model TEXT NOT NULL, prompt_sha TEXT NOT NULL, searched_at TEXT NOT NULL, job_id TEXT NOT NULL
);
CREATE TABLE locks (
  scope TEXT PRIMARY KEY,      -- 'prognosis' (global, like today's threading.Lock)
  holder TEXT NOT NULL,        -- job id
  expires_at TEXT NOT NULL
);
```

- The R2 object holds the normalized result exactly as `Service.run`
  returns it (profile, models, rows, warnings, `searched_at`). Only
  results with at least one `success`/`partial` model are cached, as
  today. Results are synthetic-only, so a lifecycle rule of 30 days on
  `cache/prognosis/` plus deletion on demo reset is enough. This changes
  the documented retention ("memory-only cache") in DATA-PROTECTION.md,
  `prognosis/README.md` and PROGNOSIS.md; update all three.
- **Single-flight lock in D1**, not a Durable Object: one statement,
  `INSERT INTO locks(scope, holder, expires_at) VALUES ('prognosis', ?, ?)
  ON CONFLICT(scope) DO UPDATE SET holder=excluded.holder,
  expires_at=excluded.expires_at WHERE locks.expires_at < ?`, then
  `meta.changes === 1` means acquired. Expiry 8 minutes (the 240 s model
  budget plus margin), so a crashed instance cannot block searches
  forever. Released in the Workflow's `finally` step (`DELETE ... WHERE
  holder = ?`). Global scope keeps today's credit protection; a per-case
  scope is a one-word change if the team wants it. A Durable Object would
  give the same guarantee with more code; D1 is enough at this volume.

**Workflow outline** (same for both implementations):

1. `load profile`: build profile from the fixtures (seeded into R2 under
   `fixtures/` in step 2), compute `evidence_cutoff`. Returns the profile
   (a few KB, already de-identified; it is the data the user sees in the
   preview).
2. `resolve model`: catalog lookup, cached in R2
   `cache/openrouter-catalog.json` for 1 h. Retry policy `fast`.
3. `search and normalize`: one OpenRouter call plus everything after it
   (citations, row normalization, dedupe, truncated-row recovery), then
   write the normalized result to R2 and `prognosis_results`. Returns
   `{ resultKey, status }` only: the raw response may be 2 MB, above the
   1 MiB step result limit, and must not be stored by the engine.
   - Timeout `6 minutes`.
   - **Retries, team decision needed.** The README promises "no automatic
     model retries, including on HTTP 429, to preserve the requested
     one-call limit"; CLAUDE.md requires retry with backoff on 429. A 429
     means the provider refused the request before doing paid work, so
     retrying it does not break "one paid call". Proposed: retry only on
     HTTP 429 and on 503 before a response body arrived (limit 3,
     `providerDelay`); throw `NonRetryableError` for every other failure,
     including timeouts and errors after a response began (those may have
     been billed). Then reword the README and PROGNOSIS.md line. Until the
     team agrees, set `limit: 0` for that step.
4. `finally` step `release lock` and `jobs` update.

**Frontend (`mocks/src/prognosis.js`) changes.**

- `pgJson`: POST timeout drops from 330 s to 45 s; the "requires the local
  server" message becomes "Vyhledávání vyžaduje server aplikace." when
  `/api/health` is absent.
- `pgLoad`: profile URL becomes
  `/api/cases/${caseId}/prognosis/profile?scheduled_date=…`; on load also
  `GET /api/cases/:id/prognosis?scheduled_date=` so a stored result shows
  (labeled with its `searched_at`).
- `pgSearch`: POST returns `200` (cache hit, show at once), `202 { job_id }`
  (store `state.jobId`, start `pgPoll(key, jobId)`), or `409` with
  `job_id` (follow that job, show "Již probíhá hledání"). Remove the
  client `logAccess` (the server audits).
- `pgPoll`: every 3 s, up to 8 minutes; on `done` fetch the result; on
  `error` show `message_cs`. The poll is keyed by `pgKey(p)` (file and
  slot day), so a late result for another patient or date still cannot
  replace the displayed search; moving the slot abandons the poll.
- The saved case-10 replay (`SAVED_PROGNOSIS`) is unchanged and still
  labeled as a saved search. Step 2 may move it to `api/seed/`; the
  2-second replay logic stays.
- Busy text stays: "Astra vyhledává studie a jejich výsledky. Hledání může
  trvat několik minut." A page reload now resumes the job instead of
  losing it.

**Prognosis: two options (pending, the user reads the code first).**

| | A. TypeScript port | B. Python Workers |
|---|---|---|
| Runtime | Same Worker as the rest of `api/` | Separate Python Worker (Pyodide), flags `python_workers` and `python_workflows`; called through a service binding or a cross-script Workflow binding (`script_name`) |
| What is reused | Logic re-expressed; prompt reused as is | The pure functions verbatim (`date_end` through `check_provider_error`, `normalize_row`, `recover_complete_rows`) |
| What must change anyway | Everything | `remote_json` (urllib does not run in Workers; use the runtime's `fetch`), `threading.Lock` and memory cache (replaced by D1 lock and R2 cache), `Path` reads of fixtures (bundled modules or R2), `os.environ` (env binding), `load_env` |
| Tests | Vitest with Workflow introspection, one CI job | Existing `unittest` suite keeps running in CPython for the pure functions; the Worker wiring needs its own tests; two toolchains |
| Risks | Porting subtle Python semantics (list below) | Python Workflows' maturity and status are not stated in the docs; cold start of Pyodide; packaging; fewer examples; a second deploy target |
| Effort | about 1.5-2 days with parity tests | about 1-1.5 days if the runtime cooperates, unknown otherwise |

Recommendation (pending): **A, the TypeScript port**, because the backend
is one TypeScript Worker with one test harness, and the parts that are
hard to port can be pinned down by a parity test against the Python code.
B is the better choice if the user values keeping `service.py` as the one
reviewed source of the trust logic more than a single runtime.

**Outline of the TypeScript port** (`api/src/services/prognosis/`,
mirroring `service.py`):

| Module | Ports | Porting notes |
|---|---|---|
| `dates.ts` | `date_end` | Use UTC dates; month end via `new Date(Date.UTC(y, m, 0))`; reject `31.2.2026` explicitly (JS `Date` rolls over, Python raises). Range split regex needs the `u` flag for `až` and `–`. |
| `text.ts` | `clean_text` | Python `\w` is Unicode, JS `\w` is ASCII: use `[\p{L}\p{N}_]` with `u`. `re.I` with names: use `iu`. Escape names with a real regex escape. Truncate by code points, not UTF-16 units, to match `text[:4000]`. |
| `profile.ts` | `profile_for` | Reads fixtures through the store (R2 `fixtures/…`) instead of files; same fields, same order of facts, same warnings text. Embedded-date regex `(?<![\d])…(?![\d])` works in JS. |
| `urls.ts` | `safe_url`, `url_key` | WHATWG `URL` differs from `urlsplit`: it lowercases and punycodes hosts, drops default port 443 (so the `port in (None,443)` test becomes `port === ''`), and rejects some inputs `urlsplit` accepts. Query re-encoding: `urlencode` (quote_plus) vs `URLSearchParams`: both use `+` for space, but differ for `~`, `*` and `'`; write `quotePlus` explicitly. |
| `citations.ts` | `excerpt_citations`, `quoted` | Whitespace collapse `\s+`: Python and JS differ on a few Unicode spaces; use `/\s+/gu` and test a non-breaking space. |
| `normalize.ts` | `ENDPOINTS`, `WEIGHTS`, `normalize_row` | Python's `isinstance(x, int)` excludes floats and treats `bool` specially: use `Number.isInteger` and `typeof x === 'boolean'` checks. NaN and Infinity checks. Number regex with Unicode `\w` lookarounds. `round()` is banker's rounding in Python: `round(numerator/known*100)` must use round-half-even to match. |
| `dedupe.ts` | `deduplicate` | `casefold()` vs `toLowerCase()` (differs for `ß`); use `toLowerCase()` plus `normalize('NFKC')` and document the difference, or port a minimal casefold. Deep copy with `structuredClone`. |
| `recover.ts` | `recover_complete_rows` | Hardest part. JS has no `JSONDecoder.raw_decode`. Write a small scanner that finds the end of one JSON value (strings with escapes, nesting depth), then `JSON.parse` that slice. Must reproduce: stop quietly only at a genuinely unfinished suffix or unterminated string; reject invalid tokens and junk; 40-row cap. |
| `provider.ts` | `remote_json`, `check_provider_error` | `fetch` with `redirect: "manual"` (any 3xx is `redirect`), `AbortSignal.timeout(240_000)` for the call and 30 s for the catalog, stream reader counting bytes to the 2,000,000 cap. Same allowlisted Czech error categories. |
| `search.ts` | `Service.config`, `resolve_models`, the `call` closure | Payload identical: `openrouter:web_search` tool with `exa`, `max_uses 4`, `max_results 5`, `max_total_results 20`, `max_tokens 14000`, `max_tool_calls 4`, `response_format json_object`, `provider { allow_fallbacks: false, data_collection: "deny" }`, `temperature 0` when supported, reasoning effort only when advertised. Grounding check on `web_search_requests >= 1`. |
| `prompt.ts` | `PROMPT` | `import PROMPT from "../../../../prognosis/prompt.txt"` with a Wrangler `rules` entry `{ type: "Text", globs: ["**/*.txt"] }`, so `prognosis/prompt.txt` stays the one copy. Store `prompt_sha` with each result. |
| `workflow.ts` | `Service.run` | Split into the steps above; cache key `sha256` of the same four inputs (`profile`, `models`, prompt, effort). The key will not equal Python's byte for byte (JSON separators differ); that is fine, since the caches are separate. |

Parity check: a script `prognosis/tests/export_golden.py` feeds a fixed set
of synthetic provider responses (the ones `test_service.py` already
builds, plus truncated and malformed variants) through `service.py` and
writes inputs and outputs to `api/test/fixtures/prognosis-golden/*.json`.
The TypeScript test runs the same inputs and compares outputs field by
field (ignoring `searched_at`). This is the evidence that the port says
what the Python code says.

### 7. Secrets and configuration

Secrets (`wrangler secret put`; locally `api/.dev.vars`, gitignored):

- `ELEVENLABS_API_KEY` (step 0), `AZURE_OPENAI_KEY` (step 1),
  `OPENROUTER_API_KEY` (new to the Worker).

Plain variables in `wrangler.jsonc` (and `.env.example` kept in step):

| Variable | Default | Used by |
|---|---|---|
| `ELEVENLABS_BATCH_MODEL` | `scribe_v2` | diarize |
| `STT_LANGUAGE` | `cs` | diarize |
| `ELEVENLABS_SEED` | `1` | diarize (best-effort determinism) |
| `AZURE_OPENAI_BASE` | the APIM base URL | summary (step 1) |
| `SUMMARY_MODEL` | `gpt-6-luna-dz-eu` | summary (step 1) |
| `OPENROUTER_MODEL_ASTRA` | from `.env.example` | prognosis |
| `OPENROUTER_REASONING_EFFORT` | `low` | prognosis |
| `AUDIO_PART_BYTES` | `5242880` | upload route, client gets it from `/api/health` |
| `AUDIO_MAX_MINUTES_PER_CASE` | `120` | upload route |

Bindings:

```jsonc
"workflows": [
  { "name": "codebridge-speaker-pass", "binding": "SPEAKER_PASS", "class_name": "SpeakerPassWorkflow" },
  { "name": "codebridge-prognosis", "binding": "PROGNOSIS", "class_name": "PrognosisWorkflow" }
],
"triggers": { "crons": ["*/15 * * * *"] },
"rules": [ { "type": "Text", "globs": ["**/*.txt"] } ]
```

Option B adds a second Worker with its own `wrangler.jsonc`,
`compatibility_flags: ["python_workers", "python_workflows"]`, its own
`OPENROUTER_API_KEY` secret, and a `script_name` on the `PROGNOSIS`
binding.

**Instance retention.** The limits page says completed-instance state is
kept 30 days on Paid (3 on Free) and "can be shortened per binding or
instance". The design keeps patient text out of step results and params
anyway; still set the shortest retention the configuration allows and
record the key name once verified.

**Plan.** Workers Free gives a step 10 ms of CPU. The prognosis normalize
step (parsing up to 2 MB of JSON, regex checks) and the multipart body
assembly will exceed that. Step 5 needs Workers Paid ($5 a month, 30 s
CPU per step). Confirm the account plan before starting.

## Tests

All in `api/test/` with `@cloudflare/vitest-pool-workers` (D1 and R2 run
locally in Miniflare). Workflow tests use `introspectWorkflowInstance` and
`introspectWorkflow` from `cloudflare:test` with `await using` (dispose is
needed for isolation), `disableRetryDelays`, `mockStepError`,
`mockStepResult`, `waitForStatus`, `waitForStepResult`, `getOutput`,
`getError`. Outbound calls to ElevenLabs, Azure and OpenRouter are mocked
at `fetch` (the mechanism the pinned pool version supports, `fetchMock` or
MSW). All transcripts are synthetic Czech text with typos and Latin terms,
no real speech.

Transcript and audio routes:

- lines accepted while recording; duplicate `client_line_id` returns
  `duplicate`; batch over 100 lines or 64 KB refused;
- refused without a running recording, for a case outside the session
  agenda, for a closed case;
- after approval: a line with `wall_ms` before the decision accepted, after
  it refused; a line covered by a `done` pass refused;
- audio part size rule (non-final not 5 MiB, odd final, gap in part
  numbers at completion); replaced part keeps the newest etag; part after
  approval refused; cap refused with `audio_too_long`;
- purge on `closed` and on session end aborts open uploads and deletes
  completed ones, writes audit rows, marks the pass `purged`;
- cron sweep deletes an upload older than 6 hours.

`SpeakerPassWorkflow`:

- happy path: lines staged, live lines up to the cutoff superseded, later
  live lines kept, speakers numbered from 0 in order of appearance, wall
  times from segment marks across two visits, audio object gone, summary
  `done`, `basis='speaker_pass'`, label `ai_draft`, decision row
  unchanged;
- 429 twice then 200: completes, ElevenLabs called three times;
- 401: no retries (`NonRetryableError`), pass `error`, audio deleted,
  summary from live lines with `basis='live_only'`;
- re-run of `activate pass lines` and `diarize` (mock a failure after the
  write): no duplicate lines;
- audio purged while the instance waits: pass `purged`, no ElevenLabs
  call, summary from live lines;
- no audio, no lines: no pass created by the approval route;
- summary cache hit: no Azure call; 429 then success; transcript over
  40,000 characters gives `transcript_too_long` and no call;
- step results contain no transcript text (assert on
  `waitForStepResult` values);
- `GET /api/jobs/:id`: membership check; reconciliation of an errored
  instance; no provider message in the response.

Prognosis (either option):

- port of every case in `prognosis/tests/test_service.py` (option A), or
  the existing suite unchanged plus Worker wiring tests (option B);
- golden parity tests (option A);
- Workflow: cache hit returns 200 without a job; busy lock returns 409
  with the running `job_id`; lock expires; lock released on failure;
  non-429 failure is not retried; result over 1 MiB does not pass through
  a step result; provider error text is reduced to the allowlisted
  category.

Frontend (recorded browser check, per CLAUDE.md "Match the evidence to the
risk"):

- record a synthetic Czech discussion across two cases and back, approve
  the first, watch "Rozlišuji mluvčí…", then speaker lines and "Shrnutí AI
  · návrh"; reload mid-pass and see polling resume; end the session and
  check in the admin access log that the other case's audio was deleted;
- prognosis: start a search, reload, see it resume; second browser gets
  "Již probíhá hledání"; saved case-10 replay unchanged.

## Acceptance criteria

- [ ] No ElevenLabs, Azure or OpenRouter key in any file the browser loads;
      `grep` of the built assets finds none.
- [ ] `POST /api/cases/:id/transcript/lines` stores live lines, is
      idempotent, and refuses lines for closed, off-agenda or approved
      cases with Czech messages; reload shows the stored transcript.
- [ ] Lines and audio are refused when no recording was switched on.
- [ ] Audio uploads in 5 MiB parts during the discussion; browser memory
      stays flat over a 20-minute synthetic recording.
- [ ] Approval starts `SpeakerPassWorkflow`; approval succeeds even when
      the start or the audio flush fails.
- [ ] After the pass, speaker lines replace the live lines up to the
      approval time; lines after it are kept.
- [ ] Audio object is gone after success, after a forced ElevenLabs
      failure, after case close, and after session end; each has an audit
      entry.
- [ ] R2 lifecycle rules for `audio/` are applied and listed; the backstop
      period is written into DATA-PROTECTION.md.
- [ ] A forced 429 from ElevenLabs and from Azure is retried with backoff
      and the job completes.
- [ ] The summary is stored as `ai_draft`, shown as "Shrnutí AI · návrh",
      never written into the conclusion or decision; the same transcript
      a second time is served from the R2 cache.
- [ ] `GET /api/jobs/:id` reports `queued`/`running`/`done`/`error` with a
      phase, reconciles a dead instance, and returns no provider text.
- [ ] No transcript text, audio bytes or prompt appears in Workflow params
      or step results.
- [ ] Prognosis runs as `PrognosisWorkflow`; the browser polls; a reload
      resumes; a concurrent start gets 409 with the running job; the
      cache lives in R2.
- [ ] Prognosis results for case 10 and S01 match the Python service on
      the golden fixtures (option A) or the existing suite passes
      (option B).
- [ ] The saved case-10 replay still plays after 2 s, labeled as saved.
- [ ] TS or Python decision recorded in the research note's "Decisions"
      section and in OPEN_QUESTIONS.md removed; the 429-retry wording for
      prognosis agreed and reflected in README and PROGNOSIS.md.
- [ ] Docs updated in the same change: DATA-PROTECTION.md (meeting audio,
      prognosis cache), `prognosis/README.md`, PROGNOSIS.md,
      TECHNOLOGIES.md and HACKATHON.md (Workflows, R2 multipart),
      `.env.example`, README run instructions; `mocks/serve.py` either
      kept as the offline path (and said so) or removed.
- [ ] A separate agent has reviewed the change adversarially (Mechanism
      4: it changes what the doctor sees and handles patient audio).

## Risks

- **Long audio and ElevenLabs.** No stated maximum duration; one call for
  an hour of audio may take many minutes. The 20-minute step timeout is a
  guess. Fallback: ElevenLabs `webhook=true` plus `step.waitForEvent()`
  and a signed webhook route; more moving parts, not built now.
- **Raw PCM size.** 115 MB an hour is fine for R2 but slow on a weak
  conference-room uplink (about 0.25 Mbit/s sustained, fine; but bursts
  when a part is cut). For a pilot, Opus via WebCodecs is the next step.
- **Deleting on failure removes the manual retry** (a visible behaviour
  change). Team decision; alternative described in section 5.
- **Terminated instances skip `finally`.** Covered by the cron sweep and
  the lifecycle rule; the backstop can leave audio up to about 2 days in
  the worst case.
- **Workflow retention keeps step data for up to 30 days.** Mitigated by
  keeping text out of params and results; verify the retention setting.
- **Delay function semantics** (whether `backoff` composes with a delay
  function) are not documented; verify with a forced 429.
- **Free plan CPU limit** (10 ms per step) will break the prognosis step;
  needs Workers Paid.
- **Port fidelity (option A).** Unicode regex classes, `casefold`,
  banker's rounding, URL parsing, and the `raw_decode` scanner are the
  places a port silently drifts. The golden parity test is the guard.
- **Python Workers maturity (option B).** Docs do not state Python
  Workflows' status or limits; a second toolchain and deploy target.
- **Prognosis 429 policy** conflicts between CLAUDE.md and the README's
  "no automatic retries" promise; needs an explicit team call.
- **Shared rate-limited endpoints during the demo.** Summary and prognosis
  results for the demo cases are cached in R2; warm the cache before the
  demo.
- **Residency.** The Workflow engine stores instance state in Cloudflare's
  infrastructure without a documented EU jurisdiction setting; another
  reason to keep patient text out of step results. Synthetic data only.
- **Second schema change to `transcript_lines`** if step 2 shipped a
  simpler shape; the migration here must update seed data and any reader.

## Effort

| Part | Estimate |
|---|---|
| Recordings, lines route, transcript GET, client batching | 0.5 day |
| Audio parts route, D1 bookkeeping, purge, cron, lifecycle rules | 0.5-0.75 day |
| `SpeakerPassWorkflow`, jobs route, summary move, tests | 0.75-1 day |
| Frontend polling and UI states, browser check | 0.25-0.5 day |
| Prognosis, option A (port, golden parity, Workflow, frontend) | 1.5-2 days |
| Prognosis, option B (Python Worker wiring, Workflow, frontend) | 1-1.5 days, plus unknown runtime risk |
| Docs, review agent, fixes from review | 0.25-0.5 day |
| **Total** | **about 3.5-5 days** |

This is above the plan's 2-3 days for step 5. The speaker pass half (about
2-2.75 days) can merge on its own first; prognosis can follow on its own
branch, and until then the deployed page keeps the saved case-10 replay.

## As implemented

Status: part (a), the speaker pass, built on the `backend` branch,
2026-10-17 (issue #6). Part (b), prognosis, is not built: the user decides
between the TypeScript port and Python Workers first. This section records
where the build differs from the design above, which was written before
steps 2 to 4 existed, and the contract the page uses.

### Differences from the design

- **Migration 0004 replaces three step 2 tables.** `transcript_passes`,
  `transcript_lines` and `jobs` from `0001_init.sql` never held rows, so
  `0004_speaker_pass.sql` drops and recreates them in the shapes above and
  adds `recordings`, `transcript_summaries`, `audio_uploads`,
  `audio_parts` and `audio_segments`. Reset-demo and `seed.py` list the new
  tables (reset batch: 48 statements with today's seed, under the limit of 50 that `api/AGENTS.md` names).
- **Recordings without a seminar.** The page records a case outside a
  running seminar too (`recTarget()`), so the route is
  `POST /api/recordings { session_day | null, case_id }`, not
  `/sessions/:day/recordings`. With a day, the seminar must be running and
  only its agenda's cases take lines and audio; without one, any open case
  the recorder may access does. `PATCH /api/recordings/:id { end_reason }`
  ends it (`stopped`, `all_approved`, `failed`); the session-end route ends
  the seminar's recordings with `session_end`.
- **Who may store transcript data.** Instead of the attendance rule: the
  role may run the meeting (`recording.write` and `transcript.write`:
  doctor or coordinator), a doctor must be on the case's team (or hold a
  break-the-glass grant), and only the user who started the recording may
  post lines and audio for it (`not_recorder`), so a second browser cannot
  write into someone else's recording.
- **Recording windows.** Lines are accepted up to 60 s after the recording
  ended; audio parts are not accepted once it ended (the page sends its
  last part before it ends the recording, and a seminar's end has already
  deleted the audio a later part would join). Line times must lie within
  the recording (with two minutes of clock skew either side).
- **A pass replaces only what its audio covers.** The design superseded
  every live line up to the approval. The diarize step now stores the
  wall-time intervals its audio covers (`transcript_passes.covered_json`:
  each visit mark to the next one or the end of the audio, with 1.5 s of
  slack), and activation supersedes only live lines inside them. Speech
  whose audio never arrived (a final part slower than the 15 s flush, a
  lost part, the cap, a closed tab) keeps its live lines and goes into the
  summary. Found by the adversarial review: without it the end of the
  discussion, often the conclusion, vanished silently.
- **Late lines after approval.** A line is refused when a finished pass's
  covered intervals hold its time (`covered_by_pass`), or when the protocol
  is approved and the line was spoken after the latest decision
  (`case_approved`). After "Nový závěr" the case takes lines again. A
  malformed line is refused alone (`invalid`), not the whole batch.
- **One upload per case and recording, several per pass.** A case can be
  discussed across two recordings (stopped and started again), so an
  upload belongs to a case and a recording, and approval claims all open
  uploads of the case (`audio_uploads.pass_id`). The diarize step streams
  them one after the other as one audio, so speakers are numbered across
  the whole discussion, and each upload's visit marks are shifted onto the
  joined timeline.
- **The part body is read into memory.** One part is at most 5 MiB and R2's
  `uploadPart` needs a known length, so the route reads the body
  (`arrayBuffer`) after checking `Content-Length`, instead of piping it.
  The diarize step does stream from R2.
- **The audio part route bypasses the JSON check.** The write middleware
  requires `application/json` for every write; `PUT
  .../transcript/audio/parts/:n` requires `application/octet-stream`
  instead and keeps the data-epoch check and the refusal logging.
- **Pass and job rows are written in the approval batch.** The design
  inserted them after the commit. The route decides before the batch
  whether there is anything to process (open uploads, or live lines after
  the previous pass's cutoff), adds the `jobs` and `transcript_passes` rows
  and claims the uploads in the same batch as the decision, and names the
  job in the answer (`speaker_pass_job_id`), so an idempotent replay
  carries the same job id. The job id, the pass id and the first instance
  id are all `sp-<decision id>`. The Workflow starts after the commit; a
  failed start leaves the job `error`/`start_failed`.
- **Retry route.** `POST /api/jobs/:id/retry` instead of
  `.../passes/:passId/start`. A `start_failed` job starts again under the
  same instance id; a failed pass whose audio was kept runs again as a new
  instance `<job id>-<attempt>` (guarded on the attempt number, so a double
  click starts one). The cron sweep also restarts `start_failed` jobs.
- **Speaker pass on failure is a setting.** The open question
  "Speaker pass on failure" is not decided, so both behaviours exist behind
  `SPEAKER_PASS_AUDIO_ON_FAILURE`: `keep_until_close` (default, today's page
  behaviour: the failed pass keeps its audio for "Zkusit znovu" until the
  case closes, the seminar ends, the six-hour sweep or the lifecycle rule)
  or `delete` (the pass's last step deletes it whatever happened). The value
  is copied onto the pass row when the approval plans it
  (`transcript_passes.audio_on_failure`), so changing the setting does not
  change a running pass. An unknown value means `delete`.
- **No words, no replacement.** When ElevenLabs returns no words (silence),
  the pass ends `empty` and the live lines stay; the page's old path
  replaced them with nothing.
- **A new line per visit.** Speaker lines split on a speaker change, where a
  new visit to the case starts (so a line's time is when its first word was
  spoken), and after about 2000 characters of one voice.
- **Retry delays.** The provider steps set `backoff: "constant"`: the delay
  function computes the whole wait, and with the default `exponential` the
  engine multiplies its result by 2^(attempt-1) again (miniflare's
  `calcRetryDuration`), which stretched six attempts to hours.
- **A failed start marks the pass too** (`error`/`start_failed`), so the page
  offers "Zkusit znovu" and the seminar's end and the sweep treat its audio
  as not in use.
- **Audio part guards.** The part's batch re-checks the case is not closed,
  the recording has not ended and its seminar still runs; an upload the
  request created is aborted when the batch is refused. A storage error
  while the upload is still open answers 503 (the page retries) instead of
  a final refusal.
- **Summary scope.** The summary covers this pass's window only
  (`from_wall_ms < wall_ms <= cutoff_wall_ms`), so a second MDT of the case
  gets its own; nothing is summarized for a closed case or a pass removed by
  reset-demo.
- **Summary after a failed pass.** The design's summary step always runs:
  after a failed pass the summary is made from the live lines
  (`basis = 'live_only'`, shown as "ze živého přepisu bez rozlišení
  mluvčích"); a later successful retry makes a second draft. Each run writes
  one summary row (`sum-<instance id>`); the page shows the latest.
- **Model and prompt version.** The summary uses `AZURE_OPENAI_MODEL` (step
  1's variable, not a new `SUMMARY_MODEL`) and `summarize-cs@1`. The cache
  key is `sha256(model, prompt version, sha256(prompt), transcript)`.
- **Retention and placement.** `create()` passes `retention: {
  successRetention: "1 day", errorRetention: "3 days" }` and
  `locationHint: "weur"`. Step params are `{ caseId, passId, jobId }`; step
  results are ids, states and counts (checked in
  `api/test/transcript.test.ts`).
- **The synchronous `/api/stt/diarize` route stays.** The design removed it,
  but the page still uses it in embedded mode on the Worker (the database
  not seeded), so it is kept; its code now shares `diarizeUpstream` with the
  Workflow.
- **Health.** `features.transcripts` (seeded database and the Workflow
  binding) switches the page to the server recorder;
  `limits.audio_part_bytes` and `limits.audio_max_minutes` tell it the part
  size and the cap.

### Contract

| Route | Who | Answer |
|---|---|---|
| `POST /api/recordings` `{ session_day, case_id }` | doctor, coordinator | 201 `{ recording_id, started_at, part_bytes }` |
| `PATCH /api/recordings/:id` `{ end_reason, case_id }` | the recorder | `{ ended_at }`; a second stop changes nothing |
| `POST /api/cases/:id/transcript/lines` `{ recording_id, lines: [{ client_line_id, wall_ms, text }] }` (at most 100) | the recorder, on the case's team | `{ accepted, duplicate, rejected: [{ client_line_id, code }] }` |
| `PUT /api/cases/:id/transcript/audio/parts/:n?recording_id=&final=0\|1`, `application/octet-stream`, `X-Audio-Segments` | the recorder, on the case's team | `{ part, bytes, final }` |
| `GET /api/cases/:id/transcript` | clinical read (audited) | `{ lines, passes, summaries }` |
| `GET /api/jobs/:id` | case header read | `{ id, kind, state, phase, error_code, result_ref, attempt, updated_at }` |
| `POST /api/jobs/:id/retry` | doctor, coordinator on the team | the job |

Refusal codes: `no_recording`, `recording_ended`, `not_recorder`,
`session_not_running`, `not_on_agenda`, `case_closed`, `case_approved`,
`bad_audio_part`, `audio_too_long`, `job_not_found`, `not_retryable`. Pass
and summary error codes: `eleven_429`, `eleven_5xx`, `eleven_4xx`,
`network`, `audio_missing`, `audio_purged`, `azure_429`, `azure_5xx`,
`azure_4xx`, `transcript_too_long`, `start_failed`, `workflow_<status>`,
`internal`. The page maps them to Czech words; no provider text is stored
or sent.

### Audio deletion paths

| When | What | Audit line |
|---|---|---|
| Pass succeeded or found no audio | last step deletes or aborts the pass's uploads | "AI záznam: zvuk po rozlišení mluvčích smazán" |
| Pass failed, `delete` | same | "AI záznam: zvuk smazán po neúspěšném rozlišení mluvčích" |
| Case closed | every upload of the case (a waiting pass becomes `purged`) | "AI záznam: zvuk smazán bez rozlišení mluvčích (případ uzavřen)" |
| Seminar ended | uploads of its cases that no queued or running pass uses | "... (konec MDT)" |
| Reset-demo | open multipart uploads aborted, `audio/` and `cache/summary/` deleted | the reset line |
| Cron, every 15 min | uploads older than 6 hours; of a finished pass; of a failed pass in `delete` mode; of a recording whose seminar ended that no running pass uses (also kept failed audio); of a closed case | "AI záznam: zvuk smazán (kontrola uchování)" |
| R2 lifecycle on `audio/` | objects after 1 day, incomplete multipart uploads after 1 day | none (backstop) |

Close, seminar end and the cron sweep need only D1 and R2, not the feature
switch, so switching the recorder off never keeps audio.

### Deployment

The Workflow and the cron trigger are registered by `wrangler deploy` only.
CI's `wrangler versions upload --preview-alias backend` does not register
them, so a preview's approvals run the Workflow code of the last
`wrangler deploy`. Deploy with `npm run deploy` after changing the Workflow.

### Known limits

- Live line times and visit marks come from the browser's clock, the
  approval time from the server's; a browser clock far off shifts which
  lines a pass covers.
- A user switch while recording stops the recording; lines and audio not yet
  sent are dropped (the server takes data only from the user who started
  the recording), and the recording is ended by the seminar's end or stays
  open with nothing attached.
- A replayed approval does not start a job whose start was lost; the job
  page reconciles it to `start_failed` after two minutes and the cron sweep
  starts it.
- `seed.py --reset` does not delete R2 `audio/`; reset-demo and the
  lifecycle rule do.

### Frontend (server mode)

`recServer()` is true in API mode when `features.transcripts` is on; the
embedded path is unchanged. Each committed live line gets a
`client_line_id` and is queued; the queue goes every 2 s or at 20 lines,
retries with backoff, and drops lines the server refuses for good. The
case's audio is cut into exact 5 MiB parts while it is discussed; the tail
is sent as the final part on approval and on stop, and stays in memory
until the approval succeeds, so a failed approval resends the same part
number longer. Approval waits at most 15 s for the flush, then proceeds
with a toast. After approval the page polls `GET /api/jobs/:id` (2 s, then
5 s, up to 30 minutes) and then shows `GET /api/cases/:id/transcript`;
opening a case's "AI záznam" loads the stored transcript and resumes
polling a running pass. The server writes the recording's audit lines; the
page no longer sends them as view events in server mode.

### Checks

- `api/test/transcript.test.ts` (26 tests, Vitest with the Workflows test
  helpers, ElevenLabs and Azure mocked at fetch).
- `mocks/src/test/recorder-server.mjs` (jsdom, fake server).
- A browser run on `wrangler dev`: Chromium with a fake microphone playing
  the synthetic speech, real ElevenLabs realtime and batch, real Azure. Two
  live lines, one audio part, approval, "Shrnutí AI · návrh" on screen,
  speaker lines replacing the live lines, the audio deleted, no page errors.
- Deployed (`npm run deploy`, 2026-10-17; the account's plan accepted the
  Workflow and the cron trigger): remote D1 migrated, R2 lifecycle rules
  `audio-backstop-1d` and `summary-cache-30d` applied and listed, and the
  same API run against the deployed Worker on the shared demo case NO-020
  (no slot, chosen so the demo's main cases stay untouched): the instance
  completed in about 20 s, the audio object is gone, the access log has the
  recording lines, and `wrangler workflows instances describe` shows step
  outputs of ids, states and counts only.
- Local end-to-end run on `wrangler dev` with the real ElevenLabs and Azure
  endpoints and synthetic Czech speech from macOS `say -v Zuzana`: a
  recording, three live lines, two audio parts (5 MiB and 0.7 MB, two
  visits), approval, the Workflow (diarize, activate, delete audio,
  summary) in about 10 s, speaker lines replacing the live lines, the audio
  object gone, the summary stored as `ai_draft` and cached in R2; then a
  seminar's end deleting an unapproved case's audio and refusing a later
  part.
