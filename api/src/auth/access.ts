import { createRemoteJWKSet, jwtVerify, type JWTPayload } from "jose";

// One JWKS per team domain per isolate; jose caches keys and refetches on an unknown kid (with a cooldown).
const sets = new Map<string, ReturnType<typeof createRemoteJWKSet>>();

// Verifies a Cloudflare Access token: signature against the team's keys, issuer, audience (the app's AUD tag)
// and expiry. Only RS256 is accepted, so a token signed with a shared secret (HS256) or "none" never passes.
export async function verifyAccessJwt(token: string, teamDomain: string, aud: string): Promise<JWTPayload> {
  const team = teamDomain.replace(/\/+$/, "");
  let jwks = sets.get(team);
  if (!jwks) {
    jwks = createRemoteJWKSet(new URL(`${team}/cdn-cgi/access/certs`));
    sets.set(team, jwks);
  }
  const { payload } = await jwtVerify(token, jwks, {
    issuer: team,
    audience: aud,
    algorithms: ["RS256"],
    clockTolerance: 30,
    // jose checks exp only when present; Access always sets these, so a token without them is not from Access.
    requiredClaims: ["exp", "iat", "sub"],
  });
  return payload;
}

// True when the team's key set could not be fetched (timeout, network, non-200, bad JSON), as opposed to a token
// that failed verification. The first is our outage, so the user must not be told to log in again.
export function isKeySetUnavailable(e: unknown): boolean {
  const code = (e as { code?: unknown } | null)?.code;
  if (code === "ERR_JWKS_TIMEOUT") return true;
  if (typeof code !== "string" || !code.startsWith("ERR_")) return true;
  const msg = e instanceof Error ? e.message : "";
  return code === "ERR_JOSE_GENERIC" && /JSON Web Key Set/.test(msg);
}
