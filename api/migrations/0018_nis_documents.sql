-- Issue #22, stream F phase 2b: documents imported from the NIS (the hospital information system, read over FHIR).
-- Each one is stored as an upload (documents, origin 'upload', processed like one: identity per page, fragments, the
-- case merge); this table says which NIS record it came from, so a later import skips a version it already holds and
-- retires an older version when the NIS replaces it (DocumentReference relatesTo replaces, or a new version of the same
-- record). Codes and IDs only: the NIS's resource ID and version, never a title or a name.
CREATE TABLE nis_documents (
  org_id        TEXT NOT NULL REFERENCES orgs(id),
  document_id   TEXT NOT NULL,
  case_id       TEXT NOT NULL,
  nis_system    TEXT NOT NULL CHECK (length(nis_system) BETWEEN 1 AND 300),
  nis_resource  TEXT NOT NULL CHECK (nis_resource GLOB 'DocumentReference/*' AND length(nis_resource) <= 100),
  nis_version   TEXT NOT NULL DEFAULT '' CHECK (length(nis_version) <= 64),
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) CHECK (created_at GLOB '[0-9][0-9][0-9][0-9]-*Z'),
  PRIMARY KEY (org_id, document_id),
  UNIQUE (org_id, case_id, nis_system, nis_resource, nis_version),
  -- A row goes with its document (a stored upload removed, the demo reset's delete of uploads), never left dangling.
  FOREIGN KEY (org_id, document_id) REFERENCES documents(org_id, id) ON DELETE CASCADE,
  FOREIGN KEY (org_id, case_id) REFERENCES cases(org_id, id)
);
