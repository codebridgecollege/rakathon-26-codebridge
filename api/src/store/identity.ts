// The identifiers that must not leave the Worker with a case's text or page images: the case patient's identity
// (D1 `patients`, the only place it lives) and the names of the org's staff. Read inside the Workflow step that
// makes the model call and kept in memory only; never a step result, never logged.
import type { CaseIdentity } from "../domain/pseudonymize";
import { orgStmt } from "./sql";

export class CaseNotFound extends Error {
  constructor() {
    super("case_missing");
  }
}

export async function loadCaseIdentity(db: D1Database, org: string, caseId: string): Promise<CaseIdentity> {
  const p = await orgStmt(
    db,
    org,
    `SELECT p.full_name, p.name_as_written, p.birth_number, p.birth_as_written
       FROM cases c JOIN patients p ON p.org_id = c.org_id AND p.id = c.patient_id
      WHERE c.org_id = ?org AND c.id = ?1`,
    caseId,
  ).first<{ full_name: string; name_as_written: string | null; birth_number: string | null; birth_as_written: string | null }>();
  if (!p) throw new CaseNotFound();
  // Everyone who has or had a membership in the org: a person who left still signs the documents written before.
  const staff = await orgStmt(
    db,
    org,
    "SELECT u.sur FROM memberships m JOIN users u ON u.id = m.user_id WHERE m.org_id = ?org ORDER BY m.id",
  ).all<{ sur: string }>();
  return {
    patientNames: [p.full_name, p.name_as_written].filter((x): x is string => !!x),
    birthNumber: p.birth_number,
    birthDate: p.birth_as_written,
    staffNames: staff.results.map((s) => s.sur),
  };
}
