// An in-memory FHIR R4 server for tests and local development: the NIS test double (fhir/nis/README.md). It implements
// only the interactions the connector uses (api/src/services/fhir.ts), with the answers the FHIR spec gives (HAPI FHIR
// JPA documents the same; not compared against a running HAPI), so the connector can be tested without Docker:
//   - transaction or batch Bundles with PUT entries (how fhir/nis/seed.ts loads the test Bundles),
//   - read and vread,
//   - search by GET and by POST to <type>/_search with a form body (the birth number stays out of the URL),
//     parameters _id, identifier, patient, subject, status and _count, comma for OR as in FHIR,
//   - paging through Bundle "next" links (?_getpages=<token>&_getpagesoffset=<n>, the shape HAPI uses),
//   - GET metadata.
// An unknown search parameter answers 400, as a server with "Prefer: handling=strict" does, so a connector that sends
// a parameter we did not mean fails a test instead of silently getting everything.
// Runtime neutral (standard Request and Response only): Node's serve.ts and the Worker's Vitest both use it.

type R = Record<string, any>;
export type Fault = { status: number; times: number; retryAfter?: string };

const FHIR_JSON = "application/fhir+json; charset=utf-8";
const SEARCH_PARAMS = new Set(["_id", "identifier", "patient", "subject", "status", "_count", "_lastUpdated"]);

export class MemoryFhir {
  readonly base: string;
  private readonly basePath: string;
  // type -> id -> versions (last is current)
  private store = new Map<string, Map<string, R[]>>();
  private pages = new Map<string, string[]>();
  private seq = 0;
  private faults: Fault[] = [];
  // Every request the server saw (method and URL only), so tests can check what the connector put in URLs.
  readonly requests: { method: string; url: string; contentType: string | null; authorization: string | null }[] = [];

  // maxCount: the largest page the server gives, whatever _count asks (servers cap it; 100 by default).
  private readonly opts: { bearer?: string; now?: () => string; maxCount?: number };

  // Plain fields, not parameter properties: Node runs this file by stripping types, which has no parameter properties.
  constructor(base: string, opts: { bearer?: string; now?: () => string; maxCount?: number } = {}) {
    this.opts = opts;
    this.base = base.replace(/\/+$/, "");
    this.basePath = new URL(this.base).pathname.replace(/\/+$/, "");
  }

  private now() {
    return this.opts.now?.() ?? new Date().toISOString();
  }

  // The next `times` requests answer `status` (429 or 503 to test the backoff), then the server answers normally.
  failNext(status: number, times = 1, retryAfter?: string) {
    this.faults.push({ status, times, ...(retryAfter ? { retryAfter } : {}) });
  }

  load(bundle: R) {
    return this.transaction(bundle);
  }

  async handle(req: Request): Promise<Response> {
    const url = new URL(req.url);
    this.requests.push({ method: req.method, url: req.url, contentType: req.headers.get("content-type"), authorization: req.headers.get("authorization") });
    const f = this.faults[0];
    if (f) {
      if (--f.times <= 0) this.faults.shift();
      return this.outcome(f.status, "transient", "Injected fault", f.retryAfter ? { "retry-after": f.retryAfter } : {});
    }
    if (this.opts.bearer && req.headers.get("authorization") !== `Bearer ${this.opts.bearer}`) return this.outcome(401, "login", "Missing or wrong bearer token");
    if (!url.pathname.startsWith(this.basePath)) return this.outcome(404, "not-found", "Unknown base");
    const parts = url.pathname.slice(this.basePath.length).split("/").filter(Boolean);
    try {
      if (req.method === "GET" && parts.length === 0 && url.searchParams.has("_getpages")) return this.page(url);
      if (req.method === "POST" && parts.length === 0) return this.json(200, this.transaction(await req.json()));
      if (req.method === "GET" && parts[0] === "metadata" && parts.length === 1) return this.json(200, this.capability());
      const [type, id, h, vid] = parts;
      if (!type || !/^[A-Z][A-Za-z]+$/.test(type)) return this.outcome(404, "not-found", "Unknown resource type");
      if (req.method === "GET" && id && !h) return this.read(type, id);
      if (req.method === "GET" && id && h === "_history" && vid) return this.read(type, id, vid);
      if (req.method === "GET" && !id) return this.search(type, url.searchParams);
      if (req.method === "POST" && id === "_search" && !h) {
        const ct = req.headers.get("content-type") ?? "";
        if (!ct.startsWith("application/x-www-form-urlencoded")) return this.outcome(415, "not-supported", "_search needs a form body");
        // Decoded by hand: workerd warns on .text() for a form body.
        const params = new URLSearchParams(new TextDecoder().decode(await req.arrayBuffer()));
        for (const [k, v] of url.searchParams) params.append(k, v);
        return this.search(type, params);
      }
      return this.outcome(405, "not-supported", "Interaction not supported by the test double");
    } catch (e) {
      return this.outcome(400, "invalid", e instanceof Error ? e.message : "invalid");
    }
  }

  private json(status: number, body: unknown, headers: Record<string, string> = {}) {
    return new Response(JSON.stringify(body), { status, headers: { "content-type": FHIR_JSON, ...headers } });
  }

  private outcome(status: number, code: string, text: string, headers: Record<string, string> = {}) {
    return this.json(status, { resourceType: "OperationOutcome", issue: [{ severity: "error", code, diagnostics: text }] }, headers);
  }

  private put(r: R): R {
    if (!r?.resourceType || !r.id) throw new Error("PUT needs resourceType and id");
    const byId = this.store.get(r.resourceType) ?? new Map<string, R[]>();
    this.store.set(r.resourceType, byId);
    const versions = byId.get(r.id) ?? [];
    const stored = { ...r, meta: { ...(r.meta ?? {}), versionId: String(versions.length + 1), lastUpdated: this.now() } };
    versions.push(stored);
    byId.set(r.id, versions);
    return stored;
  }

  private transaction(b: R): R {
    if (b?.resourceType !== "Bundle" || !["transaction", "batch"].includes(b.type)) throw new Error("POST to the base needs a transaction or batch Bundle");
    const entries = (b.entry ?? []) as R[];
    for (const e of entries) {
      const m = e.request?.method;
      const url = String(e.request?.url ?? "");
      if (m !== "PUT" || url !== `${e.resource?.resourceType}/${e.resource?.id}`) throw new Error(`Only PUT <type>/<id> entries are supported (${m} ${url})`);
    }
    const out = entries.map((e) => {
      const s = this.put(e.resource);
      return { response: { status: s.meta.versionId === "1" ? "201 Created" : "200 OK", location: `${s.resourceType}/${s.id}/_history/${s.meta.versionId}` } };
    });
    return { resourceType: "Bundle", type: `${b.type}-response`, entry: out };
  }

  private read(type: string, id: string, vid?: string) {
    const versions = this.store.get(type)?.get(id);
    const r = vid ? versions?.find((v) => v.meta.versionId === vid) : versions?.at(-1);
    if (!r) return this.outcome(404, "not-found", `${type}/${id} not found`);
    return this.json(200, r, { etag: `W/"${r.meta.versionId}"` });
  }

  private matches(r: R, key: string, value: string): boolean {
    // Comma separates alternatives (OR); a literal comma would be escaped as "\," (not needed by our callers).
    const alts = value.split(",");
    switch (key) {
      case "_id":
        return alts.includes(r.id);
      case "_lastUpdated": {
        // Prefixes gt, ge, lt, le on an instant, compared as instants; no prefix means eq, as in FHIR.
        const m = /^(gt|ge|lt|le)?(.+)$/.exec(value)!;
        const at = Date.parse(m[2]!);
        const lu = Date.parse(r.meta?.lastUpdated ?? "");
        if (Number.isNaN(at) || Number.isNaN(lu)) return false;
        return { gt: lu > at, ge: lu >= at, lt: lu < at, le: lu <= at, eq: lu === at }[(m[1] ?? "eq") as "gt" | "ge" | "lt" | "le" | "eq"];
      }
      case "status":
        return alts.includes(r.status);
      case "identifier":
        return alts.some((a) => {
          const i = a.indexOf("|");
          const [sys, val] = i < 0 ? [null, a] : [a.slice(0, i), a.slice(i + 1)];
          return ((r.identifier ?? []) as R[]).some((x) => x.value === val && (sys === null || (sys === "" ? !x.system : x.system === sys)));
        });
      case "patient":
      case "subject": {
        const target = (r.subject ?? r.patient ?? r.beneficiary)?.reference;
        return alts.some((a) => target === a || target === `Patient/${a}`);
      }
      default:
        return false;
    }
  }

  private search(type: string, params: URLSearchParams) {
    for (const k of params.keys()) if (!SEARCH_PARAMS.has(k)) return this.outcome(400, "not-supported", `Unknown search parameter ${k}`);
    const all = [...(this.store.get(type)?.values() ?? [])].map((v) => v.at(-1)!);
    const hits = all.filter((r) => [...params.entries()].filter(([k]) => k !== "_count").every(([k, v]) => this.matches(r, k, v)));
    hits.sort((a, b) => (a.id < b.id ? -1 : 1));
    const token = `p${++this.seq}`;
    this.pages.set(token, hits.map((r) => `${r.resourceType}/${r.id}`));
    return this.json(200, this.searchset(token, 0, this.count(params)));
  }

  private count(params: URLSearchParams) {
    const n = Number(params.get("_count") ?? 20);
    const max = this.opts.maxCount ?? 100;
    return Number.isInteger(n) && n > 0 ? Math.min(n, max) : Math.min(20, max);
  }

  private page(url: URL) {
    const token = url.searchParams.get("_getpages")!;
    if (!this.pages.has(token)) return this.outcome(410, "not-found", "Search expired");
    return this.json(200, this.searchset(token, Number(url.searchParams.get("_getpagesoffset") ?? 0), this.count(url.searchParams)));
  }

  private searchset(token: string, offset: number, count: number): R {
    const refs = this.pages.get(token)!;
    const slice = refs.slice(offset, offset + count);
    const link = [{ relation: "self", url: `${this.base}?_getpages=${token}&_getpagesoffset=${offset}&_count=${count}` }];
    if (offset + count < refs.length) link.push({ relation: "next", url: `${this.base}?_getpages=${token}&_getpagesoffset=${offset + count}&_count=${count}` });
    return {
      resourceType: "Bundle",
      type: "searchset",
      total: refs.length,
      link,
      entry: slice.map((ref) => {
        const [t, id] = ref.split("/") as [string, string];
        return { fullUrl: `${this.base}/${ref}`, resource: this.store.get(t)!.get(id)!.at(-1), search: { mode: "match" } };
      }),
    };
  }

  private capability(): R {
    return {
      resourceType: "CapabilityStatement",
      status: "active",
      date: this.now(),
      kind: "instance",
      fhirVersion: "4.0.1",
      format: ["json"],
      software: { name: "CodeBridge NIS test double (synthetic data only)" },
      rest: [{ mode: "server", interaction: [{ code: "transaction" }, { code: "batch" }] }],
    };
  }
}
