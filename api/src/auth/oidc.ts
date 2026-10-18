// The Worker as an OIDC client (docs/design/AUTH.md, "How login works"): the IdP's configuration, the authorization
// request with PKCE, the code exchange as a confidential client and the ID token check. Nothing here keeps a token:
// the access token is used at most once (the userinfo fallback below) and dropped; no refresh token is asked for.
import { jwtVerify, type JWTPayload } from "jose";
import { CLOCK_TOLERANCE_S, isKeySetUnavailable, remoteKeySet } from "./jwks";

// "unavailable": the IdP did not answer (the user must not be told to log in again, the page says try later);
// "misconfigured": our settings are wrong; "failed": this login attempt is not valid.
export type OidcFailure = "unavailable" | "misconfigured" | "failed";
export class OidcError extends Error {
  constructor(
    public kind: OidcFailure,
    // A short code for the Worker log; never a token, an e-mail or the IdP's answer body.
    public reason: string,
  ) {
    super(`${kind}:${reason}`);
  }
}

export type OidcConfig = { issuer: string; clientId: string; clientSecret: string; sessionKey: Uint8Array };

// http only for a loopback issuer: the mock IdP the browser suite starts next to the local Workers (e2e/mock-oidc.mjs).
function issuerOk(u: URL): boolean {
  if (u.protocol === "https:") return true;
  return u.protocol === "http:" && (u.hostname === "127.0.0.1" || u.hostname === "localhost");
}

function b64decode(s: string): Uint8Array | null {
  try {
    const bin = atob(s.trim());
    return Uint8Array.from(bin, (ch) => ch.charCodeAt(0));
  } catch {
    return null;
  }
}

// Fails closed: a half-set login must not run, and no default stands in for a missing secret.
export function oidcConfig(env: Env): OidcConfig {
  const issuer = (env.OIDC_ISSUER ?? "").replace(/\/+$/, "");
  let u: URL;
  try {
    u = new URL(issuer);
  } catch {
    throw new OidcError("misconfigured", "issuer");
  }
  if (!issuerOk(u) || u.search || u.hash) throw new OidcError("misconfigured", "issuer");
  if (!env.OIDC_CLIENT_ID) throw new OidcError("misconfigured", "client_id");
  if (!env.OIDC_CLIENT_SECRET) throw new OidcError("misconfigured", "client_secret");
  // 32 random bytes, base64 (openssl rand -base64 32): the AES-256-GCM key of the login transaction cookies.
  const key = b64decode(env.SESSION_KEY ?? "");
  if (!key || key.length !== 32) throw new OidcError("misconfigured", "session_key");
  return { issuer, clientId: env.OIDC_CLIENT_ID, clientSecret: env.OIDC_CLIENT_SECRET, sessionKey: key };
}

export type Discovery = {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  jwks_uri: string;
  end_session_endpoint: string | null;
  userinfo_endpoint: string | null;
};

// One discovery document per issuer per isolate, refreshed hourly; a stale copy serves while the IdP is unreachable.
const DISCOVERY_TTL_MS = 3600_000;
const discoveries = new Map<string, { doc: Discovery; at: number }>();

export function clearDiscoveryCache() {
  discoveries.clear();
}

export async function discover(cfg: OidcConfig, now = Date.now()): Promise<Discovery> {
  const hit = discoveries.get(cfg.issuer);
  if (hit && now - hit.at < DISCOVERY_TTL_MS) return hit.doc;
  let raw: Record<string, unknown>;
  try {
    const r = await fetch(`${cfg.issuer}/.well-known/openid-configuration`, { signal: AbortSignal.timeout(5000), headers: { accept: "application/json" } });
    if (!r.ok) throw new Error(String(r.status));
    raw = (await r.json()) as Record<string, unknown>;
  } catch {
    if (hit) return hit.doc;
    throw new OidcError("unavailable", "discovery");
  }
  // The document must name this issuer (OpenID Connect Discovery 1.0, section 4.3), and every endpoint must live on the
  // issuer's own origin, so a wrong configuration cannot send the code or the client secret to another host.
  const origin = new URL(cfg.issuer).origin;
  const ep = (k: string, required: boolean): string | null => {
    const v = raw[k];
    if (typeof v !== "string") {
      if (required) throw new OidcError("misconfigured", `discovery_${k}`);
      return null;
    }
    let u: URL;
    try {
      u = new URL(v);
    } catch {
      throw new OidcError("misconfigured", `discovery_${k}`);
    }
    if (u.origin !== origin) throw new OidcError("misconfigured", `discovery_${k}`);
    return v;
  };
  if (typeof raw.issuer !== "string" || raw.issuer.replace(/\/+$/, "") !== cfg.issuer) throw new OidcError("misconfigured", "discovery_issuer");
  // Only S256: an IdP that announces methods without it would accept a plain challenge.
  const methods = raw.code_challenge_methods_supported;
  if (Array.isArray(methods) && !methods.includes("S256")) throw new OidcError("misconfigured", "discovery_pkce");
  const doc: Discovery = {
    issuer: raw.issuer,
    authorization_endpoint: ep("authorization_endpoint", true)!,
    token_endpoint: ep("token_endpoint", true)!,
    jwks_uri: ep("jwks_uri", true)!,
    end_session_endpoint: ep("end_session_endpoint", false),
    userinfo_endpoint: ep("userinfo_endpoint", false),
  };
  discoveries.set(cfg.issuer, { doc, at: now });
  return doc;
}

const b64url = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

// 32 random bytes as base64url (43 characters): state, nonce, PKCE verifier and session IDs.
export function randomToken(): string {
  return b64url(crypto.getRandomValues(new Uint8Array(32)));
}
export const TOKEN_SHAPE = /^[A-Za-z0-9_-]{43}$/;

export async function sha256(text: string): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)));
}
export async function sha256hex(text: string): Promise<string> {
  return [...(await sha256(text))].map((b) => b.toString(16).padStart(2, "0")).join("");
}
export const pkceChallenge = async (verifier: string) => b64url(await sha256(verifier));

export function authorizationUrl(
  d: Discovery,
  cfg: OidcConfig,
  p: { redirectUri: string; state: string; nonce: string; challenge: string; locale: string; promptLogin: boolean },
): string {
  const u = new URL(d.authorization_endpoint);
  const q = u.searchParams;
  q.set("response_type", "code");
  q.set("client_id", cfg.clientId);
  q.set("redirect_uri", p.redirectUri);
  // The e-mail links the first login to the provisioned person; the name comes from our own directory, so no profile.
  q.set("scope", "openid email");
  q.set("state", p.state);
  q.set("nonce", p.nonce);
  q.set("code_challenge", p.challenge);
  q.set("code_challenge_method", "S256");
  // The code comes back in the query of a top-level GET, which carries our SameSite=Lax transaction cookie; a form
  // post from the IdP's site would not.
  q.set("response_mode", "query");
  q.set("ui_locales", p.locale);
  if (p.promptLogin) q.set("prompt", "login");
  return u.toString();
}

// The code exchange as a confidential client (client_secret_basic, RFC 6749 section 2.3.1: both parts form-encoded).
export async function exchangeCode(d: Discovery, cfg: OidcConfig, p: { code: string; redirectUri: string; verifier: string }) {
  const basic = btoa(`${encodeURIComponent(cfg.clientId)}:${encodeURIComponent(cfg.clientSecret)}`);
  let r: Response;
  try {
    r = await fetch(d.token_endpoint, {
      method: "POST",
      signal: AbortSignal.timeout(10_000),
      headers: { authorization: `Basic ${basic}`, "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
      body: new URLSearchParams({ grant_type: "authorization_code", code: p.code, redirect_uri: p.redirectUri, code_verifier: p.verifier }),
    });
  } catch {
    throw new OidcError("unavailable", "token_network");
  }
  // A refused code (used twice, expired, wrong verifier) is this attempt's failure; a server error is the IdP's outage.
  if (r.status >= 500) throw new OidcError("unavailable", "token_5xx");
  if (!r.ok) throw new OidcError("failed", "token_refused");
  let body: { id_token?: unknown; access_token?: unknown };
  try {
    body = await r.json();
  } catch {
    throw new OidcError("failed", "token_body");
  }
  if (typeof body.id_token !== "string") throw new OidcError("failed", "no_id_token");
  return { idToken: body.id_token, accessToken: typeof body.access_token === "string" ? body.access_token : null };
}

export type VerifiedLogin = { issuer: string; subject: string; email: string | null; emailVerified: boolean };

// The ID token's signature against the IdP's keys, issuer, audience, expiry (30 s tolerance) and the nonce of this
// login. Only RS256, Zitadel's signing algorithm, so a token signed with a shared secret or "none" never passes.
export async function verifyIdToken(d: Discovery, cfg: OidcConfig, idToken: string, nonce: string): Promise<{ payload: JWTPayload } & VerifiedLogin> {
  let payload: JWTPayload;
  try {
    ({ payload } = await jwtVerify(idToken, remoteKeySet(d.jwks_uri), {
      issuer: d.issuer,
      audience: cfg.clientId,
      algorithms: ["RS256"],
      clockTolerance: CLOCK_TOLERANCE_S,
      requiredClaims: ["exp", "iat", "sub", "nonce"],
    }));
  } catch (e) {
    if (isKeySetUnavailable(e)) throw new OidcError("unavailable", "jwks");
    throw new OidcError("failed", "id_token");
  }
  if (payload.nonce !== nonce) throw new OidcError("failed", "nonce");
  // A token meant for several clients must name us as the party it was issued to (OpenID Connect Core, 3.1.3.7).
  const aud = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
  if ((aud.length > 1 || payload.azp !== undefined) && payload.azp !== cfg.clientId) throw new OidcError("failed", "azp");
  if (typeof payload.sub !== "string" || !payload.sub) throw new OidcError("failed", "sub");
  return { payload, ...claimsOf(payload), issuer: d.issuer, subject: payload.sub };
}

function claimsOf(p: Record<string, unknown>): { email: string | null; emailVerified: boolean } {
  const email = typeof p.email === "string" && p.email.trim() ? p.email.trim().toLowerCase() : null;
  return { email, emailVerified: p.email_verified === true };
}

// Zitadel puts the e-mail into the ID token only when the app's "User Info inside ID Token" setting is on. Without it,
// the e-mail comes from the userinfo endpoint once, with the access token of this login, which is then dropped. The
// answer counts only for the same subject (OpenID Connect Core, 5.3.2).
export async function userinfoEmail(d: Discovery, accessToken: string, subject: string): Promise<{ email: string | null; emailVerified: boolean }> {
  if (!d.userinfo_endpoint) return { email: null, emailVerified: false };
  let r: Response;
  try {
    r = await fetch(d.userinfo_endpoint, { signal: AbortSignal.timeout(5000), headers: { authorization: `Bearer ${accessToken}`, accept: "application/json" } });
  } catch {
    throw new OidcError("unavailable", "userinfo_network");
  }
  if (r.status >= 500) throw new OidcError("unavailable", "userinfo_5xx");
  if (!r.ok) throw new OidcError("failed", "userinfo_refused");
  const body = (await r.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || body.sub !== subject) throw new OidcError("failed", "userinfo_sub");
  return claimsOf(body);
}

// The IdP's logout with the hint of this login and our registered address to come back to; null when the IdP has no
// end-session endpoint or the hint is gone, and the caller goes home instead.
export function endSessionUrl(d: Discovery, cfg: OidcConfig, idToken: string | null, postLogout: string): string | null {
  if (!d.end_session_endpoint || !idToken) return null;
  const u = new URL(d.end_session_endpoint);
  u.searchParams.set("id_token_hint", idToken);
  u.searchParams.set("post_logout_redirect_uri", postLogout);
  u.searchParams.set("client_id", cfg.clientId);
  return u.toString();
}
