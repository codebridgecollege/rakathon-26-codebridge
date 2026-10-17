import type { MiddlewareHandler } from "hono";
import type { AppEnv, RateLimitName } from "../types";
import { E } from "./errors";

// Limits are per Cloudflare location and approximate; they cap abuse and cost, they are not a security control.
export const rateLimit =
  (name: RateLimitName): MiddlewareHandler<AppEnv> =>
  async (c, next) => {
    const u = c.get("user");
    // Access mode limits per person; demo mode has no identity, so the client IP is the best key available.
    // sub rather than email, so no e-mail address sits in the limiter's keys.
    const key = u.mode === "access" ? `u:${u.sub}` : `ip:${c.req.header("cf-connecting-ip") ?? "unknown"}`;
    const { success } = await c.env[name].limit({ key });
    if (!success) throw E.rateLimited();
    return next();
  };
