import type { Context } from "hono";
import type { AppEnv } from "../types";
import { E } from "../http/errors";
import { canReadCaseHeader, canReadClinical, clinicalAccessOf, type Decision } from "../domain/access";
import type { CaseJoinRow } from "../domain/rows";
import { D1Work } from "../store/work";

export const modeOf = (c: Context<AppEnv>) => clinicalAccessOf(c.env.CLINICAL_ACCESS);

function enforce(d: Decision) {
  if (d === "not_member") throw E.notMember();
  if (d === "role_forbidden") throw E.roleForbidden();
}

// Loads a case and applies the role and membership rule for the level of content the route returns.
// "header": the case row, documents list, decisions, history. "clinical": extraction, alerts, pages, guidance.
export async function openCase(c: Context<AppEnv>, id: string, level: "header" | "clinical"): Promise<CaseJoinRow> {
  const { cases } = c.var.stores;
  const v = c.var.viewer;
  const row = await cases.caseById(id);
  if (!row) throw E.caseNotFound();
  // Only doctors need membership; the other roles are decided by role alone. A break-the-glass grant counts as
  // membership until it expires, and every read under it carries the reason in the access log.
  let member = v.role === "doctor" ? await cases.isMember(id, v) : false;
  if (v.role === "doctor" && !member) {
    const g = await new D1Work(c.env.DB).validGrant(id, v.id, new Date().toISOString());
    if (g) {
      member = true;
      c.set("breakGlass", g.reason);
    }
  }
  enforce((level === "header" ? canReadCaseHeader : canReadClinical)(v, member, modeOf(c)));
  return row;
}
