// "Import z NIS", phase 1 (issue #22): the FHIR connector against the in-memory FHIR server (fhir/nis/memory-server.ts)
// loaded with the NIS test Bundles (fhir/nis/bundles.ts), and the search and link routes. Checks the privacy rules
// (no birth number in a URL, a log line or the access log), identity (duplicates shown and never merged, a merged
// record not linkable, a conflict refused, an unverifiable one only with confirmation), org isolation, 429 backoff,
// paging, and the backend-services token.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { env } from "cloudflare:workers";
import { call, mockFetch, testEnv } from "./helpers";
import { loadFixture, FAKE_NAME } from "./data";
import { MemoryFhir } from "../../fhir/nis/memory-server";
import { NisClient, clearNisTokens, nisConfig } from "../src/services/fhir";
import { rcisSearchValue } from "@codebridge/domain/nis";

const BASE = "https://nis.test/fhir";
const CONFIG = JSON.stringify({ "demo-a": { base_url: BASE, label_cs: "Testovací NIS", auth: { mode: "none" } } });
const nisEnv = (over: Record<string, unknown> = {}) => testEnv({ NIS_CONFIG: CONFIG, ...over });
// NO-A's patient (test/data.ts) has this birth number; NO-B's patient has none.
const RC_A = "645312/1234";
// F01 in the failure Bundle: three records for one birth number (TEST_ONLY_BIRTH_NUMBERS in fhir/nis/bundles.ts).
const RC_F01 = "720905/3005";

type Body = { data?: Record<string, any>; error?: { code: string; message_cs: string; fields?: Record<string, string> } };
const q = async <T = Record<string, unknown>>(sql: string, ...args: unknown[]) => (await env.DB.prepare(sql).bind(...args).all<T>()).results;

let fhir: MemoryFhir;
let logged: string[];

function server() {
  fhir = new MemoryFhir(BASE, { now: () => "2026-10-19T08:00:00.000Z" });
  for (const b of Object.values(JSON.parse(env.TEST_NIS_BUNDLES) as Record<string, unknown>)) fhir.load(b as Record<string, unknown>);
  // NO-A's patient in the NIS, under the test fixture's own birth number and name.
  fhir.load({
    resourceType: "Bundle",
    type: "transaction",
    entry: [
      {
        resource: { resourceType: "Patient", id: "t-pt-a", identifier: [{ system: "https://ncez.mzcr.cz/fhir/sid/rcis", value: RC_A }], name: [{ family: "Pacientka", given: ["Testová"] }], birthDate: "1964-03-12" },
        request: { method: "PUT", url: "Patient/t-pt-a" },
      },
    ],
  });
  return mockFetch((req) => (req.url.startsWith(BASE) ? fhir.handle(req) : new Response("unexpected host", { status: 599 })));
}

async function w(method: string, path: string, body: unknown = {}, user = "d2p1", e = nisEnv()) {
  const r = await call(`/api${path}`, { method, headers: { "content-type": "application/json", "x-demo-user": user, "x-data-epoch": "1" }, body: JSON.stringify(body) }, e);
  return { status: r.status, body: (await r.json()) as Body };
}
async function get(path: string, user = "d2p1", e = nisEnv()) {
  const r = await call(`/api${path}`, { headers: { "x-demo-user": user } }, e);
  return { status: r.status, body: (await r.json()) as Record<string, any> };
}
const accessLog = () => q<{ action: string; what_cs: string; case_id: string | null; target_type: string | null; target_id: string | null }>("SELECT * FROM access_log ORDER BY id");

beforeEach(async () => {
  await loadFixture();
  clearNisTokens();
  logged = [];
  for (const m of ["log", "error", "warn", "info"] as const) vi.spyOn(console, m).mockImplementation((...a: unknown[]) => void logged.push(a.map(String).join(" ")));
});
afterEach(() => vi.restoreAllMocks());

// Nothing that identifies a patient may be in a URL sent to the NIS, a log line or the access log.
async function expectNoIdentityLeak(...numbers: string[]) {
  const digits = numbers.flatMap((n) => [n, n.replace("/", "")]);
  for (const r of fhir.requests) for (const d of digits) expect(r.url).not.toContain(d);
  for (const line of logged) for (const d of [...digits, FAKE_NAME]) expect(line).not.toContain(d);
  for (const row of await accessLog()) for (const d of [...digits, FAKE_NAME, "Zkušební", "Testová"]) expect(JSON.stringify(row)).not.toContain(d);
}

describe("NIS configuration", () => {
  it("hides the NIS on /me unless the org has one", async () => {
    expect((await get("/me", "d2p1", testEnv())).body.nis).toBeNull();
    expect((await get("/me")).body.nis).toEqual({ label_cs: "Testovací NIS" });
    // Org B has no entry in the config.
    expect((await get("/me", "b-doc")).body.nis).toBeNull();
    expect((await w("POST", "/cases/NO-A/nis/search", {}, "d2p1", testEnv())).body.error?.code).toBe("nis_off");
  });

  it("refuses an unsafe configuration instead of using it", () => {
    const bad = (c: unknown) => () => nisConfig(testEnv({ NIS_CONFIG: JSON.stringify({ "demo-a": c }) }), "demo-a");
    // No authentication is for the test server only.
    expect(bad({ base_url: "https://nis.fno.example/fhir", auth: { mode: "none" } })).toThrow();
    expect(bad({ base_url: "http://nis.fno.example/fhir", auth: { mode: "smart_user" } })).toThrow();
    // The key must sit in a NIS_* secret, never in another one such as the login's.
    expect(bad({ base_url: "https://nis.fno.example/fhir", auth: { mode: "backend_services", token_url: "https://nis.fno.example/token", client_id: "cb", scope: "system/Patient.rs", key_secret: "OIDC_CLIENT_SECRET", alg: "RS384" } })).toThrow();
    expect(bad({ base_url: "https://user:pw@nis.fno.example/fhir", auth: { mode: "smart_user" } })).toThrow();
    expect(nisConfig(testEnv({ NIS_CONFIG: "{}" }), "demo-a")).toBeNull();
  });
});

describe("patient search", () => {
  it("searches by the patient's own birth number as a POST _search, with nothing identifying in the URL or logs", async () => {
    server();
    const r = await w("POST", "/cases/NO-A/nis/search");
    expect(r.status).toBe(200);
    const d = r.body.data!;
    expect(d.candidates).toHaveLength(1);
    expect(d.candidates[0]).toMatchObject({ nis_id: "t-pt-a", identity: "matches", name_match: "same", linkable: true, birth_date: "1964-03-12" });
    expect(d.candidates[0]).not.toHaveProperty("birth_number");
    expect(d.national_register.status).toBe("stub");
    const req = fhir.requests.find((x) => x.method === "POST")!;
    expect(new URL(req.url).pathname).toBe("/fhir/Patient/_search");
    expect(req.contentType).toContain("application/x-www-form-urlencoded");
    expect((await accessLog()).filter((x) => x.action === "nis.search")).toEqual([
      expect.objectContaining({ case_id: "NO-A", what_cs: "vyhledal(a) pacienta v NIS", target_type: "nis", target_id: "Patient" }),
    ]);
    await expectNoIdentityLeak(RC_A);
  });

  it("shows every record of a duplicated birth number and merges none (F01)", async () => {
    server();
    // NO-B's patient has no birth number, so the person types one.
    const r = await w("POST", "/cases/NO-B/nis/search", { birth_number: RC_F01 });
    const cs = r.body.data!.candidates as Record<string, any>[];
    expect(cs.map((c) => c.nis_id)).toEqual(["cb-f01-a", "cb-f01-b", "cb-f01-c"]);
    expect(r.body.data!.duplicates).toBe(true);
    // b was merged into a by the NIS: shown, not linkable, pointing at a. Its number is stored without the slash.
    expect(cs[1]).toMatchObject({ active: false, replaced_by: "cb-f01-a", linkable: false, birth_number_matches: true });
    expect(cs[0]).toMatchObject({ linkable: true, identity: "cannot_verify" });
    expect(cs[2]).toMatchObject({ linkable: true, name: "Jiri Zkusebni" });
    expect(await q("SELECT * FROM patient_nis_links")).toHaveLength(0);
    await expectNoIdentityLeak(RC_F01);
  });

  it("refuses a typed number that differs from the patient's, and a malformed one", async () => {
    server();
    expect((await w("POST", "/cases/NO-A/nis/search", { birth_number: RC_F01 })).body.error?.code).toBe("nis_birth_number_differs");
    expect((await w("POST", "/cases/NO-B/nis/search", { birth_number: "12-34" })).body.error?.code).toBe("invalid_input");
    expect((await w("POST", "/cases/NO-B/nis/search", {})).body.error?.code).toBe("invalid_input");
    expect(fhir.requests).toHaveLength(0);
  });

  it("keeps roles and orgs apart", async () => {
    server();
    expect((await w("POST", "/cases/NO-A/nis/search", {}, "admin")).status).toBe(403);
    // A doctor outside NO-A's team (d1p1 is in neurosurgery only).
    expect((await w("POST", "/cases/NO-A/nis/search", {}, "d1p1")).body.error?.code).toBe("not_member");
    // Org B with a NIS of its own still does not see org A's case.
    const both = nisEnv({ NIS_CONFIG: JSON.stringify({ "demo-a": JSON.parse(CONFIG)["demo-a"], "demo-b": JSON.parse(CONFIG)["demo-a"] }) });
    expect((await w("POST", "/cases/NO-A/nis/search", {}, "b-doc", both)).status).toBe(404);
    expect(fhir.requests).toHaveLength(0);
  });
});

describe("linking", () => {
  it("links a matching record after reading it again, once, and logs who did it", async () => {
    server();
    const r = await w("POST", "/cases/NO-A/nis/link", { nis_patient_id: "t-pt-a" });
    expect(r.status).toBe(200);
    expect(r.body.data!.link).toMatchObject({ nis_patient_id: "t-pt-a", nis_version: "1", identity_check: "matches", by_name: "MUDr. Svobodová" });
    expect(fhir.requests.at(-1)).toMatchObject({ method: "GET", url: `${BASE}/Patient/t-pt-a` });
    expect(await q("SELECT org_id, patient_id, nis_system, nis_patient_id, identity_check FROM patient_nis_links")).toEqual([
      { org_id: "demo-a", patient_id: "pt-A", nis_system: BASE, nis_patient_id: "t-pt-a", identity_check: "matches" },
    ]);
    expect((await accessLog()).map((x) => x.action)).toEqual(["nis.read", "nis.link"]);
    expect((await w("POST", "/cases/NO-A/nis/link", { nis_patient_id: "t-pt-a" })).body.error?.code).toBe("nis_already_linked");
    expect((await get("/cases/NO-A/nis")).body.link.nis_patient_id).toBe("t-pt-a");
    await expectNoIdentityLeak(RC_A);
  });

  it("refuses a merged record, a record without the patient's birth number, and a missing one", async () => {
    server();
    const merged = await w("POST", "/cases/NO-B/nis/link", { nis_patient_id: "cb-f01-b", birth_number: RC_F01, confirm_unverified: true });
    expect(merged.body.error?.code).toBe("nis_not_linkable");
    expect(merged.body.error?.fields?.nis_patient_id).toContain("cb-f01-a");
    // S01's record has another birth number than NO-A's patient: a conflict is never linked.
    expect((await w("POST", "/cases/NO-A/nis/link", { nis_patient_id: "cb-s01" })).body.error?.code).toBe("nis_not_linkable");
    expect((await w("POST", "/cases/NO-A/nis/link", { nis_patient_id: "nobody" })).body.error?.code).toBe("nis_patient_not_found");
    expect((await w("POST", "/cases/NO-A/nis/link", { nis_patient_id: "../Observation/x" })).body.error?.code).toBe("invalid_input");
    expect(await q("SELECT * FROM patient_nis_links")).toHaveLength(0);
  });

  it("links a patient without a birth number only with explicit confirmation", async () => {
    server();
    const body = { nis_patient_id: "cb-f01-a", birth_number: RC_F01 };
    expect((await w("POST", "/cases/NO-B/nis/link", body)).body.error?.code).toBe("nis_confirm_required");
    const r = await w("POST", "/cases/NO-B/nis/link", { ...body, confirm_unverified: true });
    expect(r.body.data!.link.identity_check).toBe("cannot_verify");
    expect((await accessLog()).at(-1)!.what_cs).toContain("potvrzeno uživatelem");
  });

  it("never gives one NIS record to two patients, and unlinks", async () => {
    server();
    await env.DB.prepare(
      "INSERT INTO patient_nis_links (org_id, patient_id, nis_system, nis_patient_id, identity_check, by_user_id, by_name) VALUES ('demo-a','pt-B',?1,'t-pt-a','cannot_verify','d2p1','x')",
    ).bind(BASE).run();
    expect((await w("POST", "/cases/NO-A/nis/link", { nis_patient_id: "t-pt-a" })).body.error?.code).toBe("nis_record_taken");
    const u = await w("DELETE", "/cases/NO-B/nis/link");
    expect(u.status).toBe(200);
    expect(await q("SELECT * FROM patient_nis_links")).toHaveLength(0);
    expect((await w("DELETE", "/cases/NO-B/nis/link")).body.error?.code).toBe("nis_not_linked");
    expect((await w("POST", "/cases/NO-A/nis/link", { nis_patient_id: "t-pt-a" })).status).toBe(200);
  });

  it("removes the org's links on a demo reset", async () => {
    server();
    await w("POST", "/cases/NO-A/nis/link", { nis_patient_id: "t-pt-a" });
    await env.DB.prepare("UPDATE demo_state SET reset_in_progress = 1 WHERE org_id = 'demo-a'").run();
    expect(await q("SELECT * FROM patient_nis_links")).toHaveLength(0);
  });
});

describe("FHIR connector", () => {
  const cfg = { base_url: BASE, label_cs: "x", auth: { mode: "none" as const } };
  const fast = { attempts: 3, baseMs: 1, maxDelayMs: 5, timeoutMs: 2000, deadlineMs: 5000 };
  const pulls: string[] = [];
  const client = (c: ConstructorParameters<typeof NisClient>[2] = cfg, e = nisEnv()) => new NisClient(e, "demo-a", c, async (p) => void pulls.push(`${p.op}:${p.resource}`), fast);

  it("backs off on 429 and then answers", async () => {
    server();
    fhir.failNext(429, 2, "0");
    const r = await client().searchPatientsByIdentifier(rcisSearchValue(RC_A.replace("/", "")));
    expect(r.resources.map((x) => x.id)).toEqual(["t-pt-a"]);
    expect(fhir.requests.filter((x) => x.method === "POST")).toHaveLength(3);
    expect(logged.some((l) => l.includes('"attempts":3'))).toBe(true);
  });

  it("gives up after the attempts with the busy answer", async () => {
    server();
    fhir.failNext(503, 5);
    await expect(client().searchPatientsByIdentifier(rcisSearchValue("6453121234"))).rejects.toMatchObject({ code: "upstream_busy" });
  });

  it("follows next links within the base and stops at a link to another host", async () => {
    server();
    const many = Array.from({ length: 25 }, (_, i) => ({
      resource: { resourceType: "Patient", id: `dup-${String(i).padStart(2, "0")}`, identifier: [{ system: "https://ncez.mzcr.cz/fhir/sid/rcis", value: "7001011234" }] },
      request: { method: "PUT", url: `Patient/dup-${String(i).padStart(2, "0")}` },
    }));
    fhir.load({ resourceType: "Bundle", type: "transaction", entry: many });
    const r = await client().searchPatientsByIdentifier(rcisSearchValue("7001011234"));
    expect(r.resources).toHaveLength(25);
    expect(r.truncated).toBe(false);
    expect(fhir.requests.filter((x) => x.url.includes("_getpages"))).toHaveLength(1);

    vi.restoreAllMocks();
    const evil = mockFetch(() =>
      new Response(JSON.stringify({ resourceType: "Bundle", type: "searchset", link: [{ relation: "next", url: "https://evil.example/fhir?_getpages=x" }], entry: [] }), { status: 200 }),
    );
    const r2 = await client().searchPatientsByIdentifier(rcisSearchValue("7001011234"));
    expect(r2.truncated).toBe(true);
    expect(evil.calls.map((x) => new URL(x.url).host)).toEqual(["nis.test"]);
  });

  it("writes the access-log row before every pull", async () => {
    server();
    pulls.length = 0;
    await client().read("Patient", "cb-s02");
    await client().searchPatientsByIdentifier(rcisSearchValue("5856144019"));
    expect(pulls).toEqual(["read:Patient", "search:Patient"]);
    // A failed log write stops the pull.
    const blocked = new NisClient(nisEnv(), "demo-a", cfg, async () => { throw new Error("log down"); }, fast);
    const before = fhir.requests.length;
    await expect(blocked.read("Patient", "cb-s02")).rejects.toThrow("log down");
    expect(fhir.requests.length).toBe(before);
  });

  it("finds S02 by the referral's birth number written with the slash", async () => {
    server();
    const r = await client().searchPatientsByIdentifier(rcisSearchValue("5856144019"));
    expect(r.resources.map((x) => x.id)).toEqual(["cb-s02"]);
  });

  it("answers 503 for SMART on FHIR until the launch is built", async () => {
    server();
    await expect(client({ ...cfg, auth: { mode: "smart_user" } }).read("Patient", "cb-s02")).rejects.toMatchObject({ code: "nis_launch_missing" });
    expect(fhir.requests).toHaveLength(0);
  });

  it("gets a backend-services token with a signed client assertion and reuses it", async () => {
    const keys = (await crypto.subtle.generateKey({ name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-384" }, true, ["sign", "verify"])) as CryptoKeyPair;
    const pkcs8 = new Uint8Array((await crypto.subtle.exportKey("pkcs8", keys.privateKey)) as ArrayBuffer);
    const pem = `-----BEGIN PRIVATE KEY-----\n${btoa(String.fromCharCode(...pkcs8)).replace(/(.{64})/g, "$1\n")}\n-----END PRIVATE KEY-----`;
    fhir = new MemoryFhir(BASE, { bearer: "tok-1" });
    fhir.load(JSON.parse(env.TEST_NIS_BUNDLES)["s02"]);
    const tokenCalls: URLSearchParams[] = [];
    mockFetch(async (req) => {
      if (req.url === "https://auth.nis.test/token") {
        tokenCalls.push(new URLSearchParams(new TextDecoder().decode(await req.arrayBuffer())));
        return Response.json({ access_token: "tok-1", token_type: "bearer", expires_in: 300 });
      }
      return fhir.handle(req);
    });
    const bs = { base_url: BASE, label_cs: "x", auth: { mode: "backend_services" as const, token_url: "https://auth.nis.test/token", client_id: "codebridge", scope: "system/Patient.rs", key_secret: "NIS_DEMO_A_KEY", alg: "RS384" as const, kid: "k1" } };
    const c = client(bs, nisEnv({ NIS_DEMO_A_KEY: pem }));
    expect((await c.read("Patient", "cb-s02"))?.id).toBe("cb-s02");
    expect((await c.read("Patient", "cb-s02"))?.id).toBe("cb-s02");
    expect(tokenCalls).toHaveLength(1);
    const t = tokenCalls[0]!;
    expect(t.get("grant_type")).toBe("client_credentials");
    expect(t.get("client_assertion_type")).toBe("urn:ietf:params:oauth:client-assertion-type:jwt-bearer");
    const [h, p] = t.get("client_assertion")!.split(".").slice(0, 2).map((x) => JSON.parse(atob(x.replace(/-/g, "+").replace(/_/g, "/"))));
    expect(h).toMatchObject({ alg: "RS384", kid: "k1" });
    expect(p).toMatchObject({ iss: "codebridge", sub: "codebridge", aud: "https://auth.nis.test/token" });
    expect(p.exp - p.iat).toBeLessThanOrEqual(300);
    expect(fhir.requests.every((r) => r.authorization === "Bearer tok-1")).toBe(true);
    for (const l of logged) expect(l).not.toContain("tok-1");
  });
});
