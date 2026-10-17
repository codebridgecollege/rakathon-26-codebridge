// The document pipeline without an LLM (step 6, slice b-1) with PageKit mocked at https://pagekit.test: a run on an
// upload writes its pages, readability and lab values to R2 and D1, is compared with the prepared data, fails with a
// fixed code and a Czech reason, never runs twice at once, leaves seeded documents as they are, and its Workflow step
// results hold ids and counts only.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { env } from "cloudflare:workers";
import { introspectWorkflow } from "cloudflare:test";
import { call, mockFetch, testEnv } from "./helpers";
import { FAKE_NAME, loadFixture } from "./data";
import { sweep } from "../src/scheduled";

const q = async <T = Record<string, unknown>>(sql: string, ...args: unknown[]) => (await env.DB.prepare(sql).bind(...args).all<T>()).results;
const one = async <T = Record<string, any>>(sql: string, ...args: unknown[]) => (await q<T>(sql, ...args))[0]!;
const PNG_B64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";
const DOC = "up-test-1";
const SHA = "b".repeat(64);
// Page text that must never reach a step result: the patient's name and a lab line.
const TEXT1 = `${FAKE_NAME}, nar. 1.1.1964\nOdběr: 10.3.2026 07:25\nB_HB: 108 g/l [120 ... 160]\nS_CEA: 14,8 µg/l [0 ... 5]`;

function kit({ inspect = () => Response.json({ page_count: 2, encrypted: false, producer_present: true, has_text_layer: [true, true] }) }: { inspect?: () => Response } = {}) {
  return mockFetch(async (req) => {
    const u = new URL(req.url);
    expect(u.host).toBe("pagekit.test");
    if (u.pathname === "/healthz") return Response.json({ ok: true, versions: { pagekit: "0.1.0", pymupdf: "1.24.10", tesseract: "5.3.0", ces_model: "sha256:abc" } });
    if (u.pathname === "/v1/inspect") return inspect();
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

async function w(method: string, path: string, body: unknown = {}, user = "d2p1", e = testEnv()) {
  const r = await call(`/api${path}`, { method, headers: { "content-type": "application/json", "x-demo-user": user, "x-data-epoch": "1" }, body: JSON.stringify(body) }, e);
  return { status: r.status, body: (await r.json()) as any };
}
const get = async (path: string, user = "d2p1") => {
  const r = await call(`/api${path}`, { headers: { "x-demo-user": user } });
  return { status: r.status, body: (await r.json()) as any };
};

beforeEach(async () => {
  await loadFixture();
  await env.DB.prepare(
    `INSERT INTO documents (id, case_id, file_name, page_count, original_r2_key, sha256, size_bytes, origin, processing, uploaded_by, state, fixture_id, identity)
     VALUES (?1, 'NO-A', 'lab.pdf', 0, 'uploads/NO-A/up-test-1.pdf', ?2, 10, 'upload', 'unprocessed', 'd2p1', 'stored', NULL, NULL)`,
  ).bind(DOC, SHA).run();
  await env.DOCS.put("uploads/NO-A/up-test-1.pdf", "%PDF-1.4 test");
  // The case's prepared data holds the two values of this document, so the run is compared with them.
  await env.DOCS.put(
    "extract/NO-A/run-A.json",
    JSON.stringify({
      schema: "codebridge.extraction/1", case_id: "NO-A", processing: "partial", run_id: "run-A",
      syn: { labs_series: { tests: [
        { code: "B_HB", unit: "g/l", reference_range: "120 ... 160", points: [{ value: "108", date: "2026-03-10", time: "07:25", source: { file: `${DOC}.pdf`, page: 1 } }] },
        { code: "S_CEA", unit: "µg/l", reference_range: "0 ... 5", points: [{ value: "14,8", date: "2026-03-10", time: "07:25", source: { file: `${DOC}.pdf`, page: 1 } }] },
      ] } },
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
  it("reads the pages, judges readability, parses the labs, compares them with the prepared data and keeps text out of step results", async () => {
    const { wf, inst, runId } = await runOnce();
    await using _ = wf;
    await inst.waitForStatus("complete");
    const run = await one("SELECT * FROM pipeline_runs WHERE id = ?1", runId);
    expect(run).toMatchObject({ state: "done", page_count: 2, readability: "poor", verify_count: 1, lab_points: 2, lab_unclear: 1, diff_same: 1, diff_verify: 1, diff_silent: 0, diff_missing: 0 });
    expect(JSON.parse(run.container_versions_json)).toMatchObject({ pymupdf: "1.24.10", tesseract: "5.3.0" });
    expect(JSON.parse(run.stages_json).map((s: { stage: string }) => s.stage)).toEqual(["inspect", "pages 1-2", "analyze", "labs", "compare"]);
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
    for (const name of ["inspect", "pages 1-2", "analyze", "labs", "compare with prepared data", "write"]) {
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
    // Outputs live under uploads/, which reset-demo clears.
    const keys = (await env.DOCS.list({ prefix: `uploads/NO-A/${DOC}/${runId}/` })).objects.map((o) => o.key.split("/").pop());
    expect(keys.sort()).toEqual(["diff.json", "labs.json", "p1.json", "p1.png", "p1.raw.json", "p2.json", "p2.png", "p2.raw.json", "readability.json"]);
  });

  it("fails with a fixed code and a Czech reason when PageKit refuses the file", async () => {
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
    const off = await w("POST", `/documents/${DOC}/process`, {}, "d2p1", testEnv({ PAGEKIT_URL: "" }));
    expect([off.status, off.body.error.code]).toEqual([503, "pipeline_off"]);
    expect((await w("POST", `/documents/${DOC}/process`, {}, "admin")).status).toBe(403);
    expect((await w("POST", `/documents/${DOC}/process`, {}, "d1p1")).body.error.code).toBe("not_member");
  });

  it("refuses a run on an approved case and marks a run the engine no longer runs as failed", async () => {
    await env.DB.prepare("INSERT INTO protocols (case_id, conclusion, state) VALUES ('NO-A', 'x', 'approved')").run();
    const r = await w("POST", `/documents/${DOC}/process`);
    expect([r.status, r.body.error.code]).toEqual([409, "case_locked"]);
    const old = new Date(Date.now() - 3600_000).toISOString();
    await env.DB.prepare(
      `INSERT INTO pipeline_runs (id, document_id, case_id, state, pipeline_version, input_sha256, output_prefix, created_by, created_by_name, created_at, updated_at)
       VALUES ('pl-stuck', ?1, 'NO-A', 'running', 'dev', ?2, 'uploads/x/', 'd2p1', 'x', ?3, ?3)`,
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
