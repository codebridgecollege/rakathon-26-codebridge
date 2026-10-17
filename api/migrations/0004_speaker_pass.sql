-- Step 5 (a): the AI recording on the server. Design: docs/research/backend-steps/step-5.md ("As implemented").
-- Live transcript lines and per-case audio are stored while a case is discussed; approval starts a speaker pass (a
-- Cloudflare Workflow) that replaces the live lines with speaker lines, deletes the audio and stores a summary draft.
-- The step 2 tables transcript_passes, transcript_lines and jobs never held rows (nothing wrote them before this step),
-- so they are replaced by the shapes this step needs.
PRAGMA defer_foreign_keys = true;
DROP TABLE IF EXISTS transcript_lines;
DROP TABLE IF EXISTS transcript_passes;
DROP TABLE IF EXISTS jobs;

-- One recording = one "Spustit záznam" until it stops. The server refuses lines and audio without one, so nothing is
-- stored unless recording was switched on explicitly (CLAUDE.md, meeting audio). session_day is NULL when a case is
-- recorded outside a running seminar.
CREATE TABLE recordings (
  id               TEXT PRIMARY KEY,
  session_day      TEXT CHECK (session_day IS NULL OR session_day GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  started_by       TEXT NOT NULL REFERENCES users(id),
  started_by_name  TEXT NOT NULL,
  started_at       TEXT NOT NULL CHECK (started_at GLOB '[0-9][0-9][0-9][0-9]-*Z'),
  ended_at         TEXT CHECK (ended_at IS NULL OR ended_at GLOB '[0-9][0-9][0-9][0-9]-*Z'),
  end_reason       TEXT CHECK (end_reason IS NULL OR end_reason IN ('stopped','all_approved','session_end','failed'))
);
CREATE INDEX recordings_session ON recordings(session_day);

-- A background job the page polls; it points to one Workflow instance. attempt counts manual retries: the instance id
-- is the job id for the first run and "<job id>-<attempt>" after, so a double click cannot start a second run.
CREATE TABLE jobs (
  id               TEXT PRIMARY KEY,
  kind             TEXT NOT NULL CHECK (kind IN ('speaker_pass','prognosis')),
  case_id          TEXT NOT NULL REFERENCES cases(id),
  workflow         TEXT NOT NULL,                 -- binding name, e.g. SPEAKER_PASS
  instance_id      TEXT NOT NULL,
  attempt          INTEGER NOT NULL DEFAULT 1 CHECK (attempt >= 1),
  state            TEXT NOT NULL CHECK (state IN ('queued','running','done','error')),
  phase            TEXT CHECK (phase IS NULL OR phase IN ('audio','diarize','summary','search','normalize')),
  error_code       TEXT,                          -- a fixed code, never provider text
  result_ref       TEXT,                          -- the pass id for a speaker pass
  created_by       TEXT NOT NULL,                 -- the approving doctor; the Workflow's audit rows name them
  created_by_name  TEXT NOT NULL,
  created_by_role  TEXT NOT NULL CHECK (created_by_role IN ('doctor','coordinator','admin')),
  created_at       TEXT NOT NULL CHECK (created_at GLOB '[0-9][0-9][0-9][0-9]-*Z'),
  updated_at       TEXT NOT NULL CHECK (updated_at GLOB '[0-9][0-9][0-9][0-9]-*Z')
);
CREATE INDEX jobs_case ON jobs(case_id, created_at);

-- One speaker pass per approval that had something to process. It covers speech after the previous pass's cutoff and
-- up to this approval (cutoff_wall_ms, epoch milliseconds).
CREATE TABLE transcript_passes (
  id               TEXT PRIMARY KEY,
  case_id          TEXT NOT NULL REFERENCES cases(id),
  decision_id      TEXT NOT NULL REFERENCES decisions(id),
  job_id           TEXT NOT NULL REFERENCES jobs(id),
  from_wall_ms     INTEGER NOT NULL CHECK (from_wall_ms >= 0),
  cutoff_wall_ms   INTEGER NOT NULL CHECK (cutoff_wall_ms >= from_wall_ms),
  state            TEXT NOT NULL CHECK (state IN ('queued','running','done','empty','error','purged')),
  error_code       TEXT,
  purge_reason     TEXT,                          -- Czech reason when the audio was deleted before the pass ran
  -- SPEAKER_PASS_AUDIO_ON_FAILURE when the approval planned the pass, so a config change does not alter a running pass.
  audio_on_failure TEXT NOT NULL DEFAULT 'delete' CHECK (audio_on_failure IN ('keep_until_close','delete')),
  -- The wall-time intervals the pass's audio actually covers ([[from_ms, to_ms], ...]); only live lines inside them are
  -- replaced, so speech whose audio never arrived (a lost part, a slow upload, the cap) keeps its live text.
  covered_json     TEXT CHECK (covered_json IS NULL OR json_valid(covered_json)),
  speaker_count    INTEGER,
  line_count       INTEGER,
  audio_deleted_at TEXT,
  created_at       TEXT NOT NULL CHECK (created_at GLOB '[0-9][0-9][0-9][0-9]-*Z'),
  updated_at       TEXT NOT NULL CHECK (updated_at GLOB '[0-9][0-9][0-9][0-9]-*Z'),
  UNIQUE (decision_id)
);
CREATE INDEX transcript_passes_case ON transcript_passes(case_id, cutoff_wall_ms);

-- Live lines (from the browser, one per committed sentence and case) and speaker lines (from a pass). A line never
-- changes; a pass marks the live lines it replaces 'superseded' and its own staged lines 'current' in one batch.
CREATE TABLE transcript_lines (
  id                  TEXT PRIMARY KEY,
  case_id             TEXT NOT NULL REFERENCES cases(id),
  recording_id        TEXT REFERENCES recordings(id),
  client_line_id      TEXT,                       -- the browser's id for a live line: a retried batch is harmless
  source              TEXT NOT NULL CHECK (source IN ('live','speaker_pass')),
  pass_id             TEXT REFERENCES transcript_passes(id),
  speaker             INTEGER CHECK (speaker IS NULL OR speaker >= 0),   -- numbered per pass, never named
  wall_ms             INTEGER NOT NULL CHECK (wall_ms >= 0),
  text                TEXT NOT NULL CHECK (length(text) BETWEEN 1 AND 20000),
  state               TEXT NOT NULL DEFAULT 'current' CHECK (state IN ('staged','current','superseded')),
  superseded_by_pass  TEXT REFERENCES transcript_passes(id),
  created_by          TEXT NOT NULL,
  created_at          TEXT NOT NULL CHECK (created_at GLOB '[0-9][0-9][0-9][0-9]-*Z'),
  CHECK ((source = 'live') = (client_line_id IS NOT NULL)),
  CHECK ((source = 'speaker_pass') = (pass_id IS NOT NULL)),
  UNIQUE (case_id, client_line_id)
);
CREATE INDEX transcript_lines_case ON transcript_lines(case_id, state, wall_ms);
CREATE INDEX transcript_lines_pass ON transcript_lines(pass_id, state);

-- The summary the pass makes: always an AI draft shown beside the transcript, never copied into a protocol, a
-- decision or a task (CLAUDE.md, "a draft is never shown as approved").
CREATE TABLE transcript_summaries (
  id          TEXT PRIMARY KEY,
  case_id     TEXT NOT NULL REFERENCES cases(id),
  pass_id     TEXT NOT NULL REFERENCES transcript_passes(id),
  state       TEXT NOT NULL CHECK (state IN ('done','error','skipped')),
  basis       TEXT CHECK (basis IS NULL OR basis IN ('speaker_pass','live_only')),
  text        TEXT,
  error_code  TEXT,
  model       TEXT,
  prompt_version TEXT,
  input_sha   TEXT,
  cache_hit   INTEGER NOT NULL DEFAULT 0 CHECK (cache_hit IN (0,1)),
  label       TEXT NOT NULL DEFAULT 'ai_draft' CHECK (label = 'ai_draft'),
  created_at  TEXT NOT NULL CHECK (created_at GLOB '[0-9][0-9][0-9][0-9]-*Z')
);
CREATE INDEX transcript_summaries_case ON transcript_summaries(case_id, created_at);

-- A case's raw audio (16 kHz mono s16le PCM) for one recording, uploaded to R2 in parts while the case is discussed.
-- pass_id is set when an approval claims the upload; after that no part is accepted.
CREATE TABLE audio_uploads (
  id             TEXT PRIMARY KEY,
  case_id        TEXT NOT NULL REFERENCES cases(id),
  recording_id   TEXT NOT NULL REFERENCES recordings(id),
  pass_id        TEXT REFERENCES transcript_passes(id),
  r2_key         TEXT NOT NULL UNIQUE,            -- audio/<case_id>/<upload_id>.pcm: no name, birth number or date
  r2_upload_id   TEXT,                            -- the R2 multipart id while open
  state          TEXT NOT NULL CHECK (state IN ('open','completed','deleted','aborted')),
  bytes          INTEGER NOT NULL DEFAULT 0 CHECK (bytes >= 0),
  created_by     TEXT NOT NULL,
  created_at     TEXT NOT NULL CHECK (created_at GLOB '[0-9][0-9][0-9][0-9]-*Z'),
  completed_at   TEXT,
  deleted_at     TEXT,
  delete_reason  TEXT
);
CREATE UNIQUE INDEX audio_uploads_open ON audio_uploads(case_id, recording_id) WHERE pass_id IS NULL AND state = 'open';
CREATE INDEX audio_uploads_pass ON audio_uploads(pass_id);
CREATE INDEX audio_uploads_state ON audio_uploads(state, created_at);

CREATE TABLE audio_parts (
  upload_id    TEXT NOT NULL REFERENCES audio_uploads(id),
  part_number  INTEGER NOT NULL CHECK (part_number BETWEEN 1 AND 10000),
  etag         TEXT NOT NULL,
  bytes        INTEGER NOT NULL CHECK (bytes > 0),
  is_final     INTEGER NOT NULL DEFAULT 0 CHECK (is_final IN (0,1)),
  PRIMARY KEY (upload_id, part_number)
);

-- Where each visit to the case starts in the upload, so the pass can give every word its time of day.
CREATE TABLE audio_segments (
  upload_id     TEXT NOT NULL REFERENCES audio_uploads(id),
  start_sample  INTEGER NOT NULL CHECK (start_sample >= 0),
  wall_ms       INTEGER NOT NULL CHECK (wall_ms >= 0),
  PRIMARY KEY (upload_id, start_sample)
);
PRAGMA defer_foreign_keys = false;
