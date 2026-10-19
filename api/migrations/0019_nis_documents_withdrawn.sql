-- Issue #22 (Juro's decision of 2026-10-20): a document the NIS import brought is withdrawn automatically when the NIS
-- voids it (entered-in-error), when it disappears from the NIS, or when the patient is unlinked from the NIS record.
-- `auto_withdrawn` says which. Unlike a doctor's own withdraw of another patient's document (declined for good), a
-- document withdrawn this way comes back when a later import finds it current again (a re-link or a re-import), and the
-- case run carries an alert for the doctor naming it until then.
ALTER TABLE nis_documents ADD COLUMN auto_withdrawn TEXT
  CHECK (auto_withdrawn IS NULL OR auto_withdrawn IN ('nis_voided','nis_removed','nis_unlinked'));
-- 1 when the import itself stored the document; 0 when the NIS version was only mapped onto a document already in the
-- case (the same bytes, uploaded by hand). Only a document the import created is ever withdrawn by it: a doctor's own
-- upload is never deleted because the NIS dropped a copy of it.
ALTER TABLE nis_documents ADD COLUMN created_by_import INTEGER NOT NULL DEFAULT 0 CHECK (created_by_import IN (0,1));
