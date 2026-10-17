// Shared by the write routes: who acts, on which case, with what access, and the answer shape
// { data, data_epoch, state } the page applies (step-4.md "As implemented").
import type { Context } from "hono";
import type { AppEnv } from "../types";
import { D } from "../domain/errors";
import { canReadClinical } from "../domain/access";
import { assertCan, type Action, type Actor, type CaseAccess } from "../domain/roles";
import { systemClock, type Clock } from "../domain/time";
import { Tx } from "../store/write";
import { D1Work, type CaseCore } from "../store/work";
import { modeOf } from "./access-check";

let clock: Clock = systemClock;
// Tests pin the time and IDs.
export function setClock(c: Clock | null) {
  clock = c ?? systemClock;
}
export const now = () => clock.now();
export const newId = () => clock.id();

export const work = (c: Context<AppEnv>) => new D1Work(c.env.DB);

export const actorOf = (c: Context<AppEnv>): Actor => ({ id: c.var.viewer.id, name: c.var.viewer.name, role: c.var.viewer.role });

export function tx(c: Context<AppEnv>, breakGlass: string | null = null) {
  return new Tx(c.env.DB, c.var.viewer, { requestId: c.req.header("cf-ray") ?? null, epoch: c.var.epoch ?? null, breakGlass });
}

// Names what a refusal row says: the action label and the case. Called first in every write handler.
export function label(c: Context<AppEnv>, what: string, caseId: string | null = null) {
  c.set("auditLabel", what);
  c.set("auditCase", caseId);
}

export type CaseCtx = { core: CaseCore; access: CaseAccess; breakGlass: string | null };

// Loads the case and checks the role and membership rule for the action; a doctor outside the team needs a grant.
export async function caseFor(c: Context<AppEnv>, id: string, action: Action, extra: Partial<CaseAccess> = {}): Promise<CaseCtx> {
  const w = work(c);
  const core = await w.caseCore(id);
  const v = c.var.viewer;
  // An open intake (step 6) exists only for its creator until it completes; to anyone else it is not there.
  if (!core || (core.intake_open === 1 && core.created_by !== v.id)) throw D.caseNotFound();
  // While it is open, the intake takes its documents and nothing else, so discarding it never meets a history row.
  if (core.intake_open === 1 && action !== "document.upload" && action !== "case.create") throw D.intakeOpen();
  let member = false;
  let grant: { id: string } | null = null;
  if (v.role === "doctor") {
    member = await c.var.stores.cases.isMember(id, v);
    if (!member) grant = await w.validGrant(id, v.id, now().toISOString());
  }
  const access = { member, grant: !!grant, ...extra };
  assertCan(actorOf(c), action, access);
  // Rows under a grant name the grant; its reason is stored once, in the grant and in the row that created it.
  return { core, access, breakGlass: grant ? grantLabel(grant.id) : null };
}

// The workflow state of the given cases as the viewer may see it (edits and alert history are clinical content).
export async function statesFor(c: Context<AppEnv>, ids: string[]) {
  const v = c.var.viewer;
  const clinical = canReadClinical(v, true, modeOf(c)) === "ok";
  return work(c).caseStates(ids, clinical);
}

export function answer(c: Context<AppEnv>, data: unknown, state: Record<string, unknown> = {}, status: 200 | 201 = 200) {
  return c.json({ data, data_epoch: c.var.epoch, state }, status);
}

export const isoNow = () => now().toISOString();

export const grantLabel = (id: string) => `přístup mimo tým (povolení ${id.slice(0, 8)})`;
