import type { Context, MiddlewareHandler } from "hono";
import { getCookie } from "hono/cookie";
import type { AppEnv } from "../types";
import type { Viewer } from "@codebridge/domain/access";
import { E } from "../http/errors";
import { makeStores } from "../store";
import { actsInApp, demoMembership, membershipById, type MemberRow } from "../store/people";
import { staffName } from "../domain/rows";

// The demo opens as the first doctor of "Klinická onkologie" in demo org A (the demo case is an oncology patient).
export const DEFAULT_DEMO_USER = "d2p1";
export const DEMO_USER_COOKIE = "cb_demo_user";

// The membership a demo request names: X-Demo-User, or the cookie for <img> requests, which cannot carry a header.
// The value is a membership id (a person's id still works, meaning their first membership). It is not a credential
// and the UI says so. Ids, not names, because browsers refuse non-Latin-1 header values.
export function demoUserOf(c: Context): string {
  return (c.req.header("x-demo-user") || getCookie(c, DEMO_USER_COOKIE) || DEFAULT_DEMO_USER).slice(0, 64);
}

// The viewer a membership acts as. The stores are bound to the membership's org, so the org reaches every query.
export async function viewerOf(stores: ReturnType<typeof makeStores>, m: MemberRow & { role_id: Viewer["role"] }, authMode: Viewer["authMode"]): Promise<Viewer> {
  return {
    id: m.user_id,
    name: staffName(m),
    role: m.role_id,
    dept: await stores.dir.firstDeptOf(m.user_id),
    authMode,
    impersonating: false,
    org: m.org_id,
    membershipId: m.id,
  };
}

// Resolves the membership a data request acts with, then builds the stores for its org once per request.
export const viewer = (): MiddlewareHandler<AppEnv> => async (c, next) => {
  // The data routes need both bindings and the switch; without them the routes answer "not configured".
  if (c.env.DATA_API !== "on" || !c.env.DB || !c.env.DOCS) throw E.notConfigured();
  const user = c.get("user");
  if (user.mode === "demo") {
    const m = await demoMembership(c.env.DB, demoUserOf(c));
    // Role "staff" is a directory entry for attendance, not a user of the app; an ended membership acts nowhere.
    if (!actsInApp(m)) throw E.unknownUser();
    const stores = makeStores(c.env, m.org_id);
    c.set("stores", stores);
    c.set("viewer", await viewerOf(stores, m, "demo"));
  } else {
    // OIDC: the session names the org and the person's own membership there. A membership ended in the app counts at
    // the next request, so it is read again every time.
    const own = await membershipById(c.env.DB, user.membershipId);
    if (!actsInApp(own) || own.user_id !== user.userId || own.org_id !== user.org) throw E.unknownUser();
    let m: MemberRow & { role_id: Viewer["role"] } = own;
    if (user.actingMembershipId && user.actingMembershipId !== own.id) {
      // A role switch holds only in a demo org and only for a membership of that same org that can still act.
      const a = await membershipById(c.env.DB, user.actingMembershipId);
      if (!user.isDemoOrg || !actsInApp(a) || a.org_id !== user.org) throw E.unknownUser();
      m = a;
    }
    // One session cookie serves every tab of the browser. A tab names whom it shows (X-Acting-As: membership and
    // person, set from /api/me); after a switch or another login in a second tab, it is refused before it reads or
    // writes anything as the new identity, and reloads.
    const shown = c.req.header("x-acting-as");
    if (shown && shown !== `${m.id}:${own.user_id}`) throw E.sessionChanged();
    const stores = makeStores(c.env, m.org_id);
    const v = await viewerOf(stores, m, "oidc");
    if (m !== own) {
      v.impersonating = true;
      v.actor = { id: own.user_id, name: staffName(own) };
    }
    c.set("stores", stores);
    c.set("viewer", v);
  }
  c.set("breakGlass", null);
  return next();
};
