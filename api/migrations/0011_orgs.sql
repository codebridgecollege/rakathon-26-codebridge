-- Organizations (docs/design/AUTH.md and DATABASE.md, steps 1 and 2). An organization (org) is a hospital or another
-- customer; every patient, case and document belongs to exactly one. This migration:
-- - adds orgs, memberships (a person's role, function and activity in one org), user_identities and auth_sessions
--   (the last two are used from step 3, the login);
-- - keeps users as the person (name, titles, e-mail, active) and moves role and function into memberships;
-- - puts an org_id with no default on every table that holds org data, so a forgotten org is an error and never a row
--   that quietly lands in some org;
-- - makes every reference carry the org: (org_id, case_id) REFERENCES cases(org_id, id), backed by UNIQUE (org_id, id)
--   on the parent, and references to people go through memberships(org_id, user_id), so the database itself refuses a
--   row of one org that points at a record or a person of another;
-- - starts every unique key that orgs could share with org_id (slots, seminar days, attendance sets, idempotency keys,
--   document hashes and names, the intake fixture, department names, the case number);
-- - gives demo_state (the demo reset and the data epoch) one row per org;
-- - puts all of today's data into demo org A ("Ukázková nemocnice A", id demo-a).
--
-- SQLite cannot add a NOT NULL column without a default or change a key, so every org table is rebuilt: the old table
-- is renamed to <name>_old (which also points the old tables' foreign keys and triggers at the _old names), the new
-- table is created under the final name, the rows are copied parents first, and the old tables are dropped children
-- first. Foreign keys are deferred to the end of the migration. Indexes and triggers are created after the copy, the
-- append-only ones again with their demo-reset exception, now scoped to the row's own org.

PRAGMA defer_foreign_keys = true;

-- ---------- 1. The old tables step aside ----------
ALTER TABLE users RENAME TO users_old;
ALTER TABLE departments RENAME TO departments_old;
ALTER TABLE dept_members RENAME TO dept_members_old;
ALTER TABLE patients RENAME TO patients_old;
ALTER TABLE cases RENAME TO cases_old;
ALTER TABLE case_members RENAME TO case_members_old;
ALTER TABLE status_history RENAME TO status_history_old;
ALTER TABLE slots RENAME TO slots_old;
ALTER TABLE sessions RENAME TO sessions_old;
ALTER TABLE attendance RENAME TO attendance_old;
ALTER TABLE attendance_sets RENAME TO attendance_sets_old;
ALTER TABLE protocols RENAME TO protocols_old;
ALTER TABLE decisions RENAME TO decisions_old;
ALTER TABLE task_suggestions RENAME TO task_suggestions_old;
ALTER TABLE tasks RENAME TO tasks_old;
ALTER TABLE question_confirmations RENAME TO question_confirmations_old;
ALTER TABLE fact_edits RENAME TO fact_edits_old;
ALTER TABLE edit_log RENAME TO edit_log_old;
ALTER TABLE extraction_runs RENAME TO extraction_runs_old;
ALTER TABLE alerts RENAME TO alerts_old;
ALTER TABLE alert_events RENAME TO alert_events_old;
ALTER TABLE documents RENAME TO documents_old;
ALTER TABLE document_parts RENAME TO document_parts_old;
ALTER TABLE pages RENAME TO pages_old;
ALTER TABLE recordings RENAME TO recordings_old;
ALTER TABLE jobs RENAME TO jobs_old;
ALTER TABLE transcript_passes RENAME TO transcript_passes_old;
ALTER TABLE transcript_lines RENAME TO transcript_lines_old;
ALTER TABLE transcript_summaries RENAME TO transcript_summaries_old;
ALTER TABLE audio_uploads RENAME TO audio_uploads_old;
ALTER TABLE audio_parts RENAME TO audio_parts_old;
ALTER TABLE audio_segments RENAME TO audio_segments_old;
ALTER TABLE pipeline_runs RENAME TO pipeline_runs_old;
ALTER TABLE upload_sessions RENAME TO upload_sessions_old;
ALTER TABLE case_access_grants RENAME TO case_access_grants_old;
ALTER TABLE notifications RENAME TO notifications_old;
ALTER TABLE idempotency_keys RENAME TO idempotency_keys_old;
ALTER TABLE write_guards RENAME TO write_guards_old;
ALTER TABLE demo_state RENAME TO demo_state_old;
ALTER TABLE access_log RENAME TO access_log_old;

-- ---------- 2. Orgs and people ----------
-- id is also part of R2 keys (org/<id>/...), so it is a short lowercase code. case_id_prefix keeps internal case IDs
-- unique across orgs while each org numbers its cases (case_no) on its own: demo org A keeps today's IDs (no prefix).
CREATE TABLE orgs (
  id                TEXT PRIMARY KEY CHECK (length(id) BETWEEN 1 AND 32 AND id NOT GLOB '*[^a-z0-9-]*'),
  name              TEXT NOT NULL CHECK (length(trim(name)) > 0),
  short_name        TEXT NOT NULL CHECK (length(trim(short_name)) > 0),
  is_demo           INTEGER NOT NULL CHECK (is_demo IN (0,1)),
  session_idle_min  INTEGER CHECK (session_idle_min IS NULL OR session_idle_min > 0),  -- NULL: no idle limit (demo orgs)
  case_id_prefix    TEXT NOT NULL UNIQUE CHECK (case_id_prefix NOT GLOB '*[^A-Z0-9-]*'),
  created_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) CHECK (created_at GLOB '[0-9][0-9][0-9][0-9]-*Z')
);
INSERT INTO orgs (id, name, short_name, is_demo, session_idle_min, case_id_prefix) VALUES ('demo-a', 'Ukázková nemocnice A', 'Nemocnice A', 1, NULL, '');

-- The person: what is the same in every org. Role, function and activity per org are in memberships.
CREATE TABLE users (
  id          TEXT PRIMARY KEY,              -- 'd2p1', 'coord', 'admin', 'b-d1p1'
  pre         TEXT NOT NULL DEFAULT '',      -- title before the name, as the staff screen edits it
  sur         TEXT NOT NULL CHECK (length(trim(sur)) > 0),
  post        TEXT NOT NULL DEFAULT '',
  email       TEXT UNIQUE,                   -- the login's verified e-mail links the first login (AUTH.md)
  active      INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
              CHECK (created_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T*Z')
);

-- A person's place in one org. One per person and org, so (org_id, user_id) is the key every reference to a person
-- uses. A membership with role 'staff' is a staff entry (listed for attendance, never signs in). active_until set:
-- the person left that org's list; history rows keep pointing at the membership.
CREATE TABLE memberships (
  id            TEXT PRIMARY KEY,            -- demo org A: the person's id, so X-Demo-User 'd2p1' keeps working
  org_id        TEXT NOT NULL REFERENCES orgs(id),
  user_id       TEXT NOT NULL REFERENCES users(id),
  role_id       TEXT NOT NULL REFERENCES roles(id),
  fn            TEXT NOT NULL DEFAULT '',    -- function shown in tooltips
  active_from   TEXT NOT NULL CHECK (active_from GLOB '[0-9][0-9][0-9][0-9]-*Z'),
  active_until  TEXT CHECK (active_until IS NULL OR active_until GLOB '[0-9][0-9][0-9][0-9]-*Z'),
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) CHECK (created_at GLOB '[0-9][0-9][0-9][0-9]-*Z'),
  UNIQUE (org_id, user_id)
);

-- Step 3 (login): issuer and subject of a person at the IdP. Two during a move from one IdP to another.
CREATE TABLE user_identities (
  issuer         TEXT NOT NULL,
  subject        TEXT NOT NULL,
  user_id        TEXT NOT NULL REFERENCES users(id),
  created_at     TEXT NOT NULL CHECK (created_at GLOB '[0-9][0-9][0-9][0-9]-*Z'),
  last_login_at  TEXT,
  PRIMARY KEY (issuer, subject)
);
CREATE INDEX user_identities_user ON user_identities(user_id);

-- Step 3 (login): one row per login, keyed by the hash of the session ID (the ID itself is only in the cookie).
CREATE TABLE auth_sessions (
  id_hash        TEXT PRIMARY KEY CHECK (length(id_hash) = 64),
  user_id        TEXT NOT NULL REFERENCES users(id),
  org_id         TEXT NOT NULL REFERENCES orgs(id),
  membership_id  TEXT NOT NULL REFERENCES memberships(id),  -- the membership acted as (a role switch in a demo org)
  id_token       TEXT,                                      -- only as long as the logout hint needs it
  created_at     TEXT NOT NULL CHECK (created_at GLOB '[0-9][0-9][0-9][0-9]-*Z'),
  last_used_at   TEXT NOT NULL CHECK (last_used_at GLOB '[0-9][0-9][0-9][0-9]-*Z'),
  expires_at     TEXT NOT NULL CHECK (expires_at GLOB '[0-9][0-9][0-9][0-9]-*Z')
);
CREATE INDEX auth_sessions_expiry ON auth_sessions(expires_at);

-- ---------- 3. Staff ----------
CREATE TABLE departments (
  id      TEXT PRIMARY KEY,                  -- 'd1'..'d6' in org A, 'b-d1'.. in org B, 'd<random>' when added
  org_id  TEXT NOT NULL REFERENCES orgs(id),
  name    TEXT NOT NULL,
  sort    INTEGER NOT NULL DEFAULT 0,
  UNIQUE (org_id, id),
  UNIQUE (org_id, name)
);

CREATE TABLE dept_members (
  org_id    TEXT NOT NULL REFERENCES orgs(id),
  dept_id   TEXT NOT NULL,
  user_id   TEXT NOT NULL,
  position  INTEGER NOT NULL DEFAULT 0,      -- order on the staff screen and in attendance selects
  PRIMARY KEY (org_id, dept_id, user_id),
  FOREIGN KEY (org_id, dept_id) REFERENCES departments(org_id, id),
  FOREIGN KEY (org_id, user_id) REFERENCES memberships(org_id, user_id)
);

-- ---------- 4. Identity and cases ----------
CREATE TABLE patients (
  id                    TEXT PRIMARY KEY,    -- 'pt-010', 'pt-S01'
  org_id                TEXT NOT NULL REFERENCES orgs(id),
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
                        CHECK (created_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T*Z'),
  UNIQUE (org_id, id)
);

CREATE TABLE cases (
  id                    TEXT PRIMARY KEY,    -- unique across orgs: 'NO-010' in org A, 'B-NO-S01' in org B
  org_id                TEXT NOT NULL REFERENCES orgs(id),
  case_no               TEXT NOT NULL,       -- the number people see, counted per org ('NO-010')
  patient_id            TEXT NOT NULL,
  source_file           TEXT NOT NULL,       -- '10_pacient.pdf'; the frontend still keys cases by it (S.pid, refs)
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
  owner_user_id         TEXT,
  owner_name            TEXT NOT NULL,       -- display string; may be a referrer who is not a user
  owner_is_example      INTEGER NOT NULL DEFAULT 0 CHECK (owner_is_example IN (0,1)),
  submitted_on          TEXT CHECK (submitted_on IS NULL OR submitted_on GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  submitted_is_example  INTEGER NOT NULL DEFAULT 0 CHECK (submitted_is_example IN (0,1)),
  updated_on            TEXT NOT NULL CHECK (updated_on GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  created_at            TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
                        CHECK (created_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T*Z'),
  -- The reason a second record was created for a known birth number is staff free text that may name the patient.
  duplicate_override_reason TEXT,
  created_by            TEXT,
  intake_open           INTEGER NOT NULL DEFAULT 0 CHECK (intake_open IN (0,1)),
  intake_fixture        TEXT,
  referral_sha256       TEXT CHECK (referral_sha256 IS NULL OR length(referral_sha256) = 64),
  UNIQUE (org_id, id),
  UNIQUE (org_id, case_no),
  UNIQUE (org_id, source_file),
  FOREIGN KEY (org_id, patient_id) REFERENCES patients(org_id, id),
  FOREIGN KEY (org_id, owner_user_id) REFERENCES memberships(org_id, user_id)
);

-- Who may open a case: a user directly, or every member of a department (INTEGRATION.md, role plus membership).
CREATE TABLE case_members (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  org_id      TEXT NOT NULL REFERENCES orgs(id),
  case_id     TEXT NOT NULL,
  user_id     TEXT,
  dept_id     TEXT,
  reason      TEXT NOT NULL,               -- 'seed: oddělení MDT', 'referring doctor', ...
  added_by    TEXT,                        -- user id; NULL for the seed
  added_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) CHECK (added_at GLOB '[0-9][0-9][0-9][0-9]-*Z'),
  CHECK ((user_id IS NULL) <> (dept_id IS NULL)),
  FOREIGN KEY (org_id, case_id) REFERENCES cases(org_id, id),
  FOREIGN KEY (org_id, user_id) REFERENCES memberships(org_id, user_id),
  FOREIGN KEY (org_id, dept_id) REFERENCES departments(org_id, id)
);

CREATE TABLE status_history (               -- append-only
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  org_id      TEXT NOT NULL REFERENCES orgs(id),
  case_id     TEXT NOT NULL,
  from_status TEXT NOT NULL CHECK (from_status IN ('new','scheduled','attention','ready','done','closed')),
  to_status   TEXT NOT NULL CHECK (to_status   IN ('new','scheduled','attention','ready','done','closed')),
  by_user_id  TEXT,
  by_name     TEXT NOT NULL,
  how         TEXT NOT NULL,                -- UI "how": 'ručně', 'rezervace termínu', ...
  at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) CHECK (at GLOB '[0-9][0-9][0-9][0-9]-*Z'),
  CHECK (from_status <> to_status),
  FOREIGN KEY (org_id, case_id) REFERENCES cases(org_id, id),
  FOREIGN KEY (org_id, by_user_id) REFERENCES memberships(org_id, user_id)
);

-- Break-the-glass (INTEGRATION.md): a doctor outside the case's team opens it with a stated reason for 12 hours.
CREATE TABLE case_access_grants (
  id          TEXT PRIMARY KEY,
  org_id      TEXT NOT NULL REFERENCES orgs(id),
  case_id     TEXT NOT NULL,
  user_id     TEXT NOT NULL,
  reason      TEXT NOT NULL CHECK (length(reason) BETWEEN 10 AND 500),
  granted_at  TEXT NOT NULL CHECK (granted_at GLOB '[0-9][0-9][0-9][0-9]-*Z'),
  expires_at  TEXT NOT NULL CHECK (expires_at GLOB '[0-9][0-9][0-9][0-9]-*Z'),
  FOREIGN KEY (org_id, case_id) REFERENCES cases(org_id, id),
  FOREIGN KEY (org_id, user_id) REFERENCES memberships(org_id, user_id)
);

-- ---------- 5. Calendar and seminar ----------
CREATE TABLE slots (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  org_id     TEXT NOT NULL REFERENCES orgs(id),
  day        TEXT NOT NULL CHECK (day GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  time       TEXT NOT NULL CHECK (time GLOB '[0-2][0-9]:[0-5]0'),   -- 10-minute grid as in the UI (TIMES)
  case_id    TEXT NOT NULL,                                         -- one slot per case (p.slot)
  booked_by  TEXT,
  booked_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) CHECK (booked_at GLOB '[0-9][0-9][0-9][0-9]-*Z'),
  UNIQUE (org_id, case_id),
  UNIQUE (org_id, day, time),                                       -- two users of one org cannot book one slot
  FOREIGN KEY (org_id, case_id) REFERENCES cases(org_id, id),
  FOREIGN KEY (org_id, booked_by) REFERENCES memberships(org_id, user_id)
);

CREATE TABLE sessions (                      -- a running MDT seminar day (S.session); not a login (auth_sessions)
  org_id          TEXT NOT NULL REFERENCES orgs(id),
  day             TEXT NOT NULL CHECK (day GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  started_by      TEXT NOT NULL,
  started_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) CHECK (started_at GLOB '[0-9][0-9][0-9][0-9]-*Z'),
  ended_at        TEXT CHECK (ended_at IS NULL OR ended_at GLOB '[0-9][0-9][0-9][0-9]-*Z'),
  started_by_name TEXT,
  PRIMARY KEY (org_id, day),
  FOREIGN KEY (org_id, started_by) REFERENCES memberships(org_id, user_id)
);

-- A set is one seminar day ('2026-10-22') or one case without a slot ('case:NO-012'), per org.
CREATE TABLE attendance (
  org_id     TEXT NOT NULL REFERENCES orgs(id),
  set_key    TEXT NOT NULL CHECK (set_key GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]' OR set_key GLOB 'case:*'),
  dept_id    TEXT NOT NULL,
  position   INTEGER NOT NULL CHECK (position >= 0),
  user_id    TEXT NOT NULL,
  user_name  TEXT NOT NULL,
  PRIMARY KEY (org_id, set_key, dept_id, position),
  UNIQUE (org_id, set_key, user_id),         -- nobody is present twice
  FOREIGN KEY (org_id, dept_id) REFERENCES departments(org_id, id),
  FOREIGN KEY (org_id, user_id) REFERENCES memberships(org_id, user_id)
);
CREATE TABLE attendance_sets (
  org_id      TEXT NOT NULL REFERENCES orgs(id),
  set_key     TEXT NOT NULL,
  version     INTEGER NOT NULL DEFAULT 0,
  updated_by  TEXT,
  updated_at  TEXT,
  PRIMARY KEY (org_id, set_key)
);

-- ---------- 6. The MDT record ----------
CREATE TABLE protocols (                     -- one open draft per case (ensureProto)
  case_id          TEXT PRIMARY KEY,
  org_id           TEXT NOT NULL REFERENCES orgs(id),
  mode             TEXT NOT NULL DEFAULT 'manual' CHECK (mode IN ('manual','ai')),
  notes            TEXT NOT NULL DEFAULT '',
  conclusion       TEXT NOT NULL DEFAULT '',
  steps_json       TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(steps_json)),
  state            TEXT NOT NULL DEFAULT 'draft' CHECK (state IN ('draft','approved')),
  version          INTEGER NOT NULL DEFAULT 1,    -- optimistic concurrency for autosave (Step 4)
  updated_by       TEXT,
  updated_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) CHECK (updated_at GLOB '[0-9][0-9][0-9][0-9]-*Z'),
  updated_by_name  TEXT,
  approved_by_name TEXT,
  approved_at      TEXT,
  FOREIGN KEY (org_id, case_id) REFERENCES cases(org_id, id),
  FOREIGN KEY (org_id, updated_by) REFERENCES memberships(org_id, user_id)
);

CREATE TABLE decisions (                     -- append-only
  id                     TEXT PRIMARY KEY,
  org_id                 TEXT NOT NULL REFERENCES orgs(id),
  case_id                TEXT NOT NULL,
  version                INTEGER NOT NULL CHECK (version >= 1),       -- "Platný závěr č. n"
  conclusion             TEXT NOT NULL CHECK (length(trim(conclusion)) > 0),
  approved_by_user_id    TEXT NOT NULL,
  approved_by_name       TEXT NOT NULL,
  approved_at            TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) CHECK (approved_at GLOB '[0-9][0-9][0-9][0-9]-*Z'),
  slot_day               TEXT,
  slot_time              TEXT,
  report_snapshot_json   TEXT NOT NULL CHECK (json_valid(report_snapshot_json)),
  attendance_snapshot_json TEXT NOT NULL CHECK (json_valid(attendance_snapshot_json)),
  supersedes_id          TEXT,
  UNIQUE (org_id, id),
  UNIQUE (case_id, version),
  CHECK ((version = 1) = (supersedes_id IS NULL)),
  FOREIGN KEY (org_id, case_id) REFERENCES cases(org_id, id),
  FOREIGN KEY (org_id, approved_by_user_id) REFERENCES memberships(org_id, user_id),
  FOREIGN KEY (org_id, supersedes_id) REFERENCES decisions(org_id, id)
);

CREATE TABLE task_suggestions (              -- drafted by the assistant from an approved conclusion
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  org_id           TEXT NOT NULL REFERENCES orgs(id),
  case_id          TEXT NOT NULL,
  decision_id      TEXT,
  decision_version INTEGER,
  text             TEXT NOT NULL,
  quote            TEXT,                        -- the conclusion passage it rests on
  who              TEXT,
  due              TEXT CHECK (due IS NULL OR due GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  due_source       TEXT CHECK (due_source IN ('computed','manual','none') OR due_source IS NULL),
  due_by           TEXT,
  timing           TEXT,
  state            TEXT NOT NULL DEFAULT 'draft' CHECK (state IN ('draft','confirmed','dismissed','superseded')),
  decided_by       TEXT,
  decided_by_name  TEXT,
  decided_at       TEXT CHECK (decided_at IS NULL OR decided_at GLOB '[0-9][0-9][0-9][0-9]-*Z'),
  created_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) CHECK (created_at GLOB '[0-9][0-9][0-9][0-9]-*Z'),
  UNIQUE (org_id, id),
  FOREIGN KEY (org_id, case_id) REFERENCES cases(org_id, id),
  FOREIGN KEY (org_id, decision_id) REFERENCES decisions(org_id, id),
  FOREIGN KEY (org_id, decided_by) REFERENCES memberships(org_id, user_id)
);

CREATE TABLE tasks (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,   -- server-assigned (UI "id"), unique across orgs
  org_id              TEXT NOT NULL REFERENCES orgs(id),
  case_id             TEXT NOT NULL,
  text                TEXT NOT NULL CHECK (length(trim(text)) > 0),
  assignee_user_id    TEXT,
  assignee_name       TEXT NOT NULL,                       -- UI "who"
  due                 TEXT CHECK (due IS NULL OR due GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  due_source          TEXT CHECK (due_source IN ('computed','manual','none') OR due_source IS NULL),
  due_by              TEXT,
  timing              TEXT,
  done                INTEGER NOT NULL DEFAULT 0 CHECK (done IN (0,1)),
  done_by             TEXT,
  done_at             TEXT CHECK (done_at IS NULL OR done_at GLOB '[0-9][0-9][0-9][0-9]-*Z'),
  from_suggestion_id  INTEGER,
  confirmed_by        TEXT,
  created_by          TEXT,
  created_at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) CHECK (created_at GLOB '[0-9][0-9][0-9][0-9]-*Z'),
  done_by_name        TEXT,
  FOREIGN KEY (org_id, case_id) REFERENCES cases(org_id, id),
  FOREIGN KEY (org_id, assignee_user_id) REFERENCES memberships(org_id, user_id),
  FOREIGN KEY (org_id, done_by) REFERENCES memberships(org_id, user_id),
  FOREIGN KEY (org_id, created_by) REFERENCES memberships(org_id, user_id),
  FOREIGN KEY (org_id, from_suggestion_id) REFERENCES task_suggestions(org_id, id)
);

CREATE TABLE question_confirmations (        -- append-only; latest row per case is current
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  org_id      TEXT NOT NULL REFERENCES orgs(id),
  case_id     TEXT NOT NULL,
  text        TEXT NOT NULL,                 -- the draft text as confirmed
  by_user_id  TEXT NOT NULL,
  by_name     TEXT NOT NULL,
  at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) CHECK (at GLOB '[0-9][0-9][0-9][0-9]-*Z'),
  FOREIGN KEY (org_id, case_id) REFERENCES cases(org_id, id),
  FOREIGN KEY (org_id, by_user_id) REFERENCES memberships(org_id, user_id)
);

CREATE TABLE fact_edits (                    -- current override per key (S.edits); history in edit_log
  org_id            TEXT NOT NULL REFERENCES orgs(id),
  case_id           TEXT NOT NULL,
  key               TEXT NOT NULL,           -- the UI key after the "pid|" prefix
  text              TEXT NOT NULL,
  orig              TEXT,
  by_user_id        TEXT NOT NULL,
  by_name           TEXT NOT NULL,
  at                TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) CHECK (at GLOB '[0-9][0-9][0-9][0-9]-*Z'),
  -- The edit_log row that set the current override; a write names it to detect a parallel edit.
  log_id            INTEGER,
  extraction_run_id TEXT,
  PRIMARY KEY (case_id, key),
  FOREIGN KEY (org_id, case_id) REFERENCES cases(org_id, id),
  FOREIGN KEY (org_id, by_user_id) REFERENCES memberships(org_id, user_id)
);

CREATE TABLE edit_log (                      -- append-only
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  org_id      TEXT NOT NULL REFERENCES orgs(id),
  case_id     TEXT NOT NULL,
  key         TEXT NOT NULL,
  orig        TEXT,
  text        TEXT NOT NULL,
  reverted    INTEGER NOT NULL DEFAULT 0 CHECK (reverted IN (0,1)),
  by_user_id  TEXT NOT NULL,
  by_name     TEXT NOT NULL,
  at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) CHECK (at GLOB '[0-9][0-9][0-9][0-9]-*Z'),
  confirmed   INTEGER NOT NULL DEFAULT 0 CHECK (confirmed IN (0,1)),
  FOREIGN KEY (org_id, case_id) REFERENCES cases(org_id, id),
  FOREIGN KEY (org_id, by_user_id) REFERENCES memberships(org_id, user_id)
);

-- ---------- 7. Extraction runs and alerts ----------
CREATE TABLE extraction_runs (
  id                 TEXT PRIMARY KEY,         -- 'seed-NO-010-<sha8>'
  org_id             TEXT NOT NULL REFERENCES orgs(id),
  case_id            TEXT NOT NULL,
  kind               TEXT NOT NULL CHECK (kind IN ('seed_fixture','pipeline')),
  model              TEXT,                     -- NULL for seed fixtures (written in advance by development agents)
  prompt_version     TEXT,
  temperature        REAL,
  input_hashes_json  TEXT NOT NULL CHECK (json_valid(input_hashes_json)),  -- sha256 of each fixture/source file
  r2_key             TEXT NOT NULL,            -- org/<org>/extract/<case>/<run>.json (extract/... before orgs)
  sha256             TEXT NOT NULL CHECK (length(sha256) = 64),
  is_current         INTEGER NOT NULL DEFAULT 1 CHECK (is_current IN (0,1)),
  created_at         TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) CHECK (created_at GLOB '[0-9][0-9][0-9][0-9]-*Z'),
  producer           TEXT CHECK (producer IS NULL OR producer IN ('prepared-fixture')),
  UNIQUE (org_id, id),
  FOREIGN KEY (org_id, case_id) REFERENCES cases(org_id, id)
);

CREATE TABLE alerts (
  id            TEXT PRIMARY KEY,              -- stable: 'al-' || first 16 hex of sha256(case|origin|kind|text_cs|first source)
  org_id        TEXT NOT NULL REFERENCES orgs(id),
  case_id       TEXT NOT NULL,
  run_id        TEXT NOT NULL,
  origin        TEXT NOT NULL CHECK (origin IN ('flag','gap')),   -- CASE.flags or a data gap
  position      INTEGER NOT NULL CHECK (position >= 0),          -- index in its array; today's UI key is f.<i> / gap:<i>
  kind          TEXT NOT NULL CHECK (kind IN ('missing','contradiction','chronology','unclear')),
  text_cs       TEXT NOT NULL,
  relevant      INTEGER NOT NULL DEFAULT 0 CHECK (relevant IN (0,1)),
  UNIQUE (org_id, id),
  UNIQUE (run_id, origin, position),
  FOREIGN KEY (org_id, case_id) REFERENCES cases(org_id, id),
  FOREIGN KEY (org_id, run_id) REFERENCES extraction_runs(org_id, id)
);

CREATE TABLE alert_events (                  -- append-only; latest event is the state (alertState)
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  org_id      TEXT NOT NULL REFERENCES orgs(id),
  alert_id    TEXT NOT NULL,
  action      TEXT NOT NULL CHECK (action IN ('ack','resolved','reopen')),
  by_user_id  TEXT NOT NULL,
  by_name     TEXT NOT NULL,
  at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) CHECK (at GLOB '[0-9][0-9][0-9][0-9]-*Z'),
  FOREIGN KEY (org_id, alert_id) REFERENCES alerts(org_id, id),
  FOREIGN KEY (org_id, by_user_id) REFERENCES memberships(org_id, user_id)
);

-- ---------- 8. Documents and pages ----------
CREATE TABLE documents (                     -- one uploaded or seeded file
  id              TEXT PRIMARY KEY,          -- seed: PDF stem ('10_pacient'; 'b-S01_pacient' in org B); uploads: UUID
  org_id          TEXT NOT NULL REFERENCES orgs(id),
  case_id         TEXT NOT NULL,
  file_name       TEXT NOT NULL,             -- '10_pacient.pdf'
  media_type      TEXT NOT NULL DEFAULT 'application/pdf',
  page_count      INTEGER NOT NULL CHECK (page_count >= 0),
  original_r2_key TEXT,                      -- org/<org>/docs/<case>/<doc>.pdf (docs/... before orgs)
  sha256          TEXT CHECK (sha256 IS NULL OR length(sha256) = 64),
  size_bytes      INTEGER,
  origin          TEXT NOT NULL CHECK (origin IN ('seed','upload','fhir')),
  processing      TEXT NOT NULL CHECK (processing IN ('processed','unprocessed')),
  note_cs         TEXT,                      -- EXTRA.documents_note_cs
  uploaded_by     TEXT,
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) CHECK (created_at GLOB '[0-9][0-9][0-9][0-9]-*Z'),
  state           TEXT CHECK (state IS NULL OR state IN ('stored','prepared','queued','processing','processed','failed')),
  state_detail_cs TEXT,
  fixture_id      TEXT,                      -- the registered fixture the bytes matched; NULL otherwise
  identity        TEXT CHECK (identity IS NULL OR identity IN ('matches','conflicts','cannot_verify')),
  title_cs        TEXT,
  doc_type        TEXT,
  doc_date        TEXT,
  readability     TEXT CHECK (readability IS NULL OR readability IN ('good','fair','poor','empty')),
  readability_reasons_json TEXT CHECK (readability_reasons_json IS NULL OR json_valid(readability_reasons_json)),
  source          TEXT CHECK (source IS NULL OR source = 'phone'),
  upload_session_id TEXT,
  UNIQUE (org_id, id),
  UNIQUE (org_id, case_id, file_name),
  FOREIGN KEY (org_id, case_id) REFERENCES cases(org_id, id),
  FOREIGN KEY (org_id, uploaded_by) REFERENCES memberships(org_id, user_id)
);

CREATE TABLE document_parts (                -- logical documents inside one file (EXTRA.documents, SYN.documents)
  org_id        TEXT NOT NULL REFERENCES orgs(id),
  document_id   TEXT NOT NULL,
  ordinal       INTEGER NOT NULL CHECK (ordinal >= 0),
  title_cs      TEXT NOT NULL,
  type          TEXT,
  date          TEXT,                         -- as extracted: 'YYYY-MM-DD', 'YYYY-MM' or NULL; never filled in
  date_note_cs  TEXT,
  pages_json    TEXT NOT NULL CHECK (json_valid(pages_json)),
  readability   TEXT CHECK (readability IN ('good','fair','poor','unreadable') OR readability IS NULL),
  reason_cs     TEXT,
  upload_name   TEXT,
  PRIMARY KEY (document_id, ordinal),
  FOREIGN KEY (org_id, document_id) REFERENCES documents(org_id, id)
);

CREATE TABLE pages (
  org_id                TEXT NOT NULL REFERENCES orgs(id),
  document_id           TEXT NOT NULL,
  n                     INTEGER NOT NULL CHECK (n >= 1),
  json_r2_key           TEXT NOT NULL,        -- org/<org>/pages/<doc>/p<n>.json (pages/... before orgs)
  image_r2_key          TEXT NOT NULL,
  redacted_r2_key       TEXT,
  width                 INTEGER NOT NULL,
  height                INTEGER NOT NULL,
  engine                TEXT NOT NULL,        -- which reader produced the text (DATA-PROTECTION.md, "page reader")
  mean_conf             REAL,
  low_conf_words        INTEGER,
  is_empty              INTEGER NOT NULL CHECK (is_empty IN (0,1)),
  verify_count          INTEGER NOT NULL DEFAULT 0,
  redaction_count       INTEGER,              -- NULL: redaction not run on this page
  redaction_reasons_json TEXT CHECK (redaction_reasons_json IS NULL OR json_valid(redaction_reasons_json)),
  PRIMARY KEY (document_id, n),
  FOREIGN KEY (org_id, document_id) REFERENCES documents(org_id, id)
);

CREATE TABLE pipeline_runs (
  id                     TEXT PRIMARY KEY,            -- also the Workflow instance id
  org_id                 TEXT NOT NULL REFERENCES orgs(id),
  document_id            TEXT NOT NULL,
  case_id                TEXT NOT NULL,
  state                  TEXT NOT NULL CHECK (state IN ('queued','running','done','error')),
  stage                  TEXT CHECK (stage IS NULL OR stage IN ('inspect','pages','analyze','labs','write')),
  error_code             TEXT,                        -- a fixed code, never container or page text
  pipeline_version       TEXT NOT NULL,               -- GIT_SHA of the Worker that started the run
  container_versions_json TEXT CHECK (container_versions_json IS NULL OR json_valid(container_versions_json)),
  stages_json            TEXT CHECK (stages_json IS NULL OR json_valid(stages_json)),  -- stage, duration, counts; no text
  input_sha256           TEXT NOT NULL CHECK (length(input_sha256) = 64),
  output_prefix          TEXT NOT NULL,               -- org/<org>/uploads/<case>/<doc>/<run>/ (uploads/... before orgs)
  page_count             INTEGER,
  readability            TEXT CHECK (readability IS NULL OR readability IN ('good','fair','poor','empty')),
  readability_reasons_json TEXT CHECK (readability_reasons_json IS NULL OR json_valid(readability_reasons_json)),
  verify_count           INTEGER,
  lab_points             INTEGER,
  lab_unclear            INTEGER,
  -- Compared with the prepared extraction of the same document: equal, marked "ověřit", and different without a mark
  -- (must stay 0; a silent difference is a failure of the pipeline).
  diff_same              INTEGER,
  diff_verify            INTEGER,
  diff_silent            INTEGER,
  diff_missing           INTEGER,
  created_by             TEXT NOT NULL,
  created_by_name        TEXT NOT NULL,
  created_at             TEXT NOT NULL CHECK (created_at GLOB '[0-9][0-9][0-9][0-9]-*Z'),
  updated_at             TEXT NOT NULL CHECK (updated_at GLOB '[0-9][0-9][0-9][0-9]-*Z'),
  finished_at            TEXT,
  FOREIGN KEY (org_id, document_id) REFERENCES documents(org_id, id),
  FOREIGN KEY (org_id, case_id) REFERENCES cases(org_id, id)
);

-- An upload session (PHONE-UPLOAD.md). The phone finds it by token_hash alone, so that key stays global; the org
-- then comes from the row. case_id has no foreign key: an intake discard deletes its case and the session answers
-- "closed".
CREATE TABLE upload_sessions (
  id          TEXT PRIMARY KEY,
  org_id      TEXT NOT NULL REFERENCES orgs(id),
  token_hash  TEXT NOT NULL UNIQUE,              -- hex SHA-256 of the token; the token itself is never stored
  case_id     TEXT NOT NULL,
  target      TEXT NOT NULL CHECK (target IN ('intake','discussion','documents')),
  created_by  TEXT NOT NULL,                     -- the desktop user; the phone's files are uploaded under this name
  created_at  TEXT NOT NULL,
  expires_at  TEXT NOT NULL,
  closed_at   TEXT,
  file_count  INTEGER NOT NULL DEFAULT 0
);

-- ---------- 9. Recording ----------
CREATE TABLE recordings (
  id               TEXT PRIMARY KEY,
  org_id           TEXT NOT NULL REFERENCES orgs(id),
  session_day      TEXT CHECK (session_day IS NULL OR session_day GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  started_by       TEXT NOT NULL,
  started_by_name  TEXT NOT NULL,
  started_at       TEXT NOT NULL CHECK (started_at GLOB '[0-9][0-9][0-9][0-9]-*Z'),
  ended_at         TEXT CHECK (ended_at IS NULL OR ended_at GLOB '[0-9][0-9][0-9][0-9]-*Z'),
  end_reason       TEXT CHECK (end_reason IS NULL OR end_reason IN ('stopped','all_approved','session_end','failed')),
  UNIQUE (org_id, id),
  FOREIGN KEY (org_id, started_by) REFERENCES memberships(org_id, user_id)
);

CREATE TABLE jobs (
  id               TEXT PRIMARY KEY,
  org_id           TEXT NOT NULL REFERENCES orgs(id),
  kind             TEXT NOT NULL CHECK (kind IN ('speaker_pass','prognosis')),
  case_id          TEXT NOT NULL,
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
  updated_at       TEXT NOT NULL CHECK (updated_at GLOB '[0-9][0-9][0-9][0-9]-*Z'),
  UNIQUE (org_id, id),
  FOREIGN KEY (org_id, case_id) REFERENCES cases(org_id, id)
);

CREATE TABLE transcript_passes (
  id               TEXT PRIMARY KEY,
  org_id           TEXT NOT NULL REFERENCES orgs(id),
  case_id          TEXT NOT NULL,
  decision_id      TEXT NOT NULL,
  job_id           TEXT NOT NULL,
  from_wall_ms     INTEGER NOT NULL CHECK (from_wall_ms >= 0),
  cutoff_wall_ms   INTEGER NOT NULL CHECK (cutoff_wall_ms >= from_wall_ms),
  state            TEXT NOT NULL CHECK (state IN ('queued','running','done','empty','error','purged')),
  error_code       TEXT,
  purge_reason     TEXT,                          -- Czech reason when the audio was deleted before the pass ran
  covered_json     TEXT CHECK (covered_json IS NULL OR json_valid(covered_json)),
  speaker_count    INTEGER,
  line_count       INTEGER,
  audio_deleted_at TEXT,
  created_at       TEXT NOT NULL CHECK (created_at GLOB '[0-9][0-9][0-9][0-9]-*Z'),
  updated_at       TEXT NOT NULL CHECK (updated_at GLOB '[0-9][0-9][0-9][0-9]-*Z'),
  UNIQUE (org_id, id),
  UNIQUE (decision_id),
  FOREIGN KEY (org_id, case_id) REFERENCES cases(org_id, id),
  FOREIGN KEY (org_id, decision_id) REFERENCES decisions(org_id, id),
  FOREIGN KEY (org_id, job_id) REFERENCES jobs(org_id, id)
);

CREATE TABLE transcript_lines (
  id                  TEXT PRIMARY KEY,
  org_id              TEXT NOT NULL REFERENCES orgs(id),
  case_id             TEXT NOT NULL,
  recording_id        TEXT,
  client_line_id      TEXT,                       -- the browser's id for a live line: a retried batch is harmless
  source              TEXT NOT NULL CHECK (source IN ('live','speaker_pass')),
  pass_id             TEXT,
  speaker             INTEGER CHECK (speaker IS NULL OR speaker >= 0),   -- numbered per pass, never named
  wall_ms             INTEGER NOT NULL CHECK (wall_ms >= 0),
  text                TEXT NOT NULL CHECK (length(text) BETWEEN 1 AND 20000),
  state               TEXT NOT NULL DEFAULT 'current' CHECK (state IN ('staged','current','superseded')),
  superseded_by_pass  TEXT,
  created_by          TEXT NOT NULL,
  created_at          TEXT NOT NULL CHECK (created_at GLOB '[0-9][0-9][0-9][0-9]-*Z'),
  CHECK ((source = 'live') = (client_line_id IS NOT NULL)),
  CHECK ((source = 'speaker_pass') = (pass_id IS NOT NULL)),
  UNIQUE (case_id, client_line_id),
  FOREIGN KEY (org_id, case_id) REFERENCES cases(org_id, id),
  FOREIGN KEY (org_id, recording_id) REFERENCES recordings(org_id, id),
  FOREIGN KEY (org_id, pass_id) REFERENCES transcript_passes(org_id, id),
  FOREIGN KEY (org_id, superseded_by_pass) REFERENCES transcript_passes(org_id, id)
);

CREATE TABLE transcript_summaries (
  id          TEXT PRIMARY KEY,
  org_id      TEXT NOT NULL REFERENCES orgs(id),
  case_id     TEXT NOT NULL,
  pass_id     TEXT NOT NULL,
  state       TEXT NOT NULL CHECK (state IN ('done','error','skipped')),
  basis       TEXT CHECK (basis IS NULL OR basis IN ('speaker_pass','live_only')),
  text        TEXT,
  error_code  TEXT,
  model       TEXT,
  prompt_version TEXT,
  input_sha   TEXT,
  cache_hit   INTEGER NOT NULL DEFAULT 0 CHECK (cache_hit IN (0,1)),
  label       TEXT NOT NULL DEFAULT 'ai_draft' CHECK (label = 'ai_draft'),
  created_at  TEXT NOT NULL CHECK (created_at GLOB '[0-9][0-9][0-9][0-9]-*Z'),
  FOREIGN KEY (org_id, case_id) REFERENCES cases(org_id, id),
  FOREIGN KEY (org_id, pass_id) REFERENCES transcript_passes(org_id, id)
);

CREATE TABLE audio_uploads (
  id             TEXT PRIMARY KEY,
  org_id         TEXT NOT NULL REFERENCES orgs(id),
  case_id        TEXT NOT NULL,
  recording_id   TEXT NOT NULL,
  pass_id        TEXT,
  r2_key         TEXT NOT NULL UNIQUE,            -- org/<org>/audio/<case>/<upload>.pcm: no name, birth number or date
  r2_upload_id   TEXT,                            -- the R2 multipart id while open
  state          TEXT NOT NULL CHECK (state IN ('open','completed','deleted','aborted')),
  bytes          INTEGER NOT NULL DEFAULT 0 CHECK (bytes >= 0),
  created_by     TEXT NOT NULL,
  created_at     TEXT NOT NULL CHECK (created_at GLOB '[0-9][0-9][0-9][0-9]-*Z'),
  completed_at   TEXT,
  deleted_at     TEXT,
  delete_reason  TEXT,
  UNIQUE (org_id, id),
  FOREIGN KEY (org_id, case_id) REFERENCES cases(org_id, id),
  FOREIGN KEY (org_id, recording_id) REFERENCES recordings(org_id, id),
  FOREIGN KEY (org_id, pass_id) REFERENCES transcript_passes(org_id, id)
);

CREATE TABLE audio_parts (
  org_id       TEXT NOT NULL REFERENCES orgs(id),
  upload_id    TEXT NOT NULL,
  part_number  INTEGER NOT NULL CHECK (part_number BETWEEN 1 AND 10000),
  etag         TEXT NOT NULL,
  bytes        INTEGER NOT NULL CHECK (bytes > 0),
  is_final     INTEGER NOT NULL DEFAULT 0 CHECK (is_final IN (0,1)),
  PRIMARY KEY (upload_id, part_number),
  FOREIGN KEY (org_id, upload_id) REFERENCES audio_uploads(org_id, id)
);

CREATE TABLE audio_segments (
  org_id        TEXT NOT NULL REFERENCES orgs(id),
  upload_id     TEXT NOT NULL,
  start_sample  INTEGER NOT NULL CHECK (start_sample >= 0),
  wall_ms       INTEGER NOT NULL CHECK (wall_ms >= 0),
  PRIMARY KEY (upload_id, start_sample),
  FOREIGN KEY (org_id, upload_id) REFERENCES audio_uploads(org_id, id)
);

-- ---------- 10. Plumbing ----------
-- Outbox: what an e-mail would say. A case ID and a count only, never medical data (CLAUDE.md, notifications).
-- case_id has no foreign key: the outbox outlives a removed intake.
CREATE TABLE notifications (
  id              TEXT PRIMARY KEY,
  org_id          TEXT NOT NULL REFERENCES orgs(id),
  kind            TEXT NOT NULL CHECK (kind IN ('approval','digest')),
  to_user_id      TEXT,
  case_id         TEXT,
  count           INTEGER NOT NULL CHECK (count >= 0),
  link            TEXT NOT NULL,
  created_by      TEXT NOT NULL,
  created_by_name TEXT NOT NULL,
  created_at      TEXT NOT NULL CHECK (created_at GLOB '[0-9][0-9][0-9][0-9]-*Z'),
  sent_at         TEXT
);

-- A retried approval or case creation with the same key replays the first answer. Keyed by org, person and key, so
-- a person in two orgs cannot replay org A's answer in org B.
CREATE TABLE idempotency_keys (
  org_id         TEXT NOT NULL REFERENCES orgs(id),
  user_id        TEXT NOT NULL,
  key            TEXT NOT NULL,
  route          TEXT NOT NULL,
  body_sha       TEXT NOT NULL,
  response_json  TEXT NOT NULL CHECK (json_valid(response_json)),
  status         INTEGER NOT NULL,
  created_at     TEXT NOT NULL CHECK (created_at GLOB '[0-9][0-9][0-9][0-9]-*Z'),
  PRIMARY KEY (org_id, user_id, key)
);

-- D1 has no interactive transactions; a guard inserts its condition's result here and a false one fails the CHECK,
-- rolling back the whole batch (store/write.ts).
CREATE TABLE write_guards (
  org_id    TEXT NOT NULL REFERENCES orgs(id),
  batch_id  TEXT NOT NULL,
  code      TEXT NOT NULL,
  ok        INTEGER NOT NULL CHECK (ok = 1)
);

-- One row per org. data_epoch changes on every reset of that org, so a tab opened before a reset cannot write into
-- the new data, and a reset of one org never reloads a demo running in another. reset_in_progress is 1 only inside
-- that org's reset batch; the append-only triggers let deletes of that org's rows through only then.
CREATE TABLE demo_state (
  org_id             TEXT PRIMARY KEY REFERENCES orgs(id),
  seed_version       TEXT,
  data_epoch         INTEGER NOT NULL DEFAULT 1,
  reset_at           TEXT,
  reset_by           TEXT,
  reset_in_progress  INTEGER NOT NULL DEFAULT 0 CHECK (reset_in_progress IN (0,1))
);

-- ---------- 11. Audit ----------
CREATE TABLE access_log (                    -- append-only; written by the server only
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  org_id          TEXT NOT NULL,              -- no foreign key, as for the other ids: the audit must outlive its rows
  at              TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) CHECK (at GLOB '[0-9][0-9][0-9][0-9]-*Z'),
  actor_user_id   TEXT NOT NULL,              -- the real person (no FK: the audit must outlive a user row)
  actor_name      TEXT NOT NULL,
  acted_as_role   TEXT NOT NULL CHECK (acted_as_role IN ('doctor','coordinator','admin')),
  acted_as_membership TEXT,                   -- the membership acted as; NULL in rows from before orgs
  impersonating   INTEGER NOT NULL DEFAULT 0 CHECK (impersonating IN (0,1)),
  auth_mode       TEXT NOT NULL CHECK (auth_mode IN ('demo','access','oidc')),
  case_id         TEXT,                       -- no FK, same reason
  document_id     TEXT,
  page_n          INTEGER,
  action          TEXT NOT NULL,              -- code: 'case.open', 'source.view', ...
  what_cs         TEXT NOT NULL,              -- the line the Administrace view shows; never quotes or document text
  break_glass_reason TEXT,
  request_id      TEXT,                       -- cf-ray, for joining with Worker logs
  target_type     TEXT,
  target_id       TEXT,
  data_epoch      INTEGER
);

-- ---------- 12. Today's data goes to demo org A ----------
-- Parents first. Every person gets a membership in org A with the role and function they had; a person removed from
-- the staff list keeps the membership, ended, so the history rows that name them stay valid.
INSERT INTO users (id, pre, sur, post, email, active, created_at)
  SELECT id, pre, sur, post, email, 1, created_at FROM users_old;
INSERT INTO memberships (id, org_id, user_id, role_id, fn, active_from, active_until, created_at)
  SELECT id, 'demo-a', id, role_id, fn, created_at, CASE WHEN active = 1 THEN NULL ELSE strftime('%Y-%m-%dT%H:%M:%fZ','now') END, created_at FROM users_old;
INSERT INTO departments (id, org_id, name, sort) SELECT id, 'demo-a', name, sort FROM departments_old;
INSERT INTO dept_members (org_id, dept_id, user_id, position) SELECT 'demo-a', dept_id, user_id, position FROM dept_members_old;
INSERT INTO patients (id, org_id, full_name, name_as_written, birth_number, birth_as_written, age_as_written, insurer, sex, sex_certainty,
    identity_warning, name_note_cs, name_note_source_json, identity_source_json, data_origin, created_at)
  SELECT id, 'demo-a', full_name, name_as_written, birth_number, birth_as_written, age_as_written, insurer, sex, sex_certainty,
    identity_warning, name_note_cs, name_note_source_json, identity_source_json, data_origin, created_at FROM patients_old;
INSERT INTO cases (id, org_id, case_no, patient_id, source_file, list_order, status, processing_level, question_text, question_explicit,
    question_purpose, question_source_json, question_draft, question_kind, question_basis_json, diagnosis_text, diagnosis_note, mkn10,
    summary_one_line, page_count, referrer_name, referring_dept, referring_dept_is_example, context_note_cs, owner_user_id, owner_name,
    owner_is_example, submitted_on, submitted_is_example, updated_on, created_at, duplicate_override_reason, created_by, intake_open,
    intake_fixture, referral_sha256)
  SELECT id, 'demo-a', id, patient_id, source_file, list_order, status, processing_level, question_text, question_explicit,
    question_purpose, question_source_json, question_draft, question_kind, question_basis_json, diagnosis_text, diagnosis_note, mkn10,
    summary_one_line, page_count, referrer_name, referring_dept, referring_dept_is_example, context_note_cs, owner_user_id, owner_name,
    owner_is_example, submitted_on, submitted_is_example, updated_on, created_at, duplicate_override_reason, created_by, intake_open,
    intake_fixture, referral_sha256 FROM cases_old;
INSERT INTO case_members (id, org_id, case_id, user_id, dept_id, reason, added_by, added_at)
  SELECT id, 'demo-a', case_id, user_id, dept_id, reason, added_by, added_at FROM case_members_old;
INSERT INTO status_history (id, org_id, case_id, from_status, to_status, by_user_id, by_name, how, at)
  SELECT id, 'demo-a', case_id, from_status, to_status, by_user_id, by_name, how, at FROM status_history_old;
INSERT INTO case_access_grants (id, org_id, case_id, user_id, reason, granted_at, expires_at)
  SELECT id, 'demo-a', case_id, user_id, reason, granted_at, expires_at FROM case_access_grants_old;
INSERT INTO slots (id, org_id, day, time, case_id, booked_by, booked_at)
  SELECT id, 'demo-a', day, time, case_id, booked_by, booked_at FROM slots_old;
INSERT INTO sessions (org_id, day, started_by, started_at, ended_at, started_by_name)
  SELECT 'demo-a', day, started_by, started_at, ended_at, started_by_name FROM sessions_old;
INSERT INTO attendance (org_id, set_key, dept_id, position, user_id, user_name)
  SELECT 'demo-a', set_key, dept_id, position, user_id, user_name FROM attendance_old;
INSERT INTO attendance_sets (org_id, set_key, version, updated_by, updated_at)
  SELECT 'demo-a', set_key, version, updated_by, updated_at FROM attendance_sets_old;
INSERT INTO protocols (case_id, org_id, mode, notes, conclusion, steps_json, state, version, updated_by, updated_at, updated_by_name,
    approved_by_name, approved_at)
  SELECT case_id, 'demo-a', mode, notes, conclusion, steps_json, state, version, updated_by, updated_at, updated_by_name,
    approved_by_name, approved_at FROM protocols_old;
INSERT INTO decisions (id, org_id, case_id, version, conclusion, approved_by_user_id, approved_by_name, approved_at, slot_day, slot_time,
    report_snapshot_json, attendance_snapshot_json, supersedes_id)
  SELECT id, 'demo-a', case_id, version, conclusion, approved_by_user_id, approved_by_name, approved_at, slot_day, slot_time,
    report_snapshot_json, attendance_snapshot_json, supersedes_id FROM decisions_old ORDER BY case_id, version;
INSERT INTO task_suggestions (id, org_id, case_id, decision_id, decision_version, text, quote, who, due, due_source, due_by, timing, state,
    decided_by, decided_by_name, decided_at, created_at)
  SELECT id, 'demo-a', case_id, decision_id, decision_version, text, quote, who, due, due_source, due_by, timing, state,
    decided_by, decided_by_name, decided_at, created_at FROM task_suggestions_old;
INSERT INTO tasks (id, org_id, case_id, text, assignee_user_id, assignee_name, due, due_source, due_by, timing, done, done_by, done_at,
    from_suggestion_id, confirmed_by, created_by, created_at, done_by_name)
  SELECT id, 'demo-a', case_id, text, assignee_user_id, assignee_name, due, due_source, due_by, timing, done, done_by, done_at,
    from_suggestion_id, confirmed_by, created_by, created_at, done_by_name FROM tasks_old;
INSERT INTO question_confirmations (id, org_id, case_id, text, by_user_id, by_name, at)
  SELECT id, 'demo-a', case_id, text, by_user_id, by_name, at FROM question_confirmations_old;
INSERT INTO fact_edits (org_id, case_id, key, text, orig, by_user_id, by_name, at, log_id, extraction_run_id)
  SELECT 'demo-a', case_id, key, text, orig, by_user_id, by_name, at, log_id, extraction_run_id FROM fact_edits_old;
INSERT INTO edit_log (id, org_id, case_id, key, orig, text, reverted, by_user_id, by_name, at, confirmed)
  SELECT id, 'demo-a', case_id, key, orig, text, reverted, by_user_id, by_name, at, confirmed FROM edit_log_old;
INSERT INTO extraction_runs (id, org_id, case_id, kind, model, prompt_version, temperature, input_hashes_json, r2_key, sha256, is_current,
    created_at, producer)
  SELECT id, 'demo-a', case_id, kind, model, prompt_version, temperature, input_hashes_json, r2_key, sha256, is_current,
    created_at, producer FROM extraction_runs_old;
INSERT INTO alerts (id, org_id, case_id, run_id, origin, position, kind, text_cs, relevant)
  SELECT id, 'demo-a', case_id, run_id, origin, position, kind, text_cs, relevant FROM alerts_old;
INSERT INTO alert_events (id, org_id, alert_id, action, by_user_id, by_name, at)
  SELECT id, 'demo-a', alert_id, action, by_user_id, by_name, at FROM alert_events_old;
INSERT INTO documents (id, org_id, case_id, file_name, media_type, page_count, original_r2_key, sha256, size_bytes, origin, processing,
    note_cs, uploaded_by, created_at, state, state_detail_cs, fixture_id, identity, title_cs, doc_type, doc_date, readability,
    readability_reasons_json, source, upload_session_id)
  SELECT id, 'demo-a', case_id, file_name, media_type, page_count, original_r2_key, sha256, size_bytes, origin, processing,
    note_cs, uploaded_by, created_at, state, state_detail_cs, fixture_id, identity, title_cs, doc_type, doc_date, readability,
    readability_reasons_json, source, upload_session_id FROM documents_old;
INSERT INTO document_parts (org_id, document_id, ordinal, title_cs, type, date, date_note_cs, pages_json, readability, reason_cs, upload_name)
  SELECT 'demo-a', document_id, ordinal, title_cs, type, date, date_note_cs, pages_json, readability, reason_cs, upload_name FROM document_parts_old;
INSERT INTO pages (org_id, document_id, n, json_r2_key, image_r2_key, redacted_r2_key, width, height, engine, mean_conf, low_conf_words,
    is_empty, verify_count, redaction_count, redaction_reasons_json)
  SELECT 'demo-a', document_id, n, json_r2_key, image_r2_key, redacted_r2_key, width, height, engine, mean_conf, low_conf_words,
    is_empty, verify_count, redaction_count, redaction_reasons_json FROM pages_old;
INSERT INTO pipeline_runs (id, org_id, document_id, case_id, state, stage, error_code, pipeline_version, container_versions_json, stages_json,
    input_sha256, output_prefix, page_count, readability, readability_reasons_json, verify_count, lab_points, lab_unclear, diff_same,
    diff_verify, diff_silent, diff_missing, created_by, created_by_name, created_at, updated_at, finished_at)
  SELECT id, 'demo-a', document_id, case_id, state, stage, error_code, pipeline_version, container_versions_json, stages_json,
    input_sha256, output_prefix, page_count, readability, readability_reasons_json, verify_count, lab_points, lab_unclear, diff_same,
    diff_verify, diff_silent, diff_missing, created_by, created_by_name, created_at, updated_at, finished_at FROM pipeline_runs_old;
INSERT INTO upload_sessions (id, org_id, token_hash, case_id, target, created_by, created_at, expires_at, closed_at, file_count)
  SELECT id, 'demo-a', token_hash, case_id, target, created_by, created_at, expires_at, closed_at, file_count FROM upload_sessions_old;
INSERT INTO recordings (id, org_id, session_day, started_by, started_by_name, started_at, ended_at, end_reason)
  SELECT id, 'demo-a', session_day, started_by, started_by_name, started_at, ended_at, end_reason FROM recordings_old;
INSERT INTO jobs (id, org_id, kind, case_id, workflow, instance_id, attempt, state, phase, error_code, result_ref, created_by, created_by_name,
    created_by_role, created_at, updated_at)
  SELECT id, 'demo-a', kind, case_id, workflow, instance_id, attempt, state, phase, error_code, result_ref, created_by, created_by_name,
    created_by_role, created_at, updated_at FROM jobs_old;
INSERT INTO transcript_passes (id, org_id, case_id, decision_id, job_id, from_wall_ms, cutoff_wall_ms, state, error_code, purge_reason,
    covered_json, speaker_count, line_count, audio_deleted_at, created_at, updated_at)
  SELECT id, 'demo-a', case_id, decision_id, job_id, from_wall_ms, cutoff_wall_ms, state, error_code, purge_reason,
    covered_json, speaker_count, line_count, audio_deleted_at, created_at, updated_at FROM transcript_passes_old;
INSERT INTO transcript_lines (id, org_id, case_id, recording_id, client_line_id, source, pass_id, speaker, wall_ms, text, state,
    superseded_by_pass, created_by, created_at)
  SELECT id, 'demo-a', case_id, recording_id, client_line_id, source, pass_id, speaker, wall_ms, text, state,
    superseded_by_pass, created_by, created_at FROM transcript_lines_old;
INSERT INTO transcript_summaries (id, org_id, case_id, pass_id, state, basis, text, error_code, model, prompt_version, input_sha, cache_hit,
    label, created_at)
  SELECT id, 'demo-a', case_id, pass_id, state, basis, text, error_code, model, prompt_version, input_sha, cache_hit,
    label, created_at FROM transcript_summaries_old;
INSERT INTO audio_uploads (id, org_id, case_id, recording_id, pass_id, r2_key, r2_upload_id, state, bytes, created_by, created_at,
    completed_at, deleted_at, delete_reason)
  SELECT id, 'demo-a', case_id, recording_id, pass_id, r2_key, r2_upload_id, state, bytes, created_by, created_at,
    completed_at, deleted_at, delete_reason FROM audio_uploads_old;
INSERT INTO audio_parts (org_id, upload_id, part_number, etag, bytes, is_final)
  SELECT 'demo-a', upload_id, part_number, etag, bytes, is_final FROM audio_parts_old;
INSERT INTO audio_segments (org_id, upload_id, start_sample, wall_ms)
  SELECT 'demo-a', upload_id, start_sample, wall_ms FROM audio_segments_old;
INSERT INTO notifications (id, org_id, kind, to_user_id, case_id, count, link, created_by, created_by_name, created_at, sent_at)
  SELECT id, 'demo-a', kind, to_user_id, case_id, count, link, created_by, created_by_name, created_at, sent_at FROM notifications_old;
INSERT INTO idempotency_keys (org_id, user_id, key, route, body_sha, response_json, status, created_at)
  SELECT 'demo-a', user_id, key, route, body_sha, response_json, status, created_at FROM idempotency_keys_old;
-- write_guards holds rows only inside a batch; nothing to copy.
INSERT INTO demo_state (org_id, seed_version, data_epoch, reset_at, reset_by, reset_in_progress)
  SELECT 'demo-a', seed_version, data_epoch, reset_at, reset_by, 0 FROM demo_state_old WHERE id = 1;
-- A database without the row (it is created by migration 0003, so only one edited by hand) still gets org A's state.
INSERT INTO demo_state (org_id, data_epoch) SELECT 'demo-a', 1 WHERE NOT EXISTS (SELECT 1 FROM demo_state WHERE org_id = 'demo-a');
INSERT INTO access_log (id, org_id, at, actor_user_id, actor_name, acted_as_role, acted_as_membership, impersonating, auth_mode, case_id,
    document_id, page_n, action, what_cs, break_glass_reason, request_id, target_type, target_id, data_epoch)
  SELECT id, 'demo-a', at, actor_user_id, actor_name, acted_as_role, NULL, impersonating, auth_mode, case_id,
    document_id, page_n, action, what_cs, break_glass_reason, request_id, target_type, target_id, data_epoch FROM access_log_old;

-- ---------- 13. The old tables go, children first ----------
DROP TABLE audio_segments_old;
DROP TABLE audio_parts_old;
DROP TABLE audio_uploads_old;
DROP TABLE transcript_summaries_old;
DROP TABLE transcript_lines_old;
DROP TABLE transcript_passes_old;
DROP TABLE jobs_old;
DROP TABLE recordings_old;
DROP TABLE pipeline_runs_old;
DROP TABLE pages_old;
DROP TABLE document_parts_old;
DROP TABLE documents_old;
DROP TABLE alert_events_old;
DROP TABLE alerts_old;
DROP TABLE extraction_runs_old;
DROP TABLE edit_log_old;
DROP TABLE fact_edits_old;
DROP TABLE question_confirmations_old;
DROP TABLE tasks_old;
DROP TABLE task_suggestions_old;
DROP TABLE decisions_old;
DROP TABLE protocols_old;
DROP TABLE attendance_old;
DROP TABLE attendance_sets_old;
DROP TABLE sessions_old;
DROP TABLE slots_old;
DROP TABLE status_history_old;
DROP TABLE case_access_grants_old;
DROP TABLE case_members_old;
DROP TABLE cases_old;
DROP TABLE patients_old;
DROP TABLE dept_members_old;
DROP TABLE departments_old;
DROP TABLE upload_sessions_old;
DROP TABLE notifications_old;
DROP TABLE idempotency_keys_old;
DROP TABLE write_guards_old;
DROP TABLE access_log_old;
DROP TABLE demo_state_old;
DROP TABLE users_old;

-- ---------- 14. Indexes ----------
CREATE INDEX memberships_user ON memberships(user_id);
CREATE INDEX dept_members_user ON dept_members(org_id, user_id);
CREATE INDEX patients_birth_number ON patients(org_id, birth_number) WHERE birth_number IS NOT NULL;
CREATE INDEX cases_patient ON cases(org_id, patient_id);
CREATE INDEX cases_status ON cases(org_id, status);
CREATE INDEX cases_list ON cases(org_id, list_order);
CREATE INDEX cases_intake ON cases(intake_open, created_at) WHERE intake_open = 1;
-- One case of an org holds a fixture's prepared extraction: a second copy would share its pages.
CREATE UNIQUE INDEX cases_intake_fixture ON cases(org_id, intake_fixture) WHERE intake_fixture IS NOT NULL AND intake_open = 0;
CREATE UNIQUE INDEX case_members_user ON case_members(case_id, user_id) WHERE user_id IS NOT NULL;
CREATE UNIQUE INDEX case_members_dept ON case_members(case_id, dept_id) WHERE dept_id IS NOT NULL;
CREATE INDEX case_members_by_user ON case_members(org_id, user_id);
CREATE INDEX status_history_case ON status_history(case_id, at);
CREATE INDEX case_access_grants_user ON case_access_grants(org_id, user_id, case_id, expires_at);
CREATE INDEX tasks_case ON tasks(case_id);
CREATE INDEX tasks_org ON tasks(org_id, id);
CREATE INDEX tasks_assignee ON tasks(org_id, assignee_user_id, done);
CREATE INDEX task_suggestions_case ON task_suggestions(case_id);
CREATE INDEX question_confirmations_case ON question_confirmations(case_id, at);
CREATE INDEX edit_log_case ON edit_log(case_id, at);
CREATE UNIQUE INDEX extraction_runs_current ON extraction_runs(case_id) WHERE is_current = 1;
CREATE INDEX alerts_case ON alerts(case_id);
CREATE INDEX alert_events_alert ON alert_events(alert_id, at);
CREATE INDEX documents_case ON documents(case_id);
-- The same bytes twice in one case are one document; the file name is display data only.
CREATE UNIQUE INDEX documents_case_sha ON documents(org_id, case_id, sha256) WHERE sha256 IS NOT NULL;
CREATE INDEX documents_upload_session ON documents(upload_session_id) WHERE upload_session_id IS NOT NULL;
CREATE INDEX pipeline_runs_doc ON pipeline_runs(document_id, created_at);
-- One run at a time per document: a double click cannot start two.
CREATE UNIQUE INDEX pipeline_runs_active ON pipeline_runs(document_id) WHERE state IN ('queued','running');
CREATE INDEX upload_sessions_case ON upload_sessions(case_id);
CREATE INDEX recordings_session ON recordings(org_id, session_day);
CREATE INDEX jobs_case ON jobs(case_id, created_at);
CREATE INDEX jobs_state ON jobs(state);
CREATE INDEX transcript_passes_case ON transcript_passes(case_id, cutoff_wall_ms);
CREATE INDEX transcript_lines_case ON transcript_lines(case_id, state, wall_ms);
CREATE INDEX transcript_lines_pass ON transcript_lines(pass_id, state);
CREATE INDEX transcript_summaries_case ON transcript_summaries(case_id, created_at);
CREATE UNIQUE INDEX audio_uploads_open ON audio_uploads(case_id, recording_id) WHERE pass_id IS NULL AND state = 'open';
CREATE INDEX audio_uploads_pass ON audio_uploads(pass_id);
CREATE INDEX audio_uploads_state ON audio_uploads(state, created_at);
CREATE INDEX notifications_case ON notifications(org_id, case_id);
CREATE INDEX access_log_case ON access_log(case_id, at);
CREATE INDEX access_log_actor ON access_log(org_id, actor_user_id, at);
CREATE INDEX access_log_at ON access_log(org_id, at);
CREATE INDEX write_guards_batch ON write_guards(batch_id);

-- ---------- 15. Triggers ----------
-- Append-only tables refuse UPDATE and DELETE, except a DELETE of a row of an org whose reset batch is running
-- (reset_in_progress = 1 on that org's demo_state row). COALESCE keeps the protection on when the org has no row. A
-- pilot database must ship these triggers without the exception (api/AGENTS.md).
CREATE TRIGGER decisions_no_update BEFORE UPDATE ON decisions BEGIN SELECT RAISE(ABORT, 'append-only: decisions'); END;
CREATE TRIGGER decisions_no_delete BEFORE DELETE ON decisions WHEN COALESCE((SELECT reset_in_progress FROM demo_state WHERE org_id = OLD.org_id), 0) = 0 BEGIN SELECT RAISE(ABORT, 'append-only: decisions'); END;
CREATE TRIGGER status_history_no_update BEFORE UPDATE ON status_history BEGIN SELECT RAISE(ABORT, 'append-only: status_history'); END;
CREATE TRIGGER status_history_no_delete BEFORE DELETE ON status_history WHEN COALESCE((SELECT reset_in_progress FROM demo_state WHERE org_id = OLD.org_id), 0) = 0 BEGIN SELECT RAISE(ABORT, 'append-only: status_history'); END;
CREATE TRIGGER edit_log_no_update BEFORE UPDATE ON edit_log BEGIN SELECT RAISE(ABORT, 'append-only: edit_log'); END;
CREATE TRIGGER edit_log_no_delete BEFORE DELETE ON edit_log WHEN COALESCE((SELECT reset_in_progress FROM demo_state WHERE org_id = OLD.org_id), 0) = 0 BEGIN SELECT RAISE(ABORT, 'append-only: edit_log'); END;
CREATE TRIGGER alert_events_no_update BEFORE UPDATE ON alert_events BEGIN SELECT RAISE(ABORT, 'append-only: alert_events'); END;
CREATE TRIGGER alert_events_no_delete BEFORE DELETE ON alert_events WHEN COALESCE((SELECT reset_in_progress FROM demo_state WHERE org_id = OLD.org_id), 0) = 0 BEGIN SELECT RAISE(ABORT, 'append-only: alert_events'); END;
CREATE TRIGGER question_confirmations_no_update BEFORE UPDATE ON question_confirmations BEGIN SELECT RAISE(ABORT, 'append-only: question_confirmations'); END;
CREATE TRIGGER question_confirmations_no_delete BEFORE DELETE ON question_confirmations WHEN COALESCE((SELECT reset_in_progress FROM demo_state WHERE org_id = OLD.org_id), 0) = 0 BEGIN SELECT RAISE(ABORT, 'append-only: question_confirmations'); END;
CREATE TRIGGER access_log_no_update BEFORE UPDATE ON access_log BEGIN SELECT RAISE(ABORT, 'append-only: access_log'); END;
CREATE TRIGGER access_log_no_delete BEFORE DELETE ON access_log WHEN COALESCE((SELECT reset_in_progress FROM demo_state WHERE org_id = OLD.org_id), 0) = 0 BEGIN SELECT RAISE(ABORT, 'append-only: access_log'); END;
-- A decision may only supersede an earlier decision of the same case (so of the same org), with the next version.
CREATE TRIGGER decisions_supersede_same_case BEFORE INSERT ON decisions WHEN NEW.supersedes_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM decisions d WHERE d.id = NEW.supersedes_id AND d.org_id = NEW.org_id AND d.case_id = NEW.case_id AND d.version = NEW.version - 1) BEGIN SELECT RAISE(ABORT, 'decision must supersede the previous version of the same case'); END;

-- reset-demo (src/routes/demo.ts): the rows uploads, intakes, pipeline runs and phone upload sessions added are removed
-- by these triggers, which fire on the reset batch's own "reset_in_progress = 1" statement for one org, so the batch
-- does not grow. Only that org's rows go; seeded documents stay. A new table written by those routes goes in here.
CREATE TRIGGER demo_reset_uploads AFTER UPDATE OF reset_in_progress ON demo_state
WHEN NEW.reset_in_progress = 1 AND OLD.reset_in_progress = 0
BEGIN
  DELETE FROM pipeline_runs WHERE org_id = NEW.org_id;
  -- alert_events first: D1 checks foreign keys at once outside a deferred batch (seed.py --reset).
  DELETE FROM alert_events WHERE org_id = NEW.org_id AND alert_id IN (SELECT a.id FROM alerts a JOIN extraction_runs r ON r.id = a.run_id WHERE r.org_id = NEW.org_id AND r.producer IS NOT NULL);
  DELETE FROM alerts WHERE org_id = NEW.org_id AND run_id IN (SELECT id FROM extraction_runs WHERE org_id = NEW.org_id AND producer IS NOT NULL);
  DELETE FROM extraction_runs WHERE org_id = NEW.org_id AND producer IS NOT NULL;
  DELETE FROM pages WHERE org_id = NEW.org_id AND document_id IN (SELECT id FROM documents WHERE org_id = NEW.org_id AND origin <> 'seed');
  DELETE FROM document_parts WHERE org_id = NEW.org_id AND document_id IN (SELECT id FROM documents WHERE org_id = NEW.org_id AND origin <> 'seed');
  DELETE FROM documents WHERE org_id = NEW.org_id AND origin <> 'seed';
END;
CREATE TRIGGER demo_reset_upload_sessions AFTER UPDATE OF reset_in_progress ON demo_state
WHEN NEW.reset_in_progress = 1 AND OLD.reset_in_progress = 0
BEGIN
  DELETE FROM upload_sessions WHERE org_id = NEW.org_id;
END;

PRAGMA defer_foreign_keys = false;
