// D1 implementation of the directory, case and audit stores. Every query binds its values; nothing is concatenated.
import type { Viewer } from "../domain/access";
import type { CaseJoinRow, StatusHistItem } from "../domain/rows";
import type {
  AlertRow,
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
  RunRow,
  StaffDirectory,
  TaskRow,
  UserRow,
} from "./types";

// Membership: the user directly, or any department the user belongs to. ?1 is the user id.
const MEMBER = `EXISTS (SELECT 1 FROM case_members m WHERE m.case_id = c.id AND (m.user_id = ?1
  OR m.dept_id IN (SELECT dm.dept_id FROM dept_members dm WHERE dm.user_id = ?1)))`;

const CASE_SELECT = `SELECT c.*, p.full_name, p.name_as_written, p.birth_number, p.birth_as_written, p.age_as_written,
  p.identity_warning, p.name_note_cs, p.name_note_source_json, p.data_origin, s.day AS slot_day, s.time AS slot_time
  FROM cases c JOIN patients p ON p.id = c.patient_id LEFT JOIN slots s ON s.case_id = c.id`;

export class D1Directory implements DirectoryStore {
  constructor(private db: D1Database) {}

  userById(id: string) {
    return this.db.prepare("SELECT * FROM users WHERE id = ?1").bind(id).first<UserRow>();
  }

  userByEmail(email: string) {
    return this.db.prepare("SELECT * FROM users WHERE email = ?1").bind(email).first<UserRow>();
  }

  firstDeptOf(userId: string) {
    return this.db
      .prepare(
        "SELECT d.id, d.name FROM dept_members dm JOIN departments d ON d.id = dm.dept_id WHERE dm.user_id = ?1 ORDER BY d.sort LIMIT 1",
      )
      .bind(userId)
      .first<{ id: string; name: string }>();
  }

  async staff(): Promise<StaffDirectory> {
    const [depts, people, users] = await this.db.batch([
      this.db.prepare("SELECT id, name FROM departments ORDER BY sort, id"),
      this.db.prepare(
        "SELECT dm.dept_id, u.id, u.pre, u.sur, u.post, u.fn FROM dept_members dm JOIN users u ON u.id = dm.user_id WHERE u.active = 1 ORDER BY dm.position, u.id",
      ),
      this.db.prepare("SELECT id, pre, sur, post, fn, role_id FROM users WHERE active = 1 ORDER BY id"),
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

export class D1Cases implements CaseStore {
  constructor(private db: D1Database) {}

  async seededAt() {
    const r = await this.db.prepare("SELECT seeded_at FROM seed_meta WHERE id = 1").first<{ seeded_at: string }>();
    return r?.seeded_at ?? null;
  }

  async listCases(v: Viewer, onlyMember: boolean, f: CaseFilter) {
    // D1 refuses bound values a statement does not use, so each value is bound only when its condition is added.
    const where: string[] = [];
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
    const w = where.length ? ` WHERE ${where.join(" AND ")}` : "";
    const total = await this.db
      .prepare(`SELECT COUNT(*) AS n FROM cases c JOIN patients p ON p.id = c.patient_id${w}`)
      .bind(...args)
      .first<{ n: number }>();
    const limit = bind(f.pageSize);
    const offset = bind(f.page * f.pageSize);
    const rows = await this.db
      .prepare(`${CASE_SELECT}${w} ORDER BY c.list_order LIMIT ${limit} OFFSET ${offset}`)
      .bind(...args)
      .all<CaseJoinRow>();
    return { rows: rows.results, total: total?.n ?? 0 };
  }

  caseById(id: string) {
    return this.db.prepare(`${CASE_SELECT} WHERE c.id = ?1`).bind(id).first<CaseJoinRow>();
  }

  async isMember(caseId: string, v: Viewer) {
    const r = await this.db
      .prepare(`SELECT 1 AS ok FROM cases c WHERE c.id = ?2 AND ${MEMBER}`)
      .bind(v.id, caseId)
      .first<{ ok: number }>();
    return !!r;
  }

  async memberDepts(caseId: string) {
    const r = await this.db
      .prepare("SELECT d.name FROM case_members m JOIN departments d ON d.id = m.dept_id WHERE m.case_id = ?1 ORDER BY d.sort")
      .bind(caseId)
      .all<{ name: string }>();
    return r.results.map((x) => x.name);
  }

  async statusHistory(caseId: string): Promise<StatusHistItem[]> {
    const r = await this.db
      .prepare("SELECT from_status, to_status, by_name, at, how FROM status_history WHERE case_id = ?1 ORDER BY at, id")
      .bind(caseId)
      .all<{ from_status: string; to_status: string; by_name: string; at: string; how: string }>();
    return r.results.map((h) => ({ from: h.from_status, to: h.to_status, by: h.by_name, when: h.at, how: h.how }));
  }

  currentRun(caseId: string) {
    return this.db
      .prepare("SELECT id, kind, created_at, r2_key, case_id FROM extraction_runs WHERE case_id = ?1 AND is_current = 1")
      .bind(caseId)
      .first<RunRow>();
  }

  private async withParts(docs: Omit<DocumentRow, "parts">[]): Promise<DocumentRow[]> {
    if (!docs.length) return [];
    // One bound value per document; D1 allows 100 per statement, far above a case's document count today.
    const ids = docs.map((d) => d.id);
    const parts = await this.db
      .prepare(
        `SELECT * FROM document_parts WHERE document_id IN (${ids.map((_, i) => `?${i + 1}`).join(",")}) ORDER BY document_id, ordinal`,
      )
      .bind(...ids)
      .all<Record<string, unknown>>();
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
    const r = await this.db
      .prepare("SELECT id, case_id, file_name, page_count, processing, note_cs FROM documents WHERE case_id = ?1 ORDER BY created_at, id")
      .bind(caseId)
      .all<Omit<DocumentRow, "parts">>();
    return this.withParts(r.results);
  }

  async documentById(id: string) {
    const d = await this.db
      .prepare("SELECT id, case_id, file_name, page_count, processing, note_cs FROM documents WHERE id = ?1")
      .bind(id)
      .first<Omit<DocumentRow, "parts">>();
    return d ? (await this.withParts([d]))[0]! : null;
  }

  async pages(docId: string) {
    const r = await this.db
      .prepare("SELECT document_id, n, json_r2_key, image_r2_key, redacted_r2_key, is_empty FROM pages WHERE document_id = ?1 ORDER BY n")
      .bind(docId)
      .all<PageRow>();
    return r.results;
  }

  async alerts(caseId: string) {
    const r = await this.db
      .prepare(
        `SELECT a.id, a.origin, a.position, a.kind, a.text_cs, a.relevant, a.run_id FROM alerts a
         JOIN extraction_runs r ON r.id = a.run_id AND r.is_current = 1
         WHERE a.case_id = ?1 ORDER BY a.origin <> 'flag', a.position`,
      )
      .bind(caseId)
      .all<AlertRow>();
    return r.results;
  }

  async tasks(v: Viewer, onlyMember: boolean, mine: boolean) {
    const where = [onlyMember ? MEMBER : null, mine ? "t.assignee_user_id = ?1" : null].filter(Boolean);
    const r = await this.db
      .prepare(
        `SELECT t.*, c.source_file FROM tasks t JOIN cases c ON c.id = t.case_id
         ${where.length ? `WHERE ${where.join(" AND ")}` : "WHERE ?1 = ?1"} ORDER BY t.id`,
      )
      .bind(v.id)
      .all<TaskRow & { due_by: string | null; due_source: string | null }>();
    return r.results;
  }

  async decisions(caseId: string) {
    const r = await this.db.prepare("SELECT * FROM decisions WHERE case_id = ?1 ORDER BY version").bind(caseId).all<DecisionRow>();
    return r.results;
  }

  async editHistory(caseId: string) {
    const r = await this.db
      .prepare("SELECT key, orig, text, reverted, by_name AS by, at AS 'when' FROM edit_log WHERE case_id = ?1 ORDER BY at, id")
      .bind(caseId)
      .all();
    return r.results;
  }

  async questionConfirmations(caseId: string) {
    const r = await this.db
      .prepare("SELECT text, by_name AS by, at AS 'when' FROM question_confirmations WHERE case_id = ?1 ORDER BY at, id")
      .bind(caseId)
      .all();
    return r.results;
  }

  async slots(v: Viewer, onlyMember: boolean, from: string, to: string) {
    const r = await this.db
      .prepare(
        `SELECT s.day, s.time, s.case_id, c.source_file AS file FROM slots s JOIN cases c ON c.id = s.case_id
         WHERE s.day >= ?2 AND s.day <= ?3 ${onlyMember ? `AND ${MEMBER}` : "AND ?1 = ?1"} ORDER BY s.day, s.time`,
      )
      .bind(v.id, from, to)
      .all<{ day: string; time: string; case_id: string; file: string }>();
    return r.results;
  }
}

export class D1Audit implements AuditStore {
  constructor(private db: D1Database) {}

  async append(e: AuditEntry) {
    await this.db
      .prepare(
        `INSERT INTO access_log (actor_user_id, actor_name, acted_as_role, impersonating, auth_mode, case_id, document_id, page_n, action, what_cs, request_id,
           break_glass_reason, data_epoch)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, (SELECT data_epoch FROM demo_state WHERE id = 1))`,
      )
      .bind(
        e.viewer.id,
        e.viewer.name,
        e.viewer.role,
        e.viewer.impersonating ? 1 : 0,
        e.viewer.authMode,
        e.case_id ?? null,
        e.document_id ?? null,
        e.page_n ?? null,
        e.action,
        e.what_cs,
        e.request_id ?? null,
        e.break_glass_reason ?? null,
      )
      .run();
  }

  async list(f: AuditFilter) {
    const where: string[] = [];
    const args: unknown[] = [];
    const bind = (x: unknown) => (args.push(x), `?${args.length}`);
    if (f.caseId) where.push(`l.case_id = ${bind(f.caseId)}`);
    if (f.actor) where.push(`l.actor_user_id = ${bind(f.actor)}`);
    if (f.from) where.push(`l.at >= ${bind(f.from)}`);
    if (f.to) where.push(`l.at <= ${bind(f.to)}`);
    const r = await this.db
      .prepare(
        `SELECT l.at, l.actor_name, l.acted_as_role, l.impersonating, l.case_id, c.source_file, l.what_cs
         FROM access_log l LEFT JOIN cases c ON c.id = l.case_id
         ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY l.id DESC LIMIT ${bind(f.limit)}`,
      )
      .bind(...args)
      .all<AuditRow>();
    return r.results;
  }
}
