// Login transactions and sessions (docs/design/AUTH.md, "How login works" and "Session rules").
// - A login transaction (state, nonce, PKCE verifier, return path) lives in an encrypted cookie named after its state,
//   so two tabs logging in at once each keep their own; the callback reads it once and deletes it.
// - A session is a random ID in the __Host-cb_session cookie; D1 holds only its SHA-256, with the person, the org,
//   the person's own membership and the membership acted as after a role switch.
import { EncryptJWT, jwtDecrypt } from "jose";
import { orgStmt } from "../store/sql";
import { randomToken, sha256hex, TOKEN_SHAPE } from "./oidc";

export const SESSION_COOKIE = "__Host-cb_session";
const TX_PREFIX = "__Host-cb_tx_";
export const txCookieName = (state: string) => TX_PREFIX + state;

// A login at the IdP has ten minutes, after which the transaction cookie is gone and the callback refuses it.
export const TX_MAX_AGE_S = 600;
// A session ends 12 hours after the login at the latest; a hospital org also ends it after its idle limit
// (orgs.session_idle_min, 60 minutes), a demo org does not, so a laptop left open before a talk still works.
export const SESSION_MAX_MS = 12 * 3600_000;
// last_used_at is written at most this often, so most requests read the session without writing it.
export const TOUCH_EVERY_MS = 5 * 60_000;

// Path /, Secure, no Domain: the __Host- prefix makes the browser refuse the cookie from any other host or path.
// SameSite=Lax: the cookie still comes with the IdP's top-level redirect back to the callback.
export function cookie(name: string, value: string, maxAgeS: number): string {
  return `${name}=${value}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAgeS}`;
}
export const clearCookie = (name: string) => cookie(name, "", 0);

export type LoginTx = {
  state: string;
  nonce: string;
  verifier: string;
  // The validated return path (safeReturnPath), or "" when the login runs in a second window (popup).
  to: string;
  popup: boolean;
  locale: string;
};

export async function sealTx(tx: LoginTx, key: Uint8Array): Promise<string> {
  return new EncryptJWT({ s: tx.state, n: tx.nonce, v: tx.verifier, t: tx.to, p: tx.popup ? 1 : 0, l: tx.locale })
    .setProtectedHeader({ alg: "dir", enc: "A256GCM" })
    .setIssuedAt()
    .setExpirationTime(`${TX_MAX_AGE_S}s`)
    .encrypt(key);
}

// Null for anything but an intact, unexpired transaction of this very state: a cookie of another login, a tampered
// value or one encrypted with an old key all count as no transaction.
export async function openTx(sealed: string | undefined, state: string, key: Uint8Array): Promise<LoginTx | null> {
  if (!sealed) return null;
  try {
    const { payload: p } = await jwtDecrypt(sealed, key, { keyManagementAlgorithms: ["dir"], contentEncryptionAlgorithms: ["A256GCM"] });
    if (p.s !== state || typeof p.n !== "string" || typeof p.v !== "string" || typeof p.t !== "string") return null;
    return { state, nonce: p.n, verifier: p.v, to: p.t, popup: p.p === 1, locale: typeof p.l === "string" ? p.l : "cs" };
  } catch {
    return null;
  }
}

// Where a login may return to: a path on this host. "/" followed by anything but "/" or "\" (which browsers read as
// another host), no control characters or spaces (browsers drop tabs and newlines, so "/\t/evil" would become
// "//evil"), and not the login's own routes. Anything else becomes "/".
export function safeReturnPath(to: string | undefined | null): string {
  if (typeof to !== "string" || to.length > 2000) return "/";
  if (!/^\/(?![/\\])/.test(to)) return "/";
  if (/[\x00-\x20\x7f\\]/.test(to)) return "/";
  if (/^\/auth(?:[/?#]|$)/i.test(to)) return "/";
  return to;
}

export const isoAt = (ms: number) => new Date(ms).toISOString();

export type SessionRow = {
  id_hash: string;
  user_id: string;
  org_id: string;
  membership_id: string;
  acting_membership_id: string | null;
  id_token: string | null;
  created_at: string;
  last_used_at: string;
  expires_at: string;
  is_demo: number;
  session_idle_min: number | null;
};

// A new session: the ID goes to the cookie, its hash to D1. Returns the ID.
export async function createSession(
  db: D1Database,
  s: { userId: string; org: string; membershipId: string; idToken: string | null },
  now = Date.now(),
): Promise<string> {
  const id = randomToken();
  await orgStmt(
    db,
    s.org,
    `INSERT INTO auth_sessions (id_hash, user_id, org_id, membership_id, acting_membership_id, id_token, created_at, last_used_at, expires_at)
     VALUES (?1, ?2, ?org, ?3, NULL, ?4, ?5, ?5, ?6)`,
    await sha256hex(id),
    s.userId,
    s.membershipId,
    s.idToken,
    isoAt(now),
    isoAt(now + SESSION_MAX_MS),
  ).run();
  return id;
}

export async function sessionOf(db: D1Database, rawId: string | undefined): Promise<SessionRow | null> {
  if (!rawId || !TOKEN_SHAPE.test(rawId)) return null;
  return db
    .prepare(
      `SELECT s.*, o.is_demo, o.session_idle_min FROM auth_sessions s JOIN orgs o ON o.id = s.org_id
       WHERE s.id_hash = ?1 /* org-scope: the session names its org; this lookup establishes it */`,
    )
    .bind(await sha256hex(rawId))
    .first<SessionRow>();
}

// Whether a session still counts at `now`: before its end, and in an org with an idle limit, used recently enough.
// last_used_at lags by up to TOUCH_EVERY_MS, so the idle limit can end a session up to five minutes early.
export function sessionLive(s: SessionRow, now = Date.now()): boolean {
  if (Date.parse(s.expires_at) <= now) return false;
  if (s.session_idle_min != null && Date.parse(s.last_used_at) + s.session_idle_min * 60_000 <= now) return false;
  return true;
}

export async function touchSession(db: D1Database, s: SessionRow, now = Date.now()): Promise<void> {
  if (now - Date.parse(s.last_used_at) < TOUCH_EVERY_MS) return;
  await db.prepare("UPDATE auth_sessions SET last_used_at = ?1 WHERE id_hash = ?2 /* org-scope: by the session's own key */").bind(isoAt(now), s.id_hash).run();
}

const deleteStmt = (db: D1Database, idHash: string) =>
  db.prepare("DELETE FROM auth_sessions WHERE id_hash = ?1 /* org-scope: by the session's own key */").bind(idHash);

export function deleteSession(db: D1Database, idHash: string) {
  return deleteStmt(db, idHash).run();
}

// An org or role switch: a new session ID for the same login (no fixation of the old one), with the login's start and
// end kept, so a switch never extends a session. One batch, so the old ID stops working in the same commit. Null when
// the old session is gone (logged out in another tab).
export async function rotateSession(
  db: D1Database,
  old: SessionRow,
  next: { org: string; membershipId: string; actingMembershipId: string | null },
  now = Date.now(),
): Promise<string | null> {
  const id = randomToken();
  const [ins] = await db.batch([
    orgStmt(
      db,
      next.org,
      `INSERT INTO auth_sessions (id_hash, user_id, org_id, membership_id, acting_membership_id, id_token, created_at, last_used_at, expires_at)
       SELECT ?1, user_id, ?org, ?2, ?3, id_token, created_at, ?4, expires_at FROM auth_sessions WHERE id_hash = ?5`,
      await sha256hex(id),
      next.membershipId,
      next.actingMembershipId,
      isoAt(now),
      old.id_hash,
    ),
    deleteStmt(db, old.id_hash),
  ]);
  return ins?.meta.changes ? id : null;
}

// The cron sweep: an expired session loses its ID token at once (it was only the logout hint and names the person),
// and its row goes 30 days after it expired (AUTH.md, "Retention").
export async function sweepSessions(db: D1Database, now = Date.now()): Promise<void> {
  await db.batch([
    db.prepare("UPDATE auth_sessions SET id_token = NULL WHERE id_token IS NOT NULL AND expires_at <= ?1 /* org-scope: every org's sessions */").bind(isoAt(now)),
    db.prepare("DELETE FROM auth_sessions WHERE expires_at <= ?1 /* org-scope: every org's sessions */").bind(isoAt(now - 30 * 24 * 3600_000)),
  ]);
}
