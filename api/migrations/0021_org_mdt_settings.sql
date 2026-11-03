-- What a team sets up when it first opens its org (Administrace): the name of its MDT and when it usually meets. Empty
-- until the org's administrator fills them in; the page then asks for them. Stored for display, the calendar's slots do
-- not follow them yet. Additive, so the Worker already deployed keeps working during the deploy (api/AGENTS.md).
ALTER TABLE orgs ADD COLUMN mdt_name TEXT;
ALTER TABLE orgs ADD COLUMN mdt_weekday INTEGER CHECK (mdt_weekday IS NULL OR mdt_weekday BETWEEN 1 AND 7);
ALTER TABLE orgs ADD COLUMN mdt_time TEXT CHECK (mdt_time IS NULL OR mdt_time GLOB '[0-2][0-9]:[0-5][0-9]');
-- Demo org A's demo meets on Thursdays at 14:00 (api/seed/seed.py books its slots there).
UPDATE orgs SET mdt_name = 'Neuroonkologické MDT', mdt_weekday = 4, mdt_time = '14:00' WHERE id = 'demo-a';
