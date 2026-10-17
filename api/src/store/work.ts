// Reads the write routes need: the current case, protocol, decisions, attendance and staff, and the workflow state
// the page applies after a write (GET /api/workflow and each write's `state`). D1 implementation; a pilot store
// implements the same functions over Postgres.
import { staffName } from "../domain/rows";
import type { Protocol, Step } from "../domain/protocol";
import { emptyProtocol } from "../domain/protocol";
import type { Status } from "../domain/status";
import type { AttRow, StaffDept } from "../domain/attendance";
import type { StaffUser } from "../domain/staff";

export type CaseCore = {
  id: string;
  source_file: string;
  status: Status;
  slot_day: string | null;
  slot_time: string | null;
  updated_on: string;
  question_draft: string | null;
  processing_level: string;
  patient_id: string;
};

export type Staff = {
  users: StaffUser[]; // every user, inactive ones too (names in history)
  depts: (StaffDept & { sort: number })[]; // active people only
  idByName: Map<string, string>;
  nameById: Map<string, string>;
  activeNames: Set<string>;
  coordinator: { id: string; name: string } | null;
  firstDeptOf: (userId: string) => string | null;
};

const IN_IDS = "SELECT value FROM json_each(?1)";

export async function sha256Hex(s: string): Promise<string> {
  const b = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("");
}

export class D1Work {
  constructor(private db: D1Database) {}

  caseCore(id: string) {
    return this.db
      .prepare(
        `SELECT c.id, c.source_file, c.status, c.updated_on, c.question_draft, c.processing_level, c.patient_id,
           s.day AS slot_day, s.time AS slot_time
         FROM cases c LEFT JOIN slots s ON s.case_id = c.id WHERE c.id = ?1`,
      )
      .bind(id)
      .first<CaseCore>();
  }

  async statusHist(id: string): Promise<{ from: Status; to: Status }[]> {
    const r = await this.db.prepare("SELECT from_status AS 'from', to_status AS 'to' FROM status_history WHERE case_id = ?1 ORDER BY at, id").bind(id).all<{ from: Status; to: Status }>();
    return r.results;
  }

  async protocol(id: string): Promise<Protocol> {
    const r = await this.db.prepare("SELECT * FROM protocols WHERE case_id = ?1").bind(id).first<Record<string, unknown>>();
    if (!r) return emptyProtocol();
    return {
      notes: r.notes as string,
      conclusion: r.conclusion as string,
      steps: JSON.parse(r.steps_json as string) as Step[],
      state: r.state as "draft" | "approved",
      version: r.version as number,
      updated_by_name: (r.updated_by_name as string | null) ?? null,
    };
  }

  async protocolExists(id: string) {
    return !!(await this.db.prepare("SELECT 1 AS x FROM protocols WHERE case_id = ?1").bind(id).first());
  }

  async decisions(id: string) {
    const r = await this.db.prepare("SELECT id, version, slot_day, slot_time FROM decisions WHERE case_id = ?1 ORDER BY version").bind(id).all<{ id: string; version: number; slot_day: string | null; slot_time: string | null }>();
    return r.results;
  }

  async attendance(key: string): Promise<{ rows: AttRow[]; version: number }> {
    const [rows, set] = await this.db.batch([
      this.db.prepare("SELECT dept_id, position, user_id, user_name FROM attendance WHERE set_key = ?1 ORDER BY dept_id, position").bind(key),
      this.db.prepare("SELECT version FROM attendance_sets WHERE set_key = ?1").bind(key),
    ]);
    return { rows: rows!.results as AttRow[], version: ((set!.results[0] as { version: number } | undefined)?.version) ?? 0 };
  }

  async staff(): Promise<Staff> {
    const [users, depts, members] = await this.db.batch([
      this.db.prepare("SELECT id, pre, sur, post, fn, role_id AS role, active FROM users ORDER BY id"),
      this.db.prepare("SELECT id, name, sort FROM departments ORDER BY sort, id"),
      this.db.prepare("SELECT dm.dept_id, dm.user_id FROM dept_members dm JOIN users u ON u.id = dm.user_id WHERE u.active = 1 ORDER BY dm.position, u.id"),
    ]);
    const us = users!.results as StaffUser[];
    const nameById = new Map(us.map((u) => [u.id, staffName(u)]));
    const active = us.filter((u) => u.active === 1);
    const ms = members!.results as { dept_id: string; user_id: string }[];
    const ds = (depts!.results as { id: string; name: string; sort: number }[]).map((d) => ({
      ...d,
      people: ms.filter((m) => m.dept_id === d.id).map((m) => ({ id: m.user_id, name: nameById.get(m.user_id)! })),
    }));
    const coord = active.find((u) => u.role === "coordinator");
    return {
      users: us,
      depts: ds,
      idByName: new Map(active.map((u) => [staffName(u), u.id])),
      nameById,
      activeNames: new Set(active.map((u) => staffName(u))),
      coordinator: coord ? { id: coord.id, name: staffName(coord) } : null,
      firstDeptOf: (uid) => ds.find((d) => d.people.some((p) => p.id === uid))?.id ?? null,
    };
  }

  async validGrant(caseId: string, userId: string, nowIso: string) {
    return this.db
      .prepare("SELECT reason, expires_at FROM case_access_grants WHERE case_id = ?1 AND user_id = ?2 AND expires_at > ?3 ORDER BY expires_at DESC LIMIT 1")
      .bind(caseId, userId, nowIso)
      .first<{ reason: string; expires_at: string }>();
  }

  async epoch(): Promise<{ data_epoch: number; reset_in_progress: number; reset_at: string | null; seed_version: string | null } | null> {
    return this.db.prepare("SELECT data_epoch, reset_in_progress, reset_at, seed_version FROM demo_state WHERE id = 1").first();
  }

  // ---------- the workflow state the page applies ----------

  async caseStates(ids: string[], clinical: boolean): Promise<Record<string, CaseState>> {
    if (!ids.length) return {};
    const j = JSON.stringify(ids);
    const q = (sql: string) => this.db.prepare(sql).bind(j);
    const [cases, hist, protos, decs, tasks, suggs, edits, elog, qc, aev] = await this.db.batch([
      q(`SELECT c.id, c.source_file, c.status, c.updated_on, c.question_draft, s.day AS slot_day, s.time AS slot_time
         FROM cases c LEFT JOIN slots s ON s.case_id = c.id WHERE c.id IN (${IN_IDS})`),
      q(`SELECT case_id, from_status, to_status, by_name, at, how FROM status_history WHERE case_id IN (${IN_IDS}) ORDER BY at, id`),
      q(`SELECT * FROM protocols WHERE case_id IN (${IN_IDS})`),
      q(`SELECT * FROM decisions WHERE case_id IN (${IN_IDS}) ORDER BY version`),
      q(`SELECT t.*, c.source_file FROM tasks t JOIN cases c ON c.id = t.case_id WHERE t.case_id IN (${IN_IDS}) ORDER BY t.id`),
      q(`SELECT g.*, c.source_file FROM task_suggestions g JOIN cases c ON c.id = g.case_id WHERE g.case_id IN (${IN_IDS}) ORDER BY g.id`),
      q(`SELECT * FROM fact_edits WHERE case_id IN (${IN_IDS})`),
      q(`SELECT * FROM edit_log WHERE case_id IN (${IN_IDS}) ORDER BY at, id`),
      q(`SELECT * FROM question_confirmations WHERE case_id IN (${IN_IDS}) ORDER BY at, id`),
      q(`SELECT e.action, e.by_name, e.at, a.case_id, a.origin, a.position FROM alert_events e
         JOIN alerts a ON a.id = e.alert_id JOIN extraction_runs r ON r.id = a.run_id AND r.is_current = 1
         WHERE a.case_id IN (${IN_IDS}) ORDER BY e.at, e.id`),
    ]);
    type R = Record<string, unknown>;
    const rows = (x: D1Result | undefined) => (x?.results ?? []) as R[];
    const out: Record<string, CaseState> = {};
    for (const c of rows(cases)) {
      const id = c.id as string;
      const file = c.source_file as string;
      const p = rows(protos).find((x) => x.case_id === id);
      const qcs = rows(qc).filter((x) => x.case_id === id);
      const lastQ = qcs.at(-1);
      out[id] = {
        case_id: id,
        file,
        status: c.status as Status,
        slot: c.slot_day ? { day: c.slot_day as string, time: c.slot_time as string } : null,
        updated: c.updated_on as string,
        statusHist: rows(hist)
          .filter((h) => h.case_id === id)
          .map((h) => ({ from: h.from_status as string, to: h.to_status as string, by: h.by_name as string, when: h.at as string, how: h.how as string })),
        protocol: p
          ? {
              notes: p.notes as string,
              concl: p.conclusion as string,
              steps: JSON.parse(p.steps_json as string),
              state: p.state as string,
              version: p.version as number,
              updated_by: (p.updated_by_name as string) ?? null,
              updated_at: p.updated_at as string,
              approver: (p.approved_by_name as string) ?? null,
              approved_at: (p.approved_at as string) ?? null,
            }
          : { notes: "", concl: "", steps: [], state: "draft", version: 0, updated_by: null, updated_at: null, approver: null, approved_at: null },
        decisions: rows(decs)
          .filter((d) => d.case_id === id)
          .map((d) => {
            const rep = JSON.parse(d.report_snapshot_json as string) as { html?: string; picked_sections?: string[] };
            return {
              id: d.id as string,
              version: d.version as number,
              text: d.conclusion as string,
              by: d.approved_by_name as string,
              when: d.approved_at as string,
              slot: d.slot_day ? { day: d.slot_day as string, time: d.slot_time as string } : null,
              attSnap: JSON.parse(d.attendance_snapshot_json as string),
              pickSnap: rep.picked_sections ?? [],
              reportSnap: rep.html ?? null,
              supersedes: (d.supersedes_id as string) ?? null,
            };
          }),
        tasks: rows(tasks).filter((t) => t.case_id === id).map(taskOut),
        sugg: rows(suggs)
          .filter((g) => g.case_id === id)
          .map((g) => ({
            id: g.id as number,
            pid: file,
            case_id: id,
            decision: (g.decision_version as number) ?? null,
            text: g.text as string,
            quote: (g.quote as string) ?? null,
            who: (g.who as string) ?? "",
            due: (g.due as string) ?? "",
            dueSrc: (g.due_source as string) ?? "none",
            dueBy: (g.due_by as string) ?? null,
            timing: (g.timing as string) ?? "",
            state: g.state as string,
            by: (g.decided_by_name as string) ?? null,
            when: (g.decided_at as string) ?? null,
          })),
        edits: clinical
          ? Object.fromEntries(
              rows(edits)
                .filter((e) => e.case_id === id)
                .map((e) => [e.key as string, { id: (e.log_id as number) ?? null, text: e.text as string, orig: (e.orig as string) ?? null, by: e.by_name as string, when: e.at as string }]),
            )
          : {},
        editLog: clinical
          ? rows(elog)
              .filter((e) => e.case_id === id)
              .map((e) => ({ key: e.key as string, orig: (e.orig as string) ?? null, text: e.text as string, by: e.by_name as string, when: e.at as string, reverted: e.reverted === 1, confirmed: e.confirmed === 1 }))
          : [],
        qConfirm: lastQ ? { text: lastQ.text as string, by: lastQ.by_name as string, when: lastQ.at as string } : null,
        draft_sha: c.question_draft ? await sha256Hex(c.question_draft as string) : null,
        alertHist: clinical
          ? rows(aev)
              .filter((e) => e.case_id === id)
              .map((e) => ({ i: e.origin === "flag" ? (e.position as number) : `gap:${e.position}`, action: e.action as string, who: e.by_name as string, when: e.at as string }))
          : [],
        clinical,
      };
    }
    return out;
  }

  async attSets(keys?: string[]): Promise<Record<string, AttSet>> {
    const staff = await this.staff();
    const where = keys ? `WHERE set_key IN (SELECT value FROM json_each(?1))` : "WHERE ?1 = ?1";
    const arg = keys ? JSON.stringify(keys) : "";
    const [rows, sets] = await this.db.batch([
      this.db.prepare(`SELECT * FROM attendance ${where} ORDER BY set_key, dept_id, position`).bind(arg),
      this.db.prepare(`SELECT * FROM attendance_sets ${where}`).bind(arg),
    ]);
    const out: Record<string, AttSet> = {};
    const ensure = (k: string) => (out[k] ??= { key: k, version: 0, byName: {}, byId: {} });
    for (const s of sets!.results as { set_key: string; version: number }[]) ensure(s.set_key).version = s.version;
    for (const k of keys ?? []) ensure(k);
    for (const r of rows!.results as { set_key: string; dept_id: string; user_id: string; user_name: string }[]) {
      const a = ensure(r.set_key);
      const dname = staff.depts.find((d) => d.id === r.dept_id)?.name ?? r.dept_id;
      (a.byName[dname] ??= []).push(r.user_name);
      (a.byId[r.dept_id] ??= []).push(r.user_id);
    }
    return out;
  }

  async sessions(): Promise<Session[]> {
    const r = await this.db.prepare("SELECT day, started_by_name, started_at, ended_at FROM sessions ORDER BY started_at").all<{ day: string; started_by_name: string | null; started_at: string; ended_at: string | null }>();
    return r.results.map((s) => ({ day: s.day, started_by: s.started_by_name, started_at: s.started_at, ended_at: s.ended_at }));
  }

  async mails(caseIds: string[] | null): Promise<Mail[]> {
    const r = await this.db
      .prepare(
        `SELECT n.*, c.source_file, u.pre, u.sur, u.post FROM notifications n LEFT JOIN cases c ON c.id = n.case_id
         LEFT JOIN users u ON u.id = n.to_user_id ORDER BY n.created_at DESC, n.id`,
      )
      .all<Record<string, unknown>>();
    return r.results
      .filter((n) => n.kind === "digest" || !caseIds || caseIds.includes(n.case_id as string))
      .map((n) =>
        n.kind === "approval"
          ? { kind: "approval", case_id: n.case_id as string, pid: n.source_file as string, n: n.count as number, by: n.created_by_name as string, when: n.created_at as string }
          : { kind: "digest", to: n.sur ? staffName({ pre: n.pre as string, sur: n.sur as string, post: n.post as string }) : null, n: n.count as number, by: n.created_by_name as string, when: n.created_at as string },
      );
  }
}

export function taskOut(t: Record<string, unknown>) {
  return {
    id: t.id as number,
    pid: t.source_file as string,
    case_id: t.case_id as string,
    text: t.text as string,
    who: t.assignee_name as string,
    due: (t.due as string) ?? null,
    done: t.done === 1,
    dueSrc: (t.due_source as string) ?? null,
    dueBy: (t.due_by as string) ?? null,
    timing: (t.timing as string) ?? null,
    fromSugg: (t.from_suggestion_id as number) ?? null,
    confirmedBy: (t.confirmed_by as string) ?? null,
  };
}

export type CaseState = {
  case_id: string;
  file: string;
  status: Status;
  slot: { day: string; time: string } | null;
  updated: string;
  statusHist: { from: string; to: string; by: string; when: string; how: string }[];
  protocol: Record<string, unknown>;
  decisions: Record<string, unknown>[];
  tasks: ReturnType<typeof taskOut>[];
  sugg: Record<string, unknown>[];
  edits: Record<string, unknown>;
  editLog: Record<string, unknown>[];
  qConfirm: { text: string; by: string; when: string } | null;
  draft_sha: string | null;
  alertHist: Record<string, unknown>[];
  clinical: boolean;
};
export type AttSet = { key: string; version: number; byName: Record<string, string[]>; byId: Record<string, string[]> };
export type Session = { day: string; started_by: string | null; started_at: string; ended_at: string | null };
export type Mail = Record<string, unknown>;
