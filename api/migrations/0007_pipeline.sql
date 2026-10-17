-- Step 6 (b-1): the document pipeline without any LLM. Design: docs/research/backend-steps/step-6.md ("As implemented").
-- A run reads one stored PDF through the PageKit container (render, Tesseract, the PDF text layer as a second reading,
-- the readability check, the lab parser) in a Workflow, and writes its outputs to R2 under uploads/<case>/<doc>/<run>/.
-- A run never replaces what a case shows: for a document with prepared data it is shown next to it, labelled.

CREATE TABLE pipeline_runs (
  id                     TEXT PRIMARY KEY,            -- also the Workflow instance id
  document_id            TEXT NOT NULL REFERENCES documents(id),
  case_id                TEXT NOT NULL REFERENCES cases(id),
  state                  TEXT NOT NULL CHECK (state IN ('queued','running','done','error')),
  stage                  TEXT CHECK (stage IS NULL OR stage IN ('inspect','pages','analyze','labs','write')),
  error_code             TEXT,                        -- a fixed code, never container or page text
  pipeline_version       TEXT NOT NULL,               -- GIT_SHA of the Worker that started the run
  container_versions_json TEXT CHECK (container_versions_json IS NULL OR json_valid(container_versions_json)),  -- /healthz versions
  stages_json            TEXT CHECK (stages_json IS NULL OR json_valid(stages_json)),  -- stage, duration, counts; no text
  input_sha256           TEXT NOT NULL CHECK (length(input_sha256) = 64),
  output_prefix          TEXT NOT NULL,               -- uploads/<case>/<doc>/<run>/
  page_count             INTEGER,
  readability            TEXT CHECK (readability IS NULL OR readability IN ('good','fair','poor','empty')),
  readability_reasons_json TEXT CHECK (readability_reasons_json IS NULL OR json_valid(readability_reasons_json)),
  verify_count           INTEGER,                     -- "ověřit" marks over all pages
  lab_points             INTEGER,
  lab_unclear            INTEGER,                     -- points marked "ověřit" (unclear_ocr)
  -- Compared with the prepared extraction of the same document, when there is one: equal, marked "ověřit", and
  -- different without a mark (must stay 0; a silent difference is a failure of the pipeline).
  diff_same              INTEGER,
  diff_verify            INTEGER,
  diff_silent            INTEGER,
  diff_missing           INTEGER,                     -- prepared points the run did not find
  created_by             TEXT NOT NULL,
  created_by_name        TEXT NOT NULL,
  created_at             TEXT NOT NULL CHECK (created_at GLOB '[0-9][0-9][0-9][0-9]-*Z'),
  updated_at             TEXT NOT NULL CHECK (updated_at GLOB '[0-9][0-9][0-9][0-9]-*Z'),
  finished_at            TEXT
);
CREATE INDEX pipeline_runs_doc ON pipeline_runs(document_id, created_at);
-- One run at a time per document: a double click cannot start two.
CREATE UNIQUE INDEX pipeline_runs_active ON pipeline_runs(document_id) WHERE state IN ('queued','running');

-- reset-demo: runs go with the uploads, still inside the one trigger (the reset batch stays at its size).
DROP TRIGGER IF EXISTS demo_reset_uploads;
CREATE TRIGGER demo_reset_uploads AFTER UPDATE OF reset_in_progress ON demo_state
WHEN NEW.reset_in_progress = 1 AND OLD.reset_in_progress = 0
BEGIN
  DELETE FROM pipeline_runs;
  -- alert_events first: D1 checks foreign keys at once outside a deferred batch (seed.py --reset).
  DELETE FROM alert_events WHERE alert_id IN (SELECT a.id FROM alerts a JOIN extraction_runs r ON r.id = a.run_id WHERE r.producer IS NOT NULL);
  DELETE FROM alerts WHERE run_id IN (SELECT id FROM extraction_runs WHERE producer IS NOT NULL);
  DELETE FROM extraction_runs WHERE producer IS NOT NULL;
  DELETE FROM pages WHERE document_id IN (SELECT id FROM documents WHERE origin <> 'seed');
  DELETE FROM document_parts WHERE document_id IN (SELECT id FROM documents WHERE origin <> 'seed');
  DELETE FROM documents WHERE origin <> 'seed';
END;
