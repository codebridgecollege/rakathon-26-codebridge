-- Storage for the extraction format codebridge.extraction/2 (docs/design/EXTRACTION-FORMAT.md; DATABASE.md, section
-- "Extraction runs"). A run (one extraction of one case) is stored in R2 as JSON; D1 holds its row, the identities of
-- its alerts and facts, and what doctors did with them:
-- - extraction_runs: `producer` says what wrote the run (fixture, pipeline, nis), `seeded` whether the seed wrote it
--   (the demo reset keeps exactly those), `schema` which format version the R2 object has, `supersedes` the run it
--   replaced. `kind` stays for the Worker that is still deployed during the migration window (api/AGENTS.md), as a
--   column computed from `producer`; a later migration drops it.
-- - alert_identities: every alert ID a case has had (rule and subject, from the run). alert_events now point at it, by
--   case, so an acknowledgement stays with the alert across runs (an /2 alert ID is derived from rule and subject).
-- - alert_events_v1: the acknowledgements of the /1 alerts (table `alerts`), kept read-only and no longer shown.
-- - fact_ids: every fact ID ever issued for a case, so a new run never hands a retired ID to a different fact.
-- - fact_confirmations: a doctor confirms (or withdraws a confirmation of) one fact of the current run; append-only.
-- - fact_edits.fact_id: the fact an edit under an "f:<fact id>" key belongs to.
-- - document_parts.part_id: the stable part ID the runs cite ("<document id>/p<ordinal>").
--
-- Why `alerts` is rebuilt too, with the same columns and rows: renaming extraction_runs aside rewrites the foreign key
-- of `alerts` to point at extraction_runs_old, which is then dropped. So extraction_runs, alerts and alert_events are
-- all renamed aside (as in 0011), created anew, copied parents first, and the old ones dropped children first, so no
-- foreign key is ever left dangling. D1 cannot switch foreign keys off, only defer them, and a DROP of a parent that
-- still has children counts as a violation at commit.

PRAGMA defer_foreign_keys = true;

-- ---------- 1. Triggers and indexes that name the rebuilt tables ----------
-- A rename rewrites trigger bodies that name the table, and the new tables reuse these names.
DROP TRIGGER demo_reset_uploads;
DROP TRIGGER alert_events_no_update;
DROP TRIGGER alert_events_no_delete;
DROP INDEX extraction_runs_current;
DROP INDEX alerts_case;
DROP INDEX alert_events_alert;

ALTER TABLE extraction_runs RENAME TO extraction_runs_old;
ALTER TABLE alerts RENAME TO alerts_old;
ALTER TABLE alert_events RENAME TO alert_events_old;

-- ---------- 2. New tables ----------
CREATE TABLE extraction_runs (
  id                 TEXT PRIMARY KEY,         -- 'seed-NO-010-<sha8>', 'fixture-NO-010-v2', 'run-...'
  org_id             TEXT NOT NULL REFERENCES orgs(id),
  case_id            TEXT NOT NULL,
  producer           TEXT NOT NULL CHECK (producer IN ('fixture','pipeline','nis')),
  -- 1 = written by the seed; the demo reset keeps these runs and deletes every other one (trigger demo_reset_uploads).
  seeded             INTEGER NOT NULL DEFAULT 0 CHECK (seeded IN (0,1)),
  -- The format of the R2 object. A current /1 run is served as "not processed" until the case is reseeded.
  schema             TEXT NOT NULL CHECK (schema IN ('codebridge.extraction/1','codebridge.extraction/2')),
  supersedes         TEXT,                     -- the run this one replaced; both stay
  model              TEXT,
  prompt_version     TEXT,
  temperature        REAL,
  input_hashes_json  TEXT NOT NULL CHECK (json_valid(input_hashes_json)),
  r2_key             TEXT NOT NULL,            -- org/<org>/extract/<case>/<run>.json (extract/... before orgs)
  sha256             TEXT NOT NULL CHECK (length(sha256) = 64),
  is_current         INTEGER NOT NULL DEFAULT 1 CHECK (is_current IN (0,1)),
  created_at         TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) CHECK (created_at GLOB '[0-9][0-9][0-9][0-9]-*Z'),
  -- For the Worker deployed during the migration window only, which selects `kind`; dropped by a later migration.
  kind               TEXT GENERATED ALWAYS AS (CASE producer WHEN 'pipeline' THEN 'pipeline' ELSE 'seed_fixture' END) VIRTUAL,
  UNIQUE (org_id, id),
  FOREIGN KEY (org_id, case_id) REFERENCES cases(org_id, id),
  FOREIGN KEY (org_id, supersedes) REFERENCES extraction_runs(org_id, id)
);

-- The /1 alerts, unchanged (the deployed Worker reads them during the window; new code never writes them).
CREATE TABLE alerts (
  id            TEXT PRIMARY KEY,
  org_id        TEXT NOT NULL REFERENCES orgs(id),
  case_id       TEXT NOT NULL,
  run_id        TEXT NOT NULL,
  origin        TEXT NOT NULL CHECK (origin IN ('flag','gap')),
  position      INTEGER NOT NULL CHECK (position >= 0),
  kind          TEXT NOT NULL CHECK (kind IN ('missing','contradiction','chronology','unclear')),
  text_cs       TEXT NOT NULL,
  relevant      INTEGER NOT NULL DEFAULT 0 CHECK (relevant IN (0,1)),
  UNIQUE (org_id, id),
  UNIQUE (run_id, origin, position),
  FOREIGN KEY (org_id, case_id) REFERENCES cases(org_id, id),
  FOREIGN KEY (org_id, run_id) REFERENCES extraction_runs(org_id, id)
);

-- Acknowledgements of /1 alerts, as they were; append-only, not shown any more (their alerts are not in any /2 run).
CREATE TABLE alert_events_v1 (
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

-- Every alert a case has had. An alert ID is 'al-' + 8 hex digits of FNV-1a over rule and subject (keys.ts alertId),
-- unique only within a case, so the key carries the case. Written by run storage and by the first event on an alert.
CREATE TABLE alert_identities (
  org_id        TEXT NOT NULL REFERENCES orgs(id),
  case_id       TEXT NOT NULL,
  id            TEXT NOT NULL CHECK (length(id) = 11 AND id GLOB 'al-*' AND substr(id, 4) NOT GLOB '*[^0-9a-f]*'),
  rule          TEXT NOT NULL,
  subject       TEXT NOT NULL,               -- fact IDs, an expected document or a field name; never patient text
  kind          TEXT NOT NULL CHECK (kind IN ('missing','contradiction','chronology','unclear','poor_copy','identity')),
  first_run_id  TEXT NOT NULL,
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) CHECK (created_at GLOB '[0-9][0-9][0-9][0-9]-*Z'),
  PRIMARY KEY (org_id, case_id, id),
  FOREIGN KEY (org_id, case_id) REFERENCES cases(org_id, id),
  FOREIGN KEY (org_id, first_run_id) REFERENCES extraction_runs(org_id, id)
);

CREATE TABLE alert_events (                  -- append-only; the latest event of an alert is its state (alertState)
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  org_id      TEXT NOT NULL REFERENCES orgs(id),
  case_id     TEXT NOT NULL,
  alert_id    TEXT NOT NULL,
  action      TEXT NOT NULL CHECK (action IN ('ack','resolved','reopen')),
  by_user_id  TEXT NOT NULL,
  by_name     TEXT NOT NULL,
  at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) CHECK (at GLOB '[0-9][0-9][0-9][0-9]-*Z'),
  FOREIGN KEY (org_id, case_id, alert_id) REFERENCES alert_identities(org_id, case_id, id),
  FOREIGN KEY (org_id, case_id) REFERENCES cases(org_id, id),
  FOREIGN KEY (org_id, by_user_id) REFERENCES memberships(org_id, user_id)
);

-- Every fact ID ever issued for a case (the matcher's issuedIds, match.ts). Rows only grow, except for the demo reset.
CREATE TABLE fact_ids (
  org_id        TEXT NOT NULL REFERENCES orgs(id),
  case_id       TEXT NOT NULL,
  fact_id       TEXT NOT NULL CHECK (length(fact_id) BETWEEN 8 AND 10 AND fact_id GLOB 'f-*' AND substr(fact_id, 3) NOT GLOB '*[^0-9a-f]*'),
  first_run_id  TEXT NOT NULL,
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) CHECK (created_at GLOB '[0-9][0-9][0-9][0-9]-*Z'),
  PRIMARY KEY (org_id, case_id, fact_id),
  FOREIGN KEY (org_id, case_id) REFERENCES cases(org_id, id),
  FOREIGN KEY (org_id, first_run_id) REFERENCES extraction_runs(org_id, id)
);

-- A doctor's confirmation of one fact, or its withdrawal; the latest row per fact is the state. value_sha256 is the
-- hash of what the fact said when it was confirmed (frame and value), so a later run that gives the same ID another
-- value shows both to the doctor instead of carrying the confirmation over silently.
CREATE TABLE fact_confirmations (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  org_id        TEXT NOT NULL REFERENCES orgs(id),
  case_id       TEXT NOT NULL,
  fact_id       TEXT NOT NULL,
  action        TEXT NOT NULL CHECK (action IN ('confirm','withdraw')),
  value_sha256  TEXT NOT NULL CHECK (length(value_sha256) = 64),
  run_id        TEXT NOT NULL,                -- the run whose fact the doctor saw
  by_user_id    TEXT NOT NULL,
  by_name       TEXT NOT NULL,
  at            TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) CHECK (at GLOB '[0-9][0-9][0-9][0-9]-*Z'),
  FOREIGN KEY (org_id, case_id, fact_id) REFERENCES fact_ids(org_id, case_id, fact_id),
  FOREIGN KEY (org_id, run_id) REFERENCES extraction_runs(org_id, id),
  FOREIGN KEY (org_id, case_id) REFERENCES cases(org_id, id),
  FOREIGN KEY (org_id, by_user_id) REFERENCES memberships(org_id, user_id)
);

-- ---------- 3. Copy, parents first ----------
-- Seeded fixtures (kind seed_fixture, no producer) stay with the reset; the intake's prepared fixtures and pipeline runs
-- go with it, as before. Every existing run is a /1 object.
INSERT INTO extraction_runs (id, org_id, case_id, producer, seeded, schema, supersedes, model, prompt_version, temperature, input_hashes_json,
    r2_key, sha256, is_current, created_at)
  SELECT id, org_id, case_id,
    CASE WHEN kind = 'pipeline' THEN 'pipeline' ELSE 'fixture' END,
    CASE WHEN kind = 'seed_fixture' AND producer IS NULL THEN 1 ELSE 0 END,
    'codebridge.extraction/1', NULL, model, prompt_version, temperature, input_hashes_json, r2_key, sha256, is_current, created_at
  FROM extraction_runs_old;
INSERT INTO alerts (id, org_id, case_id, run_id, origin, position, kind, text_cs, relevant)
  SELECT id, org_id, case_id, run_id, origin, position, kind, text_cs, relevant FROM alerts_old;
INSERT INTO alert_events_v1 (id, org_id, alert_id, action, by_user_id, by_name, at)
  SELECT id, org_id, alert_id, action, by_user_id, by_name, at FROM alert_events_old;

-- ---------- 4. Drop the old tables, children first ----------
DROP TABLE alert_events_old;
DROP TABLE alerts_old;
DROP TABLE extraction_runs_old;

-- ---------- 5. Added columns ----------
ALTER TABLE fact_edits ADD COLUMN fact_id TEXT
  CHECK (fact_id IS NULL OR (length(fact_id) BETWEEN 8 AND 10 AND fact_id GLOB 'f-*' AND substr(fact_id, 3) NOT GLOB '*[^0-9a-f]*'));
ALTER TABLE document_parts ADD COLUMN part_id TEXT;
UPDATE document_parts SET part_id = document_id || '/p' || ordinal;
-- The deployed Worker inserts parts without the column during the window; this fills it in. New code sets it itself.
CREATE TRIGGER document_parts_part_id AFTER INSERT ON document_parts WHEN NEW.part_id IS NULL
BEGIN
  UPDATE document_parts SET part_id = NEW.document_id || '/p' || NEW.ordinal WHERE document_id = NEW.document_id AND ordinal = NEW.ordinal;
END;

-- ---------- 6. Indexes ----------
CREATE UNIQUE INDEX extraction_runs_current ON extraction_runs(case_id) WHERE is_current = 1;
CREATE INDEX alerts_case ON alerts(case_id);
CREATE INDEX alert_events_v1_alert ON alert_events_v1(alert_id, at);
CREATE INDEX alert_events_case ON alert_events(org_id, case_id, alert_id, at);
CREATE INDEX fact_confirmations_case ON fact_confirmations(org_id, case_id, fact_id, at);
CREATE INDEX fact_ids_run ON fact_ids(org_id, first_run_id);
CREATE INDEX alert_identities_run ON alert_identities(org_id, first_run_id);
CREATE UNIQUE INDEX document_parts_part_id ON document_parts(org_id, part_id);

-- ---------- 7. Append-only triggers ----------
-- As in 0011: no UPDATE, and no DELETE except while this row's org is being reset (reset_in_progress = 1).
CREATE TRIGGER alert_events_no_update BEFORE UPDATE ON alert_events BEGIN SELECT RAISE(ABORT, 'append-only: alert_events'); END;
CREATE TRIGGER alert_events_no_delete BEFORE DELETE ON alert_events WHEN COALESCE((SELECT reset_in_progress FROM demo_state WHERE org_id = OLD.org_id), 0) = 0 BEGIN SELECT RAISE(ABORT, 'append-only: alert_events'); END;
CREATE TRIGGER alert_events_v1_no_update BEFORE UPDATE ON alert_events_v1 BEGIN SELECT RAISE(ABORT, 'append-only: alert_events_v1'); END;
CREATE TRIGGER alert_events_v1_no_delete BEFORE DELETE ON alert_events_v1 WHEN COALESCE((SELECT reset_in_progress FROM demo_state WHERE org_id = OLD.org_id), 0) = 0 BEGIN SELECT RAISE(ABORT, 'append-only: alert_events_v1'); END;
CREATE TRIGGER fact_confirmations_no_update BEFORE UPDATE ON fact_confirmations BEGIN SELECT RAISE(ABORT, 'append-only: fact_confirmations'); END;
CREATE TRIGGER fact_confirmations_no_delete BEFORE DELETE ON fact_confirmations WHEN COALESCE((SELECT reset_in_progress FROM demo_state WHERE org_id = OLD.org_id), 0) = 0 BEGIN SELECT RAISE(ABORT, 'append-only: fact_confirmations'); END;
-- An issued ID never changes or disappears, or a confirmation could end up on another fact or alert.
CREATE TRIGGER fact_ids_no_update BEFORE UPDATE ON fact_ids BEGIN SELECT RAISE(ABORT, 'append-only: fact_ids'); END;
CREATE TRIGGER fact_ids_no_delete BEFORE DELETE ON fact_ids WHEN COALESCE((SELECT reset_in_progress FROM demo_state WHERE org_id = OLD.org_id), 0) = 0 BEGIN SELECT RAISE(ABORT, 'append-only: fact_ids'); END;
CREATE TRIGGER alert_identities_no_update BEFORE UPDATE ON alert_identities BEGIN SELECT RAISE(ABORT, 'append-only: alert_identities'); END;
CREATE TRIGGER alert_identities_no_delete BEFORE DELETE ON alert_identities WHEN COALESCE((SELECT reset_in_progress FROM demo_state WHERE org_id = OLD.org_id), 0) = 0 BEGIN SELECT RAISE(ABORT, 'append-only: alert_identities'); END;

-- ---------- 8. The demo reset ----------
-- As in 0011, plus the /2 tables: every run the seed did not write goes (seeded = 0), with the alert and fact IDs it
-- issued first and what doctors did with them; the seeded run of a case becomes current again. Children are deleted
-- before their parents, because seed.py --reset runs outside a deferred batch, where D1 checks foreign keys at once.
-- Events and confirmations on seeded runs' IDs stay here; the reset route (src/routes/demo.ts) empties those tables.
CREATE TRIGGER demo_reset_uploads AFTER UPDATE OF reset_in_progress ON demo_state
WHEN NEW.reset_in_progress = 1 AND OLD.reset_in_progress = 0
BEGIN
  DELETE FROM pipeline_runs WHERE org_id = NEW.org_id;
  DELETE FROM alert_events_v1 WHERE org_id = NEW.org_id AND alert_id IN (SELECT a.id FROM alerts a JOIN extraction_runs r ON r.id = a.run_id AND r.org_id = a.org_id WHERE a.org_id = NEW.org_id AND r.seeded = 0);
  DELETE FROM alert_events WHERE org_id = NEW.org_id AND (case_id, alert_id) IN (SELECT i.case_id, i.id FROM alert_identities i JOIN extraction_runs r ON r.id = i.first_run_id AND r.org_id = i.org_id WHERE i.org_id = NEW.org_id AND r.seeded = 0);
  DELETE FROM alert_identities WHERE org_id = NEW.org_id AND first_run_id IN (SELECT id FROM extraction_runs WHERE org_id = NEW.org_id AND seeded = 0);
  DELETE FROM fact_confirmations WHERE org_id = NEW.org_id AND (run_id IN (SELECT id FROM extraction_runs WHERE org_id = NEW.org_id AND seeded = 0)
    OR (case_id, fact_id) IN (SELECT f.case_id, f.fact_id FROM fact_ids f JOIN extraction_runs r ON r.id = f.first_run_id AND r.org_id = f.org_id WHERE f.org_id = NEW.org_id AND r.seeded = 0));
  DELETE FROM fact_ids WHERE org_id = NEW.org_id AND first_run_id IN (SELECT id FROM extraction_runs WHERE org_id = NEW.org_id AND seeded = 0);
  DELETE FROM alerts WHERE org_id = NEW.org_id AND run_id IN (SELECT id FROM extraction_runs WHERE org_id = NEW.org_id AND seeded = 0);
  DELETE FROM extraction_runs WHERE org_id = NEW.org_id AND seeded = 0;
  -- A run that superseded a seeded one is gone, so the latest seeded run of that case is current again.
  UPDATE extraction_runs SET is_current = 1
  WHERE org_id = NEW.org_id AND seeded = 1
    AND NOT EXISTS (SELECT 1 FROM extraction_runs c WHERE c.org_id = NEW.org_id AND c.case_id = extraction_runs.case_id AND c.is_current = 1)
    AND id = (SELECT s.id FROM extraction_runs s WHERE s.org_id = NEW.org_id AND s.case_id = extraction_runs.case_id AND s.seeded = 1 ORDER BY s.created_at DESC, s.id DESC LIMIT 1);
  DELETE FROM pages WHERE org_id = NEW.org_id AND document_id IN (SELECT id FROM documents WHERE org_id = NEW.org_id AND origin <> 'seed');
  DELETE FROM document_parts WHERE org_id = NEW.org_id AND document_id IN (SELECT id FROM documents WHERE org_id = NEW.org_id AND origin <> 'seed');
  DELETE FROM documents WHERE org_id = NEW.org_id AND origin <> 'seed';
END;

PRAGMA defer_foreign_keys = false;
