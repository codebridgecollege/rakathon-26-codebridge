import type { Context, MiddlewareHandler } from "hono";
import type { AppEnv, RateLimitName } from "../types";
import { E } from "./errors";

// Limits are per Cloudflare location and approximate; they cap abuse and cost, they are not a security control.
const keyOf = (c: Context<AppEnv>) => {
  const u = c.get("user");
  // A login limits per person; demo mode has no identity, so the client IP is the best key available.
  // The person's id rather than the e-mail, so no e-mail address sits in the limiter's keys.
  return u.mode === "oidc" ? `u:${u.userId}` : `ip:${c.req.header("cf-connecting-ip") ?? "unknown"}`;
};

// The same check inside a route, after the cheap refusals (role, case state) have run.
export async function limitOrThrow(c: Context<AppEnv>, name: RateLimitName) {
  const { success } = await c.env[name].limit({ key: keyOf(c) });
  if (!success) throw E.rateLimited();
}

export const rateLimit =
  (name: RateLimitName): MiddlewareHandler<AppEnv> =>
  async (c, next) => {
    const { success } = await c.env[name].limit({ key: keyOf(c) });
    if (!success) throw E.rateLimited();
    return next();
  };
