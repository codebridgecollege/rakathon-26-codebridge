-- The login (docs/design/AUTH.md, step 3). A session acts in one org with the person's own membership there; after a
-- role switch in a demo org it acts as another membership of the same org (acting_membership_id), while the access
-- log keeps the real person. Migration 0011 created auth_sessions with one membership column, which its foreign key
-- tied to the session's person, so a role switch could not be stored. No session existed before this migration (the
-- login did not), so the table is dropped and created again. Steps that finish later for a request also keep the
-- person logged in (created_by_actor, below).

-- The target of acting_membership_id's foreign key: a membership of the session's org, whoever it belongs to.
CREATE UNIQUE INDEX memberships_id_org ON memberships(id, org_id);

DROP TABLE auth_sessions;

-- One row per login, keyed by the SHA-256 of the session ID (the ID itself is only in the browser's cookie). An org or
-- role switch replaces the row with a new ID and keeps created_at and expires_at, so a switch never extends a login.
CREATE TABLE auth_sessions (
  id_hash               TEXT PRIMARY KEY CHECK (length(id_hash) = 64 AND id_hash NOT GLOB '*[^0-9a-f]*'),
  user_id               TEXT NOT NULL REFERENCES users(id),
  org_id                TEXT NOT NULL REFERENCES orgs(id),
  membership_id         TEXT NOT NULL,           -- the person's own membership in org_id
  acting_membership_id  TEXT,                    -- the membership acted as after a role switch (demo orgs); NULL: own
  id_token              TEXT,                    -- only for the IdP's logout hint; cleared when the session expires
  created_at            TEXT NOT NULL CHECK (created_at GLOB '[0-9][0-9][0-9][0-9]-*Z'),
  last_used_at          TEXT NOT NULL CHECK (last_used_at GLOB '[0-9][0-9][0-9][0-9]-*Z'),
  expires_at            TEXT NOT NULL CHECK (expires_at GLOB '[0-9][0-9][0-9][0-9]-*Z'),
  -- The person's own membership belongs to the session's org and person; the acted-as one to the session's org.
  FOREIGN KEY (membership_id, org_id, user_id) REFERENCES memberships(id, org_id, user_id),
  FOREIGN KEY (acting_membership_id, org_id) REFERENCES memberships(id, org_id)
);
CREATE INDEX auth_sessions_expiry ON auth_sessions(expires_at);
CREATE INDEX auth_sessions_user ON auth_sessions(user_id);

-- One identity per person and IdP, so two first logins of different accounts with the same e-mail cannot both link.
-- A person may still have identities at two IdPs (a move from one to another).
CREATE UNIQUE INDEX user_identities_person_issuer ON user_identities(user_id, issuer);

-- Work a request starts and an automatic step finishes later (a Workflow, the cron sweep, the phone of an upload
-- session) acts for created_by, which after a role switch is the person acted as. created_by_actor keeps the person
-- logged in, so those steps' access-log rows name them with impersonating = 1, as the request's own rows do.
-- NULL: no role switch. No foreign key, like the other person columns of these tables (DATABASE.md).
ALTER TABLE jobs ADD COLUMN created_by_actor TEXT;
ALTER TABLE pipeline_runs ADD COLUMN created_by_actor TEXT;
ALTER TABLE audio_uploads ADD COLUMN created_by_actor TEXT;
ALTER TABLE upload_sessions ADD COLUMN created_by_actor TEXT;
ALTER TABLE cases ADD COLUMN created_by_actor TEXT;
