-- Issue #22, stream F phase 1: a patient's record in the org's NIS (the hospital information system, read over FHIR).
-- A person links it after comparing the candidates (POST /api/cases/:id/nis/link); nothing links on its own and two
-- NIS records are never merged (CLAUDE.md, "Do not merge patients silently"). In its own table, not on patients: the
-- app never changes a seeded patient row, and the demo reset removes links by the trigger below.
-- Comes after 0013 (document lifecycle, #17) and 0014 (model calls, #20); it only adds a table and a trigger.
CREATE TABLE patient_nis_links (
  org_id          TEXT NOT NULL REFERENCES orgs(id),
  patient_id      TEXT NOT NULL,
  -- The NIS's FHIR base URL, the "system" a NIS source names (docs/design/EXTRACTION-FORMAT.md).
  nis_system      TEXT NOT NULL CHECK (length(nis_system) BETWEEN 1 AND 300),
  nis_patient_id  TEXT NOT NULL CHECK (length(nis_patient_id) BETWEEN 1 AND 64 AND nis_patient_id NOT GLOB '*[^A-Za-z0-9.-]*'),
  nis_version     TEXT CHECK (nis_version IS NULL OR length(nis_version) <= 64),
  -- The NIS birth number against the patient row's when linked: equal; equal with a name that differs (the person
  -- confirmed); or the row had none (the person confirmed). A conflict is refused, so it is not a value here.
  identity_check  TEXT NOT NULL CHECK (identity_check IN ('matches','matches_name_differs','cannot_verify')),
  by_user_id      TEXT NOT NULL,
  by_name         TEXT NOT NULL,
  at              TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) CHECK (at GLOB '[0-9][0-9][0-9][0-9]-*Z'),
  PRIMARY KEY (org_id, patient_id),
  -- One NIS record belongs to one patient row of the org: a second row for the same record would be a silent duplicate.
  UNIQUE (org_id, nis_system, nis_patient_id),
  FOREIGN KEY (org_id, patient_id) REFERENCES patients(org_id, id),
  FOREIGN KEY (org_id, by_user_id) REFERENCES memberships(org_id, user_id)
);

-- reset-demo: the links go with the org's other app-made rows; the trigger fires before the reset batch deletes the
-- patients created after the seed, so their links are gone first.
CREATE TRIGGER demo_reset_nis_links AFTER UPDATE OF reset_in_progress ON demo_state
WHEN NEW.reset_in_progress = 1 AND OLD.reset_in_progress = 0
BEGIN
  DELETE FROM patient_nis_links WHERE org_id = NEW.org_id;
END;
