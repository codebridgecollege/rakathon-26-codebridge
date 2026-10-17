import { Hono } from "hono";
import type { AppEnv } from "../types";

// /me and /staff hold no case content, so they write no access-log row.
export const directory = new Hono<AppEnv>()
  .get("/me", (c) => {
    const v = c.var.viewer;
    return c.json({
      user: { id: v.id, name: v.name, role: v.role, dept: v.dept },
      auth_mode: v.authMode,
      impersonating: v.impersonating,
      notice_cs: v.authMode === "demo" ? "Ukázka bez přihlášení: uživatele vybíráte ručně." : null,
    });
  })
  .get("/staff", async (c) => {
    const s = await c.var.stores.dir.staff();
    // The STAFF object the page's validStaff() accepts, plus the administrator and each person's role.
    return c.json({ ...s, seq: 0, source: "server" });
  });
