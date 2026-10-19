import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { call, testEnv } from "./helpers";
import { env } from "cloudflare:workers";
import type { Extraction } from "@codebridge/domain/wire";
import { alertId, assignKeys, validateRun, type ExtractionRun, type Fact } from "@codebridge/domain/extraction/index";
import { accessLog, as, FAKE_NAME, loadFixture, NAME_QUOTE, RUN_A2, RUN_A2_ID, RUN_A2_KEY } from "./data";
import { setStoreFactory } from "../src/store";
import { D1Audit, D1Cases, D1Directory } from "../src/store/d1";
import { R2Blobs } from "../src/store/r2";

type Err = { error: { code: string; message_cs: string } };
const strict = testEnv({ CLINICAL_ACCESS: "doctors_only" });
const errCode = async (r: Response) => ((await r.json()) as Err).error.code;

beforeEach(() => loadFixture());
afterEach(() => setStoreFactory(null));

describe("health with data", () => {
  it("reports features.data once the database is seeded", async () => {
    const body = await (await call("/api/health")).json<{ features: { data: boolean }; seeded_at: string }>();
    expect(body.features.data).toBe(true);
    expect(body.seeded_at).toBe("2026-10-17T12:00:00.000Z");
  });

  it("reports no data when DATA_API is off, and the data routes answer not_configured", async () => {
    const off = testEnv({ DATA_API: "off" });
    const body = await (await call("/api/health", {}, off)).json<{ features: { data: boolean } }>();
    expect(body.features.data).toBe(false);
    const r = await call("/api/patients", {}, off);
    expect(r.status).toBe(503);
    expect(await errCode(r)).toBe("not_configured");
  });

  it("reports no data on an empty database", async () => {
    await loadFixture({ seeded: false });
    const body = await (await call("/api/health")).json<{ features: { data: boolean } }>();
    expect(body.features.data).toBe(false);
  });
});

describe("/api/me and /api/staff", () => {
  it("uses the default demo doctor without a header", async () => {
    const r = await call("/api/me");
    expect(await r.json()).toMatchObject({ user: { id: "d2p1", name: "MUDr. Svobodová", role: "doctor", dept: { id: "d2" } }, auth_mode: "demo" });
  });

  it("reports the document pipeline per org: off in demo org A, on in demo org B with the deployed PIPELINE_ORGS", async () => {
    const deployed = testEnv({ PIPELINE_ORGS: "demo-b" });
    expect(((await (await call("/api/me", as("d2p1"), deployed)).json()) as any).features).toMatchObject({ pipeline: false });
    expect(((await (await call("/api/me", as("b-doc"), deployed)).json()) as any).features).toMatchObject({ pipeline: true });
    // Whether uploads keep their content follows UPLOAD_STORE_ORGS, never for demo org A.
    const store = testEnv({ PIPELINE_ORGS: "demo-b", UPLOAD_STORE_ORGS: "demo-b,demo-a" });
    expect(((await (await call("/api/me", as("b-doc"), store)).json()) as any).features).toEqual({ pipeline: true, keeps_uploads: true });
    expect(((await (await call("/api/me", as("d2p1"), store)).json()) as any).features).toEqual({ pipeline: false, keeps_uploads: false });
    // No page reader at all: off everywhere, whatever the list says.
    expect(((await (await call("/api/me", as("b-doc"), testEnv({ PIPELINE_ORGS: "*", PAGE_READER_URL: "" }))).json()) as any).features).toMatchObject({ pipeline: false });
  });

  it("takes the person from the header, then from the cookie", async () => {
    expect(await (await call("/api/me", as("coord"))).json()).toMatchObject({ user: { id: "coord", role: "coordinator" } });
    expect(await (await call("/api/me", { headers: { cookie: "cb_demo_user=admin" } })).json()).toMatchObject({ user: { id: "admin" } });
  });

  it("refuses an unknown or inactive user", async () => {
    for (const id of ["nobody", "gone"]) {
      const r = await call("/api/me", as(id));
      expect(r.status).toBe(401);
      expect(await errCode(r)).toBe("unknown_user");
    }
  });

  it("returns the staff list in the shape validStaff() accepts", async () => {
    const s = await (await call("/api/staff")).json<{ depts: { name: string; people: { id: string; sur: string }[] }[]; coord: { id: string; sur: string }; roles: Record<string, string> }>();
    expect(s.depts.map((d) => d.name)).toEqual(["Neurochirurgie", "Klinická onkologie"]);
    expect(s.depts.every((d) => d.people.every((p) => typeof p.id === "string" && p.sur.trim()))).toBe(true);
    expect(s.coord.id).toBe("coord");
    expect(s.roles).toMatchObject({ admin: "admin", coord: "coordinator", d1p1: "doctor" });
  });

  it("does not log directory reads", async () => {
    await call("/api/me");
    await call("/api/staff");
    expect(await accessLog()).toHaveLength(0);
  });
});

describe("/api/patients", () => {
  it("returns rows with the app's key set and one list.view audit row", async () => {
    const body = await (await call("/api/patients")).json<{ patients: Record<string, unknown>[]; total: number }>();
    expect(body.total).toBe(2);
    expect(Object.keys(body.patients[0]!).sort()).toEqual(
      ["age", "basis", "birth", "dept", "deptExample", "diagnosis", "diagnosisNote", "draft", "explicit", "file", "full", "id", "mkn10",
        "name", "nameAsWritten", "nameNote", "owner", "ownerExample", "pages", "processing", "purpose", "qkind", "question", "rc",
        "referrer", "slot", "status", "statusHist", "submitted", "submittedExample", "summary", "synthetic", "updated", "warn"].sort(),
    );
    expect(body.patients[0]).toMatchObject({ id: "NO-A", full: true, slot: { day: "2026-10-22", time: "14:00" }, synthetic: true });
    const log = await accessLog();
    expect(log).toHaveLength(1);
    expect(log[0]).toMatchObject({ action: "list.view", actor_user_id: "d2p1", case_id: null });
  });

  it("lists only the cases whose team a doctor is on", async () => {
    const body = await (await call("/api/patients", as("d1p1"))).json<{ patients: { id: string }[] }>();
    expect(body.patients.map((p) => p.id)).toEqual(["NO-B"]);
  });

  it("filters by text, status and page", async () => {
    const ids = async (qs: string) => (await (await call(`/api/patients?${qs}`)).json<{ patients: { id: string }[] }>()).patients.map((p) => p.id);
    expect(await ids("q=pacientka")).toEqual(["NO-A"]);
    expect(await ids("q=testov")).toEqual(["NO-A", "NO-B"]);
    expect(await ids("q=no-b")).toEqual(["NO-B"]);
    expect(await ids("status=new")).toEqual(["NO-B"]);
    expect(await ids("page=1&page_size=1")).toEqual(["NO-B"]);
  });

  it("shows the administrator clinical fields in the default mode and hides them in the strict mode", async () => {
    const open = await (await call("/api/patients", as("admin"))).json<{ patients: Record<string, unknown>[] }>();
    expect(open.patients[0]!.diagnosis).toBe("Diagnóza A");
    const red = await (await call("/api/patients", as("admin"), strict)).json<{ patients: Record<string, unknown>[] }>();
    expect(red.patients[0]).toMatchObject({ name: FAKE_NAME, diagnosis: null, redacted_for_role: "admin" });
  });
});

describe("case reads", () => {
  it("answers 404 for an unknown case and 403 not_member for a doctor outside the team, without content", async () => {
    expect(await errCode(await call("/api/cases/NO-X"))).toBe("case_not_found");
    for (const path of ["/api/cases/NO-A", "/api/cases/NO-A/extraction", "/api/cases/NO-A/guidance"]) {
      const r = await call(path, as("d1p1"));
      expect(r.status).toBe(403);
      expect(await errCode(r)).toBe("not_member");
    }
    expect(await accessLog()).toHaveLength(0);
  });

  it("logs a case open with actor, role and case, and marks a link open", async () => {
    const r = await call("/api/cases/NO-A");
    expect(r.status).toBe(200);
    expect(await r.json()).toMatchObject({ id: "NO-A", members: [{ dept: "Klinická onkologie" }], run: { id: "run-A2", producer: "fixture" } });
    await call("/api/cases/NO-A?via=link");
    const log = await accessLog();
    expect(log.map((l) => [l.action, l.case_id, l.acted_as_role, l.what_cs])).toEqual([
      ["case.open", "NO-A", "doctor", "otevřel(a) případ"],
      ["case.open", "NO-A", "doctor", "otevřel(a) případ (odkazem nebo historií prohlížeče)"],
    ]);
  });

  // The FHIR export gives the Patient its Provenance from it; it comes only with a logged case open, never in the list,
  // and not to a role that does not see clinical content.
  it("names where the document names the patient in the case header only", async () => {
    const head = await (await call("/api/cases/NO-A")).json<Record<string, unknown>>();
    expect(head.identitySource).toEqual({ file: "A_pacient.pdf", page: 1, quote: NAME_QUOTE });
    expect(JSON.stringify(await (await call("/api/patients")).json())).not.toContain(NAME_QUOTE);
    expect(JSON.stringify(await (await call("/api/patients", as("admin"))).json())).not.toContain(NAME_QUOTE);
    // The coordinator opens the header in the strict mode but reads no clinical content there.
    const coord = await call("/api/cases/NO-A", as("coord"), strict);
    expect(coord.status).toBe(200);
    expect(await coord.json()).toMatchObject({ id: "NO-A", identitySource: null });
    expect(JSON.stringify(await (await call("/api/cases/NO-A/extraction")).json())).not.toContain(NAME_QUOTE);
  });

  // The stripping itself happens in the seed (api/seed/seed.py, checked by its identity scan and key check); this
  // proves the route passes the stored object through without adding identity from the patients table.
  it("serves the current codebridge.extraction/2 run as stored, without identity from the patients table", async () => {
    const body = await (await call("/api/cases/NO-A/extraction")).json<Extraction>();
    expect(body).toMatchObject({ case_id: "NO-A", processing: "full", run: { id: RUN_A2_ID, producer: "fixture", created_at: "2026-10-18T12:00:00.000Z" } });
    expect(body.data).toEqual(RUN_A2);
    expect(Object.keys(body.run!).sort()).toEqual(["created_at", "id", "producer"]);
    expect(JSON.stringify(body)).not.toContain(FAKE_NAME);
    expect((await accessLog()).map((l) => l.action)).toEqual(["case.data"]);
  });

  it("leaves out a quarantined fact and the source only it cites; the identity alert stays, naming document and page", async () => {
    const other = { id: "src-other", type: "document" as const, document_id: "A_pacient", part: "A_pacient/p0", page: 2, quote: "Jiný Pacient, bolest hlavy",
      quote_text: "vision" as const, anchor: null, reported_as: "original" as const, identity: "conflicts" as const, reading_check: null };
    const draft = { kind: "symptom" as const, subject: "patient" as const, value: { text: "bolest hlavy" }, date: { as_written: null, precision: null, sort: null },
      status: "documented" as const, negated: false, not_stated: [], origin: "document" as const, certainty: "clear" as const, codes: [], note: null,
      quarantined: true, sources: ["src-other"] };
    const [q] = assignKeys([draft], [...RUN_A2.sources, other]);
    const fact = { ...q!, id: "f-0000a1a1" } as Fact;
    const alert = { rule: "identity_conflict", subject: "A_pacient|2", kind: "identity" as const, facts: [fact.id], message: { id: "alert-identity-conflict", args: { document: "A_pacient", page: 2 } }, note: null };
    const run: ExtractionRun = { ...RUN_A2, sources: [...RUN_A2.sources, other], facts: [...RUN_A2.facts, fact], alerts: [...RUN_A2.alerts, { ...alert, id: alertId(alert) }] };
    expect(validateRun(run).issues).toEqual([]);
    await env.DOCS.put(RUN_A2_KEY, JSON.stringify(run));
    const body = await (await call("/api/cases/NO-A/extraction")).json<Extraction>();
    const text = JSON.stringify(body);
    expect(text).not.toContain("Jiný Pacient");
    expect(text).not.toContain("src-other");
    expect(body.data!.facts.map((f) => f.id)).toEqual(RUN_A2.facts.map((f) => f.id));
    expect(body.data!.sources).toEqual(RUN_A2.sources);
    expect(body.data!.alerts.find((a) => a.kind === "identity")).toMatchObject({ id: alertId(alert), facts: [], message: { args: { document: "A_pacient", page: 2 } } });
  });

  it("serves a current run in the old format /1 as not processed: run named, data null", async () => {
    await env.DB.batch([
      env.DB.prepare(`UPDATE extraction_runs SET is_current = 0 WHERE id = '${RUN_A2_ID}'`),
      env.DB.prepare("UPDATE extraction_runs SET is_current = 1 WHERE id = 'run-A'"),
    ]);
    expect(await (await call("/api/cases/NO-A/extraction")).json()).toMatchObject({
      case_id: "NO-A",
      processing: "full",
      run: { id: "run-A", producer: "fixture", created_at: "2026-10-17T12:00:00.000Z" },
      data: null,
    });
  });

  it("sends the case's stored documents with their parts next to the run, which names parts by ID only", async () => {
    const body = await (await call("/api/cases/NO-A/extraction")).json<Extraction>();
    expect(Array.isArray(body.documents)).toBe(true);
    for (const d of body.documents) {
      expect(Object.keys(d).sort()).toEqual(["file", "id", "note_cs", "page_count", "parts"]);
      for (const p of d.parts) expect(Object.keys(p).sort()).toEqual(["certainty", "date", "date_as_written", "date_note_cs", "pages", "readability", "reason_cs", "title_cs", "type"]);
    }
    // One request, one access-log row.
    expect((await accessLog()).map((l) => l.action)).toEqual(["case.data"]);
  });

  it("serves one fact of an earlier run of the case, for the value a doctor confirmed; logged like the case data", async () => {
    const fact = RUN_A2.facts[0]!;
    const r = await call(`/api/cases/NO-A/runs/${RUN_A2_ID}/facts/${fact.id}`);
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ run_id: RUN_A2_ID, fact });
    expect((await accessLog()).map((l) => l.action)).toEqual(["case.data"]);
    // Another case's run, an unknown fact and a malformed ID are all "not found".
    expect(await errCode(await call(`/api/cases/NO-B/runs/${RUN_A2_ID}/facts/${fact.id}`))).toBe("fact_not_found");
    expect(await errCode(await call(`/api/cases/NO-A/runs/${RUN_A2_ID}/facts/f-00000000`))).toBe("fact_not_found");
    expect(await errCode(await call(`/api/cases/NO-A/runs/${RUN_A2_ID}/facts/x`))).toBe("fact_not_found");
  });

  it("does not serve an earlier value of a fact the current run quarantines", async () => {
    const fact = RUN_A2.facts[0]!;
    // The earlier run is a copy of run-A2 under another ID; the current run then quarantines the fact.
    await env.DB.prepare(
      `INSERT INTO extraction_runs (id, org_id, case_id, producer, seeded, schema, supersedes, input_hashes_json, r2_key, sha256, is_current, created_at)
       SELECT 'run-A1', org_id, case_id, producer, seeded, schema, NULL, input_hashes_json, 'org/demo-a/extract/NO-A/run-A1.json', sha256, 0, '2026-10-17T12:00:00.000Z'
       FROM extraction_runs WHERE id = '${RUN_A2_ID}'`,
    ).run();
    await env.DOCS.put("org/demo-a/extract/NO-A/run-A1.json", JSON.stringify(RUN_A2));
    expect((await call(`/api/cases/NO-A/runs/run-A1/facts/${fact.id}`)).status).toBe(200);
    const src = RUN_A2.sources.find((s) => s.id === fact.sources[0])!;
    const quarantined = { ...RUN_A2, sources: RUN_A2.sources.map((s) => (s === src ? { ...s, identity: "conflicts" } : s)), facts: RUN_A2.facts.map((f) => (f.id === fact.id ? { ...f, quarantined: true } : f)) };
    await env.DOCS.put(RUN_A2_KEY, JSON.stringify(quarantined));
    expect(await errCode(await call(`/api/cases/NO-A/runs/run-A1/facts/${fact.id}`))).toBe("fact_not_found");
  });

  it("has no alert list of its own any more: alerts are part of the run", async () => {
    expect((await call("/api/cases/NO-A/alerts")).status).toBe(404);
  });

  it("answers processing none for a case without a run", async () => {
    expect(await (await call("/api/cases/NO-B/extraction")).json()).toMatchObject({ case_id: "NO-B", processing: "none", run: null, data: null });
  });

  it("treats an unknown CLINICAL_ACCESS value as the strict rule", async () => {
    const r = await call("/api/cases/NO-A/extraction", as("coord"), testEnv({ CLINICAL_ACCESS: "allroles" }));
    expect(await errCode(r)).toBe("role_forbidden");
  });

  it("refuses clinical content to the coordinator and the administrator only in the strict mode", async () => {
    for (const who of ["coord", "admin"]) {
      expect((await call("/api/cases/NO-A/extraction", as(who))).status).toBe(200);
      const r = await call("/api/cases/NO-A/extraction", as(who), strict);
      expect(r.status).toBe(403);
      expect(await errCode(r)).toBe("role_forbidden");
    }
    expect((await call("/api/cases/NO-A/documents", as("coord"), strict)).status).toBe(200);
    expect(await errCode(await call("/api/cases/NO-A", as("admin"), strict))).toBe("role_forbidden");
  });

  it("serves documents, decisions, history, guidance and prognosis", async () => {
    const docs = await (await call("/api/cases/NO-A/documents")).json<{ documents: { id: string; parts: { pages: number[] }[] }[] }>();
    expect(docs.documents[0]).toMatchObject({ id: "A_pacient", page_count: 2, parts: [{ pages: [1, 2] }] });
    expect(await (await call("/api/cases/NO-A/decisions")).json()).toEqual({ decisions: [] });
    expect(await (await call("/api/cases/NO-A/history")).json()).toEqual({ status: [], edits: [], question_confirmations: [] });
    expect(await (await call("/api/cases/NO-A/guidance")).json()).toMatchObject({ guidelines: [{ id: "g1" }], prior_assessments: {} });
    expect(await (await call("/api/cases/NO-B/guidance")).json()).toEqual({
      guidelines: [], statements: [], pages: [], literature: [], queries: [], not_retrieved: [], prior_assessments: {},
    });
    expect(await (await call("/api/cases/NO-A/prognosis")).json()).toEqual({ saved: [{ patient_id: "A_pacient.pdf" }] });
    expect((await accessLog()).map((l) => l.action)).toEqual([
      "case.documents", "case.history", "case.history", "guidance.load", "guidance.load", "prognosis.view",
    ]);
  });
});

describe("source pages", () => {
  it("returns the srcApi.page() object with API image URLs and logs page and document, never the text", async () => {
    const r = await call("/api/documents/A_pacient/pages/1");
    expect(r.status).toBe(200);
    const p = await r.json<Record<string, unknown>>();
    expect(p).toMatchObject({
      file: "A_pacient.pdf", document_id: "A_pacient", case_id: "NO-A", n: 1, of: 2, doc_title: "Ambulantní zpráva",
      image: "/api/documents/A_pacient/pages/1/image", empty: false,
      redacted: { image: "/api/documents/A_pacient/pages/1/image?redacted=1", count: 1, reasons: ["jméno"] },
      pages: [{ n: 1, empty: false }, { n: 2, empty: false }],
    });
    const log = await accessLog();
    expect(log).toHaveLength(1);
    expect(log[0]).toMatchObject({ action: "source.view", document_id: "A_pacient", page_n: 1, case_id: "NO-A", what_cs: "zobrazil(a) zdroj s. 1" });
    expect(JSON.stringify(log)).not.toContain("Testová");
  });

  it("streams the page image and the redacted version, and 404s a missing redacted version", async () => {
    const img = await call("/api/documents/A_pacient/pages/1/image");
    expect(img.headers.get("content-type")).toBe("image/png");
    // Images may sit in this browser's cache briefly, so re-renders of the viewer do not log the same image again.
    expect(img.headers.get("cache-control")).toBe("private, max-age=300");
    expect((await call("/api/documents/A_pacient/pages/1")).headers.get("cache-control")).toBe("no-store");
    expect((await img.arrayBuffer()).byteLength).toBeGreaterThan(0);
    expect((await call("/api/documents/A_pacient/pages/1/image?redacted=1")).status).toBe(200);
    expect(await errCode(await call("/api/documents/A_pacient/pages/2/image?redacted=1"))).toBe("page_not_found");
    expect((await accessLog()).map((l) => l.what_cs)).toEqual(["načetl(a) obrázek s. 1", "zobrazil(a) zdroj s. 1", "načetl(a) obrázek s. 1 (začerněná verze)"]);
  });

  it("refuses pages of a case outside the doctor's team, and unknown pages", async () => {
    expect(await errCode(await call("/api/documents/A_pacient/pages/1", as("d1p1")))).toBe("not_member");
    expect(await errCode(await call("/api/documents/A_pacient/pages/1/image", { headers: { cookie: "cb_demo_user=d1p1" } }))).toBe("not_member");
    expect(await errCode(await call("/api/documents/A_pacient/pages/9"))).toBe("page_not_found");
    expect(await errCode(await call("/api/documents/A_pacient/pages/x"))).toBe("page_not_found");
    expect(await errCode(await call("/api/documents/nope/pages/1"))).toBe("page_not_found");
  });
});

describe("audit guarantees", () => {
  it("answers 500 and returns no content when the audit insert fails", async () => {
    setStoreFactory((e, org) => ({
      org,
      dir: new D1Directory(e.DB, org),
      cases: new D1Cases(e.DB, org),
      blobs: new R2Blobs(e.DOCS),
      audit: Object.assign(new D1Audit(e.DB, org), { append: async () => { throw new Error("D1 down"); } }),
    }));
    const routes = ["/api/patients", "/api/cases/NO-A", "/api/cases/NO-A/extraction", "/api/cases/NO-A/documents",
      "/api/cases/NO-A/decisions", "/api/cases/NO-A/history", "/api/cases/NO-A/guidance", "/api/cases/NO-A/prognosis",
      "/api/documents/A_pacient/pages/1", "/api/documents/A_pacient/pages/1/image"];
    for (const path of routes) {
      const r = await call(path);
      expect(r.status).toBe(500);
      const text = await r.text();
      expect(text).not.toContain(FAKE_NAME);
      expect(text).not.toContain("Diagnóza");
      expect(text).not.toContain("Ambulantní");
      expect(text).not.toContain("g1");
    }
  });

  it("shows the access log to the administrator only, and logs that view", async () => {
    expect(await errCode(await call("/api/admin/access-log"))).toBe("role_forbidden");
    expect(await errCode(await call("/api/admin/access-log", as("coord")))).toBe("role_forbidden");
    await call("/api/cases/NO-A");
    const body = await (await call("/api/admin/access-log", as("admin"))).json<{ entries: Record<string, unknown>[] }>();
    expect(body.entries[0]).toMatchObject({ who: "Ing. Kovář", role: "admin", what: "zobrazil(a) záznam přístupů", pid: null });
    expect(body.entries[1]).toMatchObject({ who: "MUDr. Svobodová", case_id: "NO-A", pid: "A_pacient.pdf", what: "otevřel(a) případ" });
  });
});

describe("tasks and calendar", () => {
  it("lists all tasks for the coordinator, own tasks with scope=mine, member cases for doctors", async () => {
    const ids = async (path: string, who: string, env = testEnv()) =>
      (await (await call(path, as(who), env)).json<{ tasks: { id: number }[] }>()).tasks.map((t) => t.id);
    expect(await ids("/api/tasks?scope=all", "coord")).toEqual([1, 2]);
    expect(await ids("/api/tasks?scope=mine", "coord")).toEqual([1]);
    expect(await ids("/api/tasks?scope=all", "d1p1")).toEqual([2]);
    expect(await ids("/api/tasks?scope=all", "admin", strict)).toEqual([]);
    const t = await (await call("/api/tasks", as("coord"))).json<{ tasks: Record<string, unknown>[] }>();
    expect(t.tasks[0]).toEqual({
      id: 1, pid: "A_pacient.pdf", case_id: "NO-A", text: "úkol A", who: "Bc. Marková", due: "2026-10-21", done: false,
      dueSrc: null, dueBy: null, timing: null, fromSugg: null, confirmedBy: null,
    });
  });

  it("returns the week's slots from Monday", async () => {
    expect(await (await call("/api/calendar?week=2026-10-22")).json()).toEqual({
      week: "2026-10-19", slots: [{ day: "2026-10-22", time: "14:00", case_id: "NO-A", file: "A_pacient.pdf" }], sessions: [],
    });
  });
});
