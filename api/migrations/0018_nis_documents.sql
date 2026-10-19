-- Issue #22, stream F phase 2b: documents imported from the NIS (the hospital information system, read over FHIR).
-- Each one is stored as an upload (documents, origin 'upload', processed like one: identity per page, fragments, the
-- case merge); this table says which NIS record and version it came from, one row per version taken over, so a later
-- import skips a version it already holds and retires an older version when the NIS replaces it. Codes and IDs only:
-- the NIS's resource ID and version, never a title or a name.
--
-- document_id becomes NULL when the document is deleted from the case (a doctor removed the stored file): the row
-- stays, so the import never brings that DocumentReference back. A withdrawn document (another patient's) keeps its
-- row, and the import declines that DocumentReference too. No foreign key on the document for that reason (a composite
-- one cannot set only document_id to NULL); a trigger clears it.
CREATE TABLE nis_documents (
  org_id        TEXT NOT NULL REFERENCES orgs(id),
  case_id       TEXT NOT NULL,
  nis_system    TEXT NOT NULL CHECK (length(nis_system) BETWEEN 1 AND 300),
  nis_resource  TEXT NOT NULL CHECK (nis_resource GLOB 'DocumentReference/*' AND length(nis_resource) <= 100),
  nis_version   TEXT NOT NULL DEFAULT '' CHECK (length(nis_version) <= 64),
  document_id   TEXT,
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) CHECK (created_at GLOB '[0-9][0-9][0-9][0-9]-*Z'),
  PRIMARY KEY (org_id, case_id, nis_system, nis_resource, nis_version),
  FOREIGN KEY (org_id, case_id) REFERENCES cases(org_id, id)
);
CREATE INDEX nis_documents_document ON nis_documents(org_id, document_id);

-- A deleted document leaves its row as a marker that the case declined that DocumentReference.
CREATE TRIGGER nis_documents_document_deleted AFTER DELETE ON documents
BEGIN
  UPDATE nis_documents SET document_id = NULL WHERE org_id = OLD.org_id AND document_id = OLD.id;
END;

-- reset-demo: the org's rows go with its uploads, so a reset case can take the NIS documents in again.
CREATE TRIGGER demo_reset_nis_documents AFTER UPDATE OF reset_in_progress ON demo_state
WHEN NEW.reset_in_progress = 1 AND OLD.reset_in_progress = 0
BEGIN
  DELETE FROM nis_documents WHERE org_id = NEW.org_id;
END;
