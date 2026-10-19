// Reads the write routes need: the current case, protocol, decisions, attendance and staff, and the workflow state
// the page applies after a write (GET /api/workflow and each write's `state`). D1 implementation; a pilot store
// implements the same functions over Postgres.
import { staffName } from "../domain/rows";
import type { Protocol, Step } from "@codebridge/domain/protocol";
import { emptyProtocol } from "@codebridge/domain/protocol";
import type { Status } from "@codebridge/domain/status";
import type { AttRow, StaffDept } from "../domain/attendance";
import type { StaffUser } from "../domain/staff";
import { assertOrg, orgStmt } from "./sql";
import type { AlertHistItem, EditEntry, FactConfirmation } from "@codebridge/domain/wire";

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
  intake_open: number;
  created_by: string | null;
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

// Bound to one org: a case, person or set of another org reads as missing.
export class D1Work {
  constructor(
    private db: D1Database,
    readonly org: string,
  ) {
    assertOrg(org);
  }

  private q(sql: string, ...args: unknown[]) {
    return orgStmt(this.db, this.org, sql, ...args);
  }

  caseCore(id: string) {
    return this.q(
      `SELECT c.id, c.source_file, c.status, c.updated_on, c.question_draft, c.processing_level, c.patient_id,
         c.intake_open, c.created_by, s.day AS slot_day, s.time AS slot_time
       FROM cases c LEFT JOIN slots s ON s.case_id = c.id AND s.org_id = c.org_id WHERE c.org_id = ?org AND c.id = ?1`,
      id,
    ).first<CaseCore>();
  }

  async statusHist(id: string): Promise<{ from: Status; to: Status }[]> {
    const r = await this.q("SELECT from_status AS 'from', to_status AS 'to' FROM status_history WHERE org_id = ?org AND case_id = ?1 ORDER BY at, id", id).all<{ from: Status; to: Status }>();
    return r.results;
  }

  async protocol(id: string): Promise<Protocol & { exists: boolean }> {
    const r = await this.q("SELECT * FROM protocols WHERE org_id = ?org AND case_id = ?1", id).first<Record<string, unknown>>();
    if (!r) return { ...emptyProtocol(), exists: false };
    return {
      exists: true,
      notes: r.notes as string,
      conclusion: r.conclusion as string,
      steps: JSON.parse(r.steps_json as string) as Step[],
      state: r.state as "draft" | "approved",
      version: r.version as number,
      updated_by_name: (r.updated_by_name as string | null) ?? null,
    };
  }


  async decisions(id: string) {
    const r = await this.q("SELECT id, version, slot_day, slot_time FROM decisions WHERE org_id = ?org AND case_id = ?1 ORDER BY version", id).all<{ id: string; version: number; slot_day: string | null; slot_time: string | null }>();
    return r.results;
  }

  async attendance(key: string): Promise<{ rows: AttRow[]; version: number }> {
    const [rows, set] = await this.db.batch([
      this.q("SELECT dept_id, position, user_id, user_name FROM attendance WHERE org_id = ?org AND set_key = ?1 ORDER BY dept_id, position", key),
      this.q("SELECT version FROM attendance_sets WHERE org_id = ?org AND set_key = ?1", key),
    ]);
    return { rows: rows!.results as AttRow[], version: ((set!.results[0] as { version: number } | undefined)?.version) ?? 0 };
  }

  async staff(): Promise<Staff> {
    const [users, depts, members] = await this.db.batch([
      // Everyone this org has had, also those who left (their names stay in history); active as of the membership.
      this.q(
        `SELECT u.id, u.pre, u.sur, u.post, m.fn, m.role_id AS role, CASE WHEN u.active = 1 AND m.active_until IS NULL THEN 1 ELSE 0 END AS active
         FROM memberships m JOIN users u ON u.id = m.user_id WHERE m.org_id = ?org ORDER BY u.id`,
      ),
      this.q("SELECT id, name, sort FROM departments WHERE org_id = ?org ORDER BY sort, id"),
      this.q(
        `SELECT dm.dept_id, dm.user_id FROM dept_members dm JOIN memberships m ON m.org_id = dm.org_id AND m.user_id = dm.user_id
         JOIN users u ON u.id = dm.user_id WHERE dm.org_id = ?org AND u.active = 1 AND m.active_until IS NULL ORDER BY dm.position, u.id`,
      ),
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
    return this.q("SELECT id, reason, expires_at FROM case_access_grants WHERE org_id = ?org AND case_id = ?1 AND user_id = ?2 AND expires_at > ?3 ORDER BY expires_at DESC LIMIT 1", caseId, userId, nowIso).first<{
      id: string;
      reason: string;
      expires_at: string;
    }>();
  }

  // This org's demo state: a reset of another org does not change it.
  async epoch(): Promise<{ data_epoch: number; reset_in_progress: number; reset_at: string | null; seed_version: string | null } | null> {
    return this.q("SELECT data_epoch, reset_in_progress, reset_at, seed_version FROM demo_state WHERE org_id = ?org").first();
  }

  // ---------- the workflow state the page applies ----------

  async caseStates(ids: string[], clinical: boolean): Promise<Record<string, CaseState>> {
    if (!ids.length) return {};
    const j = JSON.stringify(ids);
    const q = (sql: string) => this.q(sql, j);
    const [cases, hist, protos, decs, tasks, suggs, edits, elog, qc, aev, conf] = await this.db.batch([
      q(`SELECT c.id, c.source_file, c.status, c.updated_on, c.question_draft, s.day AS slot_day, s.time AS slot_time
         FROM cases c LEFT JOIN slots s ON s.case_id = c.id AND s.org_id = c.org_id WHERE c.org_id = ?org AND c.id IN (${IN_IDS})`),
      q(`SELECT case_id, from_status, to_status, by_name, at, how FROM status_history WHERE org_id = ?org AND case_id IN (${IN_IDS}) ORDER BY at, id`),
      q(`SELECT * FROM protocols WHERE org_id = ?org AND case_id IN (${IN_IDS})`),
      q(`SELECT * FROM decisions WHERE org_id = ?org AND case_id IN (${IN_IDS}) ORDER BY version`),
      q(`SELECT t.*, c.source_file FROM tasks t JOIN cases c ON c.id = t.case_id AND c.org_id = t.org_id WHERE t.org_id = ?org AND t.case_id IN (${IN_IDS}) ORDER BY t.id`),
      q(`SELECT g.*, c.source_file FROM task_suggestions g JOIN cases c ON c.id = g.case_id AND c.org_id = g.org_id WHERE g.org_id = ?org AND g.case_id IN (${IN_IDS}) ORDER BY g.id`),
      q(`SELECT * FROM fact_edits WHERE org_id = ?org AND case_id IN (${IN_IDS})`),
      q(`SELECT * FROM edit_log WHERE org_id = ?org AND case_id IN (${IN_IDS}) ORDER BY at, id`),
      q(`SELECT * FROM question_confirmations WHERE org_id = ?org AND case_id IN (${IN_IDS}) ORDER BY at, id`),
      // By alert and fact ID (codebridge.extraction/2), every run: the page matches them against the current run and lists
      // what the current run no longer has.
      q(`SELECT case_id, alert_id, action, by_name, at FROM alert_events WHERE org_id = ?org AND case_id IN (${IN_IDS}) ORDER BY at, id`),
      q(`SELECT case_id, fact_id, action, value_sha256, run_id, by_name, at FROM fact_confirmations WHERE org_id = ?org AND case_id IN (${IN_IDS}) ORDER BY at, id`),
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
                .map((e) => [
                  e.key as string,
                  { id: (e.log_id as number) ?? null, text: e.text as string, orig: (e.orig as string) ?? null, by: e.by_name as string, when: e.at as string, fact_id: (e.fact_id as string) ?? null },
                ]),
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
              .map((e) => ({ alert_id: e.alert_id as string, action: e.action as AlertHistItem["action"], who: e.by_name as string, when: e.at as string }))
          : [],
        confirmations: clinical
          ? rows(conf)
              .filter((e) => e.case_id === id)
              .map((e) => ({
                fact_id: e.fact_id as string,
                action: e.action as FactConfirmation["action"],
                value_sha256: e.value_sha256 as string,
                run_id: e.run_id as string,
                who: e.by_name as string,
                when: e.at as string,
              }))
          : [],
        clinical,
      };
    }
    return out;
  }

  async attSets(keys?: string[]): Promise<Record<string, AttSet>> {
    const staff = await this.staff();
    const where = keys ? `WHERE org_id = ?org AND set_key IN (SELECT value FROM json_each(?1))` : "WHERE org_id = ?org AND ?1 = ?1";
    const arg = keys ? JSON.stringify(keys) : "";
    const [rows, sets] = await this.db.batch([
      this.q(`SELECT * FROM attendance ${where} /* org-scope: where names org_id */ ORDER BY set_key, dept_id, position`, arg),
      this.q(`SELECT * FROM attendance_sets ${where} /* org-scope: where names org_id */`, arg),
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
    const r = await this.q("SELECT day, started_by_name, started_at, ended_at FROM sessions WHERE org_id = ?org ORDER BY started_at").all<{
      day: string;
      started_by_name: string | null;
      started_at: string;
      ended_at: string | null;
    }>();
    return r.results.map((s) => ({ day: s.day, started_by: s.started_by_name, started_at: s.started_at, ended_at: s.ended_at }));
  }

  async mails(caseIds: string[] | null): Promise<Mail[]> {
    const r = await this.q(
      `SELECT n.*, c.source_file, u.pre, u.sur, u.post FROM notifications n LEFT JOIN cases c ON c.id = n.case_id AND c.org_id = n.org_id
       LEFT JOIN memberships m ON m.org_id = n.org_id AND m.user_id = n.to_user_id LEFT JOIN users u ON u.id = m.user_id
       WHERE n.org_id = ?org ORDER BY n.created_at DESC, n.id`,
    ).all<Record<string, unknown>>();
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
  edits: Record<string, EditEntry>;
  editLog: Record<string, unknown>[];
  qConfirm: { text: string; by: string; when: string } | null;
  draft_sha: string | null;
  alertHist: AlertHistItem[];
  confirmations: FactConfirmation[];
  clinical: boolean;
};
export type AttSet = { key: string; version: number; byName: Record<string, string[]>; byId: Record<string, string[]> };
export type Session = { day: string; started_by: string | null; started_at: string; ended_at: string | null };
export type Mail = Record<string, unknown>;
