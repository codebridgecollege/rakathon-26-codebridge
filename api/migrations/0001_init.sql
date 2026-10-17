-- CodeBridge D1 schema v1. Identity lives in patients only; every clinical row refers to a case id.
-- Timestamps: ISO 8601 UTC with milliseconds. D1 refuses GLOB patterns over 50 bytes, so the *_at checks test
-- the date part and the trailing Z only.

-- ---------- directory ----------
CREATE TABLE roles (
  id        TEXT PRIMARY KEY CHECK (id IN ('doctor','coordinator','admin')),
  label_cs  TEXT NOT NULL
);

CREATE TABLE departments (
  id    TEXT PRIMARY KEY,                    -- 'd1'..'d6'
  name  TEXT NOT NULL UNIQUE,
  sort  INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE users (
  id          TEXT PRIMARY KEY,              -- 'd2p1', 'coord', 'admin'
  pre         TEXT NOT NULL DEFAULT '',      -- title before the name, as the staff screen edits it
  sur         TEXT NOT NULL CHECK (length(trim(sur)) > 0),
  post        TEXT NOT NULL DEFAULT '',
  fn          TEXT NOT NULL DEFAULT '',      -- function shown in tooltips
  role_id     TEXT NOT NULL REFERENCES roles(id),
  email       TEXT UNIQUE,                   -- Access login (AUTH_MODE=access); NULL in demo seed
  active      INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
              CHECK (created_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T*Z')
);

CREATE TABLE dept_members (
  dept_id   TEXT NOT NULL REFERENCES departments(id),
  user_id   TEXT NOT NULL REFERENCES users(id),
  position  INTEGER NOT NULL DEFAULT 0,      -- order on the staff screen and in attendance selects
  PRIMARY KEY (dept_id, user_id)
);
CREATE INDEX dept_members_user ON dept_members(user_id);

-- ---------- identity (kept apart so case data can be pseudonymous) ----------
CREATE TABLE patients (
  id                    TEXT PRIMARY KEY,    -- 'pt-010', 'pt-S01'
  full_name             TEXT NOT NULL,       -- list display name ("Daniel Poláček")
  name_as_written       TEXT,                -- form order as printed ("Poláček Daniel")
  birth_number          TEXT,                -- RČ; NULL when the documents do not state it (never invented)
  birth_as_written      TEXT,                -- "12.3.1964" exactly as in the document
  age_as_written        TEXT,                -- "63 let" when only an age is stated
  insurer               TEXT,
  sex                   TEXT CHECK (sex IN ('muž','žena') OR sex IS NULL),
  sex_certainty         TEXT CHECK (sex_certainty IN ('stated','inferred') OR sex_certainty IS NULL),
  identity_warning      TEXT,                -- note containing "ověřit identitu"; UI "warn"
  name_note_cs          TEXT,                -- neutral note, e.g. first name and surname swapped; UI "nameNote.text"
  name_note_source_json TEXT CHECK (name_note_source_json IS NULL OR json_valid(name_note_source_json)),
  identity_source_json  TEXT CHECK (identity_source_json IS NULL OR json_valid(identity_source_json)),
  data_origin           TEXT NOT NULL CHECK (data_origin IN ('fno_challenge','codebridge_synthetic')),
  created_at            TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
                        CHECK (created_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T*Z')
);
-- Not unique: Czech hospitals hold duplicate records per birth number; Step 4's POST /cases checks with an override.
CREATE INDEX patients_birth_number ON patients(birth_number) WHERE birth_number IS NOT NULL;

-- ---------- cases ----------
CREATE TABLE cases (
  id                    TEXT PRIMARY KEY,    -- 'NO-010'
  patient_id            TEXT NOT NULL REFERENCES patients(id),
  source_file           TEXT NOT NULL UNIQUE,-- '10_pacient.pdf'; the frontend still keys cases by it (S.pid, refs)
  list_order            INTEGER NOT NULL,    -- order of initialPatients(); /patients returns rows in it
  status                TEXT NOT NULL CHECK (status IN ('new','scheduled','attention','ready','done','closed')),
  processing_level      TEXT NOT NULL CHECK (processing_level IN ('full','partial','none')),
  -- question to the MDT: explicit, or an assistant draft with its basis (CLAUDE.md, team decision 2026-10-17)
  question_text         TEXT,                -- explicit question; NULL when none
  question_explicit     INTEGER NOT NULL CHECK (question_explicit IN (0,1)),
  question_purpose      TEXT,                -- UI "purpose": the stated purpose or closest source quote
  question_source_json  TEXT CHECK (question_source_json IS NULL OR json_valid(question_source_json)),
  question_draft        TEXT,                -- assistant draft, shown as draft until confirmed
  question_kind         TEXT,
  question_basis_json   TEXT CHECK (question_basis_json IS NULL OR json_valid(question_basis_json)),
  diagnosis_text        TEXT,                -- list headline
  diagnosis_note        TEXT,                -- second line (case 10: "pTNM při diagnóze 6/2022 · nyní ...")
  mkn10                 TEXT,                -- as the source gives it; never assigned by the seed
  summary_one_line      TEXT,
  page_count            INTEGER CHECK (page_count IS NULL OR page_count >= 0),
  referrer_name         TEXT,                -- from the documents; NULL when silent
  referring_dept        TEXT,
  referring_dept_is_example INTEGER NOT NULL DEFAULT 0 CHECK (referring_dept_is_example IN (0,1)),
  context_note_cs       TEXT,                -- e.g. "Odesílající lékař ani pracoviště neuvedeny."
  owner_user_id         TEXT REFERENCES users(id),
  owner_name            TEXT NOT NULL,       -- display string; may be a referrer who is not a user
  owner_is_example      INTEGER NOT NULL DEFAULT 0 CHECK (owner_is_example IN (0,1)),
  submitted_on          TEXT CHECK (submitted_on IS NULL OR submitted_on GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  submitted_is_example  INTEGER NOT NULL DEFAULT 0 CHECK (submitted_is_example IN (0,1)),
  updated_on            TEXT NOT NULL CHECK (updated_on GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  created_at            TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
                        CHECK (created_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T*Z')
);
CREATE INDEX cases_patient ON cases(patient_id);
CREATE INDEX cases_status  ON cases(status);

-- Who may open a case: a user directly, or every member of a department (INTEGRATION.md, role plus membership).
CREATE TABLE case_members (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  case_id     TEXT NOT NULL REFERENCES cases(id),
  user_id     TEXT REFERENCES users(id),
  dept_id     TEXT REFERENCES departments(id),
  reason      TEXT NOT NULL,               -- 'seed: oddělení MDT', 'referring doctor', ...
  added_by    TEXT,                        -- user id; NULL for the seed
  added_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) CHECK (added_at GLOB '[0-9][0-9][0-9][0-9]-*Z'),
  CHECK ((user_id IS NULL) <> (dept_id IS NULL))
);
CREATE UNIQUE INDEX case_members_user ON case_members(case_id, user_id) WHERE user_id IS NOT NULL;
CREATE UNIQUE INDEX case_members_dept ON case_members(case_id, dept_id) WHERE dept_id IS NOT NULL;
CREATE INDEX case_members_by_user ON case_members(user_id);

CREATE TABLE status_history (               -- append-only (0002)
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  case_id     TEXT NOT NULL REFERENCES cases(id),
  from_status TEXT NOT NULL CHECK (from_status IN ('new','scheduled','attention','ready','done','closed')),
  to_status   TEXT NOT NULL CHECK (to_status   IN ('new','scheduled','attention','ready','done','closed')),
  by_user_id  TEXT REFERENCES users(id),
  by_name     TEXT NOT NULL,
  how         TEXT NOT NULL,                -- UI "how": 'ručně', 'rezervace termínu', ...
  at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) CHECK (at GLOB '[0-9][0-9][0-9][0-9]-*Z'),
  CHECK (from_status <> to_status)
);
CREATE INDEX status_history_case ON status_history(case_id, at);

-- ---------- calendar and seminar ----------
CREATE TABLE slots (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  day        TEXT NOT NULL CHECK (day GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  time       TEXT NOT NULL CHECK (time GLOB '[0-2][0-9]:[0-5]0'),   -- 10-minute grid as in the UI (TIMES)
  case_id    TEXT NOT NULL UNIQUE REFERENCES cases(id),             -- one slot per case (p.slot)
  booked_by  TEXT REFERENCES users(id),
  booked_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) CHECK (booked_at GLOB '[0-9][0-9][0-9][0-9]-*Z'),
  UNIQUE (day, time)                                                -- two users cannot book one slot
);

CREATE TABLE sessions (                      -- a running MDT seminar day (S.session)
  day         TEXT PRIMARY KEY CHECK (day GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  started_by  TEXT NOT NULL REFERENCES users(id),
  started_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) CHECK (started_at GLOB '[0-9][0-9][0-9][0-9]-*Z'),
  ended_at    TEXT CHECK (ended_at IS NULL OR ended_at GLOB '[0-9][0-9][0-9][0-9]-*Z')
);

CREATE TABLE attendance (                    -- S.attByDay[day][dept][k]
  day        TEXT NOT NULL CHECK (day GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  dept_id    TEXT NOT NULL REFERENCES departments(id),
  position   INTEGER NOT NULL CHECK (position >= 0),
  user_id    TEXT REFERENCES users(id),
  user_name  TEXT NOT NULL,
  set_by     TEXT REFERENCES users(id),
  set_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) CHECK (set_at GLOB '[0-9][0-9][0-9][0-9]-*Z'),
  PRIMARY KEY (day, dept_id, position)
);

-- ---------- discussion record and decisions ----------
CREATE TABLE protocols (                     -- one open draft per case (ensureProto)
  case_id     TEXT PRIMARY KEY REFERENCES cases(id),
  mode        TEXT NOT NULL DEFAULT 'manual' CHECK (mode IN ('manual','ai')),
  notes       TEXT NOT NULL DEFAULT '',
  conclusion  TEXT NOT NULL DEFAULT '',
  steps_json  TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(steps_json)),
  state       TEXT NOT NULL DEFAULT 'draft' CHECK (state IN ('draft','approved')),
  version     INTEGER NOT NULL DEFAULT 1,    -- optimistic concurrency for autosave (Step 4)
  updated_by  TEXT REFERENCES users(id),
  updated_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) CHECK (updated_at GLOB '[0-9][0-9][0-9][0-9]-*Z')
);

CREATE TABLE decisions (                     -- append-only (0002)
  id                     TEXT PRIMARY KEY,
  case_id                TEXT NOT NULL REFERENCES cases(id),
  version                INTEGER NOT NULL CHECK (version >= 1),       -- "Platný závěr č. n"
  conclusion             TEXT NOT NULL CHECK (length(trim(conclusion)) > 0),
  approved_by_user_id    TEXT NOT NULL REFERENCES users(id),
  approved_by_name       TEXT NOT NULL,
  approved_at            TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) CHECK (approved_at GLOB '[0-9][0-9][0-9][0-9]-*Z'),
  slot_day               TEXT,
  slot_time              TEXT,
  report_snapshot_json   TEXT NOT NULL CHECK (json_valid(report_snapshot_json)),
  attendance_snapshot_json TEXT NOT NULL CHECK (json_valid(attendance_snapshot_json)),
  supersedes_id          TEXT REFERENCES decisions(id),
  UNIQUE (case_id, version),
  CHECK ((version = 1) = (supersedes_id IS NULL))
);

-- ---------- tasks ----------
CREATE TABLE task_suggestions (              -- drafted by the assistant from an approved conclusion
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  case_id       TEXT NOT NULL REFERENCES cases(id),
  decision_id   TEXT REFERENCES decisions(id),
  text          TEXT NOT NULL,
  quote         TEXT,                        -- the conclusion passage it rests on
  who           TEXT,
  due           TEXT CHECK (due IS NULL OR due GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  due_source    TEXT CHECK (due_source IN ('computed','manual','none') OR due_source IS NULL),
  timing        TEXT,
  state         TEXT NOT NULL DEFAULT 'draft' CHECK (state IN ('draft','confirmed','dismissed')),
  decided_by    TEXT REFERENCES users(id),
  decided_at    TEXT CHECK (decided_at IS NULL OR decided_at GLOB '[0-9][0-9][0-9][0-9]-*Z'),
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) CHECK (created_at GLOB '[0-9][0-9][0-9][0-9]-*Z')
);

CREATE TABLE tasks (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,   -- server-assigned (UI "id")
  case_id             TEXT NOT NULL REFERENCES cases(id),
  text                TEXT NOT NULL CHECK (length(trim(text)) > 0),
  assignee_user_id    TEXT REFERENCES users(id),
  assignee_name       TEXT NOT NULL,                       -- UI "who"
  due                 TEXT CHECK (due IS NULL OR due GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  due_source          TEXT CHECK (due_source IN ('computed','manual','none') OR due_source IS NULL),
  due_by              TEXT,
  timing              TEXT,
  done                INTEGER NOT NULL DEFAULT 0 CHECK (done IN (0,1)),
  done_by             TEXT REFERENCES users(id),
  done_at             TEXT CHECK (done_at IS NULL OR done_at GLOB '[0-9][0-9][0-9][0-9]-*Z'),
  from_suggestion_id  INTEGER REFERENCES task_suggestions(id),
  confirmed_by        TEXT,
  created_by          TEXT REFERENCES users(id),
  created_at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) CHECK (created_at GLOB '[0-9][0-9][0-9][0-9]-*Z')
);
CREATE INDEX tasks_case     ON tasks(case_id);
CREATE INDEX tasks_assignee ON tasks(assignee_user_id, done);

-- ---------- doctor confirmations and overrides (source values never change) ----------
CREATE TABLE question_confirmations (        -- append-only (0002); latest row per case is current
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  case_id     TEXT NOT NULL REFERENCES cases(id),
  text        TEXT NOT NULL,                 -- the draft text as confirmed
  by_user_id  TEXT NOT NULL REFERENCES users(id),
  by_name     TEXT NOT NULL,
  at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) CHECK (at GLOB '[0-9][0-9][0-9][0-9]-*Z')
);
CREATE INDEX question_confirmations_case ON question_confirmations(case_id, at);

CREATE TABLE fact_edits (                    -- current override per key (S.edits); history in edit_log
  case_id     TEXT NOT NULL REFERENCES cases(id),
  key         TEXT NOT NULL,                 -- the UI key after the "pid|" prefix
  text        TEXT NOT NULL,
  orig        TEXT,
  by_user_id  TEXT NOT NULL REFERENCES users(id),
  by_name     TEXT NOT NULL,
  at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) CHECK (at GLOB '[0-9][0-9][0-9][0-9]-*Z'),
  PRIMARY KEY (case_id, key)
);

CREATE TABLE edit_log (                      -- append-only (0002)
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  case_id     TEXT NOT NULL REFERENCES cases(id),
  key         TEXT NOT NULL,
  orig        TEXT,
  text        TEXT NOT NULL,
  reverted    INTEGER NOT NULL DEFAULT 0 CHECK (reverted IN (0,1)),
  by_user_id  TEXT NOT NULL REFERENCES users(id),
  by_name     TEXT NOT NULL,
  at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) CHECK (at GLOB '[0-9][0-9][0-9][0-9]-*Z')
);
CREATE INDEX edit_log_case ON edit_log(case_id, at);

-- ---------- extraction runs and alerts ----------
CREATE TABLE extraction_runs (
  id                 TEXT PRIMARY KEY,         -- 'seed-NO-010-<sha8>'
  case_id            TEXT NOT NULL REFERENCES cases(id),
  kind               TEXT NOT NULL CHECK (kind IN ('seed_fixture','pipeline')),
  model              TEXT,                     -- NULL for seed fixtures (written in advance by development agents)
  prompt_version     TEXT,
  temperature        REAL,
  input_hashes_json  TEXT NOT NULL CHECK (json_valid(input_hashes_json)),  -- sha256 of each fixture/source file
  r2_key             TEXT NOT NULL,            -- extract/<case>/<run>.json
  sha256             TEXT NOT NULL CHECK (length(sha256) = 64),
  is_current         INTEGER NOT NULL DEFAULT 1 CHECK (is_current IN (0,1)),
  created_at         TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) CHECK (created_at GLOB '[0-9][0-9][0-9][0-9]-*Z')
);
CREATE UNIQUE INDEX extraction_runs_current ON extraction_runs(case_id) WHERE is_current = 1;

CREATE TABLE alerts (
  id            TEXT PRIMARY KEY,              -- stable: 'al-' || first 16 hex of sha256(case|origin|kind|text_cs|first source)
  case_id       TEXT NOT NULL REFERENCES cases(id),
  run_id        TEXT NOT NULL REFERENCES extraction_runs(id),
  origin        TEXT NOT NULL CHECK (origin IN ('flag','gap')),   -- CASE.flags or a data gap
  position      INTEGER NOT NULL CHECK (position >= 0),          -- index in its array; today's UI key is f.<i> / gap:<i>
  kind          TEXT NOT NULL CHECK (kind IN ('missing','contradiction','chronology','unclear')),
  text_cs       TEXT NOT NULL,
  relevant      INTEGER NOT NULL DEFAULT 0 CHECK (relevant IN (0,1)),
  UNIQUE (run_id, origin, position)
);
CREATE INDEX alerts_case ON alerts(case_id);

CREATE TABLE alert_events (                  -- append-only (0002); latest event is the state (alertState)
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  alert_id    TEXT NOT NULL REFERENCES alerts(id),
  action      TEXT NOT NULL CHECK (action IN ('ack','resolved','reopen')),
  by_user_id  TEXT NOT NULL REFERENCES users(id),
  by_name     TEXT NOT NULL,
  at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) CHECK (at GLOB '[0-9][0-9][0-9][0-9]-*Z')
);
CREATE INDEX alert_events_alert ON alert_events(alert_id, at);

-- ---------- documents and pages ----------
CREATE TABLE documents (                     -- one uploaded or seeded file
  id              TEXT PRIMARY KEY,          -- seed: PDF stem ('10_pacient'); uploads: UUID
  case_id         TEXT NOT NULL REFERENCES cases(id),
  file_name       TEXT NOT NULL,             -- '10_pacient.pdf'
  media_type      TEXT NOT NULL DEFAULT 'application/pdf',
  page_count      INTEGER NOT NULL CHECK (page_count >= 0),
  original_r2_key TEXT,                      -- docs/<case>/<doc>.pdf
  sha256          TEXT CHECK (sha256 IS NULL OR length(sha256) = 64),
  size_bytes      INTEGER,
  origin          TEXT NOT NULL CHECK (origin IN ('seed','upload','fhir')),
  processing      TEXT NOT NULL CHECK (processing IN ('processed','unprocessed')),
  note_cs         TEXT,                      -- EXTRA.documents_note_cs
  uploaded_by     TEXT REFERENCES users(id),
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) CHECK (created_at GLOB '[0-9][0-9][0-9][0-9]-*Z'),
  UNIQUE (case_id, file_name)
);
CREATE INDEX documents_case ON documents(case_id);

CREATE TABLE document_parts (                -- logical documents inside one file (EXTRA.documents, SYN.documents)
  document_id   TEXT NOT NULL REFERENCES documents(id),
  ordinal       INTEGER NOT NULL CHECK (ordinal >= 0),
  title_cs      TEXT NOT NULL,
  type          TEXT,
  date          TEXT,                         -- as extracted: 'YYYY-MM-DD', 'YYYY-MM' or NULL; never filled in
  date_note_cs  TEXT,
  pages_json    TEXT NOT NULL CHECK (json_valid(pages_json)),
  readability   TEXT CHECK (readability IN ('good','fair','poor','unreadable') OR readability IS NULL),
  reason_cs     TEXT,
  upload_name   TEXT,
  PRIMARY KEY (document_id, ordinal)
);

CREATE TABLE pages (
  document_id           TEXT NOT NULL REFERENCES documents(id),
  n                     INTEGER NOT NULL CHECK (n >= 1),
  json_r2_key           TEXT NOT NULL,        -- pages/<doc>/p<n>.json
  image_r2_key          TEXT NOT NULL,        -- pages/<doc>/p<n>.png
  redacted_r2_key       TEXT,                 -- pages/<doc>/p<n>.redacted.png
  width                 INTEGER NOT NULL,
  height                INTEGER NOT NULL,
  engine                TEXT NOT NULL,        -- which reader produced the text (DATA-PROTECTION.md, "page reader")
  mean_conf             REAL,
  low_conf_words        INTEGER,
  is_empty              INTEGER NOT NULL CHECK (is_empty IN (0,1)),
  verify_count          INTEGER NOT NULL DEFAULT 0,
  redaction_count       INTEGER,              -- NULL: redaction not run on this page
  redaction_reasons_json TEXT CHECK (redaction_reasons_json IS NULL OR json_valid(redaction_reasons_json)),
  PRIMARY KEY (document_id, n)
);

-- Known synthetic files the upload route will accept (shared-demo decision), matched by hash in Step 6.
CREATE TABLE fixture_files (
  sha256      TEXT PRIMARY KEY CHECK (length(sha256) = 64),
  fixture_id  TEXT NOT NULL,                  -- 'S02'
  file_name   TEXT NOT NULL,
  r2_prefix   TEXT NOT NULL                   -- fixtures/S02/
);

-- ---------- transcripts and jobs (written from Step 5) ----------
CREATE TABLE transcript_passes (
  id          TEXT PRIMARY KEY,
  case_id     TEXT NOT NULL REFERENCES cases(id),
  session_day TEXT,
  state       TEXT NOT NULL CHECK (state IN ('live','pending','diarized','failed','discarded')),
  job_id      TEXT,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) CHECK (created_at GLOB '[0-9][0-9][0-9][0-9]-*Z')
);
CREATE TABLE transcript_lines (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  pass_id     TEXT NOT NULL REFERENCES transcript_passes(id),
  case_id     TEXT NOT NULL REFERENCES cases(id),
  t_ms        INTEGER NOT NULL CHECK (t_ms >= 0),
  speaker     TEXT,                           -- numbered, never named (no voiceprints)
  text        TEXT NOT NULL
);
CREATE INDEX transcript_lines_case ON transcript_lines(case_id, pass_id, t_ms);

CREATE TABLE jobs (
  id          TEXT PRIMARY KEY,               -- Workflow instance id
  case_id     TEXT REFERENCES cases(id),
  kind        TEXT NOT NULL CHECK (kind IN ('speaker_pass','summary','prognosis','document')),
  state       TEXT NOT NULL CHECK (state IN ('queued','running','done','failed')),
  error_cs    TEXT,
  created_by  TEXT REFERENCES users(id),
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) CHECK (created_at GLOB '[0-9][0-9][0-9][0-9]-*Z'),
  updated_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) CHECK (updated_at GLOB '[0-9][0-9][0-9][0-9]-*Z')
);

-- ---------- audit ----------
CREATE TABLE access_log (                    -- append-only (0002); written by the server only
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  at              TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) CHECK (at GLOB '[0-9][0-9][0-9][0-9]-*Z'),
  actor_user_id   TEXT NOT NULL,              -- the real user (no FK: the audit must outlive a user row)
  actor_name      TEXT NOT NULL,
  acted_as_role   TEXT NOT NULL CHECK (acted_as_role IN ('doctor','coordinator','admin')),
  impersonating   INTEGER NOT NULL DEFAULT 0 CHECK (impersonating IN (0,1)),
  auth_mode       TEXT NOT NULL CHECK (auth_mode IN ('demo','access')),
  case_id         TEXT,                       -- no FK, same reason
  document_id     TEXT,
  page_n          INTEGER,
  action          TEXT NOT NULL,              -- code: 'case.open', 'source.view', ...
  what_cs         TEXT NOT NULL,              -- the line the Administrace view shows; never quotes or document text
  break_glass_reason TEXT,
  request_id      TEXT                        -- cf-ray, for joining with Worker logs
);
CREATE INDEX access_log_case  ON access_log(case_id, at);
CREATE INDEX access_log_actor ON access_log(actor_user_id, at);
CREATE INDEX access_log_at    ON access_log(at);

-- ---------- seed bookkeeping ----------
CREATE TABLE seed_meta (
  id            INTEGER PRIMARY KEY CHECK (id = 1),
  seeded_at     TEXT NOT NULL CHECK (seeded_at GLOB '[0-9][0-9][0-9][0-9]-*Z'),
  git_commit    TEXT NOT NULL,
  fixtures_json TEXT NOT NULL CHECK (json_valid(fixtures_json))   -- file -> sha256
);
