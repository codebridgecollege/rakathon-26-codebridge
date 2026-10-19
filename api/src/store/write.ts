// One write = one D1 batch: guards first, then the changes, then the audit rows, so an audit row exists exactly when
// its change committed. D1 has no interactive transactions, so each guard re-checks inside the batch what the route
// read before it: it inserts the condition's result into write_guards, whose CHECK (ok = 1) fails on a false
// condition and rolls back the whole batch (verified in test/write.test.ts and on local D1 under wrangler dev).
// A Tx is bound to the org of the viewer it acts for: statements name the org as ?org (store/sql.ts), the guards, the
// idempotency row and the audit rows carry it, and the demo's data epoch it re-checks is that org's.
import type { Viewer } from "@codebridge/domain/access";
import { DomainError, D } from "@codebridge/domain/errors";
import { assertOrg, numberPlain, orgStmt } from "./sql";

export type AuditLine = {
  action: string;
  what_cs: string;
  case_id?: string | null;
  target_type?: string | null;
  target_id?: string | null;
  break_glass_reason?: string | null;
};

type Guard = { code: string; cond: string; args: unknown[]; err: () => Error };

// Raised when the idempotency key's row already exists: the route replays the stored answer.
export class IdempotentReplay extends Error {
  constructor() {
    super("idempotent_replay");
  }
}

export class Tx {
  private guards: Guard[] = [];
  private changes: D1PreparedStatement[] = [];
  private audits: D1PreparedStatement[] = [];
  private head: D1PreparedStatement[] = [];
  private batchId = crypto.randomUUID();
  // Maps a constraint failure ("UNIQUE constraint failed: slots.org_id, slots.day, slots.time") to the refusal shown.
  private constraintErrors: [RegExp, () => Error][] = [];
  readonly org: string;

  constructor(
    private db: D1Database,
    private viewer: Viewer,
    private ctx: { requestId: string | null; epoch: number | null; breakGlass?: string | null },
  ) {
    this.org = assertOrg(viewer.org);
  }

  // cond is a boolean SQL expression with plain "?" placeholders (and ?org for the org); NULL counts as false, so a
  // missing row fails closed.
  guard(code: string, cond: string, args: unknown[], err: () => Error): this {
    this.guards.push({ code, cond, args, err });
    return this;
  }

  // sql uses numbered parameters (?1, ?2, ...) and ?org.
  run(sql: string, ...args: unknown[]): this {
    this.changes.push(orgStmt(this.db, this.org, sql, ...args));
    return this;
  }

  onConstraint(re: RegExp, err: () => Error): this {
    this.constraintErrors.push([re, err]);
    return this;
  }

  // The idempotency row goes first, so a parallel duplicate fails on its primary key before any guard. The key is the
  // org's and the person's own: the same key from another person or in another org is a different request.
  idempotency(key: string, route: string, bodySha: string, response: unknown, status: number, now: string): this {
    this.head.push(
      orgStmt(
        this.db,
        this.org,
        "INSERT INTO idempotency_keys (org_id, key, user_id, route, body_sha, response_json, status, created_at) VALUES (?org, ?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        key,
        this.viewer.id,
        route,
        bodySha,
        JSON.stringify(response),
        status,
        now,
      ),
    );
    return this;
  }

  audit(a: AuditLine): this {
    this.audits.push(auditStatement(this.db, this.viewer, a, this.ctx));
    return this;
  }

  get size() {
    return this.head.length + this.guards.length + this.changes.length + this.audits.length + 1;
  }

  async commit(): Promise<void> {
    // A reset-demo of this org may commit between the epoch check of the request and this batch; the write must not
    // land in the new data, so the epoch is re-checked inside the batch like any other read.
    if (this.ctx.epoch !== null && !this.guards.some((g) => g.code === "epoch"))
      this.guards.unshift({ code: "epoch", cond: "(SELECT data_epoch FROM demo_state WHERE org_id = ?org) = ?", args: [this.ctx.epoch], err: () => D.dataReset() });
    const guardStmts = this.guards.map((g) =>
      this.db
        .prepare(`INSERT INTO write_guards (org_id, batch_id, code, ok) SELECT ?1, ?2, ?3, CASE WHEN (${numberPlain(g.cond, 4, 1)}) THEN 1 ELSE 0 END`)
        .bind(this.org, this.batchId, g.code, ...g.args),
    );
    const cleanup = this.db.prepare("DELETE FROM write_guards WHERE org_id = ?1 AND batch_id = ?2").bind(this.org, this.batchId);
    try {
      await this.db.batch([...this.head, ...guardStmts, ...this.changes, ...this.audits, cleanup]);
    } catch (e) {
      throw await this.explain(e);
    }
  }

  private async explain(e: unknown): Promise<Error> {
    const msg = e instanceof Error ? e.message : String(e);
    if (/UNIQUE constraint failed: idempotency_keys\./.test(msg)) return new IdempotentReplay();
    for (const [re, err] of this.constraintErrors) if (re.test(msg)) return err();
    if (/CHECK constraint failed/.test(msg) && this.guards.length) {
      // Name the guard that failed by asking each condition again, read-only, in order.
      for (const g of this.guards) {
        const r = await this.db
          .prepare(`SELECT CASE WHEN (${numberPlain(g.cond, 1, g.args.length + 1)}) THEN 1 ELSE 0 END AS ok`)
          // D1 refuses a bound value the statement does not use, so the org is bound only when the condition names it.
          .bind(...g.args, ...(g.cond.includes("?org") ? [this.org] : []))
          .first<{ ok: number }>();
        // The guard's code only (no values), so a race shows in the Worker log without request data.
        if (!r || r.ok !== 1) {
          console.log(JSON.stringify({ store: "guard_failed", guard: g.code }));
          return g.err();
        }
      }
      // Every guard holds again: a parallel write came and went. The user retries.
      return D.conflict();
    }
    if (e instanceof DomainError) return e;
    console.error(JSON.stringify({ store: "batch_failed", reason: msg.slice(0, 120).replace(/'[^']*'/g, "'…'") }));
    return e instanceof Error ? e : new Error("batch_failed");
  }
}

// One access-log row, in the viewer's org, naming the membership acted as.
export function auditStatement(
  db: D1Database,
  v: Viewer,
  a: AuditLine,
  ctx: { requestId: string | null; epoch: number | null; breakGlass?: string | null },
): D1PreparedStatement {
  return orgStmt(
    db,
    v.org,
    `INSERT INTO access_log (org_id, actor_user_id, actor_name, acted_as_role, acted_as_membership, impersonating, auth_mode, case_id, action, what_cs,
       target_type, target_id, break_glass_reason, request_id, data_epoch, at)
     VALUES (?org, ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, strftime('%Y-%m-%dT%H:%M:%fZ','now'))`,
    v.id,
    v.name,
    v.role,
    v.membershipId,
    v.impersonating ? 1 : 0,
    v.authMode,
    a.case_id ?? null,
    a.action,
    a.what_cs,
    a.target_type ?? null,
    a.target_id ?? null,
    a.break_glass_reason ?? ctx.breakGlass ?? null,
    ctx.requestId,
    ctx.epoch,
  );
}
