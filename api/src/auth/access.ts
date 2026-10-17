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
  });
  return payload;
}
