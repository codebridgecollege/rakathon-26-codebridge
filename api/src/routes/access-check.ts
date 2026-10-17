import type { Context } from "hono";
import type { AppEnv } from "../types";
import { E } from "../http/errors";
import { canReadCaseHeader, canReadClinical, clinicalAccessOf, type Decision } from "../domain/access";
import type { CaseJoinRow } from "../domain/rows";

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
  // Only doctors need membership; the other roles are decided by role alone.
  const member = v.role === "doctor" ? await cases.isMember(id, v) : false;
  enforce((level === "header" ? canReadCaseHeader : canReadClinical)(v, member, modeOf(c)));
  return row;
}
