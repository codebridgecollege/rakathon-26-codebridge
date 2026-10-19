import { Hono } from "hono";
import type { AppEnv } from "../types";
import { E } from "../http/errors";
import { audit } from "../middleware/audit";
import { canReadAuditLog } from "@codebridge/domain/access";
import { staffName } from "../domain/rows";

// The server's access log for Administrace. Reading it is logged too.
export const admin = new Hono<AppEnv>().get("/admin/access-log", async (c) => {
  if (!canReadAuditLog(c.var.viewer)) throw E.roleForbidden();
  await audit(c, { action: "audit.view", what_cs: "zobrazil(a) záznam přístupů" });
  const q = c.req.query();
  const limit = Math.min(Math.max(Number(q.limit) || 200, 1), 1000);
  const rows = await c.var.stores.audit.list({
    caseId: q.case || undefined,
    actor: q.actor || undefined,
    from: q.from || undefined,
    to: q.to || undefined,
    limit,
  });
  return c.json({
    entries: rows.map((r) => ({
      at: r.at,
      who: r.actor_name,
      role: r.acted_as_role,
      impersonating: r.impersonating === 1,
      acted_as: r.impersonating === 1 && r.as_sur ? staffName({ pre: r.as_pre ?? "", sur: r.as_sur, post: r.as_post ?? "" }) : null,
      case_id: r.case_id,
      pid: r.source_file,
      what: r.what_cs,
    })),
  });
});
