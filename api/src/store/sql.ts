// The one way org-scoped SQL is bound (docs/design/DATABASE.md, "Organizations: shared tables"). A statement names
// the org as ?org wherever it filters or writes org_id; orgStmt binds the org there as the next numbered parameter,
// so no statement concatenates the org and no call site counts parameters by hand.

// Org IDs come from our own orgs table, never from a request; the check makes a bad value an error, not a query.
const ORG_ID = /^[a-z0-9-]{1,32}$/;

export function assertOrg(org: string): string {
  if (typeof org !== "string" || !ORG_ID.test(org)) throw new Error("invalid_org");
  return org;
}

// "?org" becomes "?<n+1>" after the highest numbered parameter, and the org is bound there. A statement with plain
// "?" parameters cannot mix with ?org (SQLite numbers a plain "?" after the highest so far), so that is refused.
export function withOrg(sql: string, args: unknown[], org: string): { sql: string; args: unknown[] } {
  if (!sql.includes("?org")) return { sql, args };
  assertOrg(org);
  if (/\?(?![0-9]|org)/.test(sql)) throw new Error("withOrg: plain ? parameters cannot be combined with ?org");
  const max = Math.max(0, ...[...sql.matchAll(/\?(\d+)/g)].map((m) => Number(m[1])));
  // D1 binds by position, so the arguments must fill ?1..?max exactly before the org is appended.
  if (args.length !== max) throw new Error(`withOrg: ${args.length} arguments for ${max} parameters`);
  return { sql: sql.replaceAll("?org", `?${max + 1}`), args: [...args, org] };
}

export function orgStmt(db: D1Database, org: string, sql: string, ...args: unknown[]): D1PreparedStatement {
  const s = withOrg(sql, args, org);
  return db.prepare(s.sql).bind(...s.args);
}

// Plain-"?" conditions (the guards of store/write.ts) numbered from `from`, with ?org bound at orgAt. Returns the SQL.
export function numberPlain(cond: string, from: number, orgAt: number): string {
  let n = from;
  return cond.replace(/\?org|\?(?![0-9])/g, (m) => (m === "?org" ? `?${orgAt}` : `?${n++}`));
}

// Tables that hold org data: every statement on them names org_id (checked as a reminder by test/org-sql.test.ts,
// which scans the source; joins and subqueries can escape that scan, so the isolation tests are the proof).
export const ORG_TABLES = [
  "memberships", "departments", "dept_members", "patients", "cases", "case_members", "case_access_grants", "status_history",
  "slots", "sessions", "attendance", "attendance_sets", "protocols", "decisions", "task_suggestions", "tasks",
  "question_confirmations", "fact_edits", "edit_log", "extraction_runs", "alerts", "alert_events", "alert_events_v1", "alert_identities",
  "fact_ids", "fact_confirmations", "documents",
  "document_parts", "pages", "pipeline_runs", "upload_sessions", "recordings", "jobs", "transcript_passes", "transcript_lines",
  "transcript_summaries", "audio_uploads", "audio_parts", "audio_segments", "notifications", "idempotency_keys", "write_guards",
  "demo_state", "access_log", "auth_sessions", "model_calls", "patient_nis_links",
] as const;

// R2 keys of org data (DATABASE.md, R2 prefixes). Keys stored in D1 before orgs (docs/, pages/, extract/, uploads/,
// audio/) keep their value and stay readable; only new objects are written here.
export const orgKey = (org: string, rest: string) => `org/${assertOrg(org)}/${rest}`;
