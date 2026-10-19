// codebridge.extraction/2 storage (src/store/runs.ts) and migration 0015: the copy rules of the rebuilt tables, the demo
// reset that keeps seeded runs only, run storage that refuses an invalid run and registers its IDs, and the matcher's
// inputs from D1.
import { beforeEach, describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import { applyD1Migrations, reset } from "cloudflare:test";
import { validateRun, type ExtractionRun } from "@codebridge/domain/extraction/index";
import type { Viewer } from "@codebridge/domain/access";
import { loadFixture, resetDoc, RUN_A2, RUN_A2_ID } from "./data";
import { call } from "./helpers";
import { Tx } from "../src/store/write";
import { matchInputs, prepareRun, RunInvalid, storeRun, type DraftRun } from "../src/store/runs";

const q = async <T = Record<string, unknown>>(sql: string, ...args: unknown[]) => (await env.DB.prepare(sql).bind(...args).all<T>()).results;
const one = async <T = Record<string, unknown>>(sql: string, ...args: unknown[]) => (await q<T>(sql, ...args))[0]!;
const doctor: Viewer = { id: "d2p1", name: "MUDr. Svobodová", role: "doctor", dept: null, authMode: "demo", impersonating: false, org: "demo-a", membershipId: "d2p1" };
const tx = () => new Tx(env.DB, doctor, { requestId: null, epoch: null });

// A new pipeline run of NO-A as a producer builds it: the facts of RUN_A2 drafted again (their old IDs serve as draft
// IDs, so the interval's ends resolve), plus one new symptom, and the request alert without its ID.
function draftOfA(extra: { symptom?: string } = {}): DraftRun {
  const facts = RUN_A2.facts.map(({ id, key: _k, ...f }) => ({ ...f, draft_id: id }));
  if (extra.symptom)
    facts.push({
      kind: "symptom", subject: "patient", value: { text: extra.symptom }, date: { as_written: null, precision: null, sort: null }, status: "documented",
      negated: false, not_stated: [], origin: "document", certainty: "clear", codes: [], note: null, quarantined: false, sources: ["src-0041"], draft_id: "d-new",
    } as (typeof facts)[number]);
  return {
    ...RUN_A2,
    run: { id: "run-pipeline-1", producer: "pipeline", created_at: "2026-10-19T09:00:00Z", stages: [{ name: "extract_facts", model: "test-model", prompt: "extract-facts@1" }] },
    facts,
    alerts: [
      ...RUN_A2.alerts.map(({ id: _i, ...a }) => a),
      ...(extra.symptom ? [{ rule: "symptom_unclear", subject: "d-new", kind: "unclear" as const, facts: ["d-new"], message: { id: "alert-symptom-unclear", args: { fact: "d-new" } }, note: null }] : []),
    ],
  };
}

async function storeNew(run: ExtractionRun) {
  const t = tx();
  const stored = await storeRun(t, { db: env.DB, docs: env.DOCS }, run);
  await t.commit();
  return stored;
}

beforeEach(() => loadFixture());

describe("the test fixture", () => {
  it("NO-A's /2 run passes the validator", () => {
    expect(validateRun(RUN_A2).issues).toEqual([]);
  });
});

describe("storeRun", () => {
  it("refuses an invalid run and writes nothing", async () => {
    const bad = { ...RUN_A2, run: { ...RUN_A2.run, id: "run-bad", supersedes: RUN_A2_ID }, facts: RUN_A2.facts.map((f) => (f.id === "f-5a0b11" ? { ...f, key: "performance_status|other|undated" } : f)) };
    const err = await storeRun(tx(), { db: env.DB, docs: env.DOCS }, bad).catch((e) => e);
    expect(err).toBeInstanceOf(RunInvalid);
    expect((err as RunInvalid).issues).toEqual([{ code: "key_mismatch", path: "/facts/3/key" }]);
    // The run ID becomes an R2 key segment.
    const slash = await storeRun(tx(), { db: env.DB, docs: env.DOCS }, { ...RUN_A2, run: { ...RUN_A2.run, id: "../x" } }).catch((e) => e);
    expect(slash).toBeInstanceOf(RunInvalid);
    expect(await q("SELECT id FROM extraction_runs WHERE id IN ('run-bad', '../x')")).toEqual([]);
    expect((await env.DOCS.list({ prefix: "org/demo-a/extract/NO-A/" })).objects.map((o) => o.key)).toEqual([`org/demo-a/extract/NO-A/${RUN_A2_ID}.json`]);
  });

  it("stores a prepared run: R2 object, current row superseding the previous one, fact IDs and alert identities registered", async () => {
    const inputs = await matchInputs(env.DB, env.DOCS, "demo-a", "NO-A");
    const { run, match } = prepareRun(inputs, draftOfA({ symptom: "bolest hlavy" }));
    expect(validateRun(run).issues).toEqual([]);
    // Every fact of the previous run keeps its ID; the new one gets a fresh ID and its alert a derived one.
    expect(run.facts.slice(0, RUN_A2.facts.length).map((f) => f.id)).toEqual(RUN_A2.facts.map((f) => f.id));
    const fresh = run.facts.at(-1)!.id;
    expect(match.how.get(fresh)).toBe("new");
    expect(run.alerts[0]!.id).toBe(RUN_A2.alerts[0]!.id);
    expect(run.alerts[1]).toMatchObject({ subject: fresh, facts: [fresh], message: { args: { fact: fresh } } });
    expect(run.run.supersedes).toBe(RUN_A2_ID);

    const stored = await storeNew(run);
    expect(stored.r2_key).toBe("org/demo-a/runs/NO-A/run-pipeline-1.json");
    expect(await (await env.DOCS.get(stored.r2_key))!.json()).toEqual(run);
    expect(await q("SELECT id, producer, seeded, schema, supersedes, is_current, kind FROM extraction_runs WHERE case_id = 'NO-A' ORDER BY created_at")).toEqual([
      { id: "run-A", producer: "fixture", seeded: 1, schema: "codebridge.extraction/1", supersedes: null, is_current: 0, kind: "seed_fixture" },
      { id: RUN_A2_ID, producer: "fixture", seeded: 1, schema: "codebridge.extraction/2", supersedes: "run-A", is_current: 0, kind: "seed_fixture" },
      { id: "run-pipeline-1", producer: "pipeline", seeded: 0, schema: "codebridge.extraction/2", supersedes: RUN_A2_ID, is_current: 1, kind: "pipeline" },
    ]);
    // IDs issued earlier keep their first run; only the new fact and alert are registered with this one.
    expect(await q("SELECT fact_id FROM fact_ids WHERE case_id = 'NO-A' AND first_run_id = 'run-pipeline-1'")).toEqual([{ fact_id: fresh }]);
    expect((await one<{ n: number }>("SELECT COUNT(*) AS n FROM fact_ids WHERE case_id = 'NO-A'")).n).toBe(RUN_A2.facts.length + 1);
    expect(await q("SELECT id, rule, subject, kind FROM alert_identities WHERE case_id = 'NO-A' AND first_run_id = 'run-pipeline-1'")).toEqual([
      { id: run.alerts[1]!.id, rule: "symptom_unclear", subject: fresh, kind: "unclear" },
    ]);
    // The route serves the new run.
    const inputs2 = await matchInputs(env.DB, env.DOCS, "demo-a", "NO-A");
    expect(inputs2).toMatchObject({ currentRunId: "run-pipeline-1", previous: run });
  });

  it("refuses a run prepared against a run that is no longer current, and one that reads another case's document", async () => {
    const inputs = await matchInputs(env.DB, env.DOCS, "demo-a", "NO-A");
    const first = prepareRun(inputs, draftOfA()).run;
    await storeNew(first);
    // A second producer prepared against the same (now superseded) run.
    const stale = prepareRun(inputs, { ...draftOfA(), run: { ...draftOfA().run, id: "run-pipeline-2" } }).run;
    await expect(storeNew(stale)).rejects.toMatchObject({ code: "run_stale" });
    expect(await q("SELECT id FROM extraction_runs WHERE id = 'run-pipeline-2'")).toEqual([]);
    // Org B's look-alike document (same file name, its own ID) is not this case's.
    const foreign = prepareRun(await matchInputs(env.DB, env.DOCS, "demo-a", "NO-A"), { ...draftOfA(), run: { ...draftOfA().run, id: "run-pipeline-3" } }).run;
    const moved = JSON.parse(JSON.stringify(foreign).replaceAll('"A_pacient', '"b-A_pacient')) as ExtractionRun;
    moved.facts = moved.facts.map((f) => (f.kind === "lab_result" ? { ...f, key: f.key.replace("doc:A_pacient", "doc:b-A_pacient") } : f));
    expect(validateRun(moved).issues).toEqual([]);
    await expect(storeNew(moved)).rejects.toMatchObject({ code: "run_stale" });
  });
});

describe("storeRun refusals before anything is written", () => {
  it("never writes over a stored run's object, and refuses a case that is not this org's", async () => {
    const inputs = await matchInputs(env.DB, env.DOCS, "demo-a", "NO-A");
    const first = prepareRun(inputs, draftOfA()).run;
    const stored = await storeNew(first);
    const before = await (await env.DOCS.get(stored.r2_key))!.text();
    // The same run ID again (now superseding the stored run): the object stays as it was.
    const again = { ...first, run: { ...first.run, supersedes: first.run.id } };
    await expect(storeNew(again)).rejects.toMatchObject({ code: "run_stale" });
    expect(await (await env.DOCS.get(stored.r2_key))!.text()).toBe(before);
    // Org B's case, stored by org A: refused before R2 is touched.
    const b = { ...first, case_id: "B-NO-A", run: { ...first.run, id: "run-x" } };
    await expect(storeRun(tx(), { db: env.DB, docs: env.DOCS }, b)).rejects.toMatchObject({ code: "case_not_found" });
    expect((await env.DOCS.list({ prefix: "org/demo-a/runs/B-NO-A/" })).objects).toEqual([]);
  });
});

describe("matchInputs", () => {
  it("names the previous /2 run, the documents that left the current set, and every fact ID issued for the case", async () => {
    await env.DB.prepare("INSERT INTO documents (id, org_id, case_id, file_name, page_count, origin, processing) VALUES ('A_rescan','demo-a','NO-A','A_rescan.pdf',1,'upload','processed')").run();
    await env.DB.prepare(
      "UPDATE documents SET lifecycle = 'superseded', superseded_by = 'A_rescan', lifecycle_reason_cs = 'lepší sken', lifecycle_changed_at = '2026-10-19T08:00:00.000Z', lifecycle_changed_by = 'd2p1' WHERE id = 'A_pacient'",
    ).run();
    // An ID retired in an older run stays issued.
    await env.DB.prepare("INSERT INTO fact_ids (org_id, case_id, fact_id, first_run_id) VALUES ('demo-a','NO-A','f-0000beef','run-A')").run();
    const inputs = await matchInputs(env.DB, env.DOCS, "demo-a", "NO-A");
    expect(inputs.previous).toEqual(RUN_A2);
    expect(inputs.currentRunId).toBe(RUN_A2_ID);
    expect(inputs.retiredDocuments).toEqual(["A_pacient"]);
    expect(inputs.issuedIds).toEqual([...RUN_A2.facts.map((f) => f.id), "f-0000beef"].sort());
    // Facts that rest only on the retired document are not matched: they get new IDs, never a retired one.
    const { run } = prepareRun(inputs, draftOfA());
    const docFacts = RUN_A2.facts.filter((f) => f.origin === "document").map((f) => f.id);
    for (const id of docFacts) expect(run.facts.map((f) => f.id)).not.toContain(id);
    for (const f of run.facts) expect(f.id).not.toBe("f-0000beef");
  });

  it("gives no previous run for a case whose current run is /1, and stays in its org", async () => {
    expect(await matchInputs(env.DB, env.DOCS, "demo-b", "B-NO-A")).toEqual({ caseId: "B-NO-A", previous: null, currentRunId: "run-BA", retiredDocuments: [], issuedIds: [] });
    // Org A's case asked for in org B reads as unknown.
    expect(await matchInputs(env.DB, env.DOCS, "demo-b", "NO-A")).toEqual({ caseId: "NO-A", previous: null, currentRunId: null, retiredDocuments: [], issuedIds: [] });
  });
});

describe("the demo reset (trigger demo_reset_uploads, migration 0015)", () => {
  it("removes unseeded runs with the IDs they issued and what doctors did with them, and makes the seeded run current again", async () => {
    const { run } = prepareRun(await matchInputs(env.DB, env.DOCS, "demo-a", "NO-A"), draftOfA({ symptom: "bolest hlavy" }));
    await storeNew(run);
    const fresh = run.facts.at(-1)!.id;
    const freshAlert = run.alerts[1]!.id;
    const oldAlert = RUN_A2.alerts[0]!.id;
    const sha = "0".repeat(64);
    await env.DB.batch(
      [
        `INSERT INTO fact_confirmations (org_id, case_id, fact_id, action, value_sha256, run_id, by_user_id, by_name) VALUES ('demo-a','NO-A','${fresh}','confirm','${sha}','run-pipeline-1','d2p1','x')`,
        `INSERT INTO fact_confirmations (org_id, case_id, fact_id, action, value_sha256, run_id, by_user_id, by_name) VALUES ('demo-a','NO-A','f-5a0b11','confirm','${sha}','run-pipeline-1','d2p1','x')`,
        `INSERT INTO fact_confirmations (org_id, case_id, fact_id, action, value_sha256, run_id, by_user_id, by_name) VALUES ('demo-a','NO-A','f-5a0b11','confirm','${sha}','${RUN_A2_ID}','d2p1','x')`,
        `INSERT INTO alert_events (org_id, case_id, alert_id, action, by_user_id, by_name) VALUES ('demo-a','NO-A','${freshAlert}','ack','d2p1','x'), ('demo-a','NO-A','${oldAlert}','ack','d2p1','x')`,
        "INSERT INTO alert_events_v1 (org_id, alert_id, action, by_user_id, by_name) VALUES ('demo-a','al-1','ack','d2p1','x')",
      ].map((s) => env.DB.prepare(s)),
    );
    // As seed.py --reset runs it: the flag alone, outside a deferred batch, so every delete must keep foreign keys.
    await env.DB.prepare("UPDATE demo_state SET reset_in_progress = 1 WHERE org_id = 'demo-a'").run();
    expect(await q("SELECT id, is_current FROM extraction_runs WHERE org_id = 'demo-a' ORDER BY id")).toEqual([
      { id: "run-A", is_current: 0 },
      { id: RUN_A2_ID, is_current: 1 },
    ]);
    expect(await q("SELECT fact_id FROM fact_ids WHERE fact_id = ?1", fresh)).toEqual([]);
    expect((await one<{ n: number }>("SELECT COUNT(*) AS n FROM fact_ids WHERE case_id = 'NO-A'")).n).toBe(RUN_A2.facts.length);
    expect((await q("SELECT id FROM alert_identities WHERE case_id = 'NO-A'")).map((r) => r.id)).toEqual([oldAlert]);
    // What was done on the seeded run's IDs in the seeded run stays for the reset route to remove with the rest.
    expect(await q("SELECT fact_id, run_id FROM fact_confirmations")).toEqual([{ fact_id: "f-5a0b11", run_id: RUN_A2_ID }]);
    expect((await q("SELECT alert_id FROM alert_events")).map((r) => r.alert_id)).toEqual([oldAlert]);
    // A seeded /1 run's alert events stay too.
    expect((await q("SELECT alert_id FROM alert_events_v1")).map((r) => r.alert_id)).toEqual(["al-1"]);
    expect(await q("PRAGMA foreign_key_check")).toEqual([]);
    // The run object under runs/ is removed by the reset route (R2_TRANSIENT, tested in "the reset route" below).
    await env.DB.prepare("UPDATE demo_state SET reset_in_progress = 0 WHERE org_id = 'demo-a'").run();
  });

  it("through the reset route: removes the unseeded run's object and rows and the doctor's confirmation on it", async () => {
    await env.DOCS.put("seed/reset.json", JSON.stringify(resetDoc()));
    const { run } = prepareRun(await matchInputs(env.DB, env.DOCS, "demo-a", "NO-A"), draftOfA({ symptom: "bolest hlavy" }));
    const stored = await storeNew(run);
    const fresh = run.facts.at(-1)!.id;
    const headers = { "content-type": "application/json", "x-demo-user": "d2p1", "x-data-epoch": "1" };
    const post = (path: string, body: unknown, user = "d2p1") =>
      call(`/api${path}`, { method: "POST", headers: { ...headers, "x-demo-user": user }, body: JSON.stringify(body) });
    expect((await post(`/cases/NO-A/facts/${fresh}/confirmations`, { action: "confirm", expected_state: "unconfirmed" })).status).toBe(200);
    expect((await post(`/cases/NO-A/alerts/${run.alerts[1]!.id}/events`, { action: "ack", expected_state: "open" })).status).toBe(200);
    expect((await post("/admin/reset-demo", { confirm: "OBNOVIT" }, "admin")).status).toBe(200);
    expect(await env.DOCS.get(stored.r2_key)).toBeNull();
    expect(await env.DOCS.get(`org/demo-a/extract/NO-A/${RUN_A2_ID}.json`)).not.toBeNull();
    expect(await q("SELECT id FROM extraction_runs WHERE org_id = 'demo-a' AND is_current = 1")).toEqual([{ id: RUN_A2_ID }]);
    for (const t of ["fact_confirmations", "alert_events"]) expect(await q(`SELECT * FROM ${t}`), t).toEqual([]);
    expect(await q("SELECT fact_id FROM fact_ids WHERE fact_id = ?1", fresh)).toEqual([]);
    expect(await q("PRAGMA foreign_key_check")).toEqual([]);
  });

  it("leaves another org's unseeded runs alone", async () => {
    const t = new Tx(env.DB, { ...doctor, id: "b-doc", org: "demo-b", membershipId: "b-doc" }, { requestId: null, epoch: null });
    const run = JSON.parse(JSON.stringify(RUN_A2).replaceAll('"A_pacient', '"b-A_pacient')) as ExtractionRun;
    const b: ExtractionRun = {
      ...run,
      case_id: "B-NO-A",
      run: { ...run.run, id: "run-b-1", producer: "pipeline", supersedes: "run-BA" },
      facts: run.facts.map((f) => (f.kind === "lab_result" ? { ...f, key: f.key.replace("doc:A_pacient", "doc:b-A_pacient") } : f)),
    };
    await storeRun(t, { db: env.DB, docs: env.DOCS }, b);
    await t.commit();
    await env.DB.prepare("UPDATE demo_state SET reset_in_progress = 1 WHERE org_id = 'demo-a'").run();
    expect(await q("SELECT id, is_current FROM extraction_runs WHERE org_id = 'demo-b' ORDER BY id")).toEqual([
      { id: "run-BA", is_current: 0 },
      { id: "run-b-1", is_current: 1 },
    ]);
    expect((await one<{ n: number }>("SELECT COUNT(*) AS n FROM fact_ids WHERE org_id = 'demo-b'")).n).toBe(RUN_A2.facts.length);
    await env.DB.prepare("UPDATE demo_state SET reset_in_progress = 0 WHERE org_id = 'demo-a'").run();
  });
});

describe("migration 0015 on data from 0014", () => {
  it("copies runs with producer, seeded and schema, moves /1 alert events aside, keeps alerts, and gives parts their IDs", async () => {
    await reset();
    const all = env.TEST_MIGRATIONS;
    await applyD1Migrations(env.DB, all.filter((m) => m.name < "0015"));
    const TS = "2026-10-15T10:00:00.000Z";
    const s = (x: string) => env.DB.prepare(x);
    await env.DB.batch([
      s("INSERT INTO roles (id, label_cs) VALUES ('doctor','lékař')"),
      s("INSERT INTO users (id, pre, sur) VALUES ('d2p1','MUDr.','Svobodová')"),
      s(`INSERT INTO memberships (id, org_id, user_id, role_id, active_from) VALUES ('d2p1','demo-a','d2p1','doctor','${TS}')`),
      s("INSERT INTO patients (id, org_id, full_name, data_origin) VALUES ('pt-A','demo-a','X','codebridge_synthetic')"),
      s(`INSERT INTO cases (id, org_id, case_no, patient_id, source_file, list_order, status, processing_level, question_explicit, owner_name, updated_on)
         VALUES ('NO-A','demo-a','NO-A','pt-A','A_pacient.pdf',0,'ready','full',0,'x','2026-10-16'), ('NO-U','demo-a','NO-U','pt-A','U.pdf',1,'new','partial',0,'x','2026-10-16'),
                ('NO-P','demo-a','NO-P','pt-A','P.pdf',2,'new','partial',0,'x','2026-10-16')`),
      s(`INSERT INTO extraction_runs (id, org_id, case_id, kind, producer, model, input_hashes_json, r2_key, sha256, is_current, created_at) VALUES
         ('seed-A','demo-a','NO-A','seed_fixture',NULL,NULL,'{}','extract/NO-A/seed-A.json','${"a".repeat(64)}',1,'${TS}'),
         ('prep-U','demo-a','NO-U','seed_fixture','prepared-fixture',NULL,'{"u":"1"}','org/demo-a/uploads/NO-U/extract/prep-U.json','${"b".repeat(64)}',1,'${TS}'),
         ('pl-P','demo-a','NO-P','pipeline',NULL,'model-x','{}','org/demo-a/extract/NO-P/pl-P.json','${"c".repeat(64)}',1,'${TS}')`),
      s(`INSERT INTO alerts (id, org_id, case_id, run_id, origin, position, kind, text_cs, relevant) VALUES
         ('al-1','demo-a','NO-A','seed-A','flag',0,'missing','Chybí histologie.',1), ('al-u','demo-a','NO-U','prep-U','gap',0,'unclear','Nejasné.',0)`),
      s(`INSERT INTO alert_events (org_id, alert_id, action, by_user_id, by_name, at) VALUES ('demo-a','al-1','ack','d2p1','MUDr. Svobodová','${TS}'), ('demo-a','al-u','resolved','d2p1','MUDr. Svobodová','${TS}')`),
      s(`INSERT INTO fact_edits (org_id, case_id, key, text, orig, by_user_id, by_name, at, log_id, extraction_run_id) VALUES ('demo-a','NO-A','od:1:e','opraveno','původně','d2p1','MUDr. Svobodová','${TS}',NULL,'seed-A')`),
      s("INSERT INTO documents (id, org_id, case_id, file_name, page_count, origin, processing) VALUES ('A_pacient','demo-a','NO-A','A_pacient.pdf',2,'seed','processed')"),
      s("INSERT INTO document_parts (org_id, document_id, ordinal, title_cs, pages_json) VALUES ('demo-a','A_pacient',0,'Zpráva','[1]'), ('demo-a','A_pacient',1,'Laboratoř','[2]')"),
    ]);
    const alertsBefore = await q("SELECT * FROM alerts ORDER BY id");
    const eventsBefore = await q("SELECT * FROM alert_events ORDER BY id");

    await applyD1Migrations(env.DB, all);

    expect(await q("SELECT id, producer, seeded, schema, supersedes, model, input_hashes_json, r2_key, is_current, created_at, kind FROM extraction_runs ORDER BY id")).toEqual([
      { id: "pl-P", producer: "pipeline", seeded: 0, schema: "codebridge.extraction/1", supersedes: null, model: "model-x", input_hashes_json: "{}", r2_key: "org/demo-a/extract/NO-P/pl-P.json", is_current: 1, created_at: TS, kind: "pipeline" },
      { id: "prep-U", producer: "fixture", seeded: 0, schema: "codebridge.extraction/1", supersedes: null, model: null, input_hashes_json: '{"u":"1"}', r2_key: "org/demo-a/uploads/NO-U/extract/prep-U.json", is_current: 1, created_at: TS, kind: "seed_fixture" },
      { id: "seed-A", producer: "fixture", seeded: 1, schema: "codebridge.extraction/1", supersedes: null, model: null, input_hashes_json: "{}", r2_key: "extract/NO-A/seed-A.json", is_current: 1, created_at: TS, kind: "seed_fixture" },
    ]);
    expect(await q("SELECT * FROM alerts ORDER BY id")).toEqual(alertsBefore);
    // The /1 events move whole (same ids and values) to alert_events_v1; the new table starts empty.
    expect(await q("SELECT * FROM alert_events_v1 ORDER BY id")).toEqual(eventsBefore);
    expect(await q("SELECT * FROM alert_events")).toEqual([]);
    expect(await q("SELECT key, fact_id, text FROM fact_edits")).toEqual([{ key: "od:1:e", fact_id: null, text: "opraveno" }]);
    expect(await q("SELECT ordinal, part_id FROM document_parts ORDER BY ordinal")).toEqual([
      { ordinal: 0, part_id: "A_pacient/p0" },
      { ordinal: 1, part_id: "A_pacient/p1" },
    ]);
    expect(await q("PRAGMA foreign_key_check")).toEqual([]);
    expect(await q("SELECT name FROM sqlite_master WHERE name LIKE '%\\_old' ESCAPE '\\'")).toEqual([]);

    // The Worker deployed during the migration window still reads what it read: the run's kind, the /1 alerts joined
    // to the current run, and a part inserted without part_id gets one.
    expect(await q("SELECT id, kind, created_at, r2_key, case_id FROM extraction_runs WHERE org_id = 'demo-a' AND case_id = 'NO-A' AND is_current = 1")).toEqual([
      { id: "seed-A", kind: "seed_fixture", created_at: TS, r2_key: "extract/NO-A/seed-A.json", case_id: "NO-A" },
    ]);
    expect(
      await q(`SELECT a.id FROM alerts a JOIN extraction_runs r ON r.id = a.run_id AND r.org_id = a.org_id AND r.is_current = 1 WHERE a.org_id = 'demo-a' AND a.case_id = 'NO-A'`),
    ).toEqual([{ id: "al-1" }]);
    await s("INSERT INTO document_parts (org_id, document_id, ordinal, title_cs, pages_json) VALUES ('demo-a','A_pacient',2,'Další','[2]')").run();
    expect(await one("SELECT part_id FROM document_parts WHERE ordinal = 2")).toEqual({ part_id: "A_pacient/p2" });
    // The old Worker's run insert names `kind`, which is computed now: it fails and the intake answers an error until
    // the new Worker is deployed (the PR names this window).
    await expect(
      s(`INSERT INTO extraction_runs (id, org_id, case_id, kind, producer, input_hashes_json, r2_key, sha256) VALUES ('x','demo-a','NO-U','seed_fixture','prepared-fixture','{}','k','${"d".repeat(64)}')`).run(),
    ).rejects.toThrow(/generated column/);

    // The /1 events stay append-only, and a reset of the org keeps the seeded run's ones and removes the others.
    await expect(s("UPDATE alert_events_v1 SET action = 'reopen'").run()).rejects.toThrow(/append-only: alert_events_v1/);
    await expect(s("DELETE FROM alert_events_v1").run()).rejects.toThrow(/append-only: alert_events_v1/);
    await s("UPDATE demo_state SET reset_in_progress = 1 WHERE org_id = 'demo-a'").run();
    expect((await q("SELECT id FROM extraction_runs ORDER BY id")).map((r) => r.id)).toEqual(["seed-A"]);
    expect((await q("SELECT alert_id FROM alert_events_v1")).map((r) => r.alert_id)).toEqual(["al-1"]);
    expect((await q("SELECT id FROM alerts")).map((r) => r.id)).toEqual(["al-1"]);
    expect(await q("PRAGMA foreign_key_check")).toEqual([]);
  });
});
