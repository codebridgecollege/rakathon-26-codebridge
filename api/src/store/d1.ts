// D1 implementation of the directory, case and audit stores, each bound to one org: every query filters or writes
// org_id (?org, store/sql.ts), so a record of another org reads as missing. Every query binds its values; nothing is
// concatenated.
import type { Viewer } from "@codebridge/domain/access";
import type { CaseJoinRow, StatusHistItem } from "../domain/rows";
import { assertOrg, orgStmt } from "./sql";
import { currentRunRow } from "./runs";
import type {
  AuditEntry,
  AuditFilter,
  AuditRow,
  AuditStore,
  CaseFilter,
  CaseStore,
  DecisionRow,
  DirectoryStore,
  DocumentRow,
  PageRow,
  StaffDirectory,
  TaskRow,
  UserRow,
} from "./types";

// Membership of a case's team: the user directly, or any department the user belongs to, in this org. ?1 is the user.
export const MEMBER = `EXISTS (SELECT 1 FROM case_members m WHERE m.org_id = ?org AND m.case_id = c.id AND (m.user_id = ?1
  OR m.dept_id IN (SELECT dm.dept_id FROM dept_members dm WHERE dm.org_id = ?org AND dm.user_id = ?1)))`;

const CASE_SELECT = `SELECT c.*, p.full_name, p.name_as_written, p.birth_number, p.birth_as_written, p.age_as_written,
  p.identity_warning, p.name_note_cs, p.name_note_source_json, p.identity_source_json, p.data_origin, s.day AS slot_day, s.time AS slot_time
  FROM cases c JOIN patients p ON p.id = c.patient_id AND p.org_id = c.org_id LEFT JOIN slots s ON s.case_id = c.id AND s.org_id = c.org_id`;

// A person as this org knows them: the name from users; role, function and activity from the membership here.
export const ORG_USER = `SELECT u.id, u.pre, u.sur, u.post, m.fn, m.role_id, m.id AS membership_id,
  CASE WHEN u.active = 1 AND m.active_until IS NULL THEN 1 ELSE 0 END AS active
  FROM memberships m JOIN users u ON u.id = m.user_id /* org-scope: the caller's WHERE names m.org_id */`;

abstract class OrgBound {
  constructor(
    protected db: D1Database,
    readonly org: string,
  ) {
    assertOrg(org);
  }

  protected q(sql: string, ...args: unknown[]) {
    return orgStmt(this.db, this.org, sql, ...args);
  }
}

export class D1Directory extends OrgBound implements DirectoryStore {
  // A person of this org; null for a person without a membership here, as if they did not exist.
  userById(id: string) {
    return this.q(`${ORG_USER} WHERE m.org_id = ?org AND u.id = ?1`, id).first<UserRow>();
  }

  firstDeptOf(userId: string) {
    return this.q(
      `SELECT d.id, d.name FROM dept_members dm JOIN departments d ON d.id = dm.dept_id AND d.org_id = dm.org_id
       WHERE dm.org_id = ?org AND dm.user_id = ?1 ORDER BY d.sort LIMIT 1`,
      userId,
    ).first<{ id: string; name: string }>();
  }

  async staff(): Promise<StaffDirectory> {
    const [depts, people, users] = await this.db.batch([
      this.q("SELECT id, name FROM departments WHERE org_id = ?org ORDER BY sort, id"),
      this.q(
        `SELECT dm.dept_id, u.id, u.pre, u.sur, u.post, m.fn FROM dept_members dm
         JOIN memberships m ON m.org_id = dm.org_id AND m.user_id = dm.user_id JOIN users u ON u.id = dm.user_id
         WHERE dm.org_id = ?org AND u.active = 1 AND m.active_until IS NULL ORDER BY dm.position, u.id`,
      ),
      this.q(`${ORG_USER} WHERE m.org_id = ?org AND u.active = 1 AND m.active_until IS NULL ORDER BY u.id`),
    ]);
    const person = (u: Record<string, unknown>) => ({
      id: u.id as string,
      pre: u.pre as string,
      sur: u.sur as string,
      post: u.post as string,
      fn: u.fn as string,
    });
    const us = users!.results as (UserRow & Record<string, unknown>)[];
    return {
      depts: (depts!.results as { id: string; name: string }[]).map((d) => ({
        id: d.id,
        name: d.name,
        people: (people!.results as Record<string, unknown>[]).filter((p) => p.dept_id === d.id).map(person),
      })),
      coord: ((u) => (u ? person(u) : null))(us.find((u) => u.role_id === "coordinator")),
      admin: ((u) => (u ? person(u) : null))(us.find((u) => u.role_id === "admin")),
      roles: Object.fromEntries(us.map((u) => [u.id, u.role_id])),
    };
  }
}

export class D1Cases extends OrgBound implements CaseStore {
  // Global: the seed's bookkeeping (seed_meta) is not org data.
  async seededAt() {
    const r = await this.db.prepare("SELECT seeded_at FROM seed_meta WHERE id = 1").first<{ seeded_at: string }>();
    return r?.seeded_at ?? null;
  }

  async listCases(v: Viewer, onlyMember: boolean, f: CaseFilter) {
    // D1 refuses bound values a statement does not use, so each value is bound only when its condition is added.
    // An open intake (step 6) is listed only once it completes.
    const where: string[] = ["c.org_id = ?org", "c.intake_open = 0"];
    const args: unknown[] = [];
    const bind = (x: unknown) => (args.push(x), `?${args.length}`);
    if (onlyMember) where.push(MEMBER.replaceAll("?1", bind(v.id)));
    if (f.q) {
      // instr() instead of LIKE: D1 caps LIKE patterns at 50 bytes, and a search text must not fail on length.
      const q = bind(f.q.toLowerCase());
      where.push(`(instr(lower(p.full_name), ${q}) > 0 OR instr(lower(ifnull(p.birth_number, '')), ${q}) > 0 OR instr(lower(c.id), ${q}) > 0)`);
    }
    if (f.status) where.push(`c.status = ${bind(f.status)}`);
    if (f.dept) where.push(`c.referring_dept = ${bind(f.dept)}`);
    if (f.from) where.push(`c.submitted_on >= ${bind(f.from)}`);
    if (f.to) where.push(`c.submitted_on <= ${bind(f.to)}`);
    const w = ` WHERE ${where.join(" AND ")}`;
    const total = await this.q(`SELECT COUNT(*) AS n FROM cases c JOIN patients p ON p.id = c.patient_id AND p.org_id = c.org_id${w}`, ...args).first<{ n: number }>();
    const limit = bind(f.pageSize);
    const offset = bind(f.page * f.pageSize);
    const rows = await this.q(`${CASE_SELECT}${w} ORDER BY c.list_order LIMIT ${limit} OFFSET ${offset}`, ...args).all<CaseJoinRow>();
    return { rows: rows.results, total: total?.n ?? 0 };
  }

  caseById(id: string) {
    return this.q(`${CASE_SELECT} WHERE c.org_id = ?org AND c.id = ?1`, id).first<CaseJoinRow>();
  }

  async isMember(caseId: string, v: Viewer) {
    const r = await this.q(`SELECT 1 AS ok FROM cases c WHERE c.org_id = ?org AND c.id = ?2 AND ${MEMBER}`, v.id, caseId).first<{ ok: number }>();
    return !!r;
  }

  async memberDepts(caseId: string) {
    const r = await this.q(
      `SELECT d.name FROM case_members m JOIN departments d ON d.id = m.dept_id AND d.org_id = m.org_id
       WHERE m.org_id = ?org AND m.case_id = ?1 ORDER BY d.sort`,
      caseId,
    ).all<{ name: string }>();
    return r.results.map((x) => x.name);
  }

  async statusHistory(caseId: string): Promise<StatusHistItem[]> {
    const r = await this.q("SELECT from_status, to_status, by_name, at, how FROM status_history WHERE org_id = ?org AND case_id = ?1 ORDER BY at, id", caseId).all<{
      from_status: string;
      to_status: string;
      by_name: string;
      at: string;
      how: string;
    }>();
    return r.results.map((h) => ({ from: h.from_status, to: h.to_status, by: h.by_name, when: h.at, how: h.how }));
  }

  currentRun(caseId: string) {
    return currentRunRow(this.db, this.org, caseId);
  }

  private async withParts(docs: Omit<DocumentRow, "parts">[]): Promise<DocumentRow[]> {
    if (!docs.length) return [];
    // One bound value per document; D1 allows 100 per statement, far above a case's document count today.
    const ids = docs.map((d) => d.id);
    const parts = await this.q(
      `SELECT * FROM document_parts WHERE org_id = ?org AND document_id IN (${ids.map((_, i) => `?${i + 1}`).join(",")}) ORDER BY document_id, ordinal`,
      ...ids,
    ).all<Record<string, unknown>>();
    return docs.map((d) => ({
      ...d,
      parts: parts.results
        .filter((p) => p.document_id === d.id)
        .map((p) => ({
          title_cs: p.title_cs as string,
          type: p.type as string | null,
          date: p.date as string | null,
          date_note_cs: p.date_note_cs as string | null,
          pages: JSON.parse(p.pages_json as string) as number[],
          readability: p.readability as string | null,
          reason_cs: p.reason_cs as string | null,
        })),
    }));
  }

  async documents(caseId: string) {
    const r = await this.q("SELECT id, case_id, file_name, page_count, processing, note_cs FROM documents WHERE org_id = ?org AND case_id = ?1 ORDER BY created_at, id", caseId).all<
      Omit<DocumentRow, "parts">
    >();
    return this.withParts(r.results);
  }

  async documentById(id: string) {
    const d = await this.q("SELECT id, case_id, file_name, page_count, processing, note_cs FROM documents WHERE org_id = ?org AND id = ?1", id).first<Omit<DocumentRow, "parts">>();
    return d ? (await this.withParts([d]))[0]! : null;
  }

  async pages(docId: string) {
    const r = await this.q("SELECT document_id, n, json_r2_key, image_r2_key, redacted_r2_key, is_empty FROM pages WHERE org_id = ?org AND document_id = ?1 ORDER BY n", docId).all<PageRow>();
    return r.results;
  }

  async tasks(v: Viewer, onlyMember: boolean, mine: boolean) {
    // ?1 is always used, so the viewer's id can always be bound (D1 refuses an unused bound value).
    const where = ["t.org_id = ?org", "?1 = ?1", onlyMember ? MEMBER : null, mine ? "t.assignee_user_id = ?1" : null].filter(Boolean);
    const r = await this.q(
      `SELECT t.*, c.source_file FROM tasks t JOIN cases c ON c.id = t.case_id AND c.org_id = t.org_id
       WHERE ${where.join(" AND ")} ORDER BY t.id`,
      v.id,
    ).all<TaskRow & { due_by: string | null; due_source: string | null }>();
    return r.results;
  }

  async decisions(caseId: string) {
    const r = await this.q("SELECT * FROM decisions WHERE org_id = ?org AND case_id = ?1 ORDER BY version", caseId).all<DecisionRow>();
    return r.results;
  }

  async editHistory(caseId: string) {
    const r = await this.q("SELECT key, orig, text, reverted, by_name AS by, at AS 'when' FROM edit_log WHERE org_id = ?org AND case_id = ?1 ORDER BY at, id", caseId).all();
    return r.results;
  }

  async questionConfirmations(caseId: string) {
    const r = await this.q("SELECT text, by_name AS by, at AS 'when' FROM question_confirmations WHERE org_id = ?org AND case_id = ?1 ORDER BY at, id", caseId).all();
    return r.results;
  }

  async slots(v: Viewer, onlyMember: boolean, from: string, to: string) {
    const r = await this.q(
      `SELECT s.day, s.time, s.case_id, c.source_file AS file FROM slots s JOIN cases c ON c.id = s.case_id AND c.org_id = s.org_id
       WHERE s.org_id = ?org AND s.day >= ?2 AND s.day <= ?3 ${onlyMember ? `AND ${MEMBER}` : "AND ?1 = ?1"} ORDER BY s.day, s.time`,
      v.id,
      from,
      to,
    ).all<{ day: string; time: string; case_id: string; file: string }>();
    return r.results;
  }
}

export class D1Audit extends OrgBound implements AuditStore {
  async append(e: AuditEntry) {
    // A row names the org it was written in; a viewer of another org reaching this store would be a bug.
    if (e.viewer.org !== this.org) throw new Error("audit_org_mismatch");
    await this.q(
      `INSERT INTO access_log (org_id, actor_user_id, actor_name, acted_as_role, acted_as_membership, impersonating, auth_mode, case_id, document_id,
         page_n, action, what_cs, request_id, break_glass_reason, target_type, target_id, data_epoch)
       VALUES (?org, ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, (SELECT data_epoch FROM demo_state WHERE org_id = ?org))`,
      // The real person, also after a role switch; the membership acted as is the next columns.
      e.viewer.actor?.id ?? e.viewer.id,
      e.viewer.actor?.name ?? e.viewer.name,
      e.viewer.role,
      e.viewer.membershipId,
      e.viewer.impersonating ? 1 : 0,
      e.viewer.authMode,
      e.case_id ?? null,
      e.document_id ?? null,
      e.page_n ?? null,
      e.action,
      e.what_cs,
      e.request_id ?? null,
      e.break_glass_reason ?? null,
      e.target_type ?? null,
      e.target_id ?? null,
    ).run();
  }

  async list(f: AuditFilter) {
    const where: string[] = ["l.org_id = ?org"];
    const args: unknown[] = [];
    const bind = (x: unknown) => (args.push(x), `?${args.length}`);
    if (f.caseId) where.push(`l.case_id = ${bind(f.caseId)}`);
    if (f.actor) where.push(`l.actor_user_id = ${bind(f.actor)}`);
    if (f.from) where.push(`l.at >= ${bind(f.from)}`);
    if (f.to) where.push(`l.at <= ${bind(f.to)}`);
    const lim = bind(f.limit);
    const r = await this.q(
      // After a role switch the row names the real person and the membership acted as; the name of the latter is shown.
      `SELECT l.at, l.actor_name, l.acted_as_role, l.impersonating, l.case_id, c.source_file, l.what_cs,
         au.pre AS as_pre, au.sur AS as_sur, au.post AS as_post
       FROM access_log l LEFT JOIN cases c ON c.id = l.case_id AND c.org_id = l.org_id
       LEFT JOIN memberships am ON am.id = l.acted_as_membership AND am.org_id = l.org_id AND l.impersonating = 1
       LEFT JOIN users au ON au.id = am.user_id
       WHERE ${where.join(" AND ")} ORDER BY l.id DESC LIMIT ${lim}`,
      ...args,
    ).all<AuditRow>();
    return r.results;
  }
}
