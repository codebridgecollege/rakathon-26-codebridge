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
// Privacy: the birth number goes in a POST _search form body, and a next link that carries it is not followed, so it
// is never in a URL we send; redirects are not followed either. Logs carry the operation, upstream status, attempts,
// duration and counts only, never a URL, a body or a token. Each search or read writes an access-log row first (the
// caller's onPull; the pages of that search and the token call belong to it), so a failed log write means no pull.
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
    if (typeof a.key_secret !== "string" || !/^NIS_[A-Z0-9_]+$/.test(a.key_secret) || a.key_secret === "NIS_CONFIG") bad(org, "key_secret");
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
  // NIS_* only, as for the key: any other binding name (ASSETS, a service binding) would receive the NIS calls.
  if (c.mtls_binding !== undefined && (typeof c.mtls_binding !== "string" || !/^NIS_[A-Z0-9_]+$/.test(c.mtls_binding) || c.mtls_binding === "NIS_CONFIG")) bad(org, "mtls_binding");
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

export type Pull = { op: "search" | "read" | "record"; resource: string };

// Backend-services tokens per isolate, until shortly before they expire. Keyed by org and client, never by user.
const tokens = new Map<string, { token: string; until: number }>();
export const clearNisTokens = () => tokens.clear();

// deadlineMs is the budget of one whole operation (token, search and its pages), not of one request.
const RETRY: Omit<RetryOpts, "fetcher"> = { attempts: 3, baseMs: 500, maxDelayMs: 4000, timeoutMs: 15000, deadlineMs: 30000 };
// A patient search: a handful of candidates at most. A record pull: a patient's whole history of one type (labs over
// years), still bounded, and a truncated type is reported.
const SEARCH_LIMITS = { pages: 5, entries: 50 };
const RECORD_LIMITS = { pages: 40, entries: 2000 };
const RECORD_DEADLINE_MS = 120000;

// The patient a record belongs to (subject, patient or beneficiary), as a reference relative to the NIS base or
// absolute within it, without a version.
function aboutPatient(r: R, nisPatientId: string, base: string): boolean {
  const ref = String((r.subject ?? r.patient ?? r.beneficiary)?.reference ?? "").replace(/\/_history\/[^/]+$/, "");
  const local = ref.startsWith(`${base}/`) ? ref.slice(base.length + 1) : ref;
  return local === `Patient/${nisPatientId}`;
}
// What a patient record pull reads: the types the mapping turns into facts or documents.
export const RECORD_TYPES = ["Condition", "Observation", "Procedure", "MedicationStatement", "ServiceRequest", "DiagnosticReport", "DocumentReference"] as const;
// A logical id as FHIR allows it, but not "." or "..", which would turn a read into a path to something else.
const FHIR_ID = /^(?!\.+$)[A-Za-z0-9\-.]{1,64}$/;

export type Collected = { resources: R[]; truncated: boolean };

export class NisClient {
  private until = 0;

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

  // ms: the budget of this operation; a record pull reads up to seven types with their pages, so it gets more.
  private begin(ms = this.retry.deadlineMs ?? 30000) {
    this.until = Date.now() + ms;
  }

  private fetcher(): RetryOpts["fetcher"] {
    if (!this.cfg.mtls_binding) return undefined;
    const b = (this.env as unknown as Record<string, { fetch?: (u: string, i: RequestInit) => Promise<Response> }>)[this.cfg.mtls_binding];
    if (!b?.fetch) bad(this.org, "mtls_binding_missing");
    return (u, i) => b.fetch!(u, i);
  }

  private tokenKey() {
    const a = this.cfg.auth;
    return a.mode === "backend_services" ? `${this.org}|${a.client_id}` : "";
  }

  private async authHeader(): Promise<Record<string, string>> {
    const a = this.cfg.auth;
    if (a.mode === "none") return {};
    if (a.mode === "smart_user") throw new ApiError(503, "nis_launch_missing", "Přihlášení do NIS přes SMART on FHIR v prototypu ještě není napojeno.");
    const key = this.tokenKey();
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
    // One attempt: a resend would repeat the assertion's jti, which a strict server refuses as a replay.
    const res = await this.send("token", a.token_url, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" }, body }, 1);
    const j = (await this.json(res, "token")) as { access_token?: unknown; expires_in?: unknown };
    if (typeof j.access_token !== "string" || !j.access_token) throw nisError();
    const ttl = typeof j.expires_in === "number" && j.expires_in > 0 ? j.expires_in : 300;
    tokens.set(key, { token: j.access_token, until: Date.now() + Math.max(0, ttl - 60) * 1000 });
    return { authorization: `Bearer ${j.access_token}` };
  }

  private async send(op: string, url: string, init: RequestInit, attempts = this.retry.attempts): Promise<Response> {
    const started = Date.now();
    const left = this.until - started;
    if (left <= 0) throw E.upstreamTimeout();
    let res: Response, n: number;
    try {
      // Redirects are not followed: a 307 would resend the search body, birth number included, to another address.
      ({ res, attempts: n } = await fetchWithRetry(
        url,
        { ...init, redirect: "manual" },
        { ...this.retry, attempts, timeoutMs: Math.min(this.retry.timeoutMs, left), deadlineMs: left, fetcher: this.fetcher() },
      ));
    } catch (e) {
      if (e instanceof ApiError) throw e;
      console.log(JSON.stringify({ route: "nis", op, upstream: "fetch_failed", ms: Date.now() - started }));
      throw isTimeout(e) ? E.upstreamTimeout() : nisError();
    }
    console.log(JSON.stringify({ route: "nis", op, upstream: res.status, attempts: n, ms: Date.now() - started }));
    return res;
  }

  private async json(res: Response, op: string): Promise<R> {
    if (res.status === 429 || res.status === 503) throw E.upstreamBusy();
    if (res.status === 401 || res.status === 403) throw new ApiError(502, "nis_refused", "NIS odmítl přístup. Ověřte nastavení připojení k NIS.");
    if (!res.ok) {
      await res.body?.cancel();
      throw nisError();
    }
    try {
      const j = (await res.json()) as R;
      if (!j || typeof j !== "object") throw new Error("not an object");
      return j;
    } catch {
      console.log(JSON.stringify({ route: "nis", op, upstream: "bad_json" }));
      throw nisError();
    }
  }

  // A FHIR request with the auth header. A 401 with a cached backend-services token means the NIS revoked it: the
  // cache entry goes and the request is sent once more with a new token.
  private async fhir(op: string, url: string, init: RequestInit): Promise<Response> {
    const go = async () => this.send(op, url, { ...init, headers: { accept: "application/fhir+json", ...(init.headers as Record<string, string>), ...(await this.authHeader()) } });
    const res = await go();
    if (res.status !== 401 || this.cfg.auth.mode !== "backend_services") return res;
    await res.body?.cancel();
    tokens.delete(this.tokenKey());
    return go();
  }

  // A "next" link must point back into the same base: the server writes it, and following it elsewhere would send
  // our token (and the patient context) to another host. Compared as parsed URLs, so "/fhir/../admin" does not pass.
  private inBase(u: string): boolean {
    let next: URL;
    try {
      next = new URL(u);
    } catch {
      return false;
    }
    const base = new URL(this.cfg.base_url);
    const bp = base.pathname.replace(/\/+$/, "");
    return next.origin === base.origin && (next.pathname === bp || next.pathname === `${bp}/` || next.pathname.startsWith(`${bp}/`));
  }

  // Follows the searchset's next links up to the limits' pages and resources of the asked type. A next link
  // that carries one of `secret` (a server may copy the search parameters into it) is not followed: it would put the
  // birth number into a URL.
  private async collect(first: R, type: string, secret: string[], limits = SEARCH_LIMITS): Promise<Collected> {
    const MAX_PAGES = limits.pages;
    const MAX_ENTRIES = limits.entries;
    const resources: R[] = [];
    let page: R = first;
    for (let n = 1; ; n++) {
      if (page.resourceType !== "Bundle" || page.type !== "searchset") throw nisError();
      const entries = Array.isArray(page.entry) ? (page.entry as R[]) : [];
      // search.mode "include" or "outcome" entries are not matches.
      for (const e of entries) if (e?.resource?.resourceType === type && (e.search?.mode ?? "match") === "match") resources.push(e.resource);
      const links = Array.isArray(page.link) ? (page.link as R[]) : [];
      const next = links.find((l) => l?.relation === "next")?.url;
      if (!next) return { resources: resources.slice(0, MAX_ENTRIES), truncated: resources.length > MAX_ENTRIES };
      if (n >= MAX_PAGES || resources.length >= MAX_ENTRIES) return { resources: resources.slice(0, MAX_ENTRIES), truncated: true };
      let plain = String(next);
      try {
        plain = decodeURIComponent(plain);
      } catch {
        // A malformed escape: compare the raw text.
      }
      if (typeof next !== "string" || !this.inBase(next) || secret.some((s) => s && (next.includes(s) || plain.includes(s)))) {
        console.log(JSON.stringify({ route: "nis", op: "page", refused: "next_link" }));
        return { resources: resources.slice(0, MAX_ENTRIES), truncated: true };
      }
      page = await this.json(await this.fhir("page", next, { method: "GET" }), "page");
    }
  }

  // Patients with this identifier, as a POST _search, so the value travels in the body. `secret` lists the values a
  // next link must not contain (the birth number in its written forms). Strict handling: a server that does not know
  // the parameter must refuse the search, not ignore it and answer with everyone.
  async searchPatientsByIdentifier(identifierValue: string, secret: string[]): Promise<Collected> {
    this.begin();
    await this.onPull({ op: "search", resource: "Patient" });
    const body = new URLSearchParams({ identifier: identifierValue, _count: "50" }).toString();
    const res = await this.fhir("search", `${this.cfg.base_url}/Patient/_search`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", prefer: "handling=strict" },
      body,
    });
    return this.collect(await this.json(res, "search"), "Patient", secret);
  }

  // The clinical record of one NIS patient: every resource type the mapping reads (packages/domain/src/nis-map.ts),
  // searched by the NIS patient ID (an internal ID, never the birth number). `since` asks only for what changed at or
  // after an instant (_lastUpdated=ge), for the refresh's "has anything changed?": the caller passes the newest
  // meta.lastUpdated it saw, the NIS's own clock, and "ge" so a record of the same instant is not missed. A refresh
  // that finds changes pulls the whole record again, which is also how a deleted record disappears. One access-log row
  // covers the whole pull; each type has the record limits (RECORD_LIMITS) and a truncated type is reported.
  async patientRecord(nisPatientId: string, since: string | null = null): Promise<{ resources: R[]; truncated: string[]; foreign: number }> {
    if (!FHIR_ID.test(nisPatientId)) throw E.badRequest();
    if (since !== null && !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/.test(since)) throw E.badRequest();
    this.begin(RECORD_DEADLINE_MS);
    await this.onPull({ op: "record", resource: "Patient" });
    const resources: R[] = [];
    const truncated: string[] = [];
    const seen = new Set<string>();
    let foreign = 0;
    for (const type of RECORD_TYPES) {
      const q = new URLSearchParams({ patient: `Patient/${nisPatientId}`, _count: "100" });
      if (since) q.set("_lastUpdated", `ge${since}`);
      const res = await this.fhir("record", `${this.cfg.base_url}/${type}?${q}`, { method: "GET", headers: { prefer: "handling=strict" } });
      const got = await this.collect(await this.json(res, "record"), type, [], RECORD_LIMITS);
      for (const r of got.resources) {
        // Only this patient's records, once each: a server that matched loosely, or a page boundary that shifted
        // during paging, must not put another patient's record or a duplicate into the run.
        if (!aboutPatient(r, nisPatientId, this.cfg.base_url)) {
          foreign++;
          continue;
        }
        const key = `${r.resourceType}/${r.id}`;
        if (seen.has(key)) continue;
        seen.add(key);
        resources.push(r);
      }
      if (got.truncated) truncated.push(type);
    }
    console.log(JSON.stringify({ route: "nis", op: "record", n: resources.length, truncated: truncated.length, foreign }));
    return { resources, truncated, foreign };
  }

  // One resource by its logical id; null when the NIS has none (404 or 410).
  async read(type: string, id: string): Promise<R | null> {
    if (!/^[A-Z][A-Za-z]+$/.test(type) || !FHIR_ID.test(id)) throw E.badRequest();
    this.begin();
    await this.onPull({ op: "read", resource: type });
    const res = await this.fhir("read", `${this.cfg.base_url}/${type}/${id}`, { method: "GET" });
    if (res.status === 404 || res.status === 410) {
      await res.body?.cancel();
      return null;
    }
    const r = await this.json(res, "read");
    if (r.resourceType !== type || r.id !== id) throw nisError();
    return r;
  }
}

const nisError = () => new ApiError(502, "upstream_error", "Služba NIS odpověděla chybou.");

export const isFhirId = (id: string) => FHIR_ID.test(id);

// The national register (ROB, through IHE PDQm) is not connected in the prototype. A visible stub, never a fake answer
// (CLAUDE.md, "Stub national services visibly").
export const NATIONAL_REGISTER_STUB = {
  status: "stub" as const,
  message_cs: "Zde ověříme pacienta v národním registru obyvatel (IHE PDQm). V prototypu není napojeno, nic se neověřuje.",
};
