-- Erasing a patient for good (Soňa's decision 2026-11-05; CLAUDE.md, "MDT decisions are an append-only history"). The
-- history stays append-only for everything else. A case's own history may go only in the batch that first writes this
-- row, so no other path can delete it. The row keeps no identity: it says a case was erased, and keeps its number out of
-- reuse, because the access log still names that ID and must never point at a later patient.
CREATE TABLE case_erasures (
  org_id     TEXT NOT NULL REFERENCES orgs(id),
  case_id    TEXT NOT NULL,
  case_no    TEXT NOT NULL,
  erased_at  TEXT NOT NULL CHECK (erased_at GLOB '[0-9][0-9][0-9][0-9]-*Z'),
  PRIMARY KEY (org_id, case_id)
);
DROP TRIGGER decisions_no_delete;
CREATE TRIGGER decisions_no_delete BEFORE DELETE ON decisions
WHEN COALESCE((SELECT reset_in_progress FROM demo_state WHERE org_id = OLD.org_id), 0) = 0
  AND NOT EXISTS (SELECT 1 FROM case_erasures e WHERE e.org_id = OLD.org_id AND e.case_id = OLD.case_id)
BEGIN SELECT RAISE(ABORT, 'append-only: decisions'); END;
DROP TRIGGER status_history_no_delete;
CREATE TRIGGER status_history_no_delete BEFORE DELETE ON status_history
WHEN COALESCE((SELECT reset_in_progress FROM demo_state WHERE org_id = OLD.org_id), 0) = 0
  AND NOT EXISTS (SELECT 1 FROM case_erasures e WHERE e.org_id = OLD.org_id AND e.case_id = OLD.case_id)
BEGIN SELECT RAISE(ABORT, 'append-only: status_history'); END;
DROP TRIGGER edit_log_no_delete;
CREATE TRIGGER edit_log_no_delete BEFORE DELETE ON edit_log
WHEN COALESCE((SELECT reset_in_progress FROM demo_state WHERE org_id = OLD.org_id), 0) = 0
  AND NOT EXISTS (SELECT 1 FROM case_erasures e WHERE e.org_id = OLD.org_id AND e.case_id = OLD.case_id)
BEGIN SELECT RAISE(ABORT, 'append-only: edit_log'); END;
DROP TRIGGER question_confirmations_no_delete;
CREATE TRIGGER question_confirmations_no_delete BEFORE DELETE ON question_confirmations
WHEN COALESCE((SELECT reset_in_progress FROM demo_state WHERE org_id = OLD.org_id), 0) = 0
  AND NOT EXISTS (SELECT 1 FROM case_erasures e WHERE e.org_id = OLD.org_id AND e.case_id = OLD.case_id)
BEGIN SELECT RAISE(ABORT, 'append-only: question_confirmations'); END;
DROP TRIGGER alert_events_no_delete;
CREATE TRIGGER alert_events_no_delete BEFORE DELETE ON alert_events
WHEN COALESCE((SELECT reset_in_progress FROM demo_state WHERE org_id = OLD.org_id), 0) = 0
  AND NOT EXISTS (SELECT 1 FROM case_erasures e WHERE e.org_id = OLD.org_id AND e.case_id = OLD.case_id)
BEGIN SELECT RAISE(ABORT, 'append-only: alert_events'); END;
DROP TRIGGER fact_confirmations_no_delete;
CREATE TRIGGER fact_confirmations_no_delete BEFORE DELETE ON fact_confirmations
WHEN COALESCE((SELECT reset_in_progress FROM demo_state WHERE org_id = OLD.org_id), 0) = 0
  AND NOT EXISTS (SELECT 1 FROM case_erasures e WHERE e.org_id = OLD.org_id AND e.case_id = OLD.case_id)
BEGIN SELECT RAISE(ABORT, 'append-only: fact_confirmations'); END;
DROP TRIGGER fact_ids_no_delete;
CREATE TRIGGER fact_ids_no_delete BEFORE DELETE ON fact_ids
WHEN COALESCE((SELECT reset_in_progress FROM demo_state WHERE org_id = OLD.org_id), 0) = 0
  AND NOT EXISTS (SELECT 1 FROM case_erasures e WHERE e.org_id = OLD.org_id AND e.case_id = OLD.case_id)
BEGIN SELECT RAISE(ABORT, 'append-only: fact_ids'); END;
DROP TRIGGER alert_identities_no_delete;
CREATE TRIGGER alert_identities_no_delete BEFORE DELETE ON alert_identities
WHEN COALESCE((SELECT reset_in_progress FROM demo_state WHERE org_id = OLD.org_id), 0) = 0
  AND NOT EXISTS (SELECT 1 FROM case_erasures e WHERE e.org_id = OLD.org_id AND e.case_id = OLD.case_id)
BEGIN SELECT RAISE(ABORT, 'append-only: alert_identities'); END;
DROP TRIGGER alert_events_v1_no_delete;
CREATE TRIGGER alert_events_v1_no_delete BEFORE DELETE ON alert_events_v1
WHEN COALESCE((SELECT reset_in_progress FROM demo_state WHERE org_id = OLD.org_id), 0) = 0
  AND NOT EXISTS (SELECT 1 FROM alerts a JOIN case_erasures e ON e.org_id = a.org_id AND e.case_id = a.case_id WHERE a.org_id = OLD.org_id AND a.id = OLD.alert_id)
BEGIN SELECT RAISE(ABORT, 'append-only: alert_events_v1'); END;
