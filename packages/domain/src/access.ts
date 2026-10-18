// Who may read what. Pure functions with no Cloudflare imports, so the rules are unit-tested on their own and a
// pilot backend can reuse them. Design: docs/research/backend-steps/step-2.md, "Access rules".

export type Role = "doctor" | "coordinator" | "admin";

// The person a request acts for, resolved from the directory (users table).
export type Viewer = {
  id: string;
  name: string;
  role: Role;
  dept: { id: string; name: string } | null;
  authMode: "demo" | "access";
  impersonating: boolean;
};

// CLINICAL_ACCESS in wrangler.jsonc. "all_roles" keeps the demo's behaviour, where the coordinator and the
// administrator open every case like a doctor. "doctors_only" applies INTEGRATION.md: the coordinator sees the case
// header, documents list, decisions and tasks; the administrator sees identity and status only. Which one the
// prototype should use is an open question (docs/agent/OPEN_QUESTIONS.md), so the permissive mode is the default.
export type ClinicalAccess = "all_roles" | "doctors_only";

export function clinicalAccessOf(value: string | undefined): ClinicalAccess {
  // An unknown value falls back to the stricter rule, so a typo never opens more than intended.
  return value === "all_roles" ? "all_roles" : "doctors_only";
}

export type Decision = "ok" | "not_member" | "role_forbidden";

// Doctors see the cases whose team they are on; the coordinator schedules every case and the administrator
// manages the list, so both see every row (the administrator's clinical fields are hidden in doctors_only mode).
export function listsAllCases(v: Viewer): boolean {
  return v.role !== "doctor";
}

// The case header, its documents list, decisions and history: no extracted findings.
export function canReadCaseHeader(v: Viewer, isMember: boolean, mode: ClinicalAccess): Decision {
  if (v.role === "doctor") return isMember ? "ok" : "not_member";
  if (v.role === "coordinator") return "ok";
  return mode === "all_roles" ? "ok" : "role_forbidden";
}

// Extraction, alerts, source pages, guidance and prognosis: the clinical content.
export function canReadClinical(v: Viewer, isMember: boolean, mode: ClinicalAccess): Decision {
  if (v.role === "doctor") return isMember ? "ok" : "not_member";
  return mode === "all_roles" ? "ok" : "role_forbidden";
}

// In the list, the administrator gets identity and status without the clinical fields in the strict mode.
export function redactsListFor(v: Viewer, mode: ClinicalAccess): boolean {
  return v.role === "admin" && mode === "doctors_only";
}

export function canReadAuditLog(v: Viewer): boolean {
  return v.role === "admin";
}

// Tasks name a case and an action on it; the administrator has no clinical role, so none in the strict mode.
export function seesTasks(v: Viewer, mode: ClinicalAccess): boolean {
  return v.role !== "admin" || mode === "all_roles";
}
