import type { MiddlewareHandler } from "hono";
import type { AppEnv } from "../types";
import { E } from "../http/errors";
import { verifyAccessJwt } from "./access";

export const auth = (): MiddlewareHandler<AppEnv> => async (c, next) => {
  const mode = c.env.AUTH_MODE;
  if (mode === "demo") {
    // Demo mode trusts no client claim: there is no login, and the UI says roles are a stand-in.
    c.set("user", { mode: "demo", email: null, sub: null });
    return next();
  }
  if (mode === "access") {
    // Fail closed: a half-configured Access check must not let requests through.
    if (!c.env.ACCESS_TEAM_DOMAIN?.startsWith("https://") || !c.env.ACCESS_AUD) throw E.misconfigured();
    // Header only, not the CF_Authorization cookie: Access always adds the header on requests it lets through.
    const token = c.req.header("cf-access-jwt-assertion");
    if (!token) throw E.unauthenticated();
    let email: string, sub: string;
    try {
      const p = await verifyAccessJwt(token, c.env.ACCESS_TEAM_DOMAIN, c.env.ACCESS_AUD);
      if (typeof p.email !== "string" || typeof p.sub !== "string" || !p.sub) throw new Error("claims");
      email = p.email.toLowerCase();
      sub = p.sub;
    } catch {
      // The reason (expired, wrong aud, bad signature) is not echoed to the caller.
      throw E.unauthenticated();
    }
    c.set("user", { mode: "access", email, sub });
    return next();
  }
  // An unknown mode never falls back to open.
  throw E.misconfigured();
};
