import type { MiddlewareHandler } from "hono";
import type { AppEnv } from "../types";
import { E } from "./errors";

// A non-GET from another site is refused, so no other website can spend our quota or act through a visitor's
// browser (CSRF). No CORS headers are ever sent, so other sites cannot read answers either.
// This does not stop a script that forges Origin; the rate limits and the keys' credit caps do that.
export const sameOrigin = (): MiddlewareHandler<AppEnv> => async (c, next) => {
  const method = c.req.method;
  if (method === "GET" || method === "HEAD") return next();
  if (c.req.header("sec-fetch-site") === "cross-site") throw E.badOrigin();
  const origin = c.req.header("origin");
  if (!origin || origin !== new URL(c.req.url).origin) throw E.badOrigin();
  return next();
};
