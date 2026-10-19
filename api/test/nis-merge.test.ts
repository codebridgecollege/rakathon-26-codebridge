// The NIS import in the case merge (issue #22, phase 2b; docs/research/2026-10-20-case-merge-contract.md, "The NIS
// fragment"): POST /cases/:id/nis/import maps the linked patient's NIS record into the case's NIS fragment and starts
// ProcessCase, which composes it with the documents into one stored run. Refresh asks for changes first; unlinking takes
// the NIS facts out. Org B is the pipeline org (PIPELINE_ORGS); its NIS is the in-memory test server.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { env } from "cloudflare:workers";
import { introspectWorkflow } from "cloudflare:test";
import { call, mockFetch, testEnv } from "./helpers";
import { loadFixture } from "./data";
import { MemoryFhir } from "../../fhir/nis/memory-server";
import { nisImportKey } from "../src/store/nis";
import { composeCaseRun, storeCaseRun } from "../src/store/case-merge";
import { actorFor } from "../src/store/audio";
import { FACT_KINDS, type ExtractionRun } from "@codebridge/domain/extraction/types";

const BASE = "https://nis.test/fhir";
const NIS = { base_url: BASE, label_cs: "Testovací NIS", auth: { mode: "none" } };
const nisEnv = (over: Record<string, unknown> = {}) => testEnv({ NIS_CONFIG: JSON.stringify({ "demo-a": NIS, "demo-b": NIS }), PIPELINE_ORGS: "demo-b", ...over });
let fhir: MemoryFhir;
let clock = "2026-10-19T08:00:00.000Z";

type Body = { data?: Record<string, any>; error?: { code: string } };
async function w(method: string, path: string, user = "b-doc", e = nisEnv()) {
  const r = await call(`/api${path}`, { method, headers: { "content-type": "application/json", "x-demo-user": user, "x-data-epoch": "1" }, body: "{}" }, e);
  return { status: r.status, body: (await r.json()) as Body };
}
const one = async <T = Record<string, any>>(sql: string) => (await env.DB.prepare(sql).first<T>())!;
const currentRun = async () => {
  const row = await one<{ producer: string; r2_key: string } | null>("SELECT producer, r2_key FROM extraction_runs WHERE org_id = 'demo-b' AND case_id = 'B-NO-A' AND is_current = 1");
  return { producer: row!.producer, run: (await (await env.DOCS.get(row!.r2_key))!.json()) as ExtractionRun };
};

// Imports and waits for the merge the route started.
async function importAndMerge(user = "b-doc") {
  await using cases = await introspectWorkflow(env.PROCESS_CASE);
  await cases.modifyAll(async (m) => {
    await m.disableRetryDelays();
  });
  const r = await w("POST", "/cases/B-NO-A/nis/import", user);
  for (const i of await cases.get()) await i.waitForStatus("complete");
  return r;
}

beforeEach(async () => {
  await loadFixture();
  clock = "2026-10-19T08:00:00.000Z";
  fhir = new MemoryFhir(BASE, { now: () => clock });
  for (const b of Object.values(JSON.parse(env.TEST_NIS_BUNDLES) as Record<string, Record<string, unknown>>)) fhir.load(b);
  mockFetch((req) => (req.url.startsWith(BASE) ? fhir.handle(req) : new Response("unexpected host", { status: 599 })));
  // Org B's case without its prepared fixture run, linked to S01's NIS record.
  await env.DB.batch([
    env.DB.prepare("UPDATE extraction_runs SET is_current = 0 WHERE org_id = 'demo-b' AND case_id = 'B-NO-A'"),
    env.DB.prepare("INSERT INTO patient_nis_links (org_id, patient_id, nis_system, nis_patient_id, identity_check, by_user_id, by_name) VALUES ('demo-b','pt-BA',?1,'cb-s01','cannot_verify','b-doc','x')").bind(BASE),
  ]);
});
afterEach(() => vi.restoreAllMocks());

describe("NIS import into the case run", () => {
  it("stores one run with producer nis whose facts come from the NIS, valid, and never says nothing found", async () => {
    const r = await importAndMerge();
    expect(r.status).toBe(200);
    expect(r.body.data).toMatchObject({ changed: true, merge_started: true });
    expect(await env.DOCS.head(nisImportKey("demo-b", "B-NO-A"))).not.toBeNull();
    const { producer, run } = await currentRun();
    expect(producer).toBe("nis");
    expect(run.facts.length).toBe(r.body.data!.facts);
    expect(run.facts.every((f) => f.origin === "nis")).toBe(true);
    expect(run.sources.every((s) => s.type === "nis")).toBe(true);
    expect(run.documents).toEqual([]);
    expect(run.checks.find((c) => c.looks_for === "lab_result")?.result).toBe("found");
    // No fact kind says "nothing found" (the case rules' own checks, contradiction and chronology, are rule results
    // over the facts, not statements about the documentation).
    expect(run.checks.some((c) => (FACT_KINDS as readonly string[]).includes(c.looks_for) && c.result === "nothing_found")).toBe(false);
    // S01's PET/CT request stays requested with no result through the merge.
    expect(run.facts.find((f) => f.kind === "request" && f.value.what === "PET/CT s 18F-FET")).toMatchObject({ status: "requested", value: { result_fact: null } });
  });

  it("refreshes only when the NIS changed, and keeps fact IDs; a changed value shows under the same ID", async () => {
    await importAndMerge();
    const first = (await currentRun()).run;
    const unchanged = await importAndMerge();
    expect(unchanged.body.data).toMatchObject({ changed: false, facts: null });
    clock = "2026-10-20T08:00:00.000Z";
    const lab = JSON.parse(env.TEST_NIS_BUNDLES)["s01"].entry.find((e: any) => e.resource.id === "cb-s01-lab-2026-10-06-s-creae").resource;
    fhir.load({ resourceType: "Bundle", type: "transaction", entry: [{ resource: { ...lab, valueQuantity: { value: 141, unit: "µmol/l" } }, request: { method: "PUT", url: `Observation/${lab.id}` } }] });
    const again = await importAndMerge();
    expect(again.body.data).toMatchObject({ changed: true });
    const second = (await currentRun()).run;
    expect(second.facts.map((f) => f.id).sort()).toEqual(first.facts.map((f) => f.id).sort());
    const src = second.sources.find((s) => s.type === "nis" && s.resource === `Observation/${lab.id}`)!;
    expect(second.facts.find((f) => f.sources.includes(src.id))!.value).toMatchObject({ value_numeric: 141 });
  });

  it("takes the NIS facts out of every case of the patient when the link is removed, in the view at once", async () => {
    // A second case of the same patient, with its own import.
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO cases (id, org_id, case_no, patient_id, source_file, list_order, status, processing_level, question_text, question_explicit, diagnosis_text, owner_user_id, owner_name, submitted_on, updated_on)
         VALUES ('B-NO-2','demo-b','NO-2','pt-BA','B2_pacient.pdf',1,'ready','none',NULL,0,NULL,'b-doc','MUDr. Bédoktorová','2026-10-14','2026-10-16')`,
      ),
      env.DB.prepare("INSERT INTO case_members (org_id, case_id, dept_id, reason) VALUES ('demo-b','B-NO-2','b-d1','test')"),
    ]);
    await importAndMerge();
    {
      await using cases = await introspectWorkflow(env.PROCESS_CASE);
      expect((await w("POST", "/cases/B-NO-2/nis/import")).status).toBe(200);
      for (const i of await cases.get()) await i.waitForStatus("complete");
    }
    // Unlinked: before any merge has run, the view already leaves the NIS facts out.
    await env.DB.prepare("DELETE FROM patient_nis_links WHERE org_id = 'demo-b'").run();
    const view = await call("/api/cases/B-NO-2/extraction", { headers: { "x-demo-user": "b-doc" } }, nisEnv());
    const data = ((await view.json()) as { data: ExtractionRun }).data;
    expect(data.facts).toEqual([]);
    expect(data.sources).toEqual([]);
    expect(data.checks.some((c) => c.result === "found")).toBe(false);
    // Through the route: both cases' imports go and both are composed again.
    await env.DB.prepare("INSERT INTO patient_nis_links (org_id, patient_id, nis_system, nis_patient_id, identity_check, by_user_id, by_name, at) VALUES ('demo-b','pt-BA',?1,'cb-s01','cannot_verify','b-doc','x','2026-10-19T09:00:00.000Z')").bind(BASE).run();
    await using cases = await introspectWorkflow(env.PROCESS_CASE);
    expect((await w("DELETE", "/cases/B-NO-A/nis/link")).status).toBe(200);
    for (const i of await cases.get()) await i.waitForStatus("complete");
    expect(await env.DOCS.head(nisImportKey("demo-b", "B-NO-A"))).toBeNull();
    expect(await env.DOCS.head(nisImportKey("demo-b", "B-NO-2"))).toBeNull();
    expect((await currentRun()).run.facts).toEqual([]);
    const two = await one<{ r2_key: string }>("SELECT r2_key FROM extraction_runs WHERE org_id = 'demo-b' AND case_id = 'B-NO-2' AND is_current = 1");
    expect(((await (await env.DOCS.get(two.r2_key))!.json()) as ExtractionRun).facts).toEqual([]);
  });

  it("never stores NIS facts composed before an unlink or relink", async () => {
    await importAndMerge();
    const c = await composeCaseRun(env, "demo-b", "B-NO-A");
    expect("run" in c && c.nis_import).toBeTruthy();
    // Relinked in between (a new link has a new time): the store step refuses the composed run as stale.
    await env.DB.prepare("UPDATE patient_nis_links SET at = '2026-10-19T23:00:00.000Z' WHERE org_id = 'demo-b'").run();
    const who = await actorFor(env.DB, "demo-b", "b-doc", "demo");
    await expect(storeCaseRun(env, "demo-b", "B-NO-A", who, c as Exclude<typeof c, { result: string }>)).rejects.toMatchObject({ code: "run_stale" });
  });

  it("serves an earlier run's NIS fact only while the link that run took it by is the patient's", async () => {
    await importAndMerge();
    const row = await one<{ id: string; r2_key: string }>("SELECT id, r2_key FROM extraction_runs WHERE org_id = 'demo-b' AND case_id = 'B-NO-A' AND is_current = 1");
    const run = (await (await env.DOCS.get(row.r2_key))!.json()) as ExtractionRun;
    const fact = run.facts.find((f) => f.origin === "nis")!;
    const earlier = (u = "b-doc") => call(`/api/cases/B-NO-A/runs/${row.id}/facts/${fact.id}`, { headers: { "x-demo-user": u } }, nisEnv());
    expect((await earlier()).status).toBe(200);
    await env.DB.prepare("UPDATE patient_nis_links SET nis_patient_id = 'cb-s02', at = '2026-10-19T23:00:00.000Z' WHERE org_id = 'demo-b'").run();
    expect((await earlier()).status).toBe(404);
  });

  it("is refused on a closed case", async () => {
    await env.DB.prepare("UPDATE cases SET status = 'closed' WHERE org_id = 'demo-b' AND id = 'B-NO-A'").run();
    expect((await w("POST", "/cases/B-NO-A/nis/import")).body.error?.code).toBe("case_locked");
  });

  it("pulls everything again when the last pull was cut off, and starts the merge also when nothing changed", async () => {
    await importAndMerge();
    const imp = (await (await env.DOCS.get(nisImportKey("demo-b", "B-NO-A")))!.json()) as { state: { truncated: string[] } };
    imp.state.truncated = ["Observation"];
    await env.DOCS.put(nisImportKey("demo-b", "B-NO-A"), JSON.stringify(imp));
    const r = await importAndMerge();
    expect(r.body.data).toMatchObject({ changed: true });
    const same = await importAndMerge();
    expect(same.body.data).toMatchObject({ changed: false, merge_started: true });
  });

  it("is refused where the case merge does not run, and without a link", async () => {
    expect((await w("POST", "/cases/NO-A/nis/import", "d2p1")).body.error?.code).toBe("nis_not_linked");
    await env.DB.prepare("INSERT INTO patient_nis_links (org_id, patient_id, nis_system, nis_patient_id, identity_check, by_user_id, by_name) VALUES ('demo-a','pt-A',?1,'t-x','cannot_verify','d2p1','x')").bind(BASE).run();
    expect((await w("POST", "/cases/NO-A/nis/import", "d2p1")).body.error?.code).toBe("nis_merge_off");
    expect(fhir.requests).toHaveLength(0);
  });
});
