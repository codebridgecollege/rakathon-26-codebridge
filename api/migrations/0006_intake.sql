-- Step 6 (a-2): "Nový pacient" on the server. Design: docs/research/backend-steps/step-6.md ("As implemented").
-- The referral creates the case at once, open for intake: the creator uploads its documents to it, and completing the
-- intake attaches a fixture's prepared extraction only when every document matches by hash and the referral's name and
-- birth number match the fixture's patient.

-- An open intake is hidden from the patient list, the calendar and the workflow, and only its creator reaches it.
-- cases.status keeps its CHECK (SQLite cannot change one), so the intake state is a column of its own.
ALTER TABLE cases ADD COLUMN intake_open INTEGER NOT NULL DEFAULT 0 CHECK (intake_open IN (0,1));
-- The fixture whose prepared extraction the intake attached; NULL when nothing was attached.
ALTER TABLE cases ADD COLUMN intake_fixture TEXT;
-- The SHA-256 of the FHIR referral the form was filled from; the bundle itself holds identity and is not stored.
ALTER TABLE cases ADD COLUMN referral_sha256 TEXT CHECK (referral_sha256 IS NULL OR length(referral_sha256) = 64);
CREATE INDEX cases_intake ON cases(intake_open, created_at) WHERE intake_open = 1;
-- One case holds a fixture's prepared extraction: a second copy would share its pages.
CREATE UNIQUE INDEX cases_intake_fixture ON cases(intake_fixture) WHERE intake_fixture IS NOT NULL AND intake_open = 0;

-- Who produced a run. Seeded runs keep NULL; an intake attach writes 'prepared-fixture' (kind stays 'seed_fixture':
-- the data was written in advance by development agents, not read by the pipeline).
ALTER TABLE extraction_runs ADD COLUMN producer TEXT CHECK (producer IS NULL OR producer IN ('prepared-fixture'));

-- reset-demo: the trigger of migration 0005 also removes what an intake attach wrote, still without adding a statement
-- to the reset batch.
DROP TRIGGER IF EXISTS demo_reset_uploads;
CREATE TRIGGER demo_reset_uploads AFTER UPDATE OF reset_in_progress ON demo_state
WHEN NEW.reset_in_progress = 1 AND OLD.reset_in_progress = 0
BEGIN
  -- alert_events first: D1 checks foreign keys at once outside a deferred batch (seed.py --reset).
  DELETE FROM alert_events WHERE alert_id IN (SELECT a.id FROM alerts a JOIN extraction_runs r ON r.id = a.run_id WHERE r.producer IS NOT NULL);
  DELETE FROM alerts WHERE run_id IN (SELECT id FROM extraction_runs WHERE producer IS NOT NULL);
  DELETE FROM extraction_runs WHERE producer IS NOT NULL;
  DELETE FROM pages WHERE document_id IN (SELECT id FROM documents WHERE origin <> 'seed');
  DELETE FROM document_parts WHERE document_id IN (SELECT id FROM documents WHERE origin <> 'seed');
  DELETE FROM documents WHERE origin <> 'seed';
END;
