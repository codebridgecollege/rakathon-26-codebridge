-- MDT teams inside a hospital (AUTH.md, "Teams"): a lung MDT and a breast MDT are one org with two teams, so one person
-- can sit in several and staff stay in one list. A doctor reads a team's case only as a member of that team, as someone
-- named on the case, or through break-the-glass; the departments no longer open it. Additive, so the Worker already
-- deployed keeps working during the deploy (api/AGENTS.md). A case without a team follows the old department rule.
CREATE TABLE teams (
  id          TEXT PRIMARY KEY,
  org_id      TEXT NOT NULL REFERENCES orgs(id),
  name        TEXT NOT NULL,
  weekday     INTEGER CHECK (weekday IS NULL OR weekday BETWEEN 1 AND 7),
  time        TEXT CHECK (time IS NULL OR time GLOB '[0-2][0-9]:[0-5][0-9]'),
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) CHECK (created_at GLOB '[0-9][0-9][0-9][0-9]-*Z'),
  UNIQUE (id, org_id)
);
CREATE UNIQUE INDEX teams_name ON teams(org_id, lower(name));
CREATE TABLE team_members (
  org_id   TEXT NOT NULL REFERENCES orgs(id),
  team_id  TEXT NOT NULL,
  user_id  TEXT NOT NULL,
  PRIMARY KEY (team_id, user_id),
  FOREIGN KEY (team_id, org_id) REFERENCES teams(id, org_id),
  FOREIGN KEY (org_id, user_id) REFERENCES memberships(org_id, user_id)
);
CREATE INDEX team_members_user ON team_members(org_id, user_id);
ALTER TABLE cases ADD COLUMN team_id TEXT REFERENCES teams(id);
-- An MDT a team already named in Administrace becomes its first team; demo org A's demo keeps working without teams.
INSERT INTO teams (id, org_id, name, weekday, time)
  SELECT 't-' || id, id, mdt_name, mdt_weekday, mdt_time FROM orgs WHERE mdt_name IS NOT NULL AND id <> 'demo-a';
