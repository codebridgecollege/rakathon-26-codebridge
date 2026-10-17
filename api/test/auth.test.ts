import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { exportJWK, generateKeyPair, SignJWT, type CryptoKey, type JWK } from "jose";
import { call, mockFetch, testEnv } from "./helpers";

const TEAM = "https://team.cloudflareaccess.com";
const AUD = "app-aud-tag";
const KID = "test-kid";

let key: CryptoKey;
let otherKey: CryptoKey;
let jwk: JWK;

beforeAll(async () => {
  const pair = await generateKeyPair("RS256", { extractable: true });
  key = pair.privateKey;
  jwk = { ...(await exportJWK(pair.publicKey)), kid: KID, alg: "RS256", use: "sig" };
  otherKey = (await generateKeyPair("RS256", { extractable: true })).privateKey;
});

afterEach(() => vi.restoreAllMocks());

// Serves the team's JWKS and a token for the ElevenLabs call behind /api/stt/token.
function upstream() {
  return mockFetch((req) => {
    if (req.url === `${TEAM}/cdn-cgi/access/certs`) return Response.json({ keys: [jwk] });
    return Response.json({ token: "tok" });
  });
}

type Claims = { iss?: string; aud?: string; sub?: string; email?: string; exp?: number | string };
async function token(c: Claims = {}, signWith?: CryptoKey) {
  const t = new SignJWT({ email: c.email ?? "Doktor@Example.cz" })
    .setProtectedHeader({ alg: "RS256", kid: KID })
    .setIssuer(c.iss ?? TEAM)
    .setAudience(c.aud ?? AUD)
    .setSubject(c.sub ?? "user-123")
    .setIssuedAt()
    .setExpirationTime(c.exp ?? "5m");
  return t.sign(signWith ?? key);
}

const accessEnv = (over: Record<string, unknown> = {}) =>
  testEnv({ AUTH_MODE: "access", ACCESS_TEAM_DOMAIN: TEAM, ACCESS_AUD: AUD, ...over });

const tokenCall = (jwt: string | null, env = accessEnv()) =>
  call("/api/stt/token", { method: "POST", headers: jwt ? { "cf-access-jwt-assertion": jwt } : {} }, env);

const code = async (res: Response) => (await res.json<{ error: { code: string } }>()).error.code;

describe("auth in access mode", () => {
  it("accepts a valid token and limits per user sub", async () => {
    upstream();
    const keys: string[] = [];
    const env = accessEnv({ RL_STT_TOKEN: { limit: async ({ key }: { key: string }) => (keys.push(key), { success: true }) } });
    const res = await tokenCall(await token(), env);
    expect(res.status).toBe(200);
    expect(keys).toEqual(["u:user-123"]);
  });

  it("refuses a missing token", async () => {
    upstream();
    const res = await tokenCall(null);
    expect(res.status).toBe(401);
    expect(await code(res)).toBe("unauthenticated");
  });

  it("refuses a wrong audience", async () => {
    upstream();
    expect((await tokenCall(await token({ aud: "other-app" }))).status).toBe(401);
  });

  it("refuses a wrong issuer", async () => {
    upstream();
    expect((await tokenCall(await token({ iss: "https://evil.cloudflareaccess.com" }))).status).toBe(401);
  });

  it("refuses an expired token beyond the clock tolerance", async () => {
    upstream();
    const past = Math.floor(Date.now() / 1000) - 120;
    expect((await tokenCall(await token({ exp: past }))).status).toBe(401);
  });

  it("refuses a token signed by another key", async () => {
    upstream();
    expect((await tokenCall(await token({}, otherKey))).status).toBe(401);
  });

  it("refuses an HS256 token", async () => {
    upstream();
    const hs = await new SignJWT({ email: "a@b.cz" })
      .setProtectedHeader({ alg: "HS256", kid: KID })
      .setIssuer(TEAM)
      .setAudience(AUD)
      .setSubject("user-123")
      .setExpirationTime("5m")
      .sign(new TextEncoder().encode("a-shared-secret-of-enough-length-000"));
    expect((await tokenCall(hs)).status).toBe(401);
  });

  it("does not echo why a token was refused", async () => {
    upstream();
    const res = await tokenCall(await token({ aud: "other-app" }));
    const text = await res.text();
    expect(text).not.toMatch(/aud|expired|signature/i);
  });

  it("fails closed when Access is not configured", async () => {
    upstream();
    const res = await tokenCall(await token(), accessEnv({ ACCESS_AUD: "" }));
    expect(res.status).toBe(500);
    expect(await code(res)).toBe("misconfigured");
    const noHttps = await tokenCall(await token(), accessEnv({ ACCESS_TEAM_DOMAIN: "team.cloudflareaccess.com" }));
    expect(noHttps.status).toBe(500);
  });

  it("answers 503, not 401, when the team's keys cannot be fetched", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = input instanceof Request ? input.url : String(input);
      if (url.startsWith("https://down.cloudflareaccess.com")) return new Response("oops", { status: 502 });
      return Response.json({ token: "tok" });
    });
    const t = await token({ iss: "https://down.cloudflareaccess.com" });
    const res = await tokenCall(t, accessEnv({ ACCESS_TEAM_DOMAIN: "https://down.cloudflareaccess.com" }));
    expect(res.status).toBe(503);
    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  it("refuses a token without an email (an Access service token)", async () => {
    upstream();
    const t = await new SignJWT({})
      .setProtectedHeader({ alg: "RS256", kid: KID })
      .setIssuer(TEAM)
      .setAudience(AUD)
      .setSubject("svc")
      .setIssuedAt()
      .setExpirationTime("5m")
      .sign(key);
    const res = await tokenCall(t);
    expect(res.status).toBe(401);
    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  it("fails closed on an unknown mode", async () => {
    upstream();
    const res = await tokenCall(null, testEnv({ AUTH_MODE: "bogus" }));
    expect(res.status).toBe(500);
    expect(await code(res)).toBe("misconfigured");
  });
});

describe("auth in demo mode", () => {
  it("needs no token and limits per client IP", async () => {
    upstream();
    const keys: string[] = [];
    const env = testEnv({ RL_STT_TOKEN: { limit: async ({ key }: { key: string }) => (keys.push(key), { success: true }) } });
    const res = await call("/api/stt/token", { method: "POST", headers: { "cf-connecting-ip": "203.0.113.7" } }, env);
    expect(res.status).toBe(200);
    expect(keys).toEqual(["ip:203.0.113.7"]);
  });
});
