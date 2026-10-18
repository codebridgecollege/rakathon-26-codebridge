import { Hono } from "hono";
import type { AppEnv } from "../types";
import { E } from "../http/errors";
import { demoPicker, membershipsOut, orgById, orgOut } from "../store/people";
import { work } from "./write-context";

// /me, /staff and the demo picker hold no case content, so they write no access-log row.
export const directory = new Hono<AppEnv>()
  // The person, the membership the request acts with, every membership the person has, and the active org with its
  // data epoch (AUTH.md; the session-based login of step 3 fills the same answer).
  .get("/me", async (c) => {
    const v = c.var.viewer;
    const [org, memberships, st] = await Promise.all([orgById(c.env.DB, v.org), membershipsOut(c.env.DB, v.id), work(c).epoch()]);
    if (!org) throw E.unknownUser();
    return c.json({
      user: { id: v.id, name: v.name, role: v.role, dept: v.dept },
      membership_id: v.membershipId,
      memberships,
      org: orgOut(org),
      data_epoch: st?.data_epoch ?? null,
      auth_mode: v.authMode,
      impersonating: v.impersonating,
      notice_cs: v.authMode === "demo" ? "Ukázka bez přihlášení: uživatele vybíráte ručně." : null,
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
