-- Step 6 (a-1): uploads to R2. Design: docs/research/backend-steps/step-6.md ("As implemented").
-- A user uploads one PDF per request to a case; in the shared demo only registered synthetic fixtures (matched by the
-- SHA-256 of the bytes) are accepted, anything else is refused and never stored.

-- ---------- documents: what an upload needs ----------
-- state is NULL for the seeded documents (their processing column already says what they are).
ALTER TABLE documents ADD COLUMN state TEXT CHECK (state IS NULL OR state IN ('stored','prepared','queued','processing','processed','failed'));
ALTER TABLE documents ADD COLUMN state_detail_cs TEXT;
ALTER TABLE documents ADD COLUMN fixture_id TEXT;             -- the registered fixture the bytes matched; NULL otherwise
-- The registry's patient compared with the case's patient: never blocks, never merges (CLAUDE.md, two patients mixed up).
ALTER TABLE documents ADD COLUMN identity TEXT CHECK (identity IS NULL OR identity IN ('matches','conflicts','cannot_verify'));
ALTER TABLE documents ADD COLUMN title_cs TEXT;               -- the fixture's document title; NULL for an unknown file
ALTER TABLE documents ADD COLUMN doc_type TEXT;
ALTER TABLE documents ADD COLUMN doc_date TEXT;               -- as the registry gives it ('YYYY-MM-DD', 'YYYY-MM'); never filled in
ALTER TABLE documents ADD COLUMN readability TEXT CHECK (readability IS NULL OR readability IN ('good','fair','poor','empty'));
ALTER TABLE documents ADD COLUMN readability_reasons_json TEXT CHECK (readability_reasons_json IS NULL OR json_valid(readability_reasons_json));
-- The same bytes twice in one case are one document; the file name is display data only.
CREATE UNIQUE INDEX documents_case_sha ON documents(case_id, sha256) WHERE sha256 IS NOT NULL;

-- ---------- the fixture registry ----------
-- fixture_files (step 2) lists the files; these columns say what each one is, so the upload route can answer from D1
-- alone. Written by api/seed/seed.py only.
ALTER TABLE fixture_files ADD COLUMN kind TEXT NOT NULL DEFAULT 'upload' CHECK (kind IN ('upload','combined','referral'));
ALTER TABLE fixture_files ADD COLUMN size_bytes INTEGER;
ALTER TABLE fixture_files ADD COLUMN title_cs TEXT;
ALTER TABLE fixture_files ADD COLUMN doc_type TEXT;
ALTER TABLE fixture_files ADD COLUMN doc_date TEXT;
ALTER TABLE fixture_files ADD COLUMN page_count INTEGER;
-- Pages of the fixture's combined PDF this file holds ([5] for the lab sheet that is page 5 of S02_pacient.pdf).
ALTER TABLE fixture_files ADD COLUMN combined_pages_json TEXT CHECK (combined_pages_json IS NULL OR json_valid(combined_pages_json));

-- Whose documents each fixture holds. Identity of synthetic fixture patients, kept in D1 next to patients and never in
-- R2 or in case-side JSON, so a fixture uploaded into another patient's case is recognised at once.
CREATE TABLE fixture_patients (
  fixture_id        TEXT PRIMARY KEY,           -- 'S02', 'S01', 'FNO-10'
  full_name         TEXT NOT NULL,
  birth_number      TEXT,                       -- NULL when the documents do not state it (S01)
  data_origin       TEXT NOT NULL CHECK (data_origin IN ('fno_challenge','codebridge_synthetic'))
);

-- ---------- reset-demo ----------
-- reset-demo (src/routes/demo.ts) runs in one D1 batch and is at 48 of the 50 statements Workers Free allows. The rows
-- uploads add are removed by this trigger, which fires on the batch's own "reset_in_progress = 1" statement, so the
-- batch does not grow. Only the reset and seed.py set the flag (migration 0003). Seeded documents stay.
CREATE TRIGGER demo_reset_uploads AFTER UPDATE OF reset_in_progress ON demo_state
WHEN NEW.reset_in_progress = 1 AND OLD.reset_in_progress = 0
BEGIN
  DELETE FROM pages WHERE document_id IN (SELECT id FROM documents WHERE origin <> 'seed');
  DELETE FROM document_parts WHERE document_id IN (SELECT id FROM documents WHERE origin <> 'seed');
  DELETE FROM documents WHERE origin <> 'seed';
END;
