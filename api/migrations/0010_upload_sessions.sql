-- Upload from a phone (issue #10, docs/design/PHONE-UPLOAD.md). An upload session is a short-lived permission, created
-- by a desktop user, to add files to one case from a phone that is not logged in. Its token is the random value in the
-- QR code; only its SHA-256 is stored, so a database read cannot be turned into an upload permission.
CREATE TABLE upload_sessions (
  id          TEXT PRIMARY KEY,
  token_hash  TEXT NOT NULL UNIQUE,              -- hex SHA-256 of the token; the token itself is never stored
  case_id     TEXT NOT NULL,                     -- no foreign key: an intake discard deletes its case, the session then answers "closed"
  target      TEXT NOT NULL CHECK (target IN ('intake','discussion','documents')),
  created_by  TEXT NOT NULL,                     -- the desktop user; the phone's files are uploaded under this name
  created_at  TEXT NOT NULL,
  expires_at  TEXT NOT NULL,
  closed_at   TEXT,
  file_count  INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX upload_sessions_case ON upload_sessions(case_id);

-- Which documents came from a phone, and through which session (the desktop's poll lists them).
ALTER TABLE documents ADD COLUMN source TEXT CHECK (source IS NULL OR source = 'phone');
ALTER TABLE documents ADD COLUMN upload_session_id TEXT;
CREATE INDEX documents_upload_session ON documents(upload_session_id) WHERE upload_session_id IS NOT NULL;

-- reset-demo closes every session: its rows go with the uploads, on the same flag as demo_reset_uploads (migration
-- 0005), so the reset batch does not grow.
CREATE TRIGGER demo_reset_upload_sessions AFTER UPDATE OF reset_in_progress ON demo_state
WHEN NEW.reset_in_progress = 1 AND OLD.reset_in_progress = 0
BEGIN
  DELETE FROM upload_sessions;
END;
