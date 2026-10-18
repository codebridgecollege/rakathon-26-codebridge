-- Step 6: the birth date of a fixture's patient, as the documents write it ("14.6.1958"), so a completed intake shows
-- the patient's age. Identity, kept in D1 next to fixture_patients' name and birth
-- number; written by api/seed/seed.py only. NULL when the documents do not state it (never invented).
ALTER TABLE fixture_patients ADD COLUMN birth_as_written TEXT;
