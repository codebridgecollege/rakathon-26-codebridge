-- Step 4: the write API. Design: docs/research/backend-steps/step-4.md ("As implemented").
-- Adds the bookkeeping for guarded batches, idempotent approvals, break-the-glass grants, the notification outbox and
-- the shared-demo reset, and lets only the reset batch clear the append-only tables.

-- ---------- shared demo state ----------
-- One row. data_epoch changes on every reset, so a tab opened before a reset cannot write into the new data.
-- reset_in_progress is 1 only inside the reset batch; the append-only triggers below let deletes through only then.
CREATE TABLE demo_state (
  id                 INTEGER PRIMARY KEY CHECK (id = 1),
  seed_version       TEXT,
  data_epoch         INTEGER NOT NULL DEFAULT 1,
  reset_at           TEXT,
  reset_by           TEXT,
  reset_in_progress  INTEGER NOT NULL DEFAULT 0 CHECK (reset_in_progress IN (0,1))
);
INSERT INTO demo_state (id, data_epoch) VALUES (1, 1);

-- ---------- guarded batches ----------
-- D1 has no interactive transactions, so a value read before a batch may be stale by the time it runs. Each guard
-- inserts the result of its condition here; a false condition fails the CHECK and rolls back the whole batch.
CREATE TABLE write_guards (
  batch_id  TEXT NOT NULL,
  code      TEXT NOT NULL,
  ok        INTEGER NOT NULL CHECK (ok = 1)
);

-- A retried approval or case creation with the same key replays the first answer instead of acting twice.
CREATE TABLE idempotency_keys (
  key            TEXT PRIMARY KEY,
  user_id        TEXT NOT NULL,
  route          TEXT NOT NULL,
  body_sha       TEXT NOT NULL,
  response_json  TEXT NOT NULL CHECK (json_valid(response_json)),
  status         INTEGER NOT NULL,
  created_at     TEXT NOT NULL CHECK (created_at GLOB '[0-9][0-9][0-9][0-9]-*Z')
);

-- Break-the-glass (INTEGRATION.md): a doctor outside the case's team opens it with a stated reason for 12 hours.
CREATE TABLE case_access_grants (
  id          TEXT PRIMARY KEY,
  case_id     TEXT NOT NULL REFERENCES cases(id),
  user_id     TEXT NOT NULL REFERENCES users(id),
  reason      TEXT NOT NULL CHECK (length(reason) BETWEEN 10 AND 500),
  granted_at  TEXT NOT NULL CHECK (granted_at GLOB '[0-9][0-9][0-9][0-9]-*Z'),
  expires_at  TEXT NOT NULL CHECK (expires_at GLOB '[0-9][0-9][0-9][0-9]-*Z')
);
CREATE INDEX case_access_grants_user ON case_access_grants(user_id, case_id, expires_at);

-- Outbox: what an e-mail would say. A case ID and a count only, never medical data (CLAUDE.md, notifications).
CREATE TABLE notifications (
  id           TEXT PRIMARY KEY,
  kind         TEXT NOT NULL CHECK (kind IN ('approval','digest')),
  to_user_id   TEXT,
  case_id      TEXT,
  count        INTEGER NOT NULL CHECK (count >= 0),
  link         TEXT NOT NULL,
  created_by   TEXT NOT NULL,
  created_by_name TEXT NOT NULL,
  created_at   TEXT NOT NULL CHECK (created_at GLOB '[0-9][0-9][0-9][0-9]-*Z'),
  sent_at      TEXT
);
CREATE INDEX notifications_case ON notifications(case_id);

-- ---------- attendance with a version per set ----------
-- A set is one seminar day ('2026-10-22') or one case without a slot ('case:NO-012'), as the page's attDay().
-- The step 2 table keyed by day only could not hold the second kind; it held no rows, so it is replaced.
DROP TABLE attendance;
CREATE TABLE attendance (
  set_key    TEXT NOT NULL CHECK (set_key GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]' OR set_key GLOB 'case:*'),
  dept_id    TEXT NOT NULL REFERENCES departments(id),
  position   INTEGER NOT NULL CHECK (position >= 0),
  user_id    TEXT NOT NULL REFERENCES users(id),
  user_name  TEXT NOT NULL,
  PRIMARY KEY (set_key, dept_id, position),
  UNIQUE (set_key, user_id)                  -- nobody is present twice
);
CREATE TABLE attendance_sets (
  set_key     TEXT PRIMARY KEY,
  version     INTEGER NOT NULL DEFAULT 0,
  updated_by  TEXT,
  updated_at  TEXT
);

-- ---------- a directory role without app access ----------
-- Department members who are not doctors (the staff screen allows other titles) need a users row to appear in
-- attendance. Role 'staff' may not sign in or act. SQLite cannot change a CHECK, so roles is rebuilt; deferring
-- foreign keys lets users keep pointing at it while it is swapped.
PRAGMA defer_foreign_keys = true;
CREATE TABLE roles_new (
  id        TEXT PRIMARY KEY CHECK (id IN ('doctor','coordinator','admin','staff')),
  label_cs  TEXT NOT NULL
);
INSERT INTO roles_new (id, label_cs) SELECT id, label_cs FROM roles;
INSERT INTO roles_new (id, label_cs) SELECT 'staff', 'personál pracoviště' WHERE EXISTS (SELECT 1 FROM roles);
DROP TABLE roles;
ALTER TABLE roles_new RENAME TO roles;
-- ---------- drafted tasks: a fourth state ----------
-- A newer approval supersedes the drafts of the decision it replaces, so a draft from an outdated conclusion can no
-- longer become a task. SQLite cannot change a CHECK, so the table is rebuilt (it held no rows before step 4).
CREATE TABLE task_suggestions_new (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  case_id          TEXT NOT NULL REFERENCES cases(id),
  decision_id      TEXT REFERENCES decisions(id),
  decision_version INTEGER,
  text             TEXT NOT NULL,
  quote            TEXT,                        -- the conclusion passage it rests on
  who              TEXT,
  due              TEXT CHECK (due IS NULL OR due GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  due_source       TEXT CHECK (due_source IN ('computed','manual','none') OR due_source IS NULL),
  due_by           TEXT,
  timing           TEXT,
  state            TEXT NOT NULL DEFAULT 'draft' CHECK (state IN ('draft','confirmed','dismissed','superseded')),
  decided_by       TEXT REFERENCES users(id),
  decided_by_name  TEXT,
  decided_at       TEXT CHECK (decided_at IS NULL OR decided_at GLOB '[0-9][0-9][0-9][0-9]-*Z'),
  created_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) CHECK (created_at GLOB '[0-9][0-9][0-9][0-9]-*Z')
);
INSERT INTO task_suggestions_new (id, case_id, decision_id, text, quote, who, due, due_source, timing, state, decided_by, decided_at, created_at)
  SELECT id, case_id, decision_id, text, quote, who, due, due_source, timing, state, decided_by, decided_at, created_at FROM task_suggestions;
DROP TABLE task_suggestions;
ALTER TABLE task_suggestions_new RENAME TO task_suggestions;
CREATE INDEX task_suggestions_case ON task_suggestions(case_id);
PRAGMA defer_foreign_keys = false;

-- ---------- columns the write routes need ----------
-- fact_edits.log_id is the edit_log row that set the current override; a write names it to detect a parallel edit.
ALTER TABLE fact_edits ADD COLUMN log_id INTEGER;
ALTER TABLE fact_edits ADD COLUMN extraction_run_id TEXT;
ALTER TABLE edit_log ADD COLUMN confirmed INTEGER NOT NULL DEFAULT 0 CHECK (confirmed IN (0,1));
ALTER TABLE protocols ADD COLUMN updated_by_name TEXT;
ALTER TABLE protocols ADD COLUMN approved_by_name TEXT;
ALTER TABLE protocols ADD COLUMN approved_at TEXT;
ALTER TABLE tasks ADD COLUMN done_by_name TEXT;
ALTER TABLE sessions ADD COLUMN started_by_name TEXT;
-- The reason a second record was created for a known birth number is staff free text that may name the patient, so it
-- stays with the case, not in the access log.
ALTER TABLE cases ADD COLUMN duplicate_override_reason TEXT;
ALTER TABLE cases ADD COLUMN created_by TEXT;
ALTER TABLE access_log ADD COLUMN target_type TEXT;
ALTER TABLE access_log ADD COLUMN target_id TEXT;
ALTER TABLE access_log ADD COLUMN data_epoch INTEGER;

-- ---------- append-only, except inside the reset batch ----------
-- The demo's reset-demo route empties these tables in one batch that first sets reset_in_progress = 1. COALESCE keeps
-- the protection on if the demo_state row is ever missing. A pilot database must ship these triggers without the
-- condition (recorded as a risk in the design).
DROP TRIGGER IF EXISTS decisions_no_update;
DROP TRIGGER IF EXISTS decisions_no_delete;
DROP TRIGGER IF EXISTS status_history_no_update;
DROP TRIGGER IF EXISTS status_history_no_delete;
DROP TRIGGER IF EXISTS edit_log_no_update;
DROP TRIGGER IF EXISTS edit_log_no_delete;
DROP TRIGGER IF EXISTS alert_events_no_update;
DROP TRIGGER IF EXISTS alert_events_no_delete;
DROP TRIGGER IF EXISTS question_confirmations_no_update;
DROP TRIGGER IF EXISTS question_confirmations_no_delete;
DROP TRIGGER IF EXISTS access_log_no_update;
DROP TRIGGER IF EXISTS access_log_no_delete;
CREATE TRIGGER decisions_no_update BEFORE UPDATE ON decisions BEGIN SELECT RAISE(ABORT, 'append-only: decisions'); END;
CREATE TRIGGER decisions_no_delete BEFORE DELETE ON decisions WHEN COALESCE((SELECT reset_in_progress FROM demo_state WHERE id = 1), 0) = 0 BEGIN SELECT RAISE(ABORT, 'append-only: decisions'); END;
CREATE TRIGGER status_history_no_update BEFORE UPDATE ON status_history BEGIN SELECT RAISE(ABORT, 'append-only: status_history'); END;
CREATE TRIGGER status_history_no_delete BEFORE DELETE ON status_history WHEN COALESCE((SELECT reset_in_progress FROM demo_state WHERE id = 1), 0) = 0 BEGIN SELECT RAISE(ABORT, 'append-only: status_history'); END;
CREATE TRIGGER edit_log_no_update BEFORE UPDATE ON edit_log BEGIN SELECT RAISE(ABORT, 'append-only: edit_log'); END;
CREATE TRIGGER edit_log_no_delete BEFORE DELETE ON edit_log WHEN COALESCE((SELECT reset_in_progress FROM demo_state WHERE id = 1), 0) = 0 BEGIN SELECT RAISE(ABORT, 'append-only: edit_log'); END;
CREATE TRIGGER alert_events_no_update BEFORE UPDATE ON alert_events BEGIN SELECT RAISE(ABORT, 'append-only: alert_events'); END;
CREATE TRIGGER alert_events_no_delete BEFORE DELETE ON alert_events WHEN COALESCE((SELECT reset_in_progress FROM demo_state WHERE id = 1), 0) = 0 BEGIN SELECT RAISE(ABORT, 'append-only: alert_events'); END;
CREATE TRIGGER question_confirmations_no_update BEFORE UPDATE ON question_confirmations BEGIN SELECT RAISE(ABORT, 'append-only: question_confirmations'); END;
CREATE TRIGGER question_confirmations_no_delete BEFORE DELETE ON question_confirmations WHEN COALESCE((SELECT reset_in_progress FROM demo_state WHERE id = 1), 0) = 0 BEGIN SELECT RAISE(ABORT, 'append-only: question_confirmations'); END;
CREATE TRIGGER access_log_no_update BEFORE UPDATE ON access_log BEGIN SELECT RAISE(ABORT, 'append-only: access_log'); END;
CREATE TRIGGER access_log_no_delete BEFORE DELETE ON access_log WHEN COALESCE((SELECT reset_in_progress FROM demo_state WHERE id = 1), 0) = 0 BEGIN SELECT RAISE(ABORT, 'append-only: access_log'); END;
