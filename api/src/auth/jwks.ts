import { createRemoteJWKSet } from "jose";

// One key set per URL per isolate; jose caches the keys and fetches again on an unknown kid (with a cooldown), so a
// key rotation at the IdP needs no deploy.
const sets = new Map<string, ReturnType<typeof createRemoteJWKSet>>();

export function remoteKeySet(url: string): ReturnType<typeof createRemoteJWKSet> {
  let jwks = sets.get(url);
  if (!jwks) {
    jwks = createRemoteJWKSet(new URL(url));
    sets.set(url, jwks);
  }
  return jwks;
}

// The clock difference accepted between the IdP and Cloudflare when checking exp, iat and nbf.
export const CLOCK_TOLERANCE_S = 30;

// True when the key set could not be fetched (timeout, network, non-200, bad JSON), as opposed to a token that failed
// verification. The first is an outage, so the user must not be sent into a login loop: the caller answers 503.
export function isKeySetUnavailable(e: unknown): boolean {
  const code = (e as { code?: unknown } | null)?.code;
  if (code === "ERR_JWKS_TIMEOUT") return true;
  if (typeof code !== "string" || !code.startsWith("ERR_")) return true;
  const msg = e instanceof Error ? e.message : "";
  return code === "ERR_JOSE_GENERIC" && /JSON Web Key Set/.test(msg);
}
