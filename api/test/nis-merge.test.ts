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

describe("NIS documents into the case", () => {
  // A minimal PDF, so the upload path keeps it as a PDF.
  const pdf = (marker: string) => btoa(`%PDF-1.4\n% ${marker}\n1 0 obj << >> endobj\ntrailer << >>\n%%EOF\n`);
  const docEnv = (over: Record<string, unknown> = {}) => nisEnv({ UPLOAD_POLICY: "fixtures_only", UPLOAD_STORE_ORGS: "demo-b", PAGE_READER_URL: "", ...over });
  const loadDoc = (id: string, marker: string, extra: Record<string, unknown> = {}) => loadDocInto(fhir, id, marker, extra);
  const loadDocInto = (server: MemoryFhir, id: string, marker: string, extra: Record<string, unknown> = {}) =>
    server.load({
      resourceType: "Bundle",
      type: "transaction",
      entry: [
        { resource: { resourceType: "Binary", id: `${id}-bin`, contentType: "application/pdf", data: pdf(marker) }, request: { method: "PUT", url: `Binary/${id}-bin` } },
        {
          resource: {
            resourceType: "DocumentReference", id, status: "current", subject: { reference: "Patient/cb-s01" }, description: "Ambulantní zpráva",
            context: { period: { start: "2026-10-06" } }, content: [{ attachment: { contentType: "application/pdf", url: `Binary/${id}-bin` } }], ...extra,
          },
          request: { method: "PUT", url: `DocumentReference/${id}` },
        },
      ],
    });
  const docRows = () =>
    env.DB.prepare("SELECT d.id, d.origin, d.lifecycle, d.superseded_by, d.state, d.original_r2_key IS NOT NULL AS kept, n.nis_resource, n.nis_version FROM documents d JOIN nis_documents n ON n.document_id = d.id AND n.org_id = d.org_id WHERE d.org_id = 'demo-b' AND d.case_id = 'B-NO-A' ORDER BY d.created_at, d.id").all<Record<string, any>>();

  it("takes the record's PDF in as an upload, records where it came from, and skips it on the next import", async () => {
    loadDoc("dr-1", "first");
    const r = await w("POST", "/cases/B-NO-A/nis/import", "b-doc", docEnv());
    expect(r.status).toBe(200);
    // S01's own DocumentReference has no Binary in the test data (its PDF bytes are left out), so only dr-1 comes in.
    expect(r.body.data!.documents).toMatchObject({ imported: 1, superseded: 0 });
    const rows = (await docRows()).results;
    expect(rows).toMatchObject([{ origin: "upload", lifecycle: "current", kept: 1, nis_resource: "DocumentReference/dr-1", nis_version: "1" }]);
    // The access log names the document read, not its content.
    const log = (await env.DB.prepare("SELECT action, target_id FROM access_log WHERE org_id = 'demo-b' AND action IN ('nis.document','document.upload') ORDER BY id").all()).results;
    // One row per document read (S01's own, whose Binary is missing, is logged as the attempt it was) and the upload.
    expect(log).toEqual(
      expect.arrayContaining([
        { action: "nis.document", target_id: "DocumentReference/cb-s01-doc-all" },
        { action: "nis.document", target_id: "DocumentReference/dr-1" },
        { action: "document.upload", target_id: rows[0]!.id },
      ]),
    );
    expect(log).toHaveLength(3);
    // Nothing changed in the NIS: no second copy.
    const again = await w("POST", "/cases/B-NO-A/nis/import", "b-doc", docEnv());
    expect(again.body.data!.changed).toBe(false);
    expect((await docRows()).results).toHaveLength(1);
  });

  // The next import pulls everything again, as a day after the last full pull.
  const ageImport = async () => {
    const k = nisImportKey("demo-b", "B-NO-A");
    const x = (await (await env.DOCS.get(k))!.json()) as { state: { imported_at: string } };
    x.state.imported_at = "2026-01-01T00:00:00.000Z";
    await env.DOCS.put(k, JSON.stringify(x));
  };

  it("takes a large record in over several clicks", async () => {
    for (let i = 0; i < 12; i++) loadDoc(`dr-m${String(i).padStart(2, "0")}`, `m${i}`);
    const first = await w("POST", "/cases/B-NO-A/nis/import", "b-doc", docEnv());
    // Ten reads per click (S01's own document, without a Binary in the test data, is one of them).
    expect(first.body.data!.documents).toMatchObject({ imported: 9, more: true });
    const second = await w("POST", "/cases/B-NO-A/nis/import", "b-doc", docEnv());
    expect(second.body.data).toMatchObject({ changed: false });
    expect(second.body.data!.documents).toMatchObject({ imported: 3, more: false });
    expect((await docRows()).results).toHaveLength(12);
  });

  it("never takes back a document the case declined: withdrawn as another patient's, or deleted", async () => {
    loadDoc("dr-1", "first");
    loadDoc("dr-2", "second");
    await w("POST", "/cases/B-NO-A/nis/import", "b-doc", docEnv());
    const rows = (await docRows()).results;
    await env.DB.prepare("UPDATE documents SET lifecycle = 'withdrawn', lifecycle_changed_at = '2026-10-19T09:00:00.000Z', lifecycle_changed_by = 'b-doc' WHERE id = ?1").bind(rows[0]!.id).run();
    expect((await w("DELETE", `/documents/${rows[1]!.id}`, "b-doc", docEnv())).status).toBe(200);
    // A new version of both in the NIS, and a full pull.
    clock = "2026-10-20T08:00:00.000Z";
    loadDoc("dr-1", "first again");
    loadDoc("dr-2", "second again");
    await ageImport();
    const r = await w("POST", "/cases/B-NO-A/nis/import", "b-doc", docEnv());
    expect(r.body.data!.documents).toMatchObject({ imported: 0, declined: 2, superseded: 0 });
    expect((await env.DB.prepare("SELECT COUNT(*) AS n FROM documents WHERE org_id = 'demo-b' AND case_id = 'B-NO-A' AND origin = 'upload' AND lifecycle = 'current'").first<{ n: number }>())!.n).toBe(0);
    expect((await env.DB.prepare("SELECT COUNT(*) AS n FROM access_log WHERE org_id = 'demo-b' AND action = 'document.supersede'").first<{ n: number }>())!.n).toBe(0);
  });

  it("keeps two documents with the same title apart where content is not kept, and skips what it cannot store", async () => {
    loadDoc("dr-a", "a");
    loadDoc("dr-b", "b");
    fhir.load({
      resourceType: "Bundle",
      type: "transaction",
      entry: [
        { resource: { resourceType: "DocumentReference", id: "dr-txt", status: "current", subject: { reference: "Patient/cb-s01" }, content: [{ attachment: { contentType: "text/plain", url: "Binary/x" } }] }, request: { method: "PUT", url: "DocumentReference/dr-txt" } },
        { resource: { resourceType: "DocumentReference", id: "dr-err", status: "entered-in-error", subject: { reference: "Patient/cb-s01" }, content: [{ attachment: { contentType: "application/pdf", url: "Binary/dr-a-bin" } }] }, request: { method: "PUT", url: "DocumentReference/dr-err" } },
      ],
    });
    const r = await w("POST", "/cases/B-NO-A/nis/import", "b-doc", docEnv({ UPLOAD_STORE_ORGS: "" }));
    expect(r.body.data!.documents).toMatchObject({ imported: 2 });
    expect((await docRows()).results.map((x) => x.nis_resource).sort()).toEqual(["DocumentReference/dr-a", "DocumentReference/dr-b"]);
  });

  it("lists an attachment the NIS says is too large without fetching it", async () => {
    loadDoc("dr-big", "big", { content: [{ attachment: { contentType: "application/pdf", url: "Binary/dr-big-bin", size: 50_000_000 } }] });
    const r = await w("POST", "/cases/B-NO-A/nis/import", "b-doc", docEnv());
    expect(r.body.data!.documents).toMatchObject({ imported: 1 });
    expect((await docRows()).results).toMatchObject([{ nis_resource: "DocumentReference/dr-big", kept: 0 }]);
    expect(fhir.requests.some((x) => x.url.endsWith("/Binary/dr-big-bin"))).toBe(false);
  });

  it("retires each replaced version once along a chain", async () => {
    loadDoc("dr-1", "v1");
    await w("POST", "/cases/B-NO-A/nis/import", "b-doc", docEnv());
    clock = "2026-10-20T08:00:00.000Z";
    loadDoc("dr-2", "v2", { relatesTo: [{ code: "replaces", target: { reference: "DocumentReference/dr-1/_history/1" } }] });
    expect((await w("POST", "/cases/B-NO-A/nis/import", "b-doc", docEnv())).body.data!.documents).toMatchObject({ imported: 1, superseded: 1 });
    clock = "2026-10-21T08:00:00.000Z";
    loadDoc("dr-3", "v3", { relatesTo: [{ code: "replaces", target: { reference: "DocumentReference/dr-2" } }] });
    expect((await w("POST", "/cases/B-NO-A/nis/import", "b-doc", docEnv())).body.data!.documents).toMatchObject({ imported: 1, superseded: 1 });
    expect((await docRows()).results.map((x) => x.lifecycle)).toEqual(["superseded", "superseded", "current"]);
  });

  // Imports with docEnv and waits for every merge the call started.
  const importDocs = async (over: Record<string, unknown> = {}) => {
    await using cases = await introspectWorkflow(env.PROCESS_CASE);
    await cases.modifyAll(async (m) => {
      await m.disableRetryDelays();
    });
    const r = await w("POST", "/cases/B-NO-A/nis/import", "b-doc", docEnv(over));
    for (const i of await cases.get()) await i.waitForStatus("complete");
    return r;
  };
  const nisRow = (res: string) => env.DB.prepare("SELECT n.auto_withdrawn, d.lifecycle, d.lifecycle_reason_cs, d.original_r2_key FROM nis_documents n JOIN documents d ON d.org_id = n.org_id AND d.id = n.document_id WHERE n.org_id = 'demo-b' AND n.nis_resource = ?1 ORDER BY d.created_at DESC").bind(res).first<Record<string, any>>();
  const withdrawAlerts = async () => (await currentRun()).run.alerts.filter((a) => a.rule === "nis_document_withdrawn");

  it("withdraws a document the NIS voided, logs why, and tells the doctor which", async () => {
    loadDoc("dr-1", "first");
    await importDocs();
    clock = "2026-10-20T08:00:00.000Z";
    loadDoc("dr-1", "first", { status: "entered-in-error" });
    await ageImport();
    const r = await importDocs();
    expect(r.body.data!.documents).toMatchObject({ withdrawn: 1, withdraw_pending: 0 });
    expect(await nisRow("DocumentReference/dr-1")).toMatchObject({ auto_withdrawn: "nis_voided", lifecycle: "withdrawn", lifecycle_reason_cs: "dokument byl v NIS zneplatněn", original_r2_key: null });
    const log = await env.DB.prepare("SELECT what_cs FROM access_log WHERE org_id = 'demo-b' AND action = 'document.nis_withdraw'").all<{ what_cs: string }>();
    expect(log.results.map((x) => x.what_cs)).toEqual(["dokument z NIS odebrán z případu: dokument byl v NIS zneplatněn (obsah smazán)"]);
    expect(await withdrawAlerts()).toEqual([expect.objectContaining({ kind: "missing", facts: [], message: { id: "alert-nis-document-withdrawn", args: { document: "dr-1", reason: "nis_voided" } } })]);
  });

  it("withdraws a document the NIS no longer has, and takes it back when the NIS holds it again", async () => {
    loadDoc("dr-1", "first");
    await importDocs();
    fhir.remove("DocumentReference", "dr-1");
    await ageImport();
    expect((await importDocs()).body.data!.documents).toMatchObject({ withdrawn: 1 });
    expect(await nisRow("DocumentReference/dr-1")).toMatchObject({ auto_withdrawn: "nis_removed", lifecycle: "withdrawn" });
    expect((await withdrawAlerts()).map((a) => a.message.args.reason)).toEqual(["nis_removed"]);
    // Back in the NIS: unlike a doctor's own withdraw, the import takes it in again, and the alert goes.
    clock = "2026-10-21T08:00:00.000Z";
    loadDoc("dr-1", "first");
    await ageImport();
    expect((await importDocs()).body.data!.documents).toMatchObject({ imported: 1, withdrawn: 0 });
    expect(await nisRow("DocumentReference/dr-1")).toMatchObject({ auto_withdrawn: null, lifecycle: "current" });
    expect(await withdrawAlerts()).toEqual([]);
  });

  it("withdraws the patient's NIS documents on unlink, and a deliberate re-link and import brings them back", async () => {
    loadDoc("dr-1", "first");
    await importDocs();
    {
      await using cases = await introspectWorkflow(env.PROCESS_CASE);
      expect((await w("DELETE", "/cases/B-NO-A/nis/link", "b-doc", docEnv())).status).toBe(200);
      for (const i of await cases.get()) await i.waitForStatus("complete");
    }
    expect(await nisRow("DocumentReference/dr-1")).toMatchObject({ auto_withdrawn: "nis_unlinked", lifecycle: "withdrawn" });
    expect((await withdrawAlerts()).map((a) => a.message.args.reason)).toEqual(["nis_unlinked"]);
    await env.DB.prepare("INSERT INTO patient_nis_links (org_id, patient_id, nis_system, nis_patient_id, identity_check, by_user_id, by_name, at) VALUES ('demo-b','pt-BA',?1,'cb-s01','cannot_verify','b-doc','x','2026-10-19T12:00:00.000Z')").bind(BASE).run();
    expect((await importDocs()).body.data!.documents).toMatchObject({ imported: 1 });
    expect(await nisRow("DocumentReference/dr-1")).toMatchObject({ auto_withdrawn: null, lifecycle: "current" });
    expect(await withdrawAlerts()).toEqual([]);
  });

  it("withdraws nothing when the pull of DocumentReferences was cut off", async () => {
    loadDoc("dr-1", "first");
    await importDocs();
    fhir.remove("DocumentReference", "dr-1");
    await ageImport();
    // A server that caps pages at one record: the DocumentReference list is cut off, so absence proves nothing.
    const capped = new MemoryFhir(BASE, { now: () => clock, maxCount: 1 });
    for (const b of Object.values(JSON.parse(env.TEST_NIS_BUNDLES) as Record<string, Record<string, unknown>>)) capped.load(b);
    for (let i = 0; i < 45; i++) loadDocInto(capped, `dr-z${i}`, `z${i}`);
    vi.restoreAllMocks();
    mockFetch((req) => capped.handle(req));
    const r = await importDocs();
    expect(r.body.data!.truncated).toContain("DocumentReference");
    expect(r.body.data!.documents).toMatchObject({ withdrawn: 0 });
    expect(await nisRow("DocumentReference/dr-1")).toMatchObject({ lifecycle: "current", auto_withdrawn: null });
  });

  it("retires the document the NIS replaced, as superseded by the new version", async () => {
    loadDoc("dr-1", "first");
    await w("POST", "/cases/B-NO-A/nis/import", "b-doc", docEnv());
    clock = "2026-10-20T08:00:00.000Z";
    fhir.load({ resourceType: "Bundle", type: "transaction", entry: [{ resource: { ...(await (await fhir.handle(new Request(`${BASE}/DocumentReference/dr-1`))).json() as object), status: "superseded" }, request: { method: "PUT", url: "DocumentReference/dr-1" } }] });
    loadDoc("dr-2", "corrected", { relatesTo: [{ code: "replaces", target: { reference: "DocumentReference/dr-1" } }] });
    const r = await w("POST", "/cases/B-NO-A/nis/import", "b-doc", docEnv());
    expect(r.body.data!.documents).toMatchObject({ imported: 1, superseded: 1 });
    const rows = (await docRows()).results;
    expect(rows.map((x) => [x.nis_resource, x.lifecycle])).toEqual([
      ["DocumentReference/dr-1", "superseded"],
      ["DocumentReference/dr-2", "current"],
    ]);
    expect(rows[0]!.superseded_by).toBe(rows[1]!.id);
  });

  it("starts the document pipeline for it where the pipeline runs, as for an upload", async () => {
    loadDoc("dr-1", "first");
    await using docs = await introspectWorkflow(env.PROCESS_DOCUMENT);
    await w("POST", "/cases/B-NO-A/nis/import", "b-doc", docEnv({ PAGE_READER_URL: "https://page-reader.test" }));
    const rows = (await docs.get(), (await docRows()).results);
    // Started like an upload: a pipeline run for it, and it left "stored" (the run may already be under way).
    expect(rows[0]!.state).not.toBe("stored");
    expect((await env.DB.prepare("SELECT COUNT(*) AS n FROM pipeline_runs WHERE org_id = 'demo-b' AND document_id = ?1").bind(rows[0]!.id).first<{ n: number }>())!.n).toBe(1);
  });

  it("never fetches an attachment outside this NIS, and lists a document the org does not keep without content", async () => {
    loadDoc("dr-x", "far", { content: [{ attachment: { contentType: "application/pdf", url: "https://elsewhere.example/Binary/b" } }] });
    loadDoc("dr-1", "first");
    const r = await w("POST", "/cases/B-NO-A/nis/import", "b-doc", docEnv({ UPLOAD_STORE_ORGS: "" }));
    expect(r.body.data!.documents).toMatchObject({ imported: 1 });
    expect(fhir.requests.some((x) => x.url.includes("elsewhere"))).toBe(false);
    expect((await docRows()).results).toMatchObject([{ nis_resource: "DocumentReference/dr-1", kept: 0 }]);
  });
});
