// The FHIR R4 connector to an org's NIS (the hospital information system; docs/design/INTEGRATION.md, "Patient data
// in and out"). Read only: it searches and reads, never writes into the record.
//
// Configuration per org comes from the NIS_CONFIG var (a JSON object keyed by org id; "{}" means no org has a NIS, and
// the page then shows no NIS entry). Keys never sit in it: backend services names a Worker secret (NIS_*) that holds
// the private key. Auth modes:
//   - "backend_services": SMART Backend Services (client_credentials with a signed JWT client assertion, RS384 or
//     ES384). The NIS sees the app, not the user, so our access log is the record of who pulled what
//     (INTEGRATION.md, "Who may see which patient").
//   - "smart_user": the user's own token from a SMART on FHIR launch, so the NIS's access rules apply per user. The
//     launch is not built yet; a configured org answers 503 until it is.
//   - "none": for the test server only, so it is refused for any host other than this machine or a .test name.
// mTLS: "mtls_binding" names a Workers mTLS certificate binding whose fetch carries the client certificate; the
// binding itself is added in wrangler.jsonc when FNO issues the certificate.
//
// Privacy: the birth number goes in a POST _search form body, never in a URL; logs carry the operation, upstream
// status, attempts, duration and counts only, never a URL, a body or a token. Each pull writes an access-log row
// first (the caller's onPull), so a failed log write means no pull.
import { importPKCS8, SignJWT } from "jose";
import { ApiError, E, isTimeout } from "../http/errors";
import { fetchWithRetry, type RetryOpts } from "./retry";

type R = Record<string, any>;

export type NisAuth =
  | { mode: "none" }
  | { mode: "smart_user" }
  | { mode: "backend_services"; token_url: string; client_id: string; scope: string; key_secret: string; alg: "RS384" | "ES384"; kid?: string };

export type NisConfig = { base_url: string; label_cs: string; auth: NisAuth; mtls_binding?: string };

const isLocal = (u: URL) => ["localhost", "127.0.0.1", "[::1]"].includes(u.hostname) || u.hostname.endsWith(".test");

function bad(org: string, why: string): never {
  // The reason is a fixed code, not the config's text, so a URL with credentials in it never reaches the log.
  console.error(JSON.stringify({ route: "nis", config: "invalid", org, why }));
  throw E.misconfigured();
}

// The org's NIS, or null when it has none. A malformed entry is a deploy mistake: it fails closed (500).
export function nisConfig(env: Env, org: string): NisConfig | null {
  let all: unknown;
  try {
    all = JSON.parse(env.NIS_CONFIG || "{}");
  } catch {
    bad(org, "json");
  }
  if (!all || typeof all !== "object" || Array.isArray(all)) bad(org, "shape");
  const c = (all as Record<string, unknown>)[org] as R | undefined;
  if (c === undefined || c === null) return null;
  let u: URL;
  try {
    u = new URL(String(c.base_url));
  } catch {
    bad(org, "base_url");
  }
  if (u.username || u.password || u.search || u.hash) bad(org, "base_url");
  if (u.protocol !== "https:" && !(u.protocol === "http:" && isLocal(u))) bad(org, "https");
  const a = c.auth as R | undefined;
  let auth: NisAuth;
  if (a?.mode === "none") {
    if (!isLocal(u)) bad(org, "auth_none_remote");
    auth = { mode: "none" };
  } else if (a?.mode === "smart_user") auth = { mode: "smart_user" };
  else if (a?.mode === "backend_services") {
    // Only a secret named NIS_* can hold the key, so a config typo cannot hand another secret (OIDC, LLM) to the NIS.
    if (typeof a.key_secret !== "string" || !/^NIS_[A-Z0-9_]+$/.test(a.key_secret)) bad(org, "key_secret");
    if (a.alg !== "RS384" && a.alg !== "ES384") bad(org, "alg");
    let t: URL;
    try {
      t = new URL(String(a.token_url));
    } catch {
      bad(org, "token_url");
    }
    if (t.protocol !== "https:" && !(t.protocol === "http:" && isLocal(t))) bad(org, "token_url");
    if (typeof a.client_id !== "string" || !a.client_id || typeof a.scope !== "string" || !a.scope) bad(org, "client");
    auth = { mode: "backend_services", token_url: t.href, client_id: a.client_id, scope: a.scope, key_secret: a.key_secret, alg: a.alg, ...(typeof a.kid === "string" ? { kid: a.kid } : {}) };
  } else bad(org, "auth_mode");
  if (c.mtls_binding !== undefined && (typeof c.mtls_binding !== "string" || !/^[A-Z][A-Z0-9_]*$/.test(c.mtls_binding))) bad(org, "mtls_binding");
  return {
    base_url: u.href.replace(/\/+$/, ""),
    label_cs: typeof c.label_cs === "string" && c.label_cs.trim() ? c.label_cs.trim().slice(0, 120) : "NIS",
    auth,
    ...(c.mtls_binding ? { mtls_binding: c.mtls_binding } : {}),
  };
}

// For /api/me: whether the page shows the NIS entry. A broken config hides it rather than breaking /me.
export function nisConfigured(env: Env, org: string): boolean {
  try {
    return nisConfig(env, org) !== null;
  } catch {
    return false;
  }
}

export type Pull = { op: "search" | "read"; resource: string };

// Backend-services tokens per isolate, until shortly before they expire. Keyed by org and client, never by user.
const tokens = new Map<string, { token: string; until: number }>();
export const clearNisTokens = () => tokens.clear();

const RETRY: Omit<RetryOpts, "fetcher"> = { attempts: 3, baseMs: 500, maxDelayMs: 4000, timeoutMs: 15000, deadlineMs: 30000 };
const MAX_PAGES = 5;
const MAX_ENTRIES = 50;

export class NisClient {
  constructor(
    private readonly env: Env,
    private readonly org: string,
    readonly cfg: NisConfig,
    // Writes the access-log row of a pull before it happens; throws to stop it.
    private readonly onPull: (p: Pull) => Promise<void>,
    private readonly retry: Omit<RetryOpts, "fetcher"> = RETRY,
  ) {}

  // The system our NIS sources name (EXTRACTION-FORMAT.md, "A record in the NIS").
  get system() {
    return this.cfg.base_url;
  }

  private fetcher(): RetryOpts["fetcher"] {
    if (!this.cfg.mtls_binding) return undefined;
    const b = (this.env as unknown as Record<string, { fetch?: (u: string, i: RequestInit) => Promise<Response> }>)[this.cfg.mtls_binding];
    if (!b?.fetch) bad(this.org, "mtls_binding_missing");
    return (u, i) => b.fetch!(u, i);
  }

  private async authHeader(): Promise<Record<string, string>> {
    const a = this.cfg.auth;
    if (a.mode === "none") return {};
    if (a.mode === "smart_user") throw new ApiError(503, "nis_launch_missing", "Přihlášení do NIS přes SMART on FHIR v prototypu ještě není napojeno.");
    const key = `${this.org}|${a.client_id}`;
    const hit = tokens.get(key);
    if (hit && hit.until > Date.now()) return { authorization: `Bearer ${hit.token}` };
    const pem = (this.env as unknown as Record<string, unknown>)[a.key_secret];
    if (typeof pem !== "string" || !pem.includes("PRIVATE KEY")) bad(this.org, "key_missing");
    const now = Math.floor(Date.now() / 1000);
    const assertion = await new SignJWT({})
      .setProtectedHeader({ alg: a.alg, typ: "JWT", ...(a.kid ? { kid: a.kid } : {}) })
      .setIssuer(a.client_id)
      .setSubject(a.client_id)
      .setAudience(a.token_url)
      .setJti(crypto.randomUUID())
      .setIssuedAt(now)
      // SMART Backend Services allows at most five minutes.
      .setExpirationTime(now + 300)
      .sign(await importPKCS8(pem, a.alg));
    const body = new URLSearchParams({
      grant_type: "client_credentials",
      scope: a.scope,
      client_assertion_type: "urn:ietf:params:oauth:client-assertion-type:jwt-bearer",
      client_assertion: assertion,
    }).toString();
    const res = await this.send("token", a.token_url, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" }, body });
    const j = (await this.json(res, "token")) as { access_token?: unknown; expires_in?: unknown };
    if (typeof j.access_token !== "string" || !j.access_token) throw nisError(502);
    const ttl = typeof j.expires_in === "number" && j.expires_in > 0 ? j.expires_in : 300;
    tokens.set(key, { token: j.access_token, until: Date.now() + Math.max(0, ttl - 60) * 1000 });
    return { authorization: `Bearer ${j.access_token}` };
  }

  private async send(op: string, url: string, init: RequestInit): Promise<Response> {
    const started = Date.now();
    let res: Response, attempts: number;
    try {
      ({ res, attempts } = await fetchWithRetry(url, init, { ...this.retry, fetcher: this.fetcher() }));
    } catch (e) {
      if (e instanceof ApiError) throw e;
      console.log(JSON.stringify({ route: "nis", op, upstream: "fetch_failed", ms: Date.now() - started }));
      throw isTimeout(e) ? E.upstreamTimeout() : nisError(502);
    }
    console.log(JSON.stringify({ route: "nis", op, upstream: res.status, attempts, ms: Date.now() - started }));
    return res;
  }

  private async json(res: Response, op: string): Promise<R> {
    if (res.status === 429 || res.status === 503) throw E.upstreamBusy();
    if (res.status === 401 || res.status === 403) throw new ApiError(502, "nis_refused", "NIS odmítl přístup. Ověřte nastavení připojení k NIS.");
    if (!res.ok) throw nisError(502);
    try {
      return (await res.json()) as R;
    } catch {
      console.log(JSON.stringify({ route: "nis", op, upstream: "bad_json" }));
      throw nisError(502);
    }
  }

  private async get(op: string, url: string): Promise<Response> {
    return this.send(op, url, { method: "GET", headers: { accept: "application/fhir+json", ...(await this.authHeader()) } });
  }

  // A "next" link must point back into the same base: the server writes it, and following it elsewhere would send
  // our token (and the patient context) to another host.
  private inBase(u: string): boolean {
    const b = this.cfg.base_url;
    return u.startsWith(b) && (u.length === b.length || u[b.length] === "/" || u[b.length] === "?");
  }

  // Follows the searchset's next links up to MAX_PAGES pages and MAX_ENTRIES resources of the asked type.
  private async collect(first: R, type: string): Promise<{ resources: R[]; truncated: boolean }> {
    const resources: R[] = [];
    let page: R = first;
    for (let n = 1; ; n++) {
      if (page.resourceType !== "Bundle" || page.type !== "searchset") throw nisError(502);
      // search.mode "include" or "outcome" entries are not matches.
      for (const e of (page.entry ?? []) as R[]) if (e?.resource?.resourceType === type && (e.search?.mode ?? "match") === "match") resources.push(e.resource);
      const next = ((page.link ?? []) as R[]).find((l) => l?.relation === "next")?.url;
      if (!next) return { resources: resources.slice(0, MAX_ENTRIES), truncated: resources.length > MAX_ENTRIES };
      if (n >= MAX_PAGES || resources.length >= MAX_ENTRIES) return { resources: resources.slice(0, MAX_ENTRIES), truncated: true };
      if (typeof next !== "string" || !this.inBase(next)) {
        console.log(JSON.stringify({ route: "nis", op: "page", refused: "foreign_next_link" }));
        return { resources, truncated: true };
      }
      page = await this.json(await this.get("page", next), "page");
    }
  }

  // Patients with this birth number (digits only), searched with the Czech core identifier system as a POST _search.
  async searchPatientsByIdentifier(identifierValue: string): Promise<{ resources: R[]; truncated: boolean }> {
    await this.onPull({ op: "search", resource: "Patient" });
    const body = new URLSearchParams({ identifier: identifierValue, _count: "20" }).toString();
    const res = await this.send("search", `${this.cfg.base_url}/Patient/_search`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/fhir+json", ...(await this.authHeader()) },
      body,
    });
    return this.collect(await this.json(res, "search"), "Patient");
  }

  // One resource by its logical id; null when the NIS has none (404 or 410).
  async read(type: string, id: string): Promise<R | null> {
    if (!/^[A-Z][A-Za-z]+$/.test(type) || !/^[A-Za-z0-9\-.]{1,64}$/.test(id)) throw E.badRequest();
    await this.onPull({ op: "read", resource: type });
    const res = await this.get("read", `${this.cfg.base_url}/${type}/${id}`);
    if (res.status === 404 || res.status === 410) {
      await res.body?.cancel();
      return null;
    }
    const r = await this.json(res, "read");
    if (r.resourceType !== type || r.id !== id) throw nisError(502);
    return r;
  }
}

const nisError = (status: 502) => new ApiError(status, "upstream_error", "Služba NIS odpověděla chybou.");

// The national register (ROB, through IHE PDQm) is not connected in the prototype. A visible stub, never a fake answer
// (CLAUDE.md, "Stub national services visibly").
export const NATIONAL_REGISTER_STUB = {
  status: "stub" as const,
  message_cs: "Zde ověříme pacienta v národním registru obyvatel (IHE PDQm). V prototypu není napojeno, nic se neověřuje.",
};
