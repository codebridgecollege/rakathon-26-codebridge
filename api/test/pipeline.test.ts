// The document pipeline without an LLM (step 6, slice b-1) with the page reader mocked at https://page-reader.test: a run on an
// upload writes its pages, readability and lab values to R2 and D1, is compared with the prepared data, fails with a
// fixed code and a Czech reason, never runs twice at once, leaves seeded documents as they are, and its Workflow step
// results hold ids and counts only.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { env } from "cloudflare:workers";
import { introspectWorkflow } from "cloudflare:test";
import { call, mockFetch, testEnv } from "./helpers";
import { FAKE_NAME, loadFixture } from "./data";
import { sweep } from "../src/scheduled";
import { allowed } from "@codebridge/domain/roles";
import { publishCaseRun } from "../src/store/case-merge";
import { actorFor } from "../src/store/audio";
import { POOL_SIZE, pageReader, pipelineAvailable, pipelineOn, poolInstance } from "../src/services/page-reader";

const q = async <T = Record<string, unknown>>(sql: string, ...args: unknown[]) => (await env.DB.prepare(sql).bind(...args).all<T>()).results;
const one = async <T = Record<string, any>>(sql: string, ...args: unknown[]) => (await q<T>(sql, ...args))[0]!;
const PNG_B64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";
const DOC = "up-test-1";
const SHA = "b".repeat(64);
// The bodies /v1/inspect received, read inside the mock (a body cannot be read later from the test's context).
const inspected: string[] = [];
// The names /v1/identity was asked about, read inside the mock.
const identityAsked: string[] = [];
// What the mocked /v1/identity answers; each test starts from page 2 showing another patient.
const CONFLICT_ON_P2 = { result: "conflicts", pages: [{ n: 1, result: "matches" }, { n: 2, result: "conflicts" }], evidence: [] };
let identityAnswer: unknown = CONFLICT_ON_P2;
// Page text that must never reach a step result: the patient's name and a lab line.
const TEXT1 = `${FAKE_NAME}, nar. 1.1.1964\nOdběr: 10.3.2026 07:25\nB_HB: 108 g/l [120 ... 160]\nS_CEA: 14,8 µg/l [0 ... 5]`;

// older: a page reader image from before /v1/parts and /v1/identity, which answers 404 there.
function kit({ inspect = () => Response.json({ page_count: 2, encrypted: false, producer_present: true, has_text_layer: [true, true] }), older = false }: { inspect?: () => Response; older?: boolean } = {}) {
  return mockFetch(async (req) => {
    const u = new URL(req.url);
    expect(u.host).toBe("page-reader.test");
    if (older && (u.pathname === "/v1/parts" || u.pathname === "/v1/identity")) return Response.json({ error: { code: "not_found", message_cs: "x" } }, { status: 404 });
    if (u.pathname === "/healthz") return Response.json({ ok: true, versions: { page_reader: "0.1.0", pymupdf: "1.24.10", tesseract: "5.3.0", ces_model: "sha256:abc" } });
    if (u.pathname === "/v1/inspect") return (inspected.push(await req.clone().text()), inspect());
    if (u.pathname === "/v1/convert") return Response.json({ pdf_b64: btoa("%PDF-1.4 converted"), width: 3000, height: 4000 });
    if (u.pathname === "/v1/pages")
      return Response.json({
        pages: [1, 2].map((n) => ({ n, size: [10, 10], png_b64: PNG_B64, words: [{ t: "B_HB:", c: 95, b: [1, 1, 2, 1] }], tess_text: n === 1 ? TEXT1 : "x", layer_text: n === 1 ? TEXT1 : "" })),
      });
    if (u.pathname === "/v1/analyze") {
      const b = (await req.json()) as { pages: { n: number; tess_text: string; words: unknown[]; size: number[] }[] };
      return Response.json({
        pages: b.pages.map((p) => ({
          n: p.n,
          page: { n: p.n, size: p.size, text: p.tess_text, engine: "tesseract", words: p.words, mean_conf: 90, low_conf_words: 0, verify: p.n === 1 ? [{ tess: "14,8", start: 70, end: 74, layer: "14.8", conf: 55, box: [1, 1, 1, 1], reason: "disagree" }] : [], second_reading: "text_layer" },
          readability: p.n === 1 ? { level: "good", reasons_cs: [], metrics: {} } : { level: "poor", reasons_cs: ["s. 2: průměrná jistota čtení pod 75 %"], metrics: {} },
        })),
        document: { level: "poor", reasons_cs: ["s. 2: průměrná jistota čtení pod 75 %"] },
      });
    }
    if (u.pathname === "/v1/parts")
      return Response.json({
        parts: [
          { ordinal: 0, pages: [1], type: "lab_results", title_cs: "Výsledky laboratorních vyšetření", date_as_written: "10.3.2026", date: "2026-03-10", certainty: "documented" },
          { ordinal: 1, pages: [2], type: "unknown", title_cs: null, date_as_written: null, date: null, certainty: "verify" },
        ],
      });
    if (u.pathname === "/v1/identity") {
      const b = (await req.clone().json()) as { expected: { name: string } };
      identityAsked.push(b.expected.name);
      return Response.json(identityAnswer);
    }
    if (u.pathname === "/v1/labs") {
      const src = (quote: string) => ({ doc_id: DOC, page: 1, quote, start: 0, end: quote.length });
      return Response.json({
        name_note: "x",
        draws: [{ date: "2026-03-10", time: "07:25", source: src("Odběr: 10.3.2026 07:25"), certainty: "documented" }],
        tests: [
          { code: "B_HB", unit: "g/l", reference_range: "120 ... 160", points: [{ value: "108", unit: "g/l", reference_range: "120 ... 160", date: "2026-03-10", time: "07:25", certainty: "documented", out_of_range: "low", source: src("B_HB: 108 g/l [120 ... 160]") }] },
          { code: "S_CEA", unit: "µg/l", reference_range: "0 ... 5", points: [{ value: "14,8", unit: "µg/l", reference_range: "0 ... 5", date: "2026-03-10", time: "07:25", certainty: "unclear_ocr", verify_reasons: ["disagree"], source: src("S_CEA: 14,8 µg/l [0 ... 5]") }] },
        ],
        indices: [],
        unparsed: [],
        counts: { points: 2, documented: 1, unclear_ocr: 1 },
      });
    }
    return new Response("{}", { status: 404 });
  });
}

// The pipeline runs for every org in these tests; elsewhere the test env leaves PIPELINE_ORGS empty, so an upload test
// never starts a run as a side effect.
const pe = (over: Record<string, string> = {}) => testEnv({ PIPELINE_ORGS: "*", ...over });

async function w(method: string, path: string, body: unknown = {}, user = "d2p1", e = pe()) {
  const r = await call(`/api${path}`, { method, headers: { "content-type": "application/json", "x-demo-user": user, "x-data-epoch": "1" }, body: JSON.stringify(body) }, e);
  return { status: r.status, body: (await r.json()) as any };
}
const get = async (path: string, user = "d2p1") => {
  const r = await call(`/api${path}`, { headers: { "x-demo-user": user } });
  return { status: r.status, body: (await r.json()) as any };
};

beforeEach(async () => {
  identityAsked.length = 0;
  identityAnswer = CONFLICT_ON_P2;
  await loadFixture();
  await env.DB.prepare(
    `INSERT INTO documents (org_id, id, case_id, file_name, page_count, original_r2_key, sha256, size_bytes, origin, processing, uploaded_by, state, fixture_id, identity)
     VALUES ('demo-a', ?1, 'NO-A', 'lab.pdf', 0, 'uploads/NO-A/up-test-1.pdf', ?2, 10, 'upload', 'unprocessed', 'd2p1', 'stored', NULL, NULL)`,
  ).bind(DOC, SHA).run();
  await env.DOCS.put("uploads/NO-A/up-test-1.pdf", "%PDF-1.4 test");
  // The case's prepared run (codebridge.extraction/2) holds the two values of this document as lab_result facts, so the
  // run is compared with them.
  await env.DB.batch([
    env.DB.prepare("UPDATE extraction_runs SET is_current = 0 WHERE case_id = 'NO-A'"),
    env.DB.prepare("UPDATE extraction_runs SET is_current = 1, schema = 'codebridge.extraction/2' WHERE id = 'run-A'"),
  ]);
  const lab = (id: string, code: string, value: string, unit: string, range: string, src: string) => ({
    id, key: `lab_result|${code}|draw:10.3.2026 07:25|doc:${DOC}`, kind: "lab_result", subject: "patient",
    value: { name_as_written: code, value_as_written: value, value_numeric: null, unit_as_written: unit, unit, reference_range: range, reference_low: null, reference_high: null, out_of_range: null, out_of_range_origin: null, draw: { as_written: "10.3.2026 07:25", requisition: null, specimen: null } },
    date: { as_written: "10.3.2026 07:25", precision: "minute", sort: "2026-03-10T07:25" }, status: "documented", negated: false, not_stated: [], origin: "document", certainty: "clear",
    codes: [{ system: "fno-local-lab", code, assigned_by: "source" }], note: null, quarantined: false, sources: [src],
  });
  const source = (id: string, quote: string) => ({ id, type: "document", document_id: DOC, part: null, page: 1, quote, quote_text: "tesseract", anchor: null, reported_as: "original", identity: "matches", reading_check: null });
  await env.DOCS.put(
    "extract/NO-A/run-A.json",
    JSON.stringify({
      schema: "codebridge.extraction/2", case_id: "NO-A", content_language: "cs",
      run: { id: "run-A", producer: "fixture", created_at: "2026-10-19T00:00:00Z", stages: [], supersedes: null },
      documents: [{ document_id: DOC, sha256: null, parts: [] }],
      // A quarantined value and one from another document are never compared: had they been, the comparison would
      // report them as missing from the reading.
      sources: [source("src-1", "B_HB 108"), source("src-2", "S_CEA 14,8"), { ...source("src-3", "S_ALT 2,0"), identity: "conflicts" }, { ...source("src-4", "S_AST 1,0"), document_id: "other-doc" }],
      facts: [
        lab("f-0000aa01", "B_HB", "108", "g/l", "120 ... 160", "src-1"),
        lab("f-0000aa02", "S_CEA", "14,8", "µg/l", "0 ... 5", "src-2"),
        { ...lab("f-0000aa03", "S_ALT", "2,0", "µkat/l", "0 ... 0.8", "src-3"), quarantined: true },
        lab("f-0000aa04", "S_AST", "1,0", "µkat/l", "0 ... 0.8", "src-4"),
      ],
      checks: [], alerts: [], brief: null, question_draft: null,
    }),
  );
});
afterEach(() => vi.restoreAllMocks());

async function runOnce(f = kit()) {
  const wf = await introspectWorkflow(env.PROCESS_DOCUMENT);
  await wf.modifyAll(async (m) => {
    await m.disableRetryDelays();
  });
  const r = await w("POST", `/documents/${DOC}/process`);
  expect(r.status).toBe(201);
  const [inst] = await wf.get();
  return { wf, inst: inst!, runId: r.body.data.run_id as string, calls: f.calls };
}

describe("ProcessDocumentWorkflow", () => {
  it("takes one page of another patient as a conflict whatever the overall answer, and a later reading never clears it", async () => {
    identityAnswer = { result: "matches", pages: [{ n: 1, result: "matches" }, { n: 2, result: "conflicts" }], evidence: [] };
    const first = await runOnce();
    await first.inst.waitForStatus("complete");
    await first.wf[Symbol.asyncDispose]();
    expect((await one("SELECT identity FROM documents WHERE id = ?1", DOC)).identity).toBe("conflicts");
    const alerts = async () => (await q<{ rule: string }>("SELECT rule FROM document_alerts WHERE document_id = ?1 ORDER BY rule", DOC)).map((r) => r.rule);
    expect(await alerts()).toEqual(["identity_conflict", "poor_copy"]);
    // A second reading that finds nothing wrong keeps the conflict and its alert: a doctor resolves it, not a rerun.
    identityAnswer = { result: "matches", pages: [{ n: 1, result: "matches" }, { n: 2, result: "matches" }], evidence: [] };
    const second = await runOnce();
    await using _ = second.wf;
    await second.inst.waitForStatus("complete");
    expect((await one("SELECT identity FROM documents WHERE id = ?1", DOC)).identity).toBe("conflicts");
    expect(await alerts()).toEqual(["identity_conflict", "poor_copy"]);
    expect((await q("SELECT ordinal FROM document_parts WHERE document_id = ?1", DOC)).length).toBe(2);
  });

  it("never sends a registered fixture's patient to the identity check and keeps prepared parts", async () => {
    await env.DB.batch([
      env.DB.prepare("UPDATE documents SET fixture_id = 'FX' WHERE id = ?1").bind(DOC),
      env.DB.prepare("INSERT INTO document_parts (org_id, document_id, ordinal, title_cs, pages_json) VALUES ('demo-a', ?1, 0, 'Připravený dokument', '[1, 2]')").bind(DOC),
    ]);
    const { wf, inst } = await runOnce();
    await using _ = wf;
    await inst.waitForStatus("complete");
    expect(identityAsked).toEqual([]);
    expect(await q("SELECT title_cs, producer FROM document_parts WHERE document_id = ?1", DOC)).toEqual([{ title_cs: "Připravený dokument", producer: null }]);
  });

  it("goes on without parts and identity when those checks fail", async () => {
    identityAnswer = { result: "nonsense", pages: [] };
    const { wf, inst, runId } = await runOnce();
    await using _ = wf;
    await inst.waitForStatus("complete");
    expect((await one("SELECT state FROM pipeline_runs WHERE id = ?1", runId)).state).toBe("done");
    expect((await one("SELECT identity FROM documents WHERE id = ?1", DOC)).identity).toBeNull();
    expect(await inst.waitForStepResult({ name: "identity" })).toMatchObject({ identity: "error" });
  });

  it("finishes without parts and identity when the page reader is older than those endpoints", async () => {
    const { wf, inst, runId } = await runOnce(kit({ older: true }));
    await using _ = wf;
    await inst.waitForStatus("complete");
    expect((await one("SELECT state FROM pipeline_runs WHERE id = ?1", runId)).state).toBe("done");
    expect(await q("SELECT ordinal FROM document_parts WHERE document_id = ?1", DOC)).toEqual([]);
    expect((await one("SELECT identity FROM documents WHERE id = ?1", DOC)).identity).toBeNull();
    // The poor copy is still an alert: it comes from the readability check, not from the newer endpoints.
    expect((await q<{ rule: string }>("SELECT rule FROM document_alerts WHERE document_id = ?1", DOC)).map((r) => r.rule)).toEqual(["poor_copy"]);
  });

  it("converts a photo to a PDF first and reads every page from that PDF, leaving the uploaded photo as it was", async () => {
    await env.DB.prepare("UPDATE documents SET media_type = 'image/jpeg', original_r2_key = 'uploads/NO-A/up-test-1.jpg' WHERE id = ?1").bind(DOC).run();
    await env.DOCS.put("uploads/NO-A/up-test-1.jpg", "\xff\xd8\xff photo");
    const { wf, inst, runId, calls } = await runOnce();
    await using _ = wf;
    await inst.waitForStatus("complete");
    const run = await one("SELECT state, output_prefix, stages_json FROM pipeline_runs WHERE id = ?1", runId);
    expect(run.state).toBe("done");
    expect(JSON.parse(run.stages_json)[0]).toMatchObject({ stage: "convert", converted: true });
    expect(await (await env.DOCS.get(`${run.output_prefix}converted.pdf`))!.text()).toBe("%PDF-1.4 converted");
    expect(await (await env.DOCS.get("uploads/NO-A/up-test-1.jpg"))!.text()).toBe("\xff\xd8\xff photo");
    const convert = calls.find((c) => new URL(c.url).pathname === "/v1/convert")!;
    expect(convert.headers.get("content-type")).toBe("image/jpeg");
    expect(inspected.at(-1)).toBe("%PDF-1.4 converted");
  });

  it("reads the pages, judges readability, parses the labs, compares them with the prepared data and keeps text out of step results", async () => {
    const { wf, inst, runId } = await runOnce();
    await using _ = wf;
    await inst.waitForStatus("complete");
    const run = await one("SELECT * FROM pipeline_runs WHERE id = ?1", runId);
    expect(run).toMatchObject({ state: "done", page_count: 2, readability: "poor", verify_count: 1, lab_points: 2, lab_unclear: 1, diff_same: 1, diff_verify: 1, diff_silent: 0, diff_missing: 0 });
    expect(JSON.parse(run.container_versions_json)).toMatchObject({ pymupdf: "1.24.10", tesseract: "5.3.0" });
    expect(JSON.parse(run.stages_json).map((s: { stage: string }) => s.stage)).toEqual(["convert", "inspect", "pages 1-2", "analyze", "labs", "parts", "identity", "compare"]);
    const doc = await one("SELECT state, processing, page_count, readability FROM documents WHERE id = ?1", DOC);
    expect(doc).toEqual({ state: "processed", processing: "processed", page_count: 2, readability: "poor" });
    // The source view opens Tesseract's reading of the uploaded page, with its marks.
    const page = await get(`/documents/${DOC}/pages/1`);
    expect(page.status).toBe(200);
    expect(page.body).toMatchObject({ engine: "tesseract", n: 1, of: 2 });
    expect(page.body.verify).toHaveLength(1);
    const res = await get(`/documents/${DOC}/pipeline`);
    expect(res.body.run).toMatchObject({ state: "done", readability_cs: "špatná", readability_alert_cs: "Dokument je špatně čitelný, vyžádejte lepší kopii.", diff: { same: 1, verify: 1, silent: 0, missing: 0 } });
    expect(res.body.run.label_cs).toMatch(/bez AI/);
    expect(res.body.labs.tests[0].points[0].source).toMatchObject({ doc_id: DOC, file: `${DOC}.pdf`, page: 1 });
    expect(res.body.diff_points.map((x: { result: string }) => x.result)).toEqual(["same", "verify"]);
    // Step results: ids, counts and codes only.
    // Parts: the split with the printed title and date, our type label where none is printed, readability per part.
    expect(await q("SELECT ordinal, title_cs, type, date, date_as_written, pages_json, readability, certainty, producer FROM document_parts WHERE document_id = ?1 ORDER BY ordinal", DOC)).toEqual([
      { ordinal: 0, title_cs: "Výsledky laboratorních vyšetření", type: "laboratorní výsledky", date: "2026-03-10", date_as_written: "10.3.2026", pages_json: "[1]", readability: "good", certainty: "documented", producer: "pipeline" },
      { ordinal: 1, title_cs: "neurčeno", type: "neurčeno", date: null, date_as_written: null, pages_json: "[2]", readability: "poor", certainty: "verify", producer: "pipeline" },
    ]);
    // Identity from the page text against the case's patient: only the result is kept; the alerts name pages only.
    expect(identityAsked).toEqual([FAKE_NAME]);
    expect((await one("SELECT identity FROM documents WHERE id = ?1", DOC)).identity).toBe("conflicts");
    expect(await q("SELECT rule, kind, message_id, args_json, run_id FROM document_alerts WHERE document_id = ?1 ORDER BY rule", DOC)).toEqual([
      { rule: "identity_conflict", kind: "identity", message_id: "alert-identity-conflict", args_json: JSON.stringify({ document: DOC, page: "2" }), run_id: runId },
      { rule: "poor_copy", kind: "poor_copy", message_id: "alert-poor-copy", args_json: JSON.stringify({ document: DOC, pages: "2" }), run_id: runId },
    ]);
    for (const name of ["inspect", "pages 1-2", "analyze", "labs", "parts", "identity", "compare with prepared data", "write"]) {
      const r = JSON.stringify(await inst.waitForStepResult({ name }));
      expect(r.length).toBeLessThan(400);
      for (const bad of [FAKE_NAME, "Odběr", "108", "14,8", "B_HB", "nar."]) expect(r).not.toContain(bad);
    }
    const lines = (await q<{ what_cs: string }>("SELECT what_cs FROM access_log WHERE action LIKE 'pipeline.%' ORDER BY id")).map((l) => l.what_cs);
    expect(lines).toEqual([
      "spustil(a) zpracování dokumentu bez AI (čtení stránek, čitelnost, laboratorní hodnoty)",
      "dokument zpracován bez AI (čitelnost: špatná; laboratorní hodnoty: 2, k ověření 1; s předem připravenými daty: 1 shodných, 1 k ověření, 0 jinak bez označení)",
      "zobrazil(a) výsledek zpracování dokumentu bez AI",
    ]);
    // Outputs live under the org's uploads/, which reset-demo clears.
    const keys = (await env.DOCS.list({ prefix: `org/demo-a/uploads/NO-A/${DOC}/${runId}/` })).objects.map((o) => o.key.split("/").pop());
    expect(keys.sort()).toEqual(["diff.json", "identity.json", "labs.json", "p1.json", "p1.png", "p1.raw.json", "p2.json", "p2.png", "p2.raw.json", "parts.json", "readability.json"]);
  });

  it("fails with a fixed code and a Czech reason when the page reader refuses the file", async () => {
    const { wf, inst, runId } = await runOnce(kit({ inspect: () => Response.json({ error: { code: "encrypted", message_cs: "x" } }, { status: 422 }) }));
    await using _ = wf;
    await inst.waitForStatus("complete");
    expect(await one("SELECT state, error_code FROM pipeline_runs WHERE id = ?1", runId)).toEqual({ state: "error", error_code: "encrypted" });
    expect(await one("SELECT state, state_detail_cs FROM documents WHERE id = ?1", DOC)).toEqual({ state: "failed", state_detail_cs: "zpracování selhalo: PDF je zašifrované" });
  });
});

describe("starting a run", () => {
  it("refuses a second run while one is active, and when the pipeline is off", async () => {
    kit();
    const wf = await introspectWorkflow(env.PROCESS_DOCUMENT);
    await using _ = wf;
    await wf.modifyAll(async (m) => {
      await m.disableRetryDelays();
    });
    expect((await w("POST", `/documents/${DOC}/process`)).status).toBe(201);
    const again = await w("POST", `/documents/${DOC}/process`);
    expect([again.status, again.body.error.code]).toEqual([409, "pipeline_running"]);
    for (const i of await wf.get()) await i.waitForStatus("complete");
    const off = await w("POST", `/documents/${DOC}/process`, {}, "d2p1", pe({ PAGE_READER_URL: "" }));
    expect([off.status, off.body.error.code]).toEqual([503, "pipeline_off"]);
    // Demo org A is not in the deployed PIPELINE_ORGS: the route answers as if no page reader existed.
    const notListed = await w("POST", `/documents/${DOC}/process`, {}, "d2p1", pe({ PIPELINE_ORGS: "demo-b" }));
    expect([notListed.status, notListed.body.error.code]).toEqual([503, "pipeline_off"]);
    expect((await w("POST", `/documents/${DOC}/process`, {}, "admin")).status).toBe(403);
    expect((await w("POST", `/documents/${DOC}/process`, {}, "d1p1")).body.error.code).toBe("not_member");
  });

  it("refuses a run on an approved case and marks a run the engine no longer runs as failed", async () => {
    await env.DB.prepare("INSERT INTO protocols (org_id, case_id, conclusion, state) VALUES ('demo-a', 'NO-A', 'x', 'approved')").run();
    const r = await w("POST", `/documents/${DOC}/process`);
    expect([r.status, r.body.error.code]).toEqual([409, "case_locked"]);
    const old = new Date(Date.now() - 3600_000).toISOString();
    await env.DB.prepare(
      `INSERT INTO pipeline_runs (org_id, id, document_id, case_id, state, pipeline_version, input_sha256, output_prefix, created_by, created_by_name, created_at, updated_at)
       VALUES ('demo-a', 'pl-stuck', ?1, 'NO-A', 'running', 'dev', ?2, 'uploads/x/', 'd2p1', 'x', ?3, ?3)`,
    ).bind(DOC, SHA, old).run();
    await env.DB.prepare("UPDATE documents SET state = 'processing' WHERE id = ?1").bind(DOC).run();
    await sweep(env);
    expect(await one("SELECT state, error_code FROM pipeline_runs WHERE id = 'pl-stuck'")).toEqual({ state: "error", error_code: "stalled" });
    expect((await one("SELECT state FROM documents WHERE id = ?1", DOC)).state).toBe("failed");
  });

  it("never changes a seeded document's state", async () => {
    await env.DB.prepare("UPDATE documents SET original_r2_key = 'docs/NO-A/A_pacient.pdf', sha256 = ?1 WHERE id = 'A_pacient'").bind("c".repeat(64)).run();
    await env.DOCS.put("docs/NO-A/A_pacient.pdf", "%PDF-1.4 seed");
    kit();
    const wf = await introspectWorkflow(env.PROCESS_DOCUMENT);
    await using _ = wf;
    await wf.modifyAll(async (m) => {
      await m.disableRetryDelays();
    });
    expect((await w("POST", "/documents/A_pacient/process")).status).toBe(201);
    for (const i of await wf.get()) await i.waitForStatus("complete");
    expect(await one("SELECT state, processing FROM documents WHERE id = 'A_pacient'")).toEqual({ state: null, processing: "processed" });
    expect((await one("SELECT state FROM pipeline_runs WHERE document_id = 'A_pacient'")).state).toBe("done");
  });
});

describe("waking the page reader (Administrace)", () => {
  it("wakes every instance for an administrator of an org the pipeline runs for, and says how many answered", async () => {
    let n = 0;
    mockFetch(async () => (++n === 1 ? new Response("starting", { status: 503 }) : Response.json({ ok: true, versions: { page_reader: "0.2.0" } })));
    const first = await w("POST", "/admin/pipeline/warm", {}, "admin");
    expect([first.status, first.body.data]).toEqual([200, { ok: false, ready: POOL_SIZE - 1, of: POOL_SIZE, versions: { page_reader: "0.2.0" } }]);
    const again = await w("POST", "/admin/pipeline/warm", {}, "admin");
    expect(again.body.data).toMatchObject({ ok: true, ready: POOL_SIZE, of: POOL_SIZE });
    expect((await q<{ what_cs: string }>("SELECT what_cs FROM access_log WHERE action = 'pipeline.warm' ORDER BY id")).map((l) => l.what_cs)).toEqual([
      `probudil(a) službu pro čtení stránek (odpověděly ${POOL_SIZE - 1} ze ${POOL_SIZE} instancí)`,
      "probudil(a) službu pro čtení stránek (připravena)",
    ]);
  });

  it("refuses anyone but an administrator, and an org the pipeline does not run for", async () => {
    mockFetch(async () => Response.json({ ok: true, versions: {} }));
    expect((await w("POST", "/admin/pipeline/warm", {}, "d2p1")).status).toBe(403);
    const orgA = await w("POST", "/admin/pipeline/warm", {}, "admin", pe({ PIPELINE_ORGS: "demo-b" }));
    expect([orgA.status, orgA.body.error.code]).toEqual([503, "pipeline_off"]);
    expect(await q("SELECT id FROM access_log WHERE action = 'pipeline.warm'")).toEqual([]);
    // The doctor's refused try is logged as a refusal, as any refused write.
    expect((await q<{ what_cs: string }>("SELECT what_cs FROM access_log WHERE action = 'write.refused'")).map((l) => l.what_cs)).toContain("odmítnuto: probuzení služby pro čtení stránek");
  });
});

describe("page reader routing", () => {
  it("uses the container only when PAGE_READER_CONTAINER is on, and names instances from a small pool by case", async () => {
    const base = { PAGE_READER_URL: "", PAGE_READER: {}, PIPELINE_ORGS: "*" } as unknown as Env;
    expect(pipelineAvailable({ ...base, PAGE_READER_CONTAINER: "off" })).toBe(false);
    expect(pipelineAvailable({ ...base, PAGE_READER_CONTAINER: "on" })).toBe(true);
    expect(pipelineAvailable({ ...base, PAGE_READER_CONTAINER: "on", PAGE_READER: undefined } as unknown as Env)).toBe(false);
    expect(pipelineAvailable({ ...base, PAGE_READER_URL: "http://localhost:8080", PAGE_READER_CONTAINER: "off" })).toBe(true);
    // Per org: the deployed host lists demo org B only, so demo org A looks as it always has.
    const deployed = { ...base, PAGE_READER_CONTAINER: "on", PIPELINE_ORGS: "demo-b" };
    expect([pipelineOn(deployed, "demo-a"), pipelineOn(deployed, "demo-b")]).toEqual([false, true]);
    expect(pipelineOn({ ...deployed, PIPELINE_ORGS: "" }, "demo-b")).toBe(false);
    expect(pipelineOn({ ...deployed, PAGE_READER_CONTAINER: "off" }, "demo-b")).toBe(false);
    // Every case lands on one of POOL_SIZE names, the same one every time, and no name carries the case ID.
    const names = new Set(Array.from({ length: 200 }, (_, i) => poolInstance(`NO-${i}`)));
    expect([...names].sort()).toEqual(Array.from({ length: POOL_SIZE }, (_, i) => `pool-${i}`));
    expect(poolInstance("NO-S02")).toBe(poolInstance("NO-S02"));
    // A call reaches the instance named for its case.
    const seen: string[] = [];
    const ns = { getByName: (n: string) => (seen.push(n), { fetch: async () => Response.json({ ok: true, versions: {} }) }) };
    await pageReader.healthz({ ...base, PAGE_READER_CONTAINER: "on", PAGE_READER: ns } as unknown as Env, poolInstance("NO-S02"));
    expect(seen).toEqual([poolInstance("NO-S02")]);
  });
});

describe("processing on upload", () => {
  it("uses the upload's membership check, which holds only while both actions allow the same roles", () => {
    for (const role of ["doctor", "coordinator", "admin"] as const)
      for (const ctx of [{ member: true, grant: false }, { member: false, grant: false }, { member: false, grant: true }])
        expect([role, ctx, allowed({ role } as never, "document.process", ctx)]).toEqual([role, ctx, allowed({ role } as never, "document.upload", ctx)]);
  });

  const PDF = new TextEncoder().encode("%PDF-1.4 auto " + "x".repeat(64));
  const send = (e: Env, name = "auto.pdf", caseId = "NO-A") =>
    call(`/api/cases/${caseId}/documents`, {
      method: "POST",
      headers: { "content-type": "application/pdf", "x-demo-user": "d2p1", "x-data-epoch": "1", "x-file-name": name, "content-length": String(PDF.length) },
      body: PDF,
    }, e).then(async (r) => ({ status: r.status, body: (await r.json()) as any }));

  it("starts a run on a kept upload where the pipeline runs for the org, and the run reads it", async () => {
    kit();
    const wf = await introspectWorkflow(env.PROCESS_DOCUMENT);
    await using _ = wf;
    await wf.modifyAll(async (m) => {
      await m.disableRetryDelays();
    });
    const r = await send(pe({ UPLOAD_POLICY: "store_unprocessed" }));
    expect(r.status).toBe(201);
    expect(r.body.data.document).toMatchObject({ content_stored: true, state: "queued", state_cs: "zpracovává se" });
    const id = r.body.data.document.id as string;
    for (const i of await wf.get()) await i.waitForStatus("complete");
    expect((await one("SELECT state FROM pipeline_runs WHERE document_id = ?1", id)).state).toBe("done");
    expect((await one("SELECT state FROM documents WHERE id = ?1", id)).state).toBe("processed");
    const lines = await q<{ action: string; what_cs: string }>("SELECT action, what_cs FROM access_log WHERE target_id = ?1 ORDER BY id", id);
    // The mocked page reader finds another patient on page 2, so the identity line comes before the run's own.
    expect(lines.map((l) => l.action)).toEqual(["document.upload", "pipeline.start", "document.identity_conflict", "pipeline.done"]);
    expect(lines[1]!.what_cs).toMatch(/spuštěno po nahrání/);
  });

  it("starts nothing in an org the pipeline does not run for, for a listed-only file, or in an open intake", async () => {
    // Demo org A with the deployed PIPELINE_ORGS: stored, as today, and no run.
    const a = await send(pe({ UPLOAD_POLICY: "store_unprocessed", PIPELINE_ORGS: "demo-b" }));
    expect(a.body.data.document).toMatchObject({ content_stored: true, state: "stored" });
    // Only listed (fixtures_only): nothing to read.
    const b = await send(pe(), "listed.pdf");
    expect(b.body.data.document).toMatchObject({ content_stored: false, state: "stored" });
    // An open intake waits for its end.
    await env.DB.prepare("UPDATE cases SET intake_open = 1, created_by = 'd2p1' WHERE id = 'NO-A'").run();
    const c = await send(pe({ UPLOAD_POLICY: "store_unprocessed" }), "intake.pdf");
    expect(c.body.data.document.state).toBe("stored");
    expect(await q("SELECT id FROM pipeline_runs WHERE document_id IN (?1, ?2, ?3)", a.body.data.document.id, b.body.data.document.id, c.body.data.document.id)).toEqual([]);
    // Its end starts the reading of what the prepared data did not cover (here: no prepared data at all).
    kit();
    const wf = await introspectWorkflow(env.PROCESS_DOCUMENT);
    await using _ = wf;
    const done = await w("POST", "/cases/NO-A/intake/complete");
    expect(done.status).toBe(200);
    expect((await one("SELECT state FROM documents WHERE id = ?1", c.body.data.document.id)).state).toBe("queued");
    expect((await q("SELECT id FROM pipeline_runs WHERE document_id = ?1", c.body.data.document.id)).length).toBe(1);
    for (const i of await wf.get()) await i.waitForStatus("complete");
  });
});

describe("the case merge (ProcessCase)", () => {
  const BDOC = "up-b-1";
  // A new patient's case in demo org B (where the pipeline runs): no run yet, one uploaded PDF.
  async function orgBUpload() {
    await env.DB.batch([
      env.DB.prepare("UPDATE extraction_runs SET is_current = 0 WHERE org_id = 'demo-b' AND case_id = 'B-NO-A'"),
      env.DB.prepare("UPDATE cases SET processing_level = 'none' WHERE org_id = 'demo-b' AND id = 'B-NO-A'"),
      env.DB.prepare(
        `INSERT INTO documents (org_id, id, case_id, file_name, page_count, original_r2_key, sha256, size_bytes, origin, processing, uploaded_by, state)
         VALUES ('demo-b', ?1, 'B-NO-A', 'lab.pdf', 0, 'org/demo-b/uploads/B-NO-A/up-b-1.pdf', ?2, 10, 'upload', 'unprocessed', 'b-doc', 'stored')`,
      ).bind(BDOC, SHA),
    ]);
    await env.DOCS.put("org/demo-b/uploads/B-NO-A/up-b-1.pdf", "%PDF-1.4 test");
  }
  const bGet = async (path: string) => {
    const r = await call(`/api${path}`, { headers: { "x-demo-user": "b-doc" } });
    return { status: r.status, body: (await r.json()) as any };
  };

  it("stores a pipeline run from the document's fragment after its run, which the case view reads; a withdraw empties it", async () => {
    await orgBUpload();
    identityAnswer = { result: "matches", pages: [{ n: 1, result: "matches" }, { n: 2, result: "matches" }], evidence: [] };
    kit();
    const docs = await introspectWorkflow(env.PROCESS_DOCUMENT);
    const cases = await introspectWorkflow(env.PROCESS_CASE);
    await using _d = docs;
    await using _c = cases;
    await docs.modifyAll(async (m) => {
      await m.disableRetryDelays();
    });
    const r = await w("POST", `/documents/${BDOC}/process`, {}, "b-doc", pe());
    expect(r.status).toBe(201);
    for (const i of await docs.get()) await i.waitForStatus("complete");
    const [merge] = await cases.get();
    await merge!.waitForStatus("complete");
    // Step results: codes and counts only.
    expect(await merge!.waitForStepResult({ name: "compose and store" })).toEqual({ result: "stored", documents: 1, facts: 2 });
    // The AI part is not started: the model is not configured and MODEL_ORGS lists no org.
    const [docRun] = await docs.get();
    expect(await docRun!.waitForStepResult({ name: "start extraction" })).toEqual({ started: false });

    const run = await one("SELECT id, producer, seeded, is_current, r2_key FROM extraction_runs WHERE org_id = 'demo-b' AND case_id = 'B-NO-A' AND is_current = 1");
    expect(run).toMatchObject({ producer: "pipeline", seeded: 0, is_current: 1 });
    expect(run.r2_key).toMatch(/^org\/demo-b\/runs\/B-NO-A\/pipeline-B-NO-A-[0-9a-f]{8}\.json$/);
    const stored = (await (await env.DOCS.get(run.r2_key))!.json()) as any;
    expect(stored.documents).toEqual([{ document_id: BDOC, sha256: SHA, parts: [`${BDOC}/p0`, `${BDOC}/p1`] }]);
    expect(stored.facts.map((f: any) => [f.kind, f.value.value_as_written, f.certainty, f.quarantined])).toEqual([
      ["lab_result", "108", "clear", false],
      ["lab_result", "14,8", "verify", false],
    ]);
    expect(stored.alerts.map((a: any) => a.rule)).toEqual(["poor_copy"]);
    expect(stored.checks.find((c: any) => c.looks_for === "lab_result").result).toBe("found");
    expect(stored.checks.find((c: any) => c.looks_for === "allergy").result).toBe("not_run");
    // No patient identity in the stored run.
    expect(JSON.stringify(stored)).not.toContain(FAKE_NAME);
    // The document's interim alert moved into the run; the case is no longer "nezpracováno".
    expect(await q("SELECT id FROM document_alerts WHERE document_id = ?1", BDOC)).toEqual([]);
    expect((await one("SELECT processing_level FROM cases WHERE org_id = 'demo-b' AND id = 'B-NO-A'")).processing_level).toBe("partial");
    // The case view reads it: lab values and the poor-copy alert, no AI.
    const ex = await bGet("/cases/B-NO-A/extraction");
    expect(ex.status).toBe(200);
    expect(ex.body.run).toMatchObject({ producer: "pipeline" });
    expect(ex.body.data.facts).toHaveLength(2);
    expect((await q<{ what_cs: string }>("SELECT what_cs FROM access_log WHERE action = 'case.pipeline_run'")).map((l) => l.what_cs)).toEqual([
      "sestaven přehled případu ze zpracovaných dokumentů bez AI (dokumentů: 1, údajů: 2)",
    ]);

    // Withdrawn as another patient's: the next run has neither the document nor its values.
    const wd = await call(`/api/documents/${BDOC}/withdraw`, { method: "POST", headers: { "content-type": "application/json", "x-demo-user": "b-doc", "x-data-epoch": "1" }, body: JSON.stringify({ reason: "wrong_patient" }) }, pe());
    expect(wd.status).toBe(200);
    const all = await cases.get();
    for (const i of all) await i.waitForStatus("complete");
    const next = await one("SELECT id, supersedes, r2_key FROM extraction_runs WHERE org_id = 'demo-b' AND case_id = 'B-NO-A' AND is_current = 1");
    expect(next.supersedes).toBe(run.id);
    const empty = (await (await env.DOCS.get(next.r2_key))!.json()) as any;
    expect([empty.documents, empty.facts, empty.alerts]).toEqual([[], [], []]);
    // The earlier run no longer holds the withdrawn document's values either.
    const scrubbed = (await (await env.DOCS.get(run.r2_key))!.json()) as any;
    expect([scrubbed.documents, scrubbed.facts, scrubbed.sources]).toEqual([[], [], []]);
    // A merge in an org the pipeline does not run for does nothing (demo org A).
    await env.PROCESS_CASE.create({ id: "case-a-test", params: { org: "demo-a", caseId: "NO-A", by: "d2p1", byActor: null } });
    const a = (await cases.get()).at(-1);
    await a!.waitForStatus("complete");
    expect(await a!.waitForStepResult({ name: "compose and store" })).toEqual({ result: "off", documents: 0, facts: 0 });
  });

  it("holds back values from a page of another patient and says so; leaves a case with another producer's run alone", async () => {
    await orgBUpload();
    identityAnswer = { result: "conflicts", pages: [{ n: 1, result: "conflicts" }, { n: 2, result: "matches" }], evidence: [] };
    kit();
    const docs = await introspectWorkflow(env.PROCESS_DOCUMENT);
    const cases = await introspectWorkflow(env.PROCESS_CASE);
    await using _d = docs;
    await using _c = cases;
    await docs.modifyAll(async (m) => {
      await m.disableRetryDelays();
    });
    expect((await w("POST", `/documents/${BDOC}/process`, {}, "b-doc", pe())).status).toBe(201);
    for (const i of await docs.get()) await i.waitForStatus("complete");
    for (const i of await cases.get()) await i.waitForStatus("complete");
    const run = await one("SELECT r2_key FROM extraction_runs WHERE org_id = 'demo-b' AND case_id = 'B-NO-A' AND is_current = 1");
    const stored = (await (await env.DOCS.get(run.r2_key))!.json()) as any;
    expect(stored.facts.every((f: any) => f.quarantined)).toBe(true);
    // A document of another patient never goes to a model, whatever MODEL_ORGS says.
    const [docRun] = await docs.get();
    expect(await docRun!.waitForStepResult({ name: "start extraction" })).toEqual({ started: false, reason: "identity" });
    const identity = stored.alerts.find((a: any) => a.rule === "identity_conflict");
    expect(identity).toMatchObject({ kind: "identity", message: { id: "alert-identity-conflict", args: { document: BDOC, page: "1" } } });
    expect(identity.facts.sort()).toEqual(stored.facts.map((f: any) => f.id).sort());
    // The view gets the alert, never the held-back values.
    const ex = await bGet("/cases/B-NO-A/extraction");
    expect(ex.body.data.facts).toEqual([]);
    expect(ex.body.data.alerts.some((a: any) => a.rule === "identity_conflict")).toBe(true);

    // A case whose current run came from another producer (a prepared fixture, the NIS import) keeps it.
    await env.DB.prepare("UPDATE extraction_runs SET is_current = (id = 'run-BA') WHERE org_id = 'demo-b' AND case_id = 'B-NO-A'").run();
    const who = await actorFor(env.DB, "demo-b", "b-doc", "demo");
    expect(await publishCaseRun(env, "demo-b", "B-NO-A", who)).toMatchObject({ result: "other_producer" });
  });

  it("holds back a document D1 knows is another patient's even when its fragment was written before that was known", async () => {
    await orgBUpload();
    identityAnswer = { result: "matches", pages: [{ n: 1, result: "matches" }, { n: 2, result: "matches" }], evidence: [] };
    kit();
    const docs = await introspectWorkflow(env.PROCESS_DOCUMENT);
    const cases = await introspectWorkflow(env.PROCESS_CASE);
    await using _d = docs;
    await using _c = cases;
    await docs.modifyAll(async (m) => {
      await m.disableRetryDelays();
    });
    expect((await w("POST", `/documents/${BDOC}/process`, {}, "b-doc", pe())).status).toBe(201);
    for (const i of await docs.get()) await i.waitForStatus("complete");
    for (const i of await cases.get()) await i.waitForStatus("complete");
    // A rerun found the conflict (finish() kept it in D1 with its alert row), but its fragment was never written.
    await env.DB.batch([
      env.DB.prepare("UPDATE documents SET identity = 'conflicts' WHERE id = ?1").bind(BDOC),
      env.DB.prepare("INSERT INTO document_alerts (id, org_id, case_id, document_id, rule, subject, kind, message_id, args_json, run_id, created_at) VALUES ('al-x', 'demo-b', 'B-NO-A', ?1, 'identity_conflict', ?1, 'identity', 'alert-identity-conflict', '{}', 'pl-x', '2026-10-20T08:00:00Z')").bind(BDOC),
    ]);
    const who = await actorFor(env.DB, "demo-b", "b-doc", "demo");
    expect(await publishCaseRun(env, "demo-b", "B-NO-A", who)).toMatchObject({ result: "stored" });
    const run = await one("SELECT r2_key FROM extraction_runs WHERE org_id = 'demo-b' AND case_id = 'B-NO-A' AND is_current = 1");
    const stored = (await (await env.DOCS.get(run.r2_key))!.json()) as any;
    expect(stored.facts.length).toBeGreaterThan(0);
    expect(stored.facts.every((f: any) => f.quarantined)).toBe(true);
    expect(stored.alerts.some((a: any) => a.rule === "identity_conflict" && a.subject === BDOC)).toBe(true);
    expect((await bGet("/cases/B-NO-A/extraction")).body.data.facts).toEqual([]);
  });
});

