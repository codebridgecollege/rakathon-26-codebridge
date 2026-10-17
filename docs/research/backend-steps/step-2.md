# Step 2 design: D1 schema, seed, read API, frontend loader, per-page index in R2

Status: implementation design, 2026-10-17, branch `backend`. Builds on
Step 1 (the `api/` Wrangler project with Hono, `/api/health`, the auth
middleware with `AUTH_MODE=demo|access`, and the JSON error format
`{ error: { code, message_cs } }`). Source of the requirements:
`docs/research/2026-10-17-backend-migration.md` ("Do we need a database",
"API", "Foundations every step builds on", "Decisions", "Migration plan").

Terms: **D1** is Cloudflare's SQLite database; **R2** is its object
storage; **fixture** is one of the synthetic JSON files in
`mocks/src/data/` that the static mock embeds today; **case 10** is FNO's
patient `10_pacient.pdf`, the only fully processed case.

## Goal

Move the demo's data out of the HTML and into storage the server controls,
without changing what the doctor sees:

1. A D1 schema for every table the research doc lists, with append-only
   triggers, CHECK constraints and ISO timestamps.
2. A seed script that turns today's fixtures into D1 rows and R2 objects,
   with identity kept in `patients` only.
3. Read endpoints whose JSON matches the shapes the page consumes today, so
   the frontend change is a data-source swap. Each read checks role and case
   membership and writes its own audit entry on the server.
4. A loader in `mocks/src/v3-template.html` that uses the API when
   `/api/health` says the data API is on, and keeps the embedded data as the
   fallback (Pages, `file://`).
5. The page index split into one R2 object per page, served through the
   Worker after the access check.

## Scope / out of scope

**In scope**

- `api/migrations/0001_init.sql` (tables, indexes, CHECKs) and
  `api/migrations/0002_append_only.sql` (triggers).
- `api/seed/seed.py` with `api/seed/README.md` lines in `api/README.md`.
- Read routes: `/me`, `/staff`, `/patients`, `/cases/:id`,
  `/cases/:id/extraction`, `/cases/:id/documents`, `/cases/:id/alerts`,
  `/cases/:id/decisions`, `/cases/:id/history`, `/documents/:id/pages/:n`,
  `/documents/:id/pages/:n/image`, `/cases/:id/guidance`,
  `/cases/:id/prognosis`, `/tasks`, `/calendar`, `/admin/access-log`.
- Store interfaces (`api/src/store/`) with a D1/R2 implementation.
- Frontend loader, `api.guidance` and `srcApi` on fetch, server access log
  in Administrace, a "data source" chip.
- Tests in the Workers Vitest integration, plus a seed smoke test.
- Doc updates the change makes stale (listed under "Docs to update").

**Out of scope (later steps)**

- Writes of any kind, including break-the-glass, staff edits, alert events,
  edits, decisions (Step 4). Write tables are created now and stay empty,
  so Step 4 adds routes, not a schema rewrite.
- The per-case data cache that lifts the case-10-only limit (Step 3). In
  this step case 10's extraction is loaded at startup into the existing
  `CASE`/`EXTRA` globals; S01 and S02 keep reading the embedded `SYN`.
- Removing the embedded data from `mocks/build.py`. The same build serves
  Pages and the Worker during the migration (Foundations, "Frontend
  switch"), so in this step the HTML still carries all fixtures. **The data
  minimization gain arrives in Step 3/5, not here.** Say so in the PR.
- `POST /documents/:id/pages/:n/locate`. The page JSON the viewer fetches
  already holds the words and text, so quote matching stays in the browser
  on the fetched page (the quote then never leaves the browser). The server
  route becomes useful only when pages are served without words (redacted
  view for a cloud model), so it moves to Step 6.
- `/cases/:id/brief`, `/record`, `/labs` as separate slices. They are key
  subsets of the same stored JSON and have no consumer until Step 3 loads
  per tab. Step 3 adds them as views over `extract/...json`.
- Prognosis search (Step 5). Only the saved result is served.
- Upload and the S02 intake flow (Steps 4 and 6). S02 is not seeded as a
  case; its files are stored as a fixture library entry.
- Retrospective deviation assessments as a table. Per the user decision of
  2026-10-17 (CLAUDE.md, guideline layer) they are read-only with no
  writer and no rating required. They ship inside the guidance JSON as
  seeded read-only data (`prior_assessments`, empty today because the mock
  starts with `S.retro = {}` and no `pr.dev`). There is no
  `deviation_assessments` table.

## Design

### File layout added in this step

```
api/
  migrations/0001_init.sql
  migrations/0002_append_only.sql
  seed/seed.py                 # uv script, generates SQL + R2 manifest, runs wrangler
  seed/out/                    # gitignored: seed.sql, r2-manifest.json, identity-scan.txt, .seed-state.json
  src/store/types.ts           # CaseStore, DirectoryStore, AuditStore, BlobStore interfaces
  src/store/d1.ts              # D1 implementation
  src/store/r2.ts              # R2 implementation of BlobStore
  src/domain/access.ts         # canReadCase(user, caseRow, members), role rules; no Cloudflare imports
  src/domain/rows.ts           # D1 row -> frontend patient row (pure, unit-tested)
  src/routes/directory.ts      # /me, /staff
  src/routes/patients.ts       # /patients, /cases/:id, /cases/:id/history, /decisions
  src/routes/caseData.ts       # /extraction, /documents, /alerts, /guidance, /prognosis
  src/routes/pages.ts          # /documents/:id/pages/:n(+/image)
  src/routes/work.ts           # /tasks, /calendar
  src/routes/admin.ts          # /admin/access-log
  src/middleware/audit.ts      # audit(c, entry) helper
  test/...                     # see Tests
```

`wrangler.jsonc` additions:

```jsonc
"d1_databases": [{ "binding": "DB", "database_name": "codebridge-mdt", "database_id": "<from d1 create>", "migrations_dir": "migrations" }],
"r2_buckets":   [{ "binding": "DOCS", "bucket_name": "codebridge-mdt-docs", "jurisdiction": "eu" }],
"vars": { "DATA_API": "on" }   // "off" keeps /api/health reporting data_api:false, so the page stays on embedded data
```

Create once, by hand, and record the commands in `api/README.md`:

```
npx wrangler d1 create codebridge-mdt --jurisdiction eu
npx wrangler r2 bucket create codebridge-mdt-docs --jurisdiction eu
npx wrangler d1 migrations apply codebridge-mdt --remote
```

Jurisdiction can only be set at creation. Verify it on the created database
(dashboard or `wrangler d1 info codebridge-mdt`) and record the result in
`docs/agent/OPEN_QUESTIONS.md` ("Do D1 and R2 really keep data in the
EU"), moving the answer to `docs/agent/HACKATHON.md` once known.

### D1 schema

Conventions:

- Timestamps are ISO 8601 UTC text, `YYYY-MM-DDTHH:MM:SS.sssZ`, default
  `strftime('%Y-%m-%dT%H:%M:%fZ','now')`, checked with a GLOB. Calendar
  days are `YYYY-MM-DD`. Dates taken from documents keep their written
  form (`birth_as_written`, partial dates in JSON), never a made-up day.
- Booleans are `INTEGER NOT NULL CHECK (x IN (0,1))`.
- IDs: cases keep the mock's `NO-<nr>` (`NO-010`, `NO-S01`); seeded
  documents use the PDF stem (`10_pacient`); users keep the mock's staff ids
  (`d2p1`, `coord`); `admin` for the administrator. Server-made ids later
  are random UUIDs.
- Names in history rows are stored as the display string at that time
  (`by_name`) next to the user id, because the UI's history shows the name
  as it was (mock comment at the staff list, "history ... stores the name
  string and keeps it").
- **Tenant room**: no `org_id` now (decision: shared demo). Every clinical
  table hangs off `cases.id`; the directory tables, `patients`, `sessions`
  and `slots` are the only ones a later tenant migration must touch
  (`org_id` on `cases`, `patients`, `users`, `departments`, `sessions`,
  `slots`, and `UNIQUE(day,time)` becomes `UNIQUE(org_id,day,time)`).
- D1 enforces foreign keys, so the seed inserts in dependency order.

`api/migrations/0001_init.sql`:

```sql
-- CodeBridge D1 schema v1. Identity lives in patients only; every clinical row refers to a case id.
-- Timestamps: ISO 8601 UTC with milliseconds. The GLOB below is shared by every *_at column.

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
              CHECK (created_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9]*Z')
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
```

`api/migrations/0002_append_only.sql` (kept in its own file so the seed's
reset can re-run exactly this text):

```sql
-- Append-only tables refuse UPDATE and DELETE. This stops the app, not someone with D1 console access;
-- the daily R2 export with a retention lock (later step) covers that.
CREATE TRIGGER decisions_no_update BEFORE UPDATE ON decisions BEGIN SELECT RAISE(ABORT, 'append-only: decisions'); END;
CREATE TRIGGER decisions_no_delete BEFORE DELETE ON decisions BEGIN SELECT RAISE(ABORT, 'append-only: decisions'); END;
CREATE TRIGGER status_history_no_update BEFORE UPDATE ON status_history BEGIN SELECT RAISE(ABORT, 'append-only: status_history'); END;
CREATE TRIGGER status_history_no_delete BEFORE DELETE ON status_history BEGIN SELECT RAISE(ABORT, 'append-only: status_history'); END;
CREATE TRIGGER edit_log_no_update BEFORE UPDATE ON edit_log BEGIN SELECT RAISE(ABORT, 'append-only: edit_log'); END;
CREATE TRIGGER edit_log_no_delete BEFORE DELETE ON edit_log BEGIN SELECT RAISE(ABORT, 'append-only: edit_log'); END;
CREATE TRIGGER alert_events_no_update BEFORE UPDATE ON alert_events BEGIN SELECT RAISE(ABORT, 'append-only: alert_events'); END;
CREATE TRIGGER alert_events_no_delete BEFORE DELETE ON alert_events BEGIN SELECT RAISE(ABORT, 'append-only: alert_events'); END;
CREATE TRIGGER question_confirmations_no_update BEFORE UPDATE ON question_confirmations BEGIN SELECT RAISE(ABORT, 'append-only: question_confirmations'); END;
CREATE TRIGGER question_confirmations_no_delete BEFORE DELETE ON question_confirmations BEGIN SELECT RAISE(ABORT, 'append-only: question_confirmations'); END;
CREATE TRIGGER access_log_no_update BEFORE UPDATE ON access_log BEGIN SELECT RAISE(ABORT, 'append-only: access_log'); END;
CREATE TRIGGER access_log_no_delete BEFORE DELETE ON access_log BEGIN SELECT RAISE(ABORT, 'append-only: access_log'); END;
-- A decision may only supersede an earlier decision of the same case, with the next version number.
CREATE TRIGGER decisions_supersede_same_case BEFORE INSERT ON decisions
WHEN NEW.supersedes_id IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM decisions d WHERE d.id = NEW.supersedes_id AND d.case_id = NEW.case_id AND d.version = NEW.version - 1)
BEGIN SELECT RAISE(ABORT, 'decision must supersede the previous version of the same case'); END;
```

Each trigger is one line so a statement splitter cannot cut a `BEGIN ...
END` body apart; the test suite checks they exist after
`wrangler d1 migrations apply` (see Risks).

**Every UI field and its column** (from `listPatient`, `initialPatients`,
the `S` object, `defaultStaff`, `STATUS`, slots and tasks in
`mocks/src/v3-template.html`):

| UI field (today) | Comes from today | Column |
|---|---|---|
| `p.file` | `o.file`, `CASE.file` | `cases.source_file` |
| `p.id` | `caseId(file)` | `cases.id` |
| `p.name` | `o.name`, `CASE.patient.name` | `patients.full_name` |
| `p.nameAsWritten` | `CASE.patient.name_as_written` | `patients.name_as_written` |
| `p.rc` | `o.rc`, `CASE.patient.birth_number` | `patients.birth_number` |
| `p.birth` | `age_or_birth` matching a date, minus "nar." | `patients.birth_as_written` |
| `p.age` | `age_or_birth` containing "let", `CASE.patient.age` | `patients.age_as_written` |
| `p.synthetic` | `SYN_BY_FILE[file].synthetic_patient` | `patients.data_origin = 'codebridge_synthetic'` |
| `p.warn` | `note` matching "ověřit identitu" | `patients.identity_warning` |
| `p.nameNote` | `name_note_cs`, `name_note_source` | `patients.name_note_cs`, `name_note_source_json` |
| `p.diagnosis` | `ex.diagnosis_cs` or `main_problem_cs`; case 10 from `diagnosis_headline` | `cases.diagnosis_text` |
| `p.diagnosisNote` | case 10 literal | `cases.diagnosis_note` |
| `p.mkn10` | `ex.mkn10`, `CASE.diagnosis.code` | `cases.mkn10` |
| `p.question`, `p.explicit` | `mdt_question_cs` + `mdt_question_explicit` | `cases.question_text`, `question_explicit` |
| `p.purpose` | `mdt_question_cs`, case 10 `closest_source.quote` | `cases.question_purpose` |
| `p.draft`, `p.qkind`, `p.basis` | `question_draft_cs`, `question_kind`, `question_basis` | `cases.question_draft`, `question_kind`, `question_basis_json` |
| `p.summary` | `one_line_summary_cs` | `cases.summary_one_line` |
| `p.pages` | `page_count` | `cases.page_count` |
| `p.referrer` | `ex.referring_doctor` | `cases.referrer_name` |
| `p.dept`, `p.deptExample` | `ex.referring_department` or example list `[i % 4]` | `cases.referring_dept`, `referring_dept_is_example` |
| `p.owner`, `p.ownerExample` | `referrer` or `ownerFor(i)` | `cases.owner_name`, `owner_user_id`, `owner_is_example` |
| `p.submitted`, `p.submittedExample` | `addDays("2026-10-15", -[...][i % 10])` | `cases.submitted_on`, `submitted_is_example` |
| `p.status` | literal or rule on slot and note | `cases.status` (CHECK = keys of `STATUS`) |
| `p.slot` | slots array | `slots(day, time, case_id)` |
| `p.updated` | literal | `cases.updated_on` |
| `p.full` | literal `true` for case 10 | `cases.processing_level = 'full'` |
| `p.statusHist` | `setStatus` | `status_history` |
| `S.user` | default oncology doctor | `/api/me` |
| `STAFF` (`depts[].people[]`, `coord`), `ADMIN` | `defaultStaff()`, localStorage | `departments`, `users`, `dept_members`, `roles` |
| `S.tasks[]` (`id, pid, text, who, due, done, dueSrc, dueBy, timing, fromSugg, confirmedBy`) | literal, `S.tasks.push` | `tasks` |
| `S.sugg[]` | `suggestTasks` | `task_suggestions` |
| `S.decisions[]` (`pid, text, by, when, reportSnap, attSnap, slot`) | approve action | `decisions` |
| `S.protos[file]` (`mode, notes, concl, steps, state`) | `ensureProto` | `protocols` |
| `S.attByDay[day][dept][k]` | attendance selects | `attendance` |
| `S.session` | start/end MDT | `sessions` |
| `S.qConfirm[file]` | confirm draft question | `question_confirmations` |
| `S.edits[pid|key]`, `S.editLog` | edit dialog | `fact_edits`, `edit_log` |
| `S.alertHist[]` (`pid, i, action, who, when`) | `alertAct` | `alerts` + `alert_events` |
| `S.access[]` | `logAccess` | `access_log` |
| `S.retro`, `pr.dev` | read only, no writer | guidance JSON `prior_assessments` (R2), read-only |
| `S.mails` | approval e-mail stub | not stored (link-only mails are Step 4's cron) |

### R2 layout

Bucket `codebridge-mdt-docs`, EU jurisdiction, private, read only through
the Worker after the role and membership check. Keys:

| Key | Content | From |
|---|---|---|
| `docs/<case>/<doc>.pdf` | Original PDF | `data/rakathon-26/2_AI asistent MDT/<n>_pacient.pdf`, `samples/S01_pacient/S01_pacient.pdf` |
| `pages/<doc>/p<n>.json` | One page of the page index: `{n, size, text, engine, words, mean_conf, low_conf_words, verify, redacted: {count, reasons} or null}`. No `image` path (the API builds it), no `tess_text` (the viewer does not show it, as in `build.py`) | `data/derived/page-index.json` through `build.py`'s `page_index()` |
| `pages/<doc>/p<n>.png`, `p<n>.redacted.png` | Page renders | `data/derived/pages/<doc>/` (only names matching `p\d+(\.redacted)?\.png`) |
| `extract/<case>/<run>.json` | The case data as the app shows it, identity removed (below) | `mock-case-10.json` + `mock-case-10-extra.json`; `mock-case-S01.json` |
| `guidance/<case>/<sha8>.json` | The merged guideline response plus `prior_assessments: {}` | `build.py`'s `guidance()` |
| `prognosis/<case>/saved-<day>.json` | The saved prognosis replay | `prognosis-case-10.json` |
| `fixtures/S02/...` | S02 intake fixture: `extraction.json`, `fhir-referral.json`, `upload/<name>.pdf`, its pages under `pages/S02_pacient/` | `mock-case-S02.json`, `samples/S02_pacient/upload/` |

Not stored: `ocr.json` (not used by mock v3), `*.tess.tsv`, `*.layer.txt`,
`*.vision.md`, `*.redactions.json` (only the reasons and the count go into
the page JSON; the record never holds the removed values, as today).

Size check: the largest page JSON is about 33 KB, the largest extraction
about 190 KB; nothing large goes into D1.

### Extraction JSON and where identity goes

`extract/NO-010/<run>.json`:

```json
{
  "schema": "codebridge.extraction/1",
  "case_id": "NO-010",
  "run_id": "seed-NO-010-3f2a9c1b",
  "processing": "full",
  "case":  { "...": "mock-case-10.json minus the fields below" },
  "extra": { "...": "mock-case-10-extra.json minus the fields below" },
  "alert_ids": { "flag": ["al-...", "..."], "gap": ["al-...", "..."] }
}
```

`extract/NO-S01/<run>.json` has `processing: "partial"` and
`syn: mock-case-S01.json minus the fields below`.

Removed by the seed, and where they go:

| Removed | Goes to |
|---|---|
| `case.patient.name`, `name_as_written`, `birth_number`, `birth_date`, `age`, `insurer`, `source` | `patients.full_name`, `name_as_written`, `birth_number`, `birth_as_written`, `age_as_written`, `insurer`, `identity_source_json`. Kept in `case.patient`: `sex`, `sex_certainty`, `sex_note`, `missing_note` (clinical, no direct identifier) |
| `case.full_text_by_page` | Dropped; the page text lives in `pages/<doc>/p<n>.json`, and v3 does not read it |
| `extra.others` (other patients' diagnosis, referrer, context) | Their own `cases` rows (`diagnosis_text`, `mkn10`, `referrer_name`, `referring_dept`, `context_note_cs`). This also stops case 10's data from carrying other patients' details |
| `syn.list_entry.name`, `age_or_birth`, `rc`, `insurer`, `note` | `patients`; the rest of `list_entry` goes to `cases`; the JSON keeps `list_entry: {file, page_count}` for `docsOf` |
| `syn.others_entry` | `cases` columns |
| S02 `fhir_referral` | `fixtures/S02/fhir-referral.json` only (a FHIR `Patient` is identity by nature; it reaches D1 only when the intake creates the case in Step 4) |

**Residual identity scan.** After stripping, the seed walks every string
in every case-side JSON and every case row, looking for that patient's
surname, given name and birth number digits (case-insensitive, accents
folded). It writes the JSON paths (never the values) to
`api/seed/out/identity-scan.txt` and **fails** unless every hit is in a
`quote` field. Quotes are source evidence and stay unchanged (CLAUDE.md:
the original text stays findable and unchanged), so a quote such as the
name printed on a form is reported, not rewritten. This is why the
research note says the split "is not pseudonymization yet": true removal
from quotes and page text belongs to the redaction step of DATA-PROTECTION
option B. The PR states the hit count.

### Seed script

`api/seed/seed.py`, a uv script (`# /// script`, Python 3.11, standard
library only). Python, because it reuses `mocks/build.py`'s `page_index()`
and `guidance()` (imported with `importlib` from the file path; `main()`
is guarded) so the merged guidance and page data are byte-for-byte what
the mock embeds.

```
uv run api/seed/seed.py --target local            # wrangler dev state in api/.wrangler
uv run api/seed/seed.py --target remote           # the EU database and bucket
uv run api/seed/seed.py --target remote --reset   # wipe and reseed (shared demo reset)
uv run api/seed/seed.py --dry-run                 # write api/seed/out/ only
```

Steps:

1. Load fixtures: `mock-patient-list.json`, `mock-case-10.json`,
   `mock-case-10-extra.json`, `mock-case-S*.json`,
   `prognosis-case-10.json`, the page index through `page_index()`,
   guidance through `guidance()`. Hash every input (sha256) for
   `seed_meta.fixtures_json` and `extraction_runs.input_hashes_json`.
2. Build the staff directory from the same values as `defaultStaff()`
   (six departments `d1`..`d6` with two `MUDr.` each, ids `d<i>p<j>`,
   `coord` = "Bc. Marková" with `fn` "koordinátorka MDT", `admin` =
   "Ing. Kovář" with `fn` "správce systému"). Roles: every department
   person `doctor`, `coord` `coordinator`, `admin` `admin`. A unit test
   compares this list with `defaultStaff()` text in the template (regex on
   the `D` array) so the two cannot drift.
3. Build the patient list exactly as `initialPatients()` does, in Python:
   order `[case 10, *mock-patient-list, *SYN without intake_demo]`; the
   same slot array, `ownerFor(i)` (even `i`: first doctor of "Klinická
   onkologie", odd `i`: second doctor of "Neurochirurgie"), submitted
   offsets `[1,3,5,8,12,15,19,26,33,40][i % 10]` from 2026-10-15, example
   departments `[i % 4]`, status rule (`new` without slot; `attention` if
   the note matches `ověřit identitu|useknut`; else `scheduled`; case 10
   `ready`), case 10's diagnosis string
   (`histology_cs + ", " + tnm_cs.replace("(", " (", 1)`, mind JS
   `replace` replacing the first match only) and its literal
   `diagnosisNote`, `updated` `2026-10-15` (case 10: `2026-10-16`).
   Result: 11 patients, 11 cases (case 10, the nine FNO list patients,
   S01). S02 is not a case.
4. Case members: for every seeded case one `case_members` row per
   department (`reason = 'seed: oddělení MDT'`). The coordinator and the
   administrator are not members; their access follows the role rules
   below.
5. Documents: one `documents` row per seeded case's PDF (11 rows, id = PDF
   stem, `origin 'seed'`, `processing 'processed'` for case 10 and S01,
   `'unprocessed'` for the nine, since their pages are read but no facts
   were extracted); `document_parts` from `EXTRA.documents` (case 10) and
   `SYN.documents` (S01); `pages` from the page index (27 rows: 35 pages
   minus S02's 8).
6. Extraction runs and alerts: case 10 and S01 get one
   `extraction_runs` row each (`kind 'seed_fixture'`, `model NULL`). Alerts:
   one row per `CASE.flags[i]` (`origin 'flag'`, `position i`) and per
   data gap (`EXTRA.data_gaps_v3[n]`, `SYN.data_gaps[n]`, `origin 'gap'`).
   The stable id is `al-` plus the first 16 hex of
   `sha256(case_id|origin|kind|text_cs|first source file:page:quote)`. The
   ids are also written into the extraction JSON (`alert_ids`) so Step 4
   can key events by id while the UI still uses the position.
7. Tasks: the two literal tasks (`2_pacient.pdf` "doplnit pooperační MR do
   podkladů", due 2026-10-21, open; `13_pacient.pdf` "vyžádat snímky MR
   8/2025 ke srovnání", due 2026-10-21, done), assignee `coord`,
   `assignee_name` = the coordinator's display name.
8. Fixture library: `fixture_files` rows with the sha256 of every file in
   `samples/S02_pacient/upload/`.
9. Identity scan (above); stop on failure.
10. Write `api/seed/out/seed.sql`:
    - `--reset` prefix: `DROP TRIGGER IF EXISTS` for every trigger in
      `0002_append_only.sql` (names parsed from the file), `DELETE FROM`
      every table in reverse dependency order, then the content of
      `0002_append_only.sql` verbatim, so the triggers come back with the
      exact text of the migration.
    - Without `--reset`: refuse when `seed_meta` already has a row
      (checked with `wrangler d1 execute --command "SELECT ..." --json`).
    - One `INSERT` per row with SQL literals escaped by one function
      (`'` doubled; NULL; integers), in dependency order: roles,
      departments, users, dept_members, patients, cases, case_members,
      slots, documents, document_parts, pages, extraction_runs, alerts,
      tasks, fixture_files, seed_meta. The script asserts every statement
      is under 90 KB (D1 limit 100 KB).
11. Write `api/seed/out/r2-manifest.json` (`[{key, file, content_type,
    sha256}]`), then upload: `npx wrangler r2 object put
    codebridge-mdt-docs/<key> --file <file> --content-type <ct>` with
    `--local` or `--remote --jurisdiction eu`, run from `api/` so local
    state lands in `api/.wrangler/state`. Six uploads in parallel; a
    remote run skips keys whose sha256 matches `out/.seed-state.json`.
    About 140 objects; a first remote run takes a few minutes.
12. Apply the SQL: `npx wrangler d1 execute codebridge-mdt --file
    out/seed.sql --local|--remote`. R2 goes first, so D1 never points at a
    missing object.
13. Verify: query counts (`patients 11, cases 11, documents 11, pages 27,
    alerts n, tasks 2`) and `SELECT name FROM sqlite_master WHERE
    type='trigger'` (all 13 present); print a one-screen summary with no
    patient values.

CI (`.github/workflows/deploy-mock.yml`, the Worker job from Step 1) runs
`wrangler d1 migrations apply --remote` on every deploy, but **not** the
seed: reseeding the shared demo wipes what visitors did, so it is a
manual `workflow_dispatch` job (`seed: reset`) or a local command. The
token needs D1 edit and R2 write.

`.gitignore`: add `api/seed/out/`, `api/.wrangler/`.

### Read API

All under `/api`, JSON, `Cache-Control: no-store` (page images:
`private, max-age=300`). Errors use Step 1's format. User resolution
comes from Step 1's middleware; Step 2 changes the demo header to carry
the **user id**, not the name: `X-Demo-User: d2p1`. Reason: browsers
refuse non-Latin-1 header values, and staff names contain "ř", "Č", "š".
Unknown or inactive id: `401 {code:"unknown_user", message_cs:"Neznámý
uživatel. Vyberte uživatele znovu."}`. No header in demo mode: the default
demo user, the first doctor of "Klinická onkologie" (same rule as
today's `S.user` default).

**Access rules** (`api/src/domain/access.ts`, pure functions):

| Role | `/patients` | Case content (`/cases/:id/*`, pages) | `/tasks` | `/admin/access-log` |
|---|---|---|---|---|
| doctor | cases where member (direct or via department) | member only, else `403 not_member` | tasks of member cases | `403` |
| coordinator | all cases (creates and schedules) | header, documents list, decisions, history, tasks; **not** extraction, alerts, pages, guidance, prognosis: `403 role_forbidden` | all | `403` |
| admin | rows with identity and status only; clinical fields `null` | `403 role_forbidden` | none | allowed |

The coordinator and admin rows follow INTEGRATION.md ("Coordinator ...
no clinical edits"; "Administrator ... no clinical content"). Today's mock
lets both open the full patient view, so this is a visible change; it is
listed under Risks and as a question for the team (they may prefer the
coordinator to read clinical content for preparing cases; then add
coordinator to the "case content" column and say so in DATA-PROTECTION.md).

Error messages (Czech, shown by the UI):

- `404 case_not_found` "Případ nebyl nalezen."
- `403 not_member` "Nejste v týmu tohoto případu. Přístup mimo tým (s důvodem) přijde v dalším kroku."
- `403 role_forbidden` "Vaše role k těmto údajům nemá přístup."
- `404 page_not_found` "Stránka dokumentu není k dispozici."
- `503 data_unavailable` "Data případu se nepodařilo načíst. Zkuste to znovu."

**Audit on reads.** Every route that returns case content inserts its
`access_log` row **before** reading the content, in the same request; if
the insert fails, the route answers 500 and returns nothing (no access
without a trace). `what_cs` is the line the Administrace view shows. No
quote, no document text, no search terms go into the log.

| Route | `action` | `what_cs` |
|---|---|---|
| `GET /patients` | `list.view` | "zobrazil(a) seznam pacientů" |
| `GET /cases/:id` | `case.open` | "otevřel(a) případ" (or `?via=link`: "otevřel(a) případ (odkazem nebo historií prohlížeče)") |
| `GET /cases/:id/extraction` | `case.data` | "načetl(a) zpracovaná data případu" |
| `GET /cases/:id/documents` | `case.documents` | "zobrazil(a) seznam dokumentů" |
| `GET /cases/:id/alerts` | `case.alerts` | "zobrazil(a) upozornění" |
| `GET /cases/:id/decisions`, `/history` | `case.history` | "zobrazil(a) historii případu" |
| `GET /documents/:id/pages/:n` | `source.view` | "zobrazil(a) zdroj s. <n>" (with `document_id`, `page_n`) |
| `GET /documents/:id/pages/:n/image` | `source.image` | "načetl(a) obrázek s. <n>" (+ " (začerněná verze)" when redacted) |
| `GET /cases/:id/guidance` | `guidance.load` | "načetl(a) doporučení" |
| `GET /cases/:id/prognosis` | `prognosis.view` | "zobrazil(a) uloženou prognózu" |
| `GET /admin/access-log` | `audit.view` | "zobrazil(a) záznam přístupů" |

`/me`, `/staff`, `/tasks`, `/calendar`, `/health` hold no case content
and write no entry.

**Response shapes.** Shapes mirror the objects the page builds today, so
the loader assigns them directly.

`GET /api/health` (Step 1 route, extended):

```json
{ "ok": true, "service": "codebridge-mdt", "version": "<git sha>", "data_api": true, "seeded_at": "2026-10-17T12:00:00.000Z" }
```

`data_api` is `true` only when `DATA_API === "on"` and `seed_meta` has a
row. This is the step's flag: the Worker can ship with the schema while
the page stays on embedded data.

`GET /api/me`:

```json
{ "user": { "id": "d2p1", "name": "MUDr. Svobodová", "role": "doctor",
            "dept": { "id": "d2", "name": "Klinická onkologie" } },
  "auth_mode": "demo", "impersonating": false,
  "notice_cs": "Ukázka bez přihlášení: uživatele vybíráte ručně." }
```

`name` is `staffName()` of the row (`pre sur, post`).

`GET /api/staff` (the `STAFF` object `validStaff()` accepts, plus `admin`
and `roles`):

```json
{ "depts": [ { "id": "d1", "name": "Neurochirurgie",
               "people": [ { "id": "d1p1", "pre": "MUDr.", "sur": "Novák", "post": "", "fn": "" } ] } ],
  "coord": { "id": "coord", "pre": "Bc.", "sur": "Marková", "post": "", "fn": "koordinátorka MDT" },
  "admin": { "id": "admin", "pre": "Ing.", "sur": "Kovář", "post": "", "fn": "správce systému" },
  "roles": { "d1p1": "doctor", "coord": "coordinator", "admin": "admin" },
  "seq": 0, "source": "server" }
```

`GET /api/patients?q&status&dept&from&to&page&page_size`: today the page
filters and pages on the client (`S.q`, `S.colf`, `S.subFrom`, `S.dbPage`),
so the loader calls it without parameters and gets all rows (11). The
parameters are implemented now for Step 3 (`q` matches name, birth number
or case id; `status` a STATUS key; `dept` the referring department;
`from`/`to` on `submitted_on`; `page` 0-based, `page_size` default 50, max
200). Response:

```json
{ "patients": [ {
    "file": "10_pacient.pdf", "id": "NO-010",
    "name": "Daniel Poláček", "nameAsWritten": "Poláček Daniel", "rc": null, "birth": null, "age": null,
    "synthetic": false, "warn": null, "nameNote": null,
    "diagnosis": "...", "diagnosisNote": "pTNM při diagnóze 6/2022 · nyní susp. MTS v mozečku", "mkn10": "C64",
    "question": null, "purpose": "Nález při MR vyš. mozku zadávám k projednáni na NCH semináři.", "explicit": false,
    "draft": "...", "qkind": "document_purpose", "basis": [ { "role": "purpose", "quote": "...", "source": { "file": "10_pacient.pdf", "page": 3 } } ],
    "summary": null, "pages": null,
    "referrer": null, "dept": "Nemocnice Havířov, neurologie", "deptExample": true,
    "owner": "MUDr. Svobodová", "ownerExample": true,
    "submitted": "2026-10-14", "submittedExample": true,
    "status": "ready", "slot": { "day": "2026-10-22", "time": "14:00" }, "updated": "2026-10-16",
    "full": true, "processing": "full", "statusHist": []
  } ],
  "total": 11, "page": 0 }
```

Case 10's row has `summary` and `pages` `null` because `initialPatients()`
does not set them for it (`cases.summary_one_line` and `page_count` stay
NULL for case 10 so the parity check passes; the page count is in its
`documents` row). Rules in `api/src/domain/rows.ts`: keys absent in today's objects are
returned as `null` (the UI tests `!!` or `||`, so `null` and `undefined`
behave the same, checked in the parity check below); `full` is `true`
only for `processing_level = 'full'`; `slot` is `null` without a slot;
`statusHist` from `status_history` with `when` formatted on the client.
For the admin role the clinical keys (`diagnosis`, `diagnosisNote`,
`mkn10`, `question`, `purpose`, `draft`, `basis`, `summary`) are `null`
and the response carries `"redacted_for_role": "admin"`.

`GET /api/cases/:id`: one row of the same shape plus
`"members": [{ "dept": "Neurochirurgie" }]` and
`"run": { "id", "created_at", "kind" }` (or `null`).

`GET /api/cases/:id/extraction`:

```json
{ "case_id": "NO-010", "processing": "full", "run": { "id": "seed-NO-010-3f2a9c1b", "kind": "seed_fixture", "created_at": "..." },
  "data": { "case": { }, "extra": { }, "alert_ids": { } } }
```

For S01 `data` is `{ "syn": { }, "alert_ids": { } }`. For a case without a
run: `200 { "processing": "none", "run": null, "data": null }` (the UI
already says "nezpracováno"; this is not an error).

`GET /api/cases/:id/documents` (replaces `docsOf()`):

```json
{ "case_id": "NO-010",
  "documents": [ { "id": "10_pacient", "file": "10_pacient.pdf", "page_count": 3, "processing": "processed",
                   "note": "...", "parts": [ { "title_cs": "...", "type": "ambulantní zpráva", "date": null,
                   "date_note_cs": "...", "pages": [1,2,3], "readability": "fair", "reason_cs": "..." } ] } ] }
```

`GET /api/cases/:id/alerts`:

```json
{ "case_id": "NO-010", "run_id": "seed-NO-010-3f2a9c1b",
  "alerts": [ { "id": "al-9c...", "origin": "flag", "position": 0, "ui_key": 0, "kind": "missing",
                "text_cs": "...", "relevant": true, "events": [] } ] }
```

`ui_key` is today's key (`i` for flags, `"gap:<n>"` for gaps), so Step 4
can map old keys while it switches the UI to `id`. `events` are
`{action, by, at}` (empty in this step). The full flag object (with
`based_on`, `note`) stays in the extraction JSON; this route is the
stateful index over it.

`GET /api/cases/:id/decisions`: `{ "decisions": [ { "id", "version",
"text", "by", "when", "slot", "reportSnap", "attSnap", "supersedes" } ] }`
(keys as in `S.decisions`). `GET /api/cases/:id/history`:
`{ "status": [ {from, to, by, when, how} ], "edits": [ ... ],
"question_confirmations": [ ... ] }`. Both empty after the seed.

`GET /api/documents/:id/pages/:n` (replaces `srcApi.page`, same object):

```json
{ "file": "10_pacient.pdf", "document_id": "10_pacient", "case_id": "NO-010", "n": 1, "of": 3,
  "doc_title": "Ambulantní vyšetření kontrolní (onkologie): ...",
  "image": "/api/documents/10_pacient/pages/1/image", "size": [1205, 1718],
  "text": "...", "engine": "vision", "empty": false, "mean_conf": 91.3, "low_conf_words": 10,
  "words": [ { "t": "K", "c": 97, "b": [592, 74, 13, 14] } ],
  "verify": [ { "vision": "14.9.2026", "start": 107, "end": 116, "tess": "14,9,2026", "conf": 58, "box": [], "reason": "..." } ],
  "redacted": { "image": "/api/documents/10_pacient/pages/1/image?redacted=1", "count": 3, "reasons": ["..."] },
  "pages": [ { "n": 1, "empty": false }, { "n": 2, "empty": false } ] }
```

`verify` is returned raw; the client still applies `verifyOf()`.
`empty` uses the same test as `isEmptyPage`. `pages` carries what
`srcApi.document()` returned, so one request serves both.
`GET .../image` streams the R2 object (`image/png`), `?redacted=1`
the redacted one or `404 page_not_found`.

`GET /api/cases/:id/guidance`: the object `api.guidance()` returns today
(`guidelines, statements, pages, not_retrieved, literature, queries,
past_statements, fact_refs, deviation_case_file, deviation_findings`) plus
`prior_assessments: {}`. For a case without a guidance object: the empty
shape the stub returns today (`{guidelines: [], statements: [], pages: [],
literature: [], queries: [], not_retrieved: []}`).

`GET /api/cases/:id/prognosis`: `{ "saved": [ <prognosis-case-10.json> ] }`
or `{ "saved": [] }`.

`GET /api/tasks?scope=all|mine`: `{ "tasks": [ { "id": 1, "pid":
"2_pacient.pdf", "case_id": "NO-002", "text": "...", "who": "Bc. Marková",
"due": "2026-10-21", "done": false, "dueSrc": null, "dueBy": null,
"timing": null, "fromSugg": null, "confirmedBy": null } ] }`.

`GET /api/calendar?week=YYYY-MM-DD` (Monday): `{ "week": "...",
"slots": [ { "day", "time", "case_id", "file" } ], "sessions": [] }`.
Not used by the page yet (it derives the calendar from `S.patients`);
built now because it is one query and Step 4's booking needs it.

`GET /api/admin/access-log?case&actor&from&to&limit` (admin only,
default limit 200, newest first): `{ "entries": [ { "at", "who", "role",
"impersonating", "case_id", "pid", "what" } ] }` where `pid` is the case's
`source_file` (the Administrace view groups by it today).

**Store interfaces** (`api/src/store/types.ts`), so the pilot can swap D1/R2
for Postgres/S3:

```ts
export interface DirectoryStore { userById(id: string): Promise<User | null>; staff(): Promise<StaffDirectory>; }
export interface CaseStore {
  listCases(viewer: User, f: CaseFilter): Promise<{ rows: CaseRow[]; total: number }>;
  caseById(id: string): Promise<CaseRow | null>;
  isMember(caseId: string, user: User): Promise<boolean>;
  currentRun(caseId: string): Promise<RunRow | null>;
  documents(caseId: string): Promise<DocumentRow[]>;
  page(docId: string, n: number): Promise<PageRow | null>;
  alerts(caseId: string): Promise<AlertRow[]>;
  tasks(viewer: User, scope: 'all' | 'mine'): Promise<TaskRow[]>;
  decisions(caseId: string): Promise<DecisionRow[]>;
  history(caseId: string): Promise<HistoryRows>;
}
export interface AuditStore { append(e: AuditEntry): Promise<void>; list(f: AuditFilter): Promise<AuditRow[]>; }
export interface BlobStore { getJson<T>(key: string): Promise<T | null>; getStream(key: string): Promise<{ body: ReadableStream; contentType: string } | null>; }
```

Routes get the stores from `c.var` (built once per request in middleware
from `env.DB`, `env.DOCS`). `domain/` has no Cloudflare imports.

### Frontend loader (`mocks/src/v3-template.html`)

Line numbers refer to the template at commit `04968a4`.

1. **Data globals become reassignable.** Lines 865 and 867: `const CASE`
   and `const EXTRA` become `let`. Lines 1605-1606: `const BRIEF_CS`,
   `const BRIEF_REFS` become `let`, and a function
   `deriveFromExtra()` recomputes them (the other readers, `R3`, `DXH`,
   `A3`, `caseDataOf`, `decisionRef`, read `EXTRA` lazily and need no
   change).

2. **API client** (new block right after `api`, around line 882):

   ```js
   /* Where the data comes from: "embedded" (Pages, file://) or "api" (the Worker). Decided once at startup. */
   const DATA = { mode: "embedded", userId: null, error: null };
   async function apiGet(path, { timeout = 8000 } = {}) {
     const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), timeout);
     try {
       const r = await fetch("/api" + path, { signal: ctl.signal, credentials: "same-origin",
         headers: { Accept: "application/json", ...(DATA.userId ? { "X-Demo-User": DATA.userId } : {}) } });
       if (!(r.headers.get("content-type") || "").includes("application/json")) throw Object.assign(new Error("Server neodpovídá."), { code: "no_api" });
       const body = await r.json();
       if (!r.ok) throw Object.assign(new Error(body.error?.message_cs || "Požadavek se nepodařilo dokončit."), { code: body.error?.code, status: r.status });
       return body;
     } finally { clearTimeout(t); }
   }
   ```

3. **`api.guidance` on fetch** (lines 877-882):

   ```js
   async guidance(caseId) {
     if (DATA.mode === "api") return apiGet(`/cases/${encodeURIComponent(caseId)}/guidance`);
     await new Promise(r => setTimeout(r, 350));
     return caseId === "NO-010" ? SERVER_GUIDANCE : { guidelines: [], statements: [], pages: [], literature: [], queries: [], not_retrieved: [] };
   },
   ```

   `loadGuidance` (line 1024) gets a `catch` that sets `GUIDE = { error:
   e.message }` and renders; the guideline panel shows the message
   instead of spinning.

4. **`srcApi` becomes async** (lines 995-1022): `document(file)` and
   `page(file, n)` return promises. In embedded mode they wrap today's
   code in `Promise.resolve`. In API mode `page()` calls
   `apiGet(`/documents/${docIdOf(file)}/pages/${n}`)`, and `document()`
   returns `{file, case_id, pages}` from the same response (cached per
   file in a `Map`, so moving between pages costs one request per page).
   `docIdOf(file) = file.replace(/\.pdf$/, "")` is the seed's id contract
   for seeded documents; uploaded documents (Step 6) carry their id in
   their refs. `locate()` stays synchronous and local, but reads the
   fetched page (`o.data.words`, `o.data.text`) instead of
   `SERVER_PAGES`.

5. **Source viewer waits for the page** (`openSource`, `loadSourcePage`,
   lines 2904-2919, and the page change handler that checks `o.data` near
   line 3304):

   ```js
   async function openSource(r) {
     const o = { kind: "source", cite: r, file: r.file || CASE.file, page: +r.page || 1, tab: S.srcTab, zoom: "fit", data: null, doc: null, loading: true };
     S.overlay = o; renderOverlay();
     try { await loadSourcePage(o); }
     catch (e) { if (S.overlay === o) { S.overlay = null; renderOverlay(); } toast(e.code === "page_not_found" || e.code === "no_doc" ? "Původní dokument není v maketě k dispozici." : e.message); return; }
     if (S.overlay === o) renderOverlay();   // a late reply for a closed viewer is dropped
   }
   async function loadSourcePage(o) {
     o.loading = true;
     o.doc = await srcApi.document(o.file); if (!o.doc) throw Object.assign(new Error(""), { code: "no_doc" });
     o.data = await srcApi.page(o.file, o.page);
     if (!o.data) { o.page = o.doc.pages[0].n; o.data = await srcApi.page(o.file, o.page); }
     if (DATA.mode !== "api") logAccess(o.file, `zobrazil(a) zdroj s. ${o.page}`);   // the server logs it in API mode
     o.data.match = o.cite.quote && +o.cite.page === o.page ? { quote: o.cite.quote, ...srcApi.locate(o.data, o.cite.quote) } : null;
     o.loading = false;
   }
   ```

   `renderOverlay` for `kind: "source"` shows "Načítám stránku…" while
   `o.loading`, before `sourceHtml` (line 2974 reads `d.size` and would
   throw on `null`). `srcApi.locate(file, n, quote)` becomes
   `locate(page, quote)`.

6. **Staff** (lines 1054-1084): `loadStaff()` and `saveStaff()` keep their
   localStorage path only in embedded mode. In API mode `STAFF` comes from
   `/api/staff`, edits on the staff screen change the in-memory list only,
   and the staff screen shows "Změny seznamu se zatím neukládají na
   server." (Step 4 adds `PUT /staff`). Otherwise a stale localStorage list
   would silently override the server.

7. **User picker** (line 3853): besides `S.user = t.value`, set
   `DATA.userId = staffIds()` reverse lookup of the name (`coord`,
   `admin`, `d<i>p<j>`), so every later request carries the picked user.

8. **Access log.** `openPatient` (line 3460) and `readHash` (line 3451):
   in API mode call `apiGet(`/cases/${id}${viaLink ? "?via=link" : ""}`)`
   (fire and forget, errors shown as a toast; on `403` the view returns to
   the list with the server's message) instead of `logAccess`. All other
   `logAccess` calls (writes, still client-side until Step 4) keep working
   and mark entries `local: true`. The Administrace view (line 2203) in
   API mode loads `/api/admin/access-log` when opened (same pattern as
   `loadGuidance`: a global, a `for` key, `render()` on reply) and shows
   two sections: "Záznam přístupů na serveru" and "Změny v této relaci
   (zatím jen v prohlížeči)".

9. **Data source chip** in the top bar (`renderNav`, line 1446 area):
   "Data: server" or "Data: vložená" with a tooltip; when API mode failed
   during startup, "Data: vložená (server nedostupný)" in amber, so a
   silent fallback cannot hide a broken backend during the demo.

10. **Prognosis messages** (`mocks/src/prognosis.js`, `pgJson`): read
    `data.error?.message_cs` as well as `message`, so the Worker's 404 for
    `/api/prognosis/*` reads as Czech text. The saved replay keeps coming
    from the embedded `SAVED_PROGNOSIS` in this step; Step 5 moves it to
    `GET /cases/:id/prognosis`.

11. **Startup** replaces the last two lines (`readHash(); render();`,
    lines 3896-3897) with `boot();`:

    ```js
    async function boot() {
      const force = new URLSearchParams(location.search).get("data");   // ?data=embedded compares against the old path
      if (location.protocol.startsWith("http") && force !== "embedded") {
        let health = null;
        try { health = await apiGet("/health", { timeout: 1500 }); } catch (e) { /* Pages or file://: no API */ }
        if (health?.service === "codebridge-mdt" && health.data_api) {
          try { await loadFromApi(); DATA.mode = "api"; }
          catch (e) { DATA.error = e.message; restoreEmbedded(); }
        }
      }
      readHash(); render();
      if (DATA.mode === "api" && new URLSearchParams(location.search).has("parity")) checkApiParity();
    }
    async function loadFromApi() {
      const me = await apiGet("/me");
      DATA.userId = me.user.id;
      const [staff, list, tasks] = await Promise.all([apiGet("/staff"), apiGet("/patients"), apiGet("/tasks?scope=all")]);
      const full = list.patients.find(p => p.full);
      /* Step 2 keeps case 10's full view on the CASE/EXTRA globals; Step 3 replaces them with a per-case cache. */
      const ex = full ? await apiGet(`/cases/${encodeURIComponent(full.id)}/extraction`) : null;
      /* Nothing is assigned until every request succeeded, so a failure leaves the embedded data whole. */
      STAFF = { depts: staff.depts, coord: staff.coord, seq: 0 }; applyStaff();
      S.patients = list.patients; S.tasks = tasks.tasks; S.user = me.user.name;
      if (ex?.data?.case) { CASE = { ...ex.data.case, file: full.file }; EXTRA = ex.data.extra; deriveFromExtra(); S.pid = full.file; }
    }
    ```

    `restoreEmbedded()` is a no-op today (nothing is assigned before all
    requests succeed); it exists so the fallback stays explicit.
    `readHash()` runs after the data, so a `#patient/10` link resolves
    against the server's list. The first render waits at most the health
    timeout (1.5 s) plus the loads; the page shows the existing empty
    `#app` until then (add a "Načítám…" text to the static `#app` markup).

12. **Parity check** (`checkApiParity()`, dev only, behind `?parity`):
    computes `initialPatients()` from the embedded data and compares each
    row with the server's row by `file`, key by key (treating `undefined`
    and `null` as equal and ignoring `processing`, `statusHist`,
    `redacted_for_role`), and prints the differences with
    `console.table` (keys only, and values only for non-identity keys). It
    also compares `STAFF` with `defaultStaff()` and `S.tasks`. This is how
    the acceptance check proves the swap changes nothing.

`mocks/build.py` is unchanged in this step. `api/scripts/stage-assets`
from Step 1 keeps copying `mocks/v3.html` and `mocks/pages/` into
`api/.assets/`; once the loader is in, the Worker serves page images from
R2 and the staged `pages/` folder is only for the embedded fallback.

### Docs to update in the same change (Mechanism 3)

- `api/README.md` (or the root `README.md` run section): create, migrate,
  seed, reset, run locally, `?data=embedded`, `?parity`.
- `docs/design/TECHNOLOGIES.md` and `docs/agent/HACKATHON.md`: D1, R2,
  `@cloudflare/vitest-plugin` with pinned versions.
- `docs/design/DATA-PROTECTION.md`: where identity lives (`patients`
  only), what the extraction JSON still holds (quotes, page text), the
  demo audit log kept until a reset, the admin and coordinator read
  rules.
- `docs/agent/OPEN_QUESTIONS.md`: jurisdiction check result; whether the
  coordinator may read clinical content.
- `mocks/README.md`: the loader, the data chip, the two modes.
- `.env.example` unchanged (no new secrets); `wrangler.jsonc` vars
  documented.

## Tests

Tooling: Vitest with Cloudflare's Workers integration. The current
package is `@cloudflare/vitest-plugin` (the docs now point users of the
older `@cloudflare/vitest-pool-workers` to a migration guide); pin the
exact version in `package.json` and `TECHNOLOGIES.md`, and adjust the
research note's "Pinned tools" line.

`api/vitest.config.ts`:

```ts
import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-plugin/config"; // check the export path at install
import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig(async () => {
  const migrations = await readD1Migrations(path.join(__dirname, "migrations"));
  return {
    plugins: [cloudflareTest({
      wrangler: { configPath: "./wrangler.jsonc" },
      miniflare: { bindings: { TEST_MIGRATIONS: migrations, DATA_API: "on", AUTH_MODE: "demo" } },
    })],
    test: { setupFiles: ["./test/apply-migrations.ts"] },
  };
});
```

`test/apply-migrations.ts`: `await applyD1Migrations(env.DB,
env.TEST_MIGRATIONS)` (from `cloudflare:test`), then
`test/fixtures.ts` inserts a small TypeScript fixture: three users (doctor
member, doctor non-member in a department not on the case, coordinator,
admin), two cases (one `full` with a run, one `none`), one document with
two pages, R2 objects put through `env.DOCS.put` (a tiny PNG and page
JSON with a fake name "Testová Pacientka" in its text). Tests never read
`data/` or `mocks/`; the seed has its own smoke test.

Test files and what each proves:

- `test/schema.test.ts`
  - all tables and 13 triggers exist after migrations;
  - UPDATE and DELETE on each append-only table abort with
    `append-only: <table>`;
  - CHECKs refuse: unknown status, `time = '14:05'`, a timestamp without
    `Z`, a `case_members` row with both or neither of user and dept;
  - `UNIQUE(day,time)` refuses a second booking; one slot per case;
  - a decision superseding another case's decision, or skipping a
    version, aborts; `version 1` with `supersedes_id` aborts.
- `test/me-staff.test.ts`: default demo user without a header; header
  `X-Demo-User: coord` gives the coordinator; unknown id gives 401
  `unknown_user`; `/staff` passes a port of `validStaff()`.
- `test/patients.test.ts`: the exact key set of a row (snapshot of keys);
  member doctor sees the case, non-member doctor does not; admin sees
  identity with `diagnosis` etc. `null`; filters `q`, `status`, `page`;
  one `list.view` audit row per call.
- `test/case-read.test.ts`: `/cases/:id` 404, 403 `not_member`, 200 with
  one `case.open` row (actor, role, case id); `?via=link` changes
  `what_cs`; `/extraction` for the coordinator and admin is 403
  `role_forbidden`; for a case without a run returns
  `processing: "none"`; the returned JSON has no `patient.name`,
  `name_as_written`, `birth_number`, `full_text_by_page`, `others`.
- `test/pages.test.ts`: page JSON shape (keys as `srcApi.page()`), `image`
  is an API URL; image route returns `image/png`; `?redacted=1` 404 when
  absent; 403 for non-member; `source.view` row has `document_id` and
  `page_n` and its `what_cs` does not contain the page text or the fake
  name.
- `test/audit.test.ts`: when the audit insert fails (a store stub that
  throws, injected through the store factory), the route answers 500 and
  no content; `/admin/access-log` is 403 for doctor and coordinator, 200
  for admin, and writes its own `audit.view` row.
- `test/rows.test.ts` (pure, no bindings): `domain/rows.ts` mapping,
  including `null` slot, `full` only for `processing_level 'full'`, admin
  redaction.
- `test/guidance-tasks.test.ts`: guidance empty shape for a case without
  an object; tasks `mine` vs `all`.

Seed smoke test, `npm run test:seed` (Node, runs locally and in CI):

1. delete `api/.wrangler/state`, `wrangler d1 migrations apply --local`;
2. `uv run api/seed/seed.py --target local`;
3. start `wrangler dev --local` on a free port;
4. `api/test/smoke.mjs` checks: health `data_api: true`; `/patients`
   returns 11 rows in the order `NO-010, NO-002, NO-009, NO-011, NO-013,
   NO-015, NO-017, NO-018, NO-019, NO-020, NO-S01`; no `NO-S02`; NO-010
   is `ready`, slot 2026-10-22 14:00; `/cases/NO-010/extraction` has no
   identity keys; every case's documents resolve every page
   (`/documents/:id/pages/:n` 200 and its `/image` 200, 27 pages); the
   guidance object for NO-010 equals `json.loads(guidance())` from
   `build.py` plus `prior_assessments`; `identity-scan.txt` exists and
   lists only `quote` paths;
5. a seed run without `--reset` on a seeded database fails; with
   `--reset` it succeeds and all 13 triggers exist afterwards.

Manual check in the browser (the doctor-visible part, CLAUDE.md "Match
the evidence to the risk"): open the Worker URL with `?parity`, confirm
the console shows no differences; click through case 10 (brief, timeline,
labs, alerts, guidance, a source link with a highlighted quote, the
redacted view), S01's lite view and labs, the calendar, tasks, and
Administrace; then open the same with `?data=embedded` and compare.
Record the result in the PR.

## Acceptance criteria

- [ ] `wrangler d1 migrations apply` creates the schema locally and on the
      remote EU database; all 13 triggers exist on both.
- [ ] D1 and R2 were created with `--jurisdiction eu`; the check result
      is recorded in `OPEN_QUESTIONS.md` (or moved to `HACKATHON.md`).
- [ ] `uv run api/seed/seed.py --target local` and `--target remote`
      seed 11 patients, 11 cases, 11 documents, 27 pages, 2 tasks, the
      alerts of case 10 and S01, and the S02 fixture files; S02 has no
      case or patient row.
- [ ] No extraction object in R2 contains `patient.name`,
      `name_as_written`, `birth_number`, `birth_date`, `insurer`,
      `full_text_by_page` or `others`; the identity scan lists only
      `quote` paths and its count is in the PR.
- [ ] Every read route listed in Scope answers with the documented shape;
      Vitest suite and seed smoke test pass in CI.
- [ ] Every case-content read writes exactly one `access_log` row before
      returning data; no row contains a quote or page text.
- [ ] A non-member doctor, the coordinator (for clinical content) and the
      admin (for case content) get the documented 403 with a Czech
      message, and the UI shows that message.
- [ ] On the Worker, the page starts in API mode ("Data: server"), and
      `?parity` reports zero differences for patients, staff and tasks.
- [ ] Case 10's full view, S01's lite view, the source viewer (image,
      text, highlight, redacted view), the guideline layer and
      Administrace work on the Worker; the access log in Administrace
      shows the server entries.
- [ ] `codebridge-mdt.pages.dev` and `mocks/v3.html` opened from disk
      still start in embedded mode and behave as before (no console
      errors, "Data: vložená").
- [ ] With `DATA_API=off` the Worker page runs on embedded data.
- [ ] Docs listed under "Docs to update" are changed in the same PR.
- [ ] A separate agent reviewed the change adversarially (privacy, access
      rules, parity) before merge (CLAUDE.md, Mechanism 4).

## Risks

- **D1 EU jurisdiction.** Cloudflare's pages disagree on whether D1
  supports jurisdictions. Check on the created database before seeding
  remote. If it is not EU, stop and tell the team: only synthetic data is
  involved, but the residency claim in our slides would be false.
- **Size limits.** D1: 2 MB per row or string, 100 KB per SQL statement,
  100 bound parameters, 50 queries per invocation on the Free plan. The
  design keeps large JSON in R2 (largest object about 190 KB) and the seed
  asserts statements under 90 KB. The page index is 606 KB as one file
  but at most about 33 KB per page object after the split. Routes use at
  most four queries.
- **Triggers through the migration runner.** Statement splitting of
  `BEGIN ... END` bodies by Wrangler has had bugs. Mitigation: one-line
  triggers in their own migration and a test that counts triggers on the
  local and the remote database.
- **Reset with append-only triggers.** The reset drops and re-creates
  triggers; if it fails half way, the database may be left without them.
  The seed verifies the trigger count after every run and fails loudly.
  The reset also deletes the demo audit log; DATA-PROTECTION.md must say
  so (the shared-demo decision in the research note already does).
- **Visible behavior change for the coordinator and admin.** The mock lets
  every role open the full patient view; the server refuses clinical
  content to the admin (and, as designed, to the coordinator). The jury
  demo uses a doctor, but a presenter switching roles will see 403
  messages. Decide with the team before merge; the rule is one line in
  `domain/access.ts`.
- **Interim leak of case 10 data on the client.** The loader preloads
  case 10's extraction for the starting user. If the picker then switches
  to a role without access, the data is still in memory, and the
  embedded fixtures are still in the HTML for everyone. Both end in Step
  3 (per-case cache, cleared on user switch) and Step 5 of the frontend
  plan (no embedding). The PR says so.
- **Silent divergence between embedded and server data.** Two copies
  exist during the migration. The parity check and the seed's reuse of
  `build.py` functions limit it; any fixture change needs a reseed (the
  seed records fixture hashes in `seed_meta`, and `/api/health` could
  report a mismatch later).
- **Pages answers `/api/health` with HTML.** The loader requires a JSON
  content type and `service === "codebridge-mdt"`, so Pages and `file://`
  stay on embedded data.
- **Header encoding.** Names with "ř" or "Č" in a header make `fetch`
  throw; the header carries the user id. If Step 1 shipped the name, this
  step changes the middleware and its test.
- **Startup latency on a cold Worker or a slow D1 query.** The first
  render waits for health (1.5 s cap) and four requests. Acceptable for
  the demo; if it is not, render the list from embedded data first and
  swap (more code, not planned).
- **Remote seeding speed.** About 140 `wrangler r2 object put` calls; a
  few minutes on first run, then only changed objects. If too slow, use
  the S3 API with the EU endpoint
  (`https://<account>.eu.r2.cloudflarestorage.com`) instead.
- **Vitest package rename.** The research note names the Workers Vitest
  integration; the current docs name `@cloudflare/vitest-plugin`. The
  exact import path of `readD1Migrations` must be checked at install.

## Effort

About 3 days for one developer with agents, in line with the research
note's 2-3 days:

| Part | Estimate |
|---|---|
| Migrations 0001/0002, schema tests | 0.5 day |
| Seed script (port of `initialPatients`, identity strip and scan, SQL and R2 upload, reset) | 0.75 day |
| Read routes, stores, access rules, audit, route tests | 0.75 day |
| Frontend loader, async source viewer, staff and admin changes, parity check | 0.5 day |
| Seed smoke test, browser check on the Worker and on Pages, docs, review fixes | 0.5 day |

The seed's port of `initialPatients()` and the async source viewer are
the parts most likely to run over; the parity check is what tells you
when the first is done. If the step passes 6 days, stop and report
(CLAUDE.md, "Say when time runs over").
