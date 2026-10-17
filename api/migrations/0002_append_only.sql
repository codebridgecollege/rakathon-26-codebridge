-- Append-only tables refuse UPDATE and DELETE. This stops the app, not someone with D1 console access;
-- the daily R2 export with a retention lock (later step) covers that.
CREATE TRIGGER decisions_no_update BEFORE UPDATE ON decisions BEGIN SELECT RAISE(ABORT, 'append-only: decisions'); END;
CREATE TRIGGER decisions_no_delete BEFORE DELETE ON decisions BEGIN SELECT RAISE(ABORT, 'append-only: decisions'); END;
CREATE TRIGGER status_history_no_update BEFORE UPDATE ON status_history BEGIN SELECT RAISE(ABORT, 'append-only: status_history'); END;
CREATE TRIGGER status_history_no_delete BEFORE DELETE ON status_history BEGIN SELECT RAISE(ABORT, 'append-only: status_history'); END;
CREATE TRIGGER edit_log_no_update BEFORE UPDATE ON edit_log BEGIN SELECT RAISE(ABORT, 'append-only: edit_log'); END;
CREATE TRIGGER edit_log_no_delete BEFORE DELETE ON edit_log BEGIN SELECT RAISE(ABORT, 'append-only: edit_log'); END;
CREATE TRIGGER alert_events_no_update BEFORE UPDATE ON alert_events BEGIN SELECT RAISE(ABORT, 'append-only: alert_events'); END;
CREATE TRIGGER alert_events_no_delete BEFORE DELETE ON alert_events BEGIN SELECT RAISE(ABORT, 'append-only: alert_events'); END;
CREATE TRIGGER question_confirmations_no_update BEFORE UPDATE ON question_confirmations BEGIN SELECT RAISE(ABORT, 'append-only: question_confirmations'); END;
CREATE TRIGGER question_confirmations_no_delete BEFORE DELETE ON question_confirmations BEGIN SELECT RAISE(ABORT, 'append-only: question_confirmations'); END;
CREATE TRIGGER access_log_no_update BEFORE UPDATE ON access_log BEGIN SELECT RAISE(ABORT, 'append-only: access_log'); END;
CREATE TRIGGER access_log_no_delete BEFORE DELETE ON access_log BEGIN SELECT RAISE(ABORT, 'append-only: access_log'); END;
-- A decision may only supersede an earlier decision of the same case, with the next version number.
CREATE TRIGGER decisions_supersede_same_case BEFORE INSERT ON decisions WHEN NEW.supersedes_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM decisions d WHERE d.id = NEW.supersedes_id AND d.case_id = NEW.case_id AND d.version = NEW.version - 1) BEGIN SELECT RAISE(ABORT, 'decision must supersede the previous version of the same case'); END;
