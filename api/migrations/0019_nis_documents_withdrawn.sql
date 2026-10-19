-- Issue #22 (Juro's decision of 2026-10-20): a document the NIS import brought is withdrawn automatically when the NIS
-- voids it (entered-in-error), when it disappears from the NIS, or when the patient is unlinked from the NIS record.
-- `auto_withdrawn` says which. Unlike a doctor's own withdraw of another patient's document (declined for good), a
-- document withdrawn this way comes back when a later import finds it current again (a re-link or a re-import), and the
-- case run carries an alert for the doctor naming it until then.
ALTER TABLE nis_documents ADD COLUMN auto_withdrawn TEXT
  CHECK (auto_withdrawn IS NULL OR auto_withdrawn IN ('nis_voided','nis_removed','nis_unlinked'));
