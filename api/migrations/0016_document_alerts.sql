-- Issue #18 (stream B): what the document pipeline without an LLM finds about one uploaded document, before the case
-- merge exists. Both changes only add, so the Worker deployed during the migration window keeps working.
--
-- 1. document_parts gets the date exactly as printed (partial dates stay partial, "03/2024"), how sure the split is,
--    and who produced the part: the page reader's splitting writes 'pipeline' rows; the seed and the intake's
--    prepared data leave it NULL as before.
ALTER TABLE document_parts ADD COLUMN date_as_written TEXT;
ALTER TABLE document_parts ADD COLUMN certainty TEXT CHECK (certainty IS NULL OR certainty IN ('documented','verify'));
ALTER TABLE document_parts ADD COLUMN producer TEXT CHECK (producer IS NULL OR producer = 'pipeline');

-- 2. document_alerts: alerts about one document (a poor copy, another patient's identity on its pages) that need no
--    extraction run. The case's `alerts` table hangs off extraction_runs, which a document without a case merge does
--    not have. This is a small interim store: when the case merge (stream A's format) publishes a pipeline run, these
--    become alert instances of that run, and the ids already follow its rule (alertId: rule plus subject, FNV-1a, as
--    packages/domain/src/extraction/keys.ts), so an acknowledgement can carry over.
--    Rows are replaced on every finished run of the document: they say what the latest reading found.
--    No identity value is stored: the message has a Fluent id and arguments that are page numbers only.
CREATE TABLE document_alerts (
  id            TEXT NOT NULL,              -- 'al-' + fnv1a32(rule|subject)
  org_id        TEXT NOT NULL REFERENCES orgs(id),
  case_id       TEXT NOT NULL,              -- no foreign key: an intake discard or reset removes the case first
  document_id   TEXT NOT NULL,
  rule          TEXT NOT NULL CHECK (rule IN ('poor_copy','identity_conflict')),
  subject       TEXT NOT NULL,              -- the document id (the rule's subject)
  kind          TEXT NOT NULL CHECK (kind IN ('poor_copy','identity')),
  message_id    TEXT NOT NULL,              -- Fluent message (i18n/<lang>/*.ftl)
  args_json     TEXT NOT NULL CHECK (json_valid(args_json)),
  run_id        TEXT NOT NULL,              -- the pipeline run that raised it
  created_at    TEXT NOT NULL CHECK (created_at GLOB '[0-9][0-9][0-9][0-9]-*Z'),
  PRIMARY KEY (org_id, id)
);
CREATE INDEX document_alerts_case ON document_alerts(org_id, case_id);

-- reset-demo: the uploads go (demo_reset_uploads), and with them their alerts. A trigger of its own on the same
-- "reset_in_progress = 1" update, so the reset batch stays at its size (api/AGENTS.md, "Reset").
CREATE TRIGGER demo_reset_document_alerts AFTER UPDATE OF reset_in_progress ON demo_state
WHEN NEW.reset_in_progress = 1 AND OLD.reset_in_progress = 0
BEGIN
  DELETE FROM document_alerts WHERE org_id = NEW.org_id;
END;
