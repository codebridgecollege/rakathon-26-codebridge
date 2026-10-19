import { Hono } from "hono";
import type { AppEnv } from "../types";
import { E } from "../http/errors";
import type { Role } from "@codebridge/domain/access";
import { demoPicker, membershipsOut, orgById, orgOut, roleSwitchMemberships } from "../store/people";
import { staffName } from "../domain/rows";
import { work } from "./write-context";
import { nisConfig, nisConfigured } from "../services/fhir";
import { pipelineOn } from "../services/page-reader";
import { uploadPolicy } from "../domain/documents";

// /me, /staff and the demo picker hold no case content, so they write no access-log row.
export const directory = new Hono<AppEnv>()
  // The person, the membership the request acts with, every membership the person has, and the active org with its
  // data epoch (AUTH.md; the session-based login of step 3 fills the same answer).
  .get("/me", async (c) => {
    const v = c.var.viewer;
    const u = c.var.user;
    // The memberships and the org switch belong to the person logged in, also while acting as someone else.
    const person = v.actor?.id ?? v.id;
    const [org, memberships, st] = await Promise.all([orgById(c.env.DB, v.org), membershipsOut(c.env.DB, person), work(c).epoch()]);
    if (!org) throw E.unknownUser();
    // "Přepnout roli" exists after a real login in a demo org only.
    const roleSwitch =
      u.mode === "oidc" && org.is_demo === 1
        ? (await roleSwitchMemberships(c.env.DB, org.id)).map((m) => ({
            membership_id: m.id,
            name: staffName(m),
            role: m.role_id as Role,
            fn: m.fn,
            own: u.mode === "oidc" && m.id === u.membershipId,
          }))
        : null;
    return c.json({
      user: { id: v.id, name: v.name, role: v.role, dept: v.dept },
      membership_id: v.membershipId,
      memberships,
      org: orgOut(org),
      data_epoch: st?.data_epoch ?? null,
      auth_mode: v.authMode,
      impersonating: v.impersonating,
      real_user: v.actor ?? null,
      role_switch: roleSwitch,
      notice_cs: v.authMode === "demo" ? "Ukázka bez přihlášení: uživatele vybíráte ručně." : null,
      // The org's NIS, so the page shows "Import z NIS" only where one is configured (hidden otherwise).
      nis: nisConfigured(c.env, v.org) ? { label_cs: nisConfig(c.env, v.org)!.label_cs } : null,
      features: { pipeline: pipelineOn(c.env, v.org), keeps_uploads: uploadPolicy(c.env.UPLOAD_POLICY, v.org, c.env.UPLOAD_STORE_ORGS) === "store_unprocessed" },
    });
  })
  .get("/staff", async (c) => {
    const s = await c.var.stores.dir.staff();
    // The staff object the app accepts as a user, plus the administrator and each person's role, of this org only.
    return c.json({ ...s, seq: 0, source: "server" });
  })
  // The demo user picker (AUTH_MODE=demo only): every membership that can act, grouped by org. Without a login there is
  // nothing to protect the list with, so with a login it does not exist.
  .get("/demo/memberships", async (c) => {
    if (c.env.AUTH_MODE !== "demo") throw E.notFound();
    return c.json(await demoPicker(c.env.DB));
  });
