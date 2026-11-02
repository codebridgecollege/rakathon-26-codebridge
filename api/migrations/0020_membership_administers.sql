-- A membership that also administers its org (AUTH.md, "Organizations and roles"): a doctor such as the head of a
-- clinic keeps every doctor's right and also gets the administrator's (the staff list, the access log, the demo reset).
-- The role stays 'doctor', so the clinical rules (team membership, doctor-only confirmations) still apply to them. A
-- membership with role 'admin' administers by its role; this column is for the other roles.
ALTER TABLE memberships ADD COLUMN administers INTEGER NOT NULL DEFAULT 0 CHECK (administers IN (0,1));
