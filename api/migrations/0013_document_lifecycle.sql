-- Documents can leave the case's current set (docs/design/EXTRACTION-FORMAT.md, section "documents"): a document is
-- `superseded` when a better scan of the same paper replaces it, or `withdrawn` when it turned out to be another
-- patient's. An extraction run reads only `current` documents, so facts from a superseded or withdrawn document are
-- not in the next run, and doctor confirmations attached to them show up as "potvrzeno dříve, v novém zpracování
-- chybí" instead of disappearing.
--
-- Why new columns and not new values of documents.state: `state` is the processing state of an upload (stored ...
-- processed, failed), a different question from "does this document still count". A processed scan can be superseded.
-- Widening the CHECK on `state` would also need a rebuild of the documents table, which the Worker that is still
-- deployed during the migration window cannot run against (api/AGENTS.md, "The window"). ADD COLUMN with a default
-- keeps every existing INSERT and SELECT working: the old code never names these columns and every row starts current.
--
-- The document row itself stays (with its pages and parts), so the doctor can still open what was replaced and see why.

ALTER TABLE documents ADD COLUMN lifecycle TEXT NOT NULL DEFAULT 'current'
  CHECK (lifecycle IN ('current','superseded','withdrawn'));
-- The replacing document's id. A trigger below checks it, because SQLite cannot add the org-scoped composite foreign
-- key (org_id, superseded_by) with ALTER TABLE.
ALTER TABLE documents ADD COLUMN superseded_by TEXT;
-- Why the document left the current set, in Czech for the doctor ("lepší sken", "dokument jiného pacienta").
ALTER TABLE documents ADD COLUMN lifecycle_reason_cs TEXT;
ALTER TABLE documents ADD COLUMN lifecycle_changed_at TEXT
  CHECK (lifecycle_changed_at IS NULL OR lifecycle_changed_at GLOB '[0-9][0-9][0-9][0-9]-*Z');
-- Who did it: a user of a membership in the document's org (checked below, as uploaded_by is by its foreign key).
ALTER TABLE documents ADD COLUMN lifecycle_changed_by TEXT;

-- The pipeline and the case view ask for the current documents of one case.
CREATE INDEX documents_case_lifecycle ON documents(org_id, case_id, lifecycle);

-- A document starts current. Leaving the current set is an UPDATE, so it always passes the checks below and records
-- who and when.
CREATE TRIGGER documents_lifecycle_starts_current BEFORE INSERT ON documents
WHEN NEW.lifecycle <> 'current' OR NEW.superseded_by IS NOT NULL OR NEW.lifecycle_changed_at IS NOT NULL OR NEW.lifecycle_changed_by IS NOT NULL
BEGIN SELECT RAISE(ABORT, 'a document starts current'); END;

-- Append-only in spirit: a superseded or withdrawn document never comes back and never switches between the two, so a
-- confirmation that was orphaned by the change stays explained. The demo reset (reset_in_progress = 1 for the org) is
-- the one exception; it puts the seeded documents back (trigger demo_reset_document_lifecycle).
CREATE TRIGGER documents_lifecycle_final BEFORE UPDATE OF lifecycle, superseded_by, lifecycle_reason_cs, lifecycle_changed_at, lifecycle_changed_by ON documents
WHEN OLD.lifecycle <> 'current'
  AND (NEW.lifecycle IS NOT OLD.lifecycle OR NEW.superseded_by IS NOT OLD.superseded_by OR NEW.lifecycle_reason_cs IS NOT OLD.lifecycle_reason_cs
       OR NEW.lifecycle_changed_at IS NOT OLD.lifecycle_changed_at OR NEW.lifecycle_changed_by IS NOT OLD.lifecycle_changed_by)
  AND COALESCE((SELECT reset_in_progress FROM demo_state WHERE org_id = OLD.org_id), 0) = 0
BEGIN SELECT RAISE(ABORT, 'a superseded or withdrawn document stays so'); END;

-- Only superseded names a replacement; current and withdrawn never do.
CREATE TRIGGER documents_lifecycle_replacement_only_when_superseded BEFORE UPDATE OF lifecycle, superseded_by ON documents
WHEN (NEW.lifecycle = 'superseded') <> (NEW.superseded_by IS NOT NULL)
BEGIN SELECT RAISE(ABORT, 'superseded_by is set exactly when the document is superseded'); END;

-- The replacement is another current document of the same org and case. A replacement from another case would move a
-- patient's paper into someone else's record; a superseded replacement would build chains nobody reads.
CREATE TRIGGER documents_lifecycle_replacement_same_case BEFORE UPDATE OF lifecycle, superseded_by ON documents
WHEN NEW.superseded_by IS NOT NULL AND NEW.superseded_by IS NOT OLD.superseded_by
  AND (NEW.superseded_by = NEW.id OR NOT EXISTS (
    SELECT 1 FROM documents r WHERE r.id = NEW.superseded_by AND r.org_id = NEW.org_id AND r.case_id = NEW.case_id AND r.lifecycle = 'current'))
BEGIN SELECT RAISE(ABORT, 'a document is superseded by another current document of the same case'); END;

-- Leaving the current set records when and by whom, and the person belongs to the document's org.
CREATE TRIGGER documents_lifecycle_who_and_when BEFORE UPDATE OF lifecycle ON documents
WHEN NEW.lifecycle <> 'current' AND OLD.lifecycle = 'current'
  AND (NEW.lifecycle_changed_at IS NULL OR NEW.lifecycle_changed_by IS NULL
       OR NOT EXISTS (SELECT 1 FROM memberships m WHERE m.org_id = NEW.org_id AND m.user_id = NEW.lifecycle_changed_by))
BEGIN SELECT RAISE(ABORT, 'a superseded or withdrawn document records when and by which member of its org'); END;

-- reset-demo: the uploads are deleted by demo_reset_uploads; a seeded document that one of them superseded, or that was
-- withdrawn during the demo, becomes current again. Fires on the same "reset_in_progress = 1" statement.
CREATE TRIGGER demo_reset_document_lifecycle AFTER UPDATE OF reset_in_progress ON demo_state
WHEN NEW.reset_in_progress = 1 AND OLD.reset_in_progress = 0
BEGIN
  UPDATE documents SET lifecycle = 'current', superseded_by = NULL, lifecycle_reason_cs = NULL, lifecycle_changed_at = NULL, lifecycle_changed_by = NULL
  WHERE org_id = NEW.org_id AND lifecycle <> 'current';
END;
