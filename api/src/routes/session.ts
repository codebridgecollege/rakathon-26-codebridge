// Switching the org or, in a demo org, the role of a login session (docs/design/AUTH.md, "Organizations and roles").
// Both issue a new session ID and keep the login's start and end. OIDC mode only: demo mode switches with its picker.
import { Hono, type Context } from "hono";
import { getCookie } from "hono/cookie";
import type { AppEnv, SessionUser } from "../types";
import { ApiError, E } from "../http/errors";
import { cookie, rotateSession, SESSION_COOKIE, SESSION_MAX_MS, sessionOf } from "../auth/session";
import { actsInApp, activeMembershipsOfUser, membershipById, roleSwitchMemberships } from "../store/people";
import { logSessionEvent } from "../auth/events";
import { staffName } from "../domain/rows";

const ROLE_CS: Record<string, string> = { doctor: "lékař", coordinator: "koordinátor", admin: "správce" };

// A small JSON body; the write guard does not run here, because a switch changes the org whose data epoch it checks.
async function bodyOf(c: Context<AppEnv>): Promise<Record<string, unknown>> {
  if (!(c.req.header("content-type") || "").toLowerCase().startsWith("application/json")) throw E.unsupportedMediaType();
  const text = await c.req.text();
  if (text.length > 1024) throw E.bodyTooLarge();
  try {
    const b = JSON.parse(text || "{}");
    if (b && typeof b === "object" && !Array.isArray(b)) return b as Record<string, unknown>;
  } catch {
    // falls through to the refusal
  }
  throw E.badRequest();
}

function sessionUser(c: Context<AppEnv>): SessionUser {
  const u = c.get("user");
  if (u.mode !== "oidc") throw E.notFound();
  return u;
}

async function rotated(c: Context<AppEnv>, next: { org: string; membershipId: string; actingMembershipId: string | null }) {
  const old = await sessionOf(c.env.DB, getCookie(c, SESSION_COOKIE));
  if (!old) throw E.unauthenticated();
  const id = await rotateSession(c.env.DB, old, next);
  // Logged out in another tab between the check and the switch.
  if (!id) throw E.unauthenticated();
  // The cookie keeps the login's end; the row's expires_at is what counts.
  const left = Math.ceil((Date.parse(old.expires_at) - Date.now()) / 1000);
  c.header("set-cookie", cookie(SESSION_COOKIE, id, Math.min(Math.max(1, left), SESSION_MAX_MS / 1000)));
}

const orgNotFound = () => new ApiError(404, "org_not_found", "Tuto organizaci nemáte k dispozici.");
const memberNotFound = () => new ApiError(404, "membership_not_found", "Tuto roli nelze zvolit.");
const roleSwitchOff = () => new ApiError(403, "role_switch_forbidden", "Přepnout roli lze jen v ukázkové organizaci.");

export const session = new Hono<AppEnv>()
  // To another org of the same person: their own membership there, no role switch carried over.
  .post("/session/org", async (c) => {
    const u = sessionUser(c);
    const b = await bodyOf(c);
    const target = (await activeMembershipsOfUser(c.env.DB, u.userId)).filter(actsInApp).find((m) => m.org_id === b.org_id);
    if (!target) throw orgNotFound();
    await rotated(c, { org: target.org_id, membershipId: target.id, actingMembershipId: null });
    await logSessionEvent(c.env, target, null, "session.org", "přepnul(a) organizaci", c.req.header("cf-ray") ?? null);
    return c.json({ ok: true });
  })
  // "Přepnout roli" (demo orgs only): act as one of the org's demo accounts, or back as oneself. The access log keeps
  // the real person on every row from here on.
  .post("/session/role", async (c) => {
    const u = sessionUser(c);
    const b = await bodyOf(c);
    if (!u.isDemoOrg) throw roleSwitchOff();
    const own = await membershipById(c.env.DB, u.membershipId);
    if (!actsInApp(own) || own.user_id !== u.userId) throw E.unknownUser();
    let target = own;
    if (b.membership_id !== own.id) {
      const allowed = await roleSwitchMemberships(c.env.DB, u.org);
      const t = allowed.find((m) => m.id === b.membership_id);
      if (!t || !actsInApp(t)) throw memberNotFound();
      target = t;
    }
    await rotated(c, { org: u.org, membershipId: own.id, actingMembershipId: target.id === own.id ? null : target.id });
    await logSessionEvent(
      c.env,
      target,
      own,
      "session.role",
      `přepnul(a) roli: ${staffName(target)} (${ROLE_CS[target.role_id] ?? target.role_id})`,
      c.req.header("cf-ray") ?? null,
    );
    return c.json({ ok: true });
  });
