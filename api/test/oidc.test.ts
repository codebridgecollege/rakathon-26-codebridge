// The login in the Worker (docs/design/AUTH.md, "How login works" and "Tests"), against a fake IdP with generated keys:
// discovery, keys and the token endpoint are answered by a mocked fetch, and the fake checks the client secret, the
// redirect address and the PKCE verifier the way an IdP does, and gives every code out once.
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { env } from "cloudflare:workers";
import { exportJWK, generateKeyPair, SignJWT, type CryptoKey, type JWK } from "jose";
import { call, mockFetch, ORIGIN, testEnv } from "./helpers";
import { loadFixture } from "./data";
import { clearDiscoveryCache, sha256hex } from "../src/auth/oidc";
import { parseCatalog } from "../src/auth/pages";
import { safeReturnPath, sweepSessions } from "../src/auth/session";
import { actorFor } from "../src/store/audio";

const ISS = "https://idp.test";
const CLIENT = "client-1";
const SECRET = "secret-1";
const KEY_B64 = btoa(String.fromCharCode(...new Uint8Array(32).map((_, i) => i + 1)));
const KID = "k1";
const E = (over: Record<string, unknown> = {}) =>
  testEnv({ AUTH_MODE: "oidc", OIDC_ISSUER: ISS, OIDC_CLIENT_ID: CLIENT, OIDC_CLIENT_SECRET: SECRET, SESSION_KEY: KEY_B64, ...over });

let key: CryptoKey;
let otherKey: CryptoKey;
let jwk: JWK;

beforeAll(async () => {
  const pair = await generateKeyPair("RS256", { extractable: true });
  key = pair.privateKey;
  jwk = { ...(await exportJWK(pair.publicKey)), kid: KID, alg: "RS256", use: "sig" };
  otherKey = (await generateKeyPair("RS256", { extractable: true })).privateKey;
});

type Claims = Record<string, unknown>;
type Grant = { nonce: string; challenge: string; redirect: string; claims: Claims; used: boolean; sign?: (c: Claims) => Promise<string> };

// The fake IdP's state for one test.
let grants: Map<string, Grant>;
let keysUp: boolean;
let userinfo: Claims | null;
let tokenCalls: Request[];

async function idToken(c: Claims, signWith = key, alg = "RS256") {
  const { iss = ISS, aud = CLIENT, exp = "5m", ...rest } = c;
  return new SignJWT(rest)
    .setProtectedHeader({ alg, kid: KID })
    .setIssuer(iss as string)
    .setAudience(aud as string | string[])
    .setIssuedAt()
    .setExpirationTime(exp as string | number)
    .sign(signWith);
}

const b64url = (b: Uint8Array) => btoa(String.fromCharCode(...b)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
async function s256(v: string) {
  return b64url(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(v))));
}

function idp() {
  return mockFetch(async (req) => {
    const u = new URL(req.url);
    if (u.origin !== ISS) return new Response("unexpected host", { status: 599 });
    if (u.pathname === "/.well-known/openid-configuration")
      return Response.json({
        issuer: ISS,
        authorization_endpoint: `${ISS}/authorize`,
        token_endpoint: `${ISS}/token`,
        jwks_uri: `${ISS}/keys`,
        userinfo_endpoint: `${ISS}/userinfo`,
        end_session_endpoint: `${ISS}/end_session`,
        code_challenge_methods_supported: ["S256"],
      });
    if (u.pathname === "/keys") return keysUp ? Response.json({ keys: [jwk] }) : new Response("down", { status: 503 });
    if (u.pathname === "/token") {
      tokenCalls.push(req.clone());
      if (req.headers.get("authorization") !== `Basic ${btoa(`${CLIENT}:${SECRET}`)}`) return Response.json({ error: "invalid_client" }, { status: 401 });
      const f = new URLSearchParams(new TextDecoder().decode(await req.arrayBuffer()));
      const g = grants.get(f.get("code") ?? "");
      if (!g || g.used || f.get("grant_type") !== "authorization_code" || f.get("redirect_uri") !== g.redirect) return Response.json({ error: "invalid_grant" }, { status: 400 });
      if ((await s256(f.get("code_verifier") ?? "")) !== g.challenge) return Response.json({ error: "invalid_grant" }, { status: 400 });
      g.used = true;
      const claims = { nonce: g.nonce, ...g.claims };
      return Response.json({ id_token: g.sign ? await g.sign(claims) : await idToken(claims), access_token: "at-1", token_type: "Bearer" });
    }
    if (u.pathname === "/userinfo") return userinfo ? Response.json(userinfo) : new Response("no", { status: 401 });
    return new Response("not found", { status: 404 });
  });
}

const setCookies = (r: Response) => r.headers.getSetCookie();
const cookieValue = (r: Response, name: string) => {
  const c = setCookies(r).find((x) => x.startsWith(`${name}=`));
  return c ? c.slice(name.length + 1).split(";")[0]! : null;
};

type Started = { state: string; nonce: string; challenge: string; redirect: string; txName: string; txValue: string; location: URL };
async function startLogin(query = "to=%2Fpatients", env = E()): Promise<Started> {
  const r = await call(`/auth/login?${query}`, {}, env);
  expect(r.status).toBe(302);
  const location = new URL(r.headers.get("location")!);
  const q = location.searchParams;
  const state = q.get("state")!;
  const txName = `__Host-cb_tx_${state}`;
  return { state, nonce: q.get("nonce")!, challenge: q.get("code_challenge")!, redirect: q.get("redirect_uri")!, txName, txValue: cookieValue(r, txName)!, location };
}

// The user logs in at the fake IdP, which then sends the browser to the callback with a fresh code.
function issue(s: Started, claims: Claims = {}, sign?: Grant["sign"]) {
  const code = crypto.randomUUID();
  grants.set(code, { nonce: s.nonce, challenge: s.challenge, redirect: s.redirect, claims: { sub: "sub-lekar1", email: "lekar1.a@codebridge.demo", email_verified: true, ...claims }, used: false, sign });
  return code;
}

const callback = (s: Started, code: string, extraCookie = "", env = E()) =>
  call(`/auth/callback?code=${encodeURIComponent(code)}&state=${s.state}`, { headers: { cookie: `${s.txName}=${s.txValue}${extraCookie}` } }, env);

async function login(claims: Claims = {}, query = "to=%2Fpatients") {
  const s = await startLogin(query);
  const r = await callback(s, issue(s, claims));
  return { r, sid: cookieValue(r, "__Host-cb_session") };
}

const withSession = (sid: string | null, init: RequestInit = {}) => {
  const h = new Headers(init.headers);
  h.set("cookie", `__Host-cb_session=${sid}`);
  return { ...init, headers: h };
};
const me = (sid: string | null) => call("/api/me", withSession(sid), E());
const q1 = <T>(sql: string, ...args: unknown[]) => env.DB.prepare(sql).bind(...args).first<T>();
const all = async <T>(sql: string, ...args: unknown[]) => (await env.DB.prepare(sql).bind(...args).all<T>()).results;
const sessions = () => all<{ id_hash: string; user_id: string; org_id: string; membership_id: string; acting_membership_id: string | null; id_token: string | null; created_at: string; expires_at: string; last_used_at: string }>("SELECT * FROM auth_sessions");
const post = (path: string, sid: string | null, body: unknown) =>
  call(path, withSession(sid, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }), E());

beforeEach(async () => {
  await loadFixture();
  clearDiscoveryCache();
  grants = new Map();
  keysUp = true;
  userinfo = null;
  tokenCalls = [];
  // The demo accounts of the seed: e-mails on two doctors, the coordinator and the administrator of org A, and one
  // doctor of org B. A hospital org (idle limit 60 minutes) where d2p1 also works, so one person has two orgs.
  await env.DB.batch([
    env.DB.prepare(
      `UPDATE users SET email = CASE id WHEN 'd2p1' THEN 'lekar1.a@codebridge.demo' WHEN 'd1p1' THEN 'lekar2.a@codebridge.demo'
         WHEN 'coord' THEN 'koordinator.a@codebridge.demo' WHEN 'admin' THEN 'admin.a@codebridge.demo' WHEN 'b-doc' THEN 'lekar1.b@codebridge.demo' END
       WHERE id IN ('d2p1','d1p1','coord','admin','b-doc')`,
    ),
    env.DB.prepare("INSERT INTO orgs (id, name, short_name, is_demo, session_idle_min, case_id_prefix) VALUES ('hosp','Nemocnice H','H',0,60,'H-')"),
    env.DB.prepare("INSERT INTO demo_state (org_id, data_epoch) VALUES ('hosp', 1)"),
    env.DB.prepare("INSERT INTO memberships (id, org_id, user_id, role_id, active_from) VALUES ('h-d2p1','hosp','d2p1','doctor','2026-01-01T00:00:00.000Z')"),
    env.DB.prepare("INSERT INTO users (id, pre, sur, email) VALUES ('nomember','MUDr.','Bezčlenný','nomember@codebridge.demo')"),
  ]);
  idp();
});

afterEach(() => vi.restoreAllMocks());

describe("GET /auth/login", () => {
  it("redirects to the IdP with the code flow, S256 PKCE, the query response mode and a fresh state and nonce", async () => {
    const s = await startLogin();
    const q = s.location.searchParams;
    expect(s.location.origin + s.location.pathname).toBe(`${ISS}/authorize`);
    expect(Object.fromEntries(q)).toMatchObject({
      response_type: "code",
      client_id: CLIENT,
      redirect_uri: `${ORIGIN}/auth/callback`,
      scope: "openid email",
      code_challenge_method: "S256",
      response_mode: "query",
      ui_locales: "cs",
    });
    expect(s.state).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(s.nonce).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(s.nonce).not.toBe(s.state);
    const again = await startLogin();
    expect(again.state).not.toBe(s.state);
  });

  it("keeps the transaction in an encrypted cookie named after the state, for ten minutes only", async () => {
    const r = await call("/auth/login?to=%2Fpatients", {}, E());
    const state = new URL(r.headers.get("location")!).searchParams.get("state")!;
    const c = setCookies(r).find((x) => x.startsWith(`__Host-cb_tx_${state}=`))!;
    expect(c).toMatch(/; Path=\/; HttpOnly; Secure; SameSite=Lax; Max-Age=600$/);
    expect(c).not.toMatch(/Domain=/i);
    // Neither the verifier nor the return path is readable in the cookie.
    expect(c).not.toContain("patients");
  });

  it("asks the IdP for its English page with ?lang=en and for Czech otherwise", async () => {
    expect((await startLogin("lang=en")).location.searchParams.get("ui_locales")).toBe("en");
    expect((await startLogin("lang=sk")).location.searchParams.get("ui_locales")).toBe("cs");
  });

  it("fails closed when a secret is missing, and says so on a fixed page", async () => {
    for (const over of [{ SESSION_KEY: "" }, { SESSION_KEY: btoa("short") }, { OIDC_CLIENT_SECRET: "" }, { OIDC_ISSUER: "http://idp.test" }]) {
      const r = await call("/auth/login", {}, E(over));
      expect(r.status).toBe(500);
      expect(await r.text()).toContain("Přihlášení není nastavené");
    }
  });

  it("answers 503 with a retry page when the IdP cannot be reached", async () => {
    vi.restoreAllMocks();
    mockFetch(() => new Response("down", { status: 502 }));
    const r = await call("/auth/login?to=%2Fcalendar", {}, E());
    expect(r.status).toBe(503);
    const html = await r.text();
    expect(html).toContain("Přihlašovací služba je nedostupná");
    expect(html).toContain('href="/auth/login?to=%2Fcalendar"');
  });

  it("only redirects in demo mode, where there is no login", async () => {
    const r = await call("/auth/login?to=%2Fcalendar", {}, testEnv());
    expect(r.status).toBe(302);
    expect(r.headers.get("location")).toBe("/calendar");
  });
});

describe("return paths (open redirect)", () => {
  it("accepts only a path on this host", () => {
    expect(safeReturnPath("/patient/10/labs?x=1#a")).toBe("/patient/10/labs?x=1#a");
    for (const bad of ["//evil.test", "/\\evil.test", "https://evil.test", "evil.test", "/\t/evil.test", "/\n/evil.test", "/ /x", "", null, undefined, "/auth/logout", "/AUTH/login?x", "/x\\y", "/x?q=Dvořák", "/x\u00a0y", "/" + "a".repeat(2001)])
      expect(safeReturnPath(bad as string)).toBe("/");
  });

  it("sends a login that asked for another host back to /", async () => {
    const { r } = await login({}, "to=%2F%2Fevil.test%2Fx");
    expect(r.status).toBe(303);
    expect(r.headers.get("location")).toBe("/");
  });
});

describe("GET /auth/callback", () => {
  it("links the first login by verified e-mail, sets the session cookie and returns to the path asked for", async () => {
    const { r, sid } = await login();
    expect(r.status).toBe(303);
    expect(r.headers.get("location")).toBe("/patients");
    const c = setCookies(r).find((x) => x.startsWith("__Host-cb_session="))!;
    expect(c).toMatch(/; Path=\/; HttpOnly; Secure; SameSite=Lax; Max-Age=43200$/);
    expect(sid).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(await q1("SELECT user_id FROM user_identities WHERE issuer = ?1 AND subject = 'sub-lekar1'", ISS)).toEqual({ user_id: "d2p1" });
    const res = await me(sid);
    expect(res.status).toBe(200);
    const body = await res.json<{ user: { id: string }; org: { id: string }; auth_mode: string; impersonating: boolean }>();
    expect(body).toMatchObject({ user: { id: "d2p1" }, org: { id: "demo-a" }, auth_mode: "oidc", impersonating: false });
  });

  it("stores only the hash of the session ID, with the login's lifetime of 12 hours", async () => {
    const { sid } = await login();
    const [s] = await sessions();
    expect(s!.id_hash).toBe(await sha256hex(sid!));
    expect(s!.id_hash).not.toContain(sid!);
    expect(Date.parse(s!.expires_at) - Date.parse(s!.created_at)).toBe(12 * 3600_000);
    expect(s!.id_token).toBeTruthy();
  });

  it("deletes the transaction cookie and keeps no access or refresh token", async () => {
    const s = await startLogin();
    const r = await callback(s, issue(s));
    expect(setCookies(r)).toContain(`${s.txName}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`);
    const row = JSON.stringify(await sessions());
    expect(row).not.toContain("at-1");
  });

  it("sends the code with the client secret, the same redirect address and the PKCE verifier", async () => {
    await login();
    const f = new URLSearchParams(new TextDecoder().decode(await tokenCalls[0]!.arrayBuffer()));
    expect(f.get("redirect_uri")).toBe(`${ORIGIN}/auth/callback`);
    expect(f.get("code_verifier")).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it("finds the person by issuer and subject on later logins, even with another e-mail", async () => {
    await login();
    const { sid } = await login({ email: "renamed@codebridge.demo" });
    expect((await (await me(sid)).json<{ user: { id: string } }>()).user.id).toBe("d2p1");
  });

  it("does not let a second account with the same e-mail take over a linked person", async () => {
    await login();
    const { r, sid } = await login({ sub: "sub-other" });
    expect(r.status).toBe(403);
    expect(sid).toBeNull();
  });

  const refused = async (claims: Claims, sign?: Grant["sign"]) => {
    const s = await startLogin();
    const r = await callback(s, issue(s, claims, sign));
    expect(cookieValue(r, "__Host-cb_session")).toBeNull();
    expect(await sessions()).toEqual([]);
    return r;
  };

  it("refuses a wrong issuer, audience or nonce, an expired token and a token signed with another key", async () => {
    for (const claims of [{ iss: "https://evil.test" }, { aud: "other-client" }, { nonce: "not-this-login" }, { exp: Math.floor(Date.now() / 1000) - 120 }]) {
      const r = await refused(claims);
      expect(r.status).toBe(400);
      expect(await r.text()).toContain("Přihlášení se nepodařilo");
    }
    expect((await refused({}, (c) => idToken(c, otherKey))).status).toBe(400);
  });

  it("accepts a token that expired within the 30 s clock tolerance", async () => {
    const { r } = await login({ exp: Math.floor(Date.now() / 1000) - 10 });
    expect(r.status).toBe(303);
  });

  it("refuses a token for several clients that does not name us as the authorized party", async () => {
    expect((await refused({ aud: [CLIENT, "other"] })).status).toBe(400);
    const { r } = await login({ aud: [CLIENT, "other"], azp: CLIENT });
    expect(r.status).toBe(303);
  });

  it("refuses an unverified e-mail with 'Nemáte přístup', and links nothing", async () => {
    for (const claims of [{ email_verified: false }, { email_verified: "true" }]) {
      const r = await refused(claims);
      expect(r.status).toBe(403);
      expect(await r.text()).toContain("Nemáte přístup");
    }
    expect(await all("SELECT * FROM user_identities")).toEqual([]);
  });

  it("takes the e-mail from userinfo, for the same subject only, when the ID token has none", async () => {
    userinfo = { sub: "sub-lekar1", email: "lekar1.a@codebridge.demo", email_verified: true };
    const { r } = await login({ email: undefined, email_verified: undefined });
    expect(r.status).toBe(303);
    await env.DB.prepare("DELETE FROM auth_sessions").run();
    userinfo = { sub: "someone-else", email: "lekar2.a@codebridge.demo", email_verified: true };
    expect((await refused({ sub: "sub-x", email: undefined, email_verified: undefined })).status).toBe(400);
  });

  it("shows 'Nemáte přístup' for a person who is not provisioned or has no active membership, and creates nothing", async () => {
    const before = await all("SELECT id FROM users ORDER BY id");
    for (const claims of [{ sub: "s-stranger", email: "stranger@example.test" }, { sub: "s-nomember", email: "nomember@codebridge.demo" }]) {
      const r = await refused(claims);
      expect(r.status).toBe(403);
      const html = await r.text();
      expect(html).toContain("Nemáte přístup");
      expect(html).toContain('href="/auth/login?prompt=login"');
    }
    await env.DB.prepare("UPDATE memberships SET active_until = '2026-02-01T00:00:00.000Z' WHERE id = 'b-doc'").run();
    expect((await refused({ sub: "s-bdoc", email: "lekar1.b@codebridge.demo" })).status).toBe(403);
    expect(await all("SELECT id FROM users ORDER BY id")).toEqual(before);
    expect(await all("SELECT * FROM user_identities")).toEqual([]);
  });

  it("refuses a replayed code and a replayed or missing state", async () => {
    const s = await startLogin();
    const code = issue(s);
    expect((await callback(s, code)).status).toBe(303);
    // The browser has deleted the cookie; a copy of it with the same code is refused by the IdP.
    const again = await callback(s, code);
    expect(again.status).toBe(400);
    // Without the transaction cookie, nothing is even sent to the IdP.
    const calls = tokenCalls.length;
    const bare = await call(`/auth/callback?code=x&state=${s.state}`, {}, E());
    expect(bare.status).toBe(400);
    expect(tokenCalls.length).toBe(calls);
    // Another login's cookie under this state's name does not open it.
    const other = await startLogin();
    const swapped = await call(`/auth/callback?code=${issue(s)}&state=${s.state}`, { headers: { cookie: `${s.txName}=${other.txValue}` } }, E());
    expect(swapped.status).toBe(400);
    expect((await call("/auth/callback?code=x&state=../x", {}, E())).status).toBe(400);
  });

  it("refuses a wrong PKCE verifier (a transaction made for another challenge)", async () => {
    const s = await startLogin();
    const code = issue(s);
    grants.get(code)!.challenge = "a".repeat(43);
    expect((await callback(s, code)).status).toBe(400);
  });

  it("completes two logins started in parallel, each with its own cookie", async () => {
    const a = await startLogin("to=%2Fcalendar");
    const b = await startLogin("to=%2Ftasks");
    const rb = await callback(b, issue(b));
    const ra = await callback(a, issue(a));
    expect([ra.status, rb.status]).toEqual([303, 303]);
    expect([ra.headers.get("location"), rb.headers.get("location")]).toEqual(["/calendar", "/tasks"]);
  });

  it("shows the IdP's own refusal on the fixed page with a retry link, without asking for a token", async () => {
    const s = await startLogin("to=%2Fcalendar");
    const r = await call(`/auth/callback?error=access_denied&state=${s.state}`, { headers: { cookie: `${s.txName}=${s.txValue}` } }, E());
    expect(r.status).toBe(400);
    expect(await r.text()).toContain('href="/auth/login?to=%2Fcalendar"');
    expect(tokenCalls).toEqual([]);
  });

  it("answers 503, not 'log in again', when the IdP's keys cannot be fetched", async () => {
    keysUp = false;
    // Another key set URL than the other tests, so jose's cache of the working one does not answer.
    vi.restoreAllMocks();
    const iss2 = "https://idp2.test";
    mockFetch(async (req) => {
      const u = new URL(req.url);
      if (u.pathname === "/.well-known/openid-configuration")
        return Response.json({ issuer: iss2, authorization_endpoint: `${iss2}/authorize`, token_endpoint: `${iss2}/token`, jwks_uri: `${iss2}/keys` });
      if (u.pathname === "/token") return Response.json({ id_token: await idToken({ iss: iss2, sub: "s", nonce: "n" }) });
      return new Response("down", { status: 503 });
    });
    const env2 = E({ OIDC_ISSUER: iss2 });
    const s = await startLogin("", env2);
    const r = await callback(s, "code", "", env2);
    expect(r.status).toBe(503);
    expect(await r.text()).toContain("Přihlašovací služba je nedostupná");
  });

  it("issues a new session ID at every login and ends the one the browser had", async () => {
    const first = await login();
    const s = await startLogin();
    const r = await callback(s, issue(s), `; __Host-cb_session=${first.sid}`);
    const second = cookieValue(r, "__Host-cb_session");
    expect(second).not.toBe(first.sid);
    expect((await me(first.sid)).status).toBe(401);
    expect((await me(second)).status).toBe(200);
  });

  it("ends a login in a second window on the 'done' page instead of redirecting", async () => {
    const s = await startLogin("popup=1");
    const r = await callback(s, issue(s));
    expect(r.status).toBe(200);
    expect(await r.text()).toContain("Přihlášení obnoveno");
    expect(cookieValue(r, "__Host-cb_session")).toBeTruthy();
  });

  it("writes a login row in the access log with the real person and no e-mail", async () => {
    await login();
    const rows = await all<{ actor_user_id: string; action: string; auth_mode: string; what_cs: string }>("SELECT * FROM access_log WHERE action = 'session.login'");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ actor_user_id: "d2p1", auth_mode: "oidc" });
    expect(JSON.stringify(rows)).not.toContain("@");
  });

  it("serves its pages without scripts, framing or caching, in the language of the login", async () => {
    const s = await startLogin("lang=en");
    const r = await call(`/auth/callback?error=x&state=${s.state}`, { headers: { cookie: `${s.txName}=${s.txValue}` } }, E());
    expect(r.headers.get("content-security-policy")).toContain("default-src 'none'");
    expect(r.headers.get("content-security-policy")).toContain("frame-ancestors 'none'");
    expect(r.headers.get("cache-control")).toBe("no-store");
    const html = await r.text();
    expect(html).toContain('<html lang="en">');
    expect(html).toContain("Sign-in failed");
    expect(html).not.toContain("<script");
  });
});

describe("sessions", () => {
  it("answers 401 without a session, with an unknown one, and in OIDC mode ignores X-Demo-User", async () => {
    expect((await call("/api/me", {}, E())).status).toBe(401);
    expect((await me("A".repeat(43))).status).toBe(401);
    expect((await call("/api/me", { headers: { "X-Demo-User": "admin" } }, E())).status).toBe(401);
    const { sid } = await login();
    const r = await call("/api/me", withSession(sid, { headers: { "X-Demo-User": "admin" } }), E());
    expect((await r.json<{ user: { id: string } }>()).user.id).toBe("d2p1");
  });

  it("ends a session after 12 hours", async () => {
    const { sid } = await login();
    await env.DB.prepare("UPDATE auth_sessions SET expires_at = ?1").bind(new Date(Date.now() - 1000).toISOString()).run();
    expect((await me(sid)).status).toBe(401);
  });

  it("ends a hospital org's session after an hour idle, and not a demo org's", async () => {
    const { sid } = await login();
    const twoHoursAgo = new Date(Date.now() - 2 * 3600_000).toISOString();
    await env.DB.prepare("UPDATE auth_sessions SET last_used_at = ?1").bind(twoHoursAgo).run();
    expect((await me(sid)).status).toBe(200);
    const r = await post("/api/session/org", sid, { org_id: "hosp" });
    const hosp = cookieValue(r, "__Host-cb_session");
    expect((await me(hosp)).status).toBe(200);
    await env.DB.prepare("UPDATE auth_sessions SET last_used_at = ?1").bind(new Date(Date.now() - 61 * 60_000).toISOString()).run();
    expect((await me(hosp)).status).toBe(401);
  });

  it("writes the last-used time at most every five minutes", async () => {
    const { sid } = await login();
    const fourMin = new Date(Date.now() - 4 * 60_000).toISOString();
    await env.DB.prepare("UPDATE auth_sessions SET last_used_at = ?1").bind(fourMin).run();
    await me(sid);
    expect((await sessions())[0]!.last_used_at).toBe(fourMin);
    const sixMin = new Date(Date.now() - 6 * 60_000).toISOString();
    await env.DB.prepare("UPDATE auth_sessions SET last_used_at = ?1").bind(sixMin).run();
    await me(sid);
    expect(Date.parse((await sessions())[0]!.last_used_at)).toBeGreaterThan(Date.now() - 60_000);
  });

  it("stops acting with a membership ended in the app at the next request", async () => {
    const { sid } = await login();
    await env.DB.prepare("UPDATE memberships SET active_until = '2026-02-01T00:00:00.000Z' WHERE id = 'd2p1'").run();
    expect((await me(sid)).status).toBe(401);
  });

  it("refuses an audit-writing read from another site, and writes no log row for it", async () => {
    const { sid } = await login();
    const before = (await all("SELECT id FROM access_log")).length;
    for (const site of ["cross-site", "same-site"]) {
      const r = await call("/api/cases/NO-A", withSession(sid, { headers: { "sec-fetch-site": site } }), E());
      expect(r.status).toBe(403);
    }
    expect((await all("SELECT id FROM access_log")).length).toBe(before);
    const ok = await call("/api/cases/NO-A", withSession(sid, { headers: { "sec-fetch-site": "same-origin" } }), E());
    expect(ok.status).toBe(200);
  });

  it("clears the ID token of an expired session at once and deletes the row 30 days after it expired", async () => {
    await login();
    await login({ sub: "sub-b", email: "lekar1.b@codebridge.demo" });
    const now = Date.now();
    await env.DB.prepare("UPDATE auth_sessions SET expires_at = ?1 WHERE org_id = 'demo-a'").bind(new Date(now - 31 * 24 * 3600_000).toISOString()).run();
    await env.DB.prepare("UPDATE auth_sessions SET expires_at = ?1 WHERE org_id = 'demo-b'").bind(new Date(now - 3600_000).toISOString()).run();
    await sweepSessions(env.DB, now);
    const rows = await sessions();
    expect(rows.map((r) => [r.org_id, r.id_token])).toEqual([["demo-b", null]]);
  });

  it("clears the ID token of a session that ended by the idle limit", async () => {
    const { sid } = await login();
    const h = cookieValue(await post("/api/session/org", sid, { org_id: "hosp" }), "__Host-cb_session");
    expect(h).toBeTruthy();
    await env.DB.prepare("UPDATE auth_sessions SET last_used_at = ?1").bind(new Date(Date.now() - 61 * 60_000).toISOString()).run();
    await sweepSessions(env.DB);
    expect((await sessions()).map((r) => r.id_token)).toEqual([null]);
  });

  it("keeps one identity per person and IdP in the database", async () => {
    await login();
    await expect(env.DB.prepare("INSERT INTO user_identities (issuer, subject, user_id, created_at) VALUES (?1, 'other', 'd2p1', '2026-10-19T00:00:00.000Z')").bind(ISS).run()).rejects.toThrow(/UNIQUE/);
  });
});

describe("POST /auth/logout", () => {
  it("deletes the session, clears the cookie and goes to the IdP's logout with the ID token hint", async () => {
    const { sid } = await login();
    const idTok = (await sessions())[0]!.id_token!;
    const r = await call("/auth/logout", withSession(sid, { method: "POST" }), E());
    expect(r.status).toBe(200);
    expect(setCookies(r)).toContain("__Host-cb_session=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0");
    const next = new URL((await r.json<{ redirect: string }>()).redirect);
    expect(next.origin + next.pathname).toBe(`${ISS}/end_session`);
    expect(next.searchParams.get("id_token_hint")).toBe(idTok);
    expect(next.searchParams.get("post_logout_redirect_uri")).toBe(`${ORIGIN}/`);
    expect(await sessions()).toEqual([]);
    expect((await me(sid)).status).toBe(401);
  });

  it("refuses a logout from another site (CSRF)", async () => {
    const { sid } = await login();
    const r = await call("/auth/logout", withSession(sid, { method: "POST", headers: { origin: "https://evil.test" } }), E());
    expect(r.status).toBe(403);
    expect(await sessions()).toHaveLength(1);
  });

  it("goes home without a session", async () => {
    const r = await call("/auth/logout", { method: "POST" }, E());
    expect(await r.json()).toEqual({ redirect: "/" });
  });
});

describe("org and role switch", () => {
  it("switches org with a new session ID, keeping the login's end, only into the person's own memberships", async () => {
    const { sid } = await login();
    const [before] = await sessions();
    expect((await post("/api/session/org", sid, { org_id: "demo-b" })).status).toBe(404);
    const r = await post("/api/session/org", sid, { org_id: "hosp" });
    expect(r.status).toBe(200);
    const next = cookieValue(r, "__Host-cb_session")!;
    expect(next).not.toBe(sid);
    expect((await me(sid)).status).toBe(401);
    const body = await (await me(next)).json<{ org: { id: string }; membership_id: string; memberships: { org: { id: string } }[]; role_switch: unknown }>();
    expect(body.org.id).toBe("hosp");
    expect(body.membership_id).toBe("h-d2p1");
    expect(body.memberships.map((m) => m.org.id)).toEqual(["demo-a", "hosp"]);
    // A hospital org has no role switch.
    expect(body.role_switch).toBeNull();
    const [after] = await sessions();
    expect(after!.expires_at).toBe(before!.expires_at);
    expect(after!.created_at).toBe(before!.created_at);
  });

  it("switches role in a demo org: the session acts as the other membership, the access log keeps the real person", async () => {
    const { sid } = await login({ sub: "sub-admin", email: "admin.a@codebridge.demo" });
    const offered = (await (await me(sid)).json<{ role_switch: { membership_id: string; own: boolean }[] }>()).role_switch!;
    expect(offered.map((m) => m.membership_id).sort()).toEqual(["admin", "coord", "d1p1", "d2p1"]);
    expect(offered.find((m) => m.own)!.membership_id).toBe("admin");
    const r = await post("/api/session/role", sid, { membership_id: "d2p1" });
    expect(r.status).toBe(200);
    const next = cookieValue(r, "__Host-cb_session")!;
    expect((await me(sid)).status).toBe(401);
    const body = await (await me(next)).json<{ user: { id: string; role: string }; impersonating: boolean; real_user: { id: string } }>();
    expect(body).toMatchObject({ user: { id: "d2p1", role: "doctor" }, impersonating: true, real_user: { id: "admin" } });
    // A read as the doctor: the row names the administrator who acts, the doctor's membership and impersonating = 1.
    expect((await call("/api/cases/NO-A", withSession(next), E())).status).toBe(200);
    const row = await q1<{ actor_user_id: string; acted_as_role: string; acted_as_membership: string; impersonating: number; auth_mode: string }>(
      "SELECT * FROM access_log WHERE action = 'case.open' ORDER BY id DESC LIMIT 1",
    );
    expect(row).toMatchObject({ actor_user_id: "admin", acted_as_role: "doctor", acted_as_membership: "d2p1", impersonating: 1, auth_mode: "oidc" });
    const sw = await q1<{ actor_user_id: string; impersonating: number }>("SELECT * FROM access_log WHERE action = 'session.role'");
    expect(sw).toMatchObject({ actor_user_id: "admin", impersonating: 1 });
    // And back to oneself.
    const back = cookieValue(await post("/api/session/role", next, { membership_id: "admin" }), "__Host-cb_session");
    expect(await (await me(back)).json()).toMatchObject({ user: { id: "admin" }, impersonating: false, real_user: null });
  });

  it("refuses a role switch to another org's membership, to a membership without a demo account, and in a hospital org", async () => {
    const { sid } = await login({ sub: "sub-admin", email: "admin.a@codebridge.demo" });
    for (const membership_id of ["b-doc", "gone", "nobody"]) expect((await post("/api/session/role", sid, { membership_id })).status).toBe(404);
    await env.DB.prepare("UPDATE users SET email = NULL WHERE id = 'd1p1'").run();
    expect((await post("/api/session/role", sid, { membership_id: "d1p1" })).status).toBe(404);
    const h = cookieValue(await post("/api/session/org", (await login()).sid, { org_id: "hosp" }), "__Host-cb_session");
    expect((await post("/api/session/role", h, { membership_id: "h-d2p1" })).status).toBe(403);
    expect((await sessions()).filter((s) => s.acting_membership_id)).toEqual([]);
  });

  it("drops the role switch when the org stops being a demo org", async () => {
    const { sid } = await login({ sub: "sub-admin", email: "admin.a@codebridge.demo" });
    const next = cookieValue(await post("/api/session/role", sid, { membership_id: "d2p1" }), "__Host-cb_session");
    expect((await me(next)).status).toBe(200);
    await env.DB.prepare("UPDATE orgs SET is_demo = 0 WHERE id = 'demo-a'").run();
    expect((await me(next)).status).toBe(401);
  });

  it("drops the role switch when the membership acted as ends", async () => {
    const { sid } = await login({ sub: "sub-admin", email: "admin.a@codebridge.demo" });
    const next = cookieValue(await post("/api/session/role", sid, { membership_id: "d2p1" }), "__Host-cb_session");
    await env.DB.prepare("UPDATE memberships SET active_until = '2026-02-01T00:00:00.000Z' WHERE id = 'd2p1'").run();
    expect((await me(next)).status).toBe(401);
  });

  it("keeps the real person on work that finishes later (phone upload, Workflows, sweeps) after a role switch", async () => {
    const { sid } = await login({ sub: "sub-admin", email: "admin.a@codebridge.demo" });
    const next = cookieValue(await post("/api/session/role", sid, { membership_id: "d2p1" }), "__Host-cb_session");
    const r = await call(
      "/api/upload-sessions",
      withSession(next, { method: "POST", headers: { "content-type": "application/json", "x-data-epoch": "1" }, body: JSON.stringify({ case_id: "NO-A", target: "documents" }) }),
      E(),
    );
    expect(r.status).toBe(201);
    expect(await q1("SELECT created_by, created_by_actor FROM upload_sessions")).toEqual({ created_by: "d2p1", created_by_actor: "admin" });
    // What a Workflow, the cron sweep and the phone build from such a row.
    const v = await actorFor(env.DB, "demo-a", "d2p1", "oidc", "admin");
    expect(v).toMatchObject({ id: "d2p1", role: "doctor", impersonating: true, actor: { id: "admin", name: "Ing. Kovář" } });
    expect(await actorFor(env.DB, "demo-a", "d2p1", "oidc", null)).toMatchObject({ impersonating: false });
  });

  it("refuses a tab that still shows another identity after a switch in a second tab (409 session_changed)", async () => {
    const { sid } = await login({ sub: "sub-admin", email: "admin.a@codebridge.demo" });
    const shows = (sid2: string | null, who: string) => call("/api/patients", withSession(sid2, { headers: { "x-acting-as": who } }), E());
    expect((await shows(sid, "admin:admin")).status).toBe(200);
    const next = cookieValue(await post("/api/session/role", sid, { membership_id: "d2p1" }), "__Host-cb_session");
    const r = await shows(next, "admin:admin");
    expect(r.status).toBe(409);
    expect((await r.json<{ error: { code: string } }>()).error.code).toBe("session_changed");
    expect((await shows(next, "d2p1:admin")).status).toBe(200);
    // The doctor's own login acts as the same membership, but is another person.
    expect((await shows((await login()).sid, "d2p1:admin")).status).toBe(409);
  });

  it("stops the speech and summary routes too once the membership ended", async () => {
    const { sid } = await login();
    await env.DB.prepare("UPDATE memberships SET active_until = '2026-02-01T00:00:00.000Z' WHERE id = 'd2p1'").run();
    const r = await call("/api/stt/token", withSession(sid, { method: "POST" }), E());
    expect(r.status).toBe(401);
  });

  it("refuses switches from another site and in demo mode", async () => {
    const { sid } = await login();
    const r = await call("/api/session/org", withSession(sid, { method: "POST", headers: { "content-type": "application/json", origin: "https://evil.test" }, body: '{"org_id":"hosp"}' }), E());
    expect(r.status).toBe(403);
    const role = await call("/api/session/role", withSession(sid, { method: "POST", headers: { "content-type": "application/json", origin: "https://evil.test" }, body: '{"membership_id":"admin"}' }), E());
    expect(role.status).toBe(403);
    const demo = await call("/api/session/org", { method: "POST", headers: { "content-type": "application/json" }, body: '{"org_id":"demo-b"}' }, testEnv());
    expect(demo.status).toBe(404);
  });
});

describe("the login pages' catalogs", () => {
  it("parses every message of auth.ftl in Czech, Slovak and English, all with the same IDs", async () => {
    // The Worker reads a subset of Fluent: one line per message, no placeables (src/auth/pages.ts).
    const { default: cs } = await import("../../i18n/cs/auth.ftl");
    const { default: sk } = await import("../../i18n/sk/auth.ftl");
    const { default: en } = await import("../../i18n/en/auth.ftl");
    const ids = (t: string) => [...parseCatalog(t).keys()].sort();
    expect(ids(cs).length).toBeGreaterThan(10);
    expect(ids(sk)).toEqual(ids(cs));
    expect(ids(en)).toEqual(ids(cs));
    for (const t of [cs, sk, en]) {
      const messages = t.split("\n").filter((l) => /^[a-z]/.test(l));
      expect(messages.length).toBe(ids(t).length);
      for (const v of parseCatalog(t).values()) expect(v).not.toMatch(/[{}]/);
    }
  });
});
