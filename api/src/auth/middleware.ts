import type { MiddlewareHandler } from "hono";
import { getCookie } from "hono/cookie";
import type { AppEnv } from "../types";
import { E } from "../http/errors";
import { SESSION_COOKIE, sessionLive, sessionOf, touchSession } from "./session";

export const auth = (): MiddlewareHandler<AppEnv> => async (c, next) => {
  const mode = c.env.AUTH_MODE;
  if (mode === "demo") {
    // Demo mode trusts no client claim: there is no login, and the UI says roles are a stand-in.
    c.set("user", { mode: "demo" });
    return next();
  }
  if (mode === "oidc") {
    // The session cookie is the only credential; a header cannot name another person or org.
    const s = await sessionOf(c.env.DB, getCookie(c, SESSION_COOKIE));
    // A missing, unknown, expired or idle session reads the same to the caller: log in again. The row stays for the
    // sweep (auth/session.ts, sweepSessions).
    if (!s || !sessionLive(s)) throw E.unauthenticated();
    await touchSession(c.env.DB, s);
    c.set("user", {
      mode: "oidc",
      userId: s.user_id,
      org: s.org_id,
      membershipId: s.membership_id,
      actingMembershipId: s.acting_membership_id,
      isDemoOrg: s.is_demo === 1,
      sessionHash: s.id_hash,
    });
    return next();
  }
  // An unknown mode never falls back to open.
  throw E.misconfigured();
};
