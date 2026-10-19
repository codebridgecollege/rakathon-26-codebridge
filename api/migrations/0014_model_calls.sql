-- Issue #20 (stream D): one row per external model call (src/services/model.ts). The access log gets one row per
-- page sent, before the first attempt, pointing here with target_type 'model_call'; the access log is append-only, so
-- the outcome (attempts, upstream status, error code) is recorded on this row instead. It also carries the per-org
-- page count the model budget reads. No patient text: ids, hashes, counts and fixed codes only.
CREATE TABLE model_calls (
  id               TEXT PRIMARY KEY,
  org_id           TEXT NOT NULL REFERENCES orgs(id),
  case_id          TEXT NOT NULL,                 -- no FK, as for the access log: the record must outlive the case
  purpose          TEXT NOT NULL CHECK (purpose GLOB '[a-z]*' AND length(purpose) <= 40),
  prompt_ref       TEXT NOT NULL,                 -- 'read-page-cs@1'
  prompt_sha256    TEXT NOT NULL CHECK (length(prompt_sha256) = 64),
  provider         TEXT NOT NULL,
  model            TEXT NOT NULL,
  input_sha256     TEXT NOT NULL CHECK (length(input_sha256) = 64),
  pages            INTEGER NOT NULL CHECK (pages >= 0),
  images           INTEGER NOT NULL CHECK (images >= 0),
  input_chars      INTEGER NOT NULL CHECK (input_chars >= 0),
  state            TEXT NOT NULL CHECK (state IN ('sending','done','error')),
  attempts         INTEGER CHECK (attempts IS NULL OR attempts >= 1),
  upstream_status  INTEGER,
  error_code       TEXT CHECK (error_code IS NULL OR (error_code GLOB '[a-z]*' AND length(error_code) <= 40)),
  ms               INTEGER,
  created_at       TEXT NOT NULL CHECK (created_at GLOB '[0-9][0-9][0-9][0-9]-*Z'),
  finished_at      TEXT CHECK (finished_at IS NULL OR finished_at GLOB '[0-9][0-9][0-9][0-9]-*Z'),
  UNIQUE (org_id, id)
);
CREATE INDEX model_calls_org_time ON model_calls(org_id, created_at);
CREATE INDEX access_log_model_pages ON access_log(org_id, case_id, action, document_id, page_n, at);

-- Reset-demo removes an org's calls with its uploads (the reset batch flips reset_in_progress), as for upload sessions.
CREATE TRIGGER demo_reset_model_calls AFTER UPDATE OF reset_in_progress ON demo_state
WHEN NEW.reset_in_progress = 1 AND OLD.reset_in_progress = 0
BEGIN
  DELETE FROM model_calls WHERE org_id = NEW.org_id;
END;
