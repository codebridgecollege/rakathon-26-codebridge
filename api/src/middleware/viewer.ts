import type { MiddlewareHandler } from "hono";
import { getCookie } from "hono/cookie";
import type { AppEnv } from "../types";
import { E } from "../http/errors";
import { makeStores } from "../store";
import { staffName } from "../domain/rows";

// The demo opens as the first doctor of "Klinická onkologie" (the demo case is an oncology patient), as the page does.
export const DEFAULT_DEMO_USER = "d2p1";
export const DEMO_USER_COOKIE = "cb_demo_user";

// Resolves the person a data request acts for, from the users table, and builds the stores once per request.
export const viewer = (): MiddlewareHandler<AppEnv> => async (c, next) => {
  // The data routes need both bindings and the switch; without them the page stays on its embedded data.
  if (c.env.DATA_API !== "on" || !c.env.DB || !c.env.DOCS) throw E.notConfigured();
  const stores = makeStores(c.env);
  c.set("stores", stores);
  const user = c.get("user");
  let row;
  if (user.mode === "demo") {
    // Demo mode has no login (CLAUDE.md): the page's user picker names the person by staff id, in a header, or in a
    // cookie for <img> requests, which cannot carry a header. The id is not a credential and the UI says so.
    // Ids, not names, because browsers refuse non-Latin-1 header values and staff names contain "ř" and "š".
    const id = (c.req.header("x-demo-user") || getCookie(c, DEMO_USER_COOKIE) || DEFAULT_DEMO_USER).slice(0, 64);
    row = await stores.dir.userById(id);
  } else {
    // Access mode: the verified e-mail picks the directory entry; a client header cannot change who you are.
    row = await stores.dir.userByEmail(user.email);
  }
  // Role "staff" is a directory entry for attendance (step 4), not a user of the app.
  if (!row || row.active !== 1 || row.role_id === ("staff" as string)) throw E.unknownUser();
  c.set("viewer", {
    id: row.id,
    name: staffName(row),
    role: row.role_id,
    dept: await stores.dir.firstDeptOf(row.id),
    authMode: user.mode,
    impersonating: false,
  });
  c.set("breakGlass", null);
  return next();
};
