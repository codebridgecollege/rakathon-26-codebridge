// ExtractDocumentWorkflow (src/workflows/extract-document.ts) on a pipeline run's outputs, with the page reader and the
// model mocked: which pages are read by vision and from which image, what the model receives, the fragment it writes
// (docs/research/2026-10-20-case-merge-contract.md), quarantine from the pipeline's identity, a refused part listed as
// unread, the audit rows, and step results without patient text.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { env } from "cloudflare:workers";
import { introspectWorkflow } from "cloudflare:test";
import { mockFetch } from "./helpers";
import { FAKE_NAME, loadFixture } from "./data";
import { modelOn } from "../src/workflows/extract-document";
import { testEnv } from "./helpers";

const DOC = "up-ai-1";
const PREFIX = `org/demo-a/uploads/NO-A/${DOC}/pl-1/`;
const P1 = `${FAKE_NAME}, nar. 1.1.1964, r.č. 645312/1234\nDiagnózy: C20 Zhoubný novotvar konečníku\nCT 17.3.2026: bez známek vzdálených metastáz`;
const P2 = "Vrbenská Lenka, nar. 18.4.1959\nCT břicha 24.9.2026: metastatické postižení jater.";
const VISION_P1 = "[X], nar. [X], r.č. [X]\nDiagnózy: C20 Zhoubný novotvar konečníku\nCT 17.3.2026: bez známek vzdálených metastáz";
const REDACTED = btoa("redacted-page-1");
const PNG_B64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";

const words = (text: string) => text.split(/\s+/).filter(Boolean).map((t, i) => ({ t, c: 90, b: [i * 10, 10, 9, 9] }));
const putJson = (key: string, v: unknown) => env.DOCS.put(key, JSON.stringify(v));

const modelFact = (o: Record<string, unknown>) => ({
  kind: "diagnosis", part: 1, quote: "", subject: "patient", relation: null, status: "documented", negated: false, date_as_written: null, text: "", code: null,
  disease_status: null, primary: null, tnm_as_written: null, stage_kind: null, at_diagnosis: null, site: null, metastasis_status: null, modality: null, region: null,
  specimen: null, tumour_type: null, grade: null, line: null, stop_as_written: null, reason_stopped: null, dose: null, request_kind: null, decision_body: null, scale: null,
  value_as_written: null, reaction: null, risk_type: null, pack_years: null, strength: null, dosing: null, change: null, indication: null, reported_as: "original",
  certainty: "clear", uncertainty: null, ...o,
});
const answer = (content: string, finish = "stop") => Response.json({ choices: [{ message: { content }, finish_reason: finish }] });

beforeEach(async () => {
  await loadFixture();
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO documents (org_id, id, case_id, file_name, page_count, original_r2_key, sha256, size_bytes, origin, processing, uploaded_by, state)
       VALUES ('demo-a', ?1, 'NO-A', 'zprava.pdf', 2, ?2, ?3, 10, 'upload', 'processed', 'd2p1', 'processed')`,
    ).bind(DOC, `org/demo-a/uploads/NO-A/${DOC}.pdf`, "c".repeat(64)),
    env.DB.prepare(
      `INSERT INTO pipeline_runs (org_id, id, document_id, case_id, state, pipeline_version, input_sha256, output_prefix, created_by, created_by_name, created_at, updated_at)
       VALUES ('demo-a', 'pl-1', ?1, 'NO-A', 'done', 'dev', ?2, ?3, 'd2p1', 'x', '2026-10-20T08:00:00Z', '2026-10-20T08:00:00Z')`,
    ).bind(DOC, "c".repeat(64), PREFIX),
  ]);
  // The pipeline's outputs: page 1 fair (read by vision), page 2 good with a text layer (not read by vision) and
  // showing another patient; two parts; identity per page.
  await putJson(`${PREFIX}readability.json`, { document: { level: "fair", reasons_cs: [] }, pages: [{ n: 1, level: "fair" }, { n: 2, level: "good" }] });
  for (const [n, text, level] of [[1, P1, "fair"], [2, P2, "good"]] as const) {
    await putJson(`${PREFIX}p${n}.json`, { n, size: [10, 10], text, engine: "tesseract", words: words(text), mean_conf: 90, low_conf_words: 0, verify: [], second_reading: "text_layer", readability: { level, reasons_cs: [], metrics: {} } });
    await putJson(`${PREFIX}p${n}.raw.json`, { n, size: [10, 10], words: words(text), tess_text: text, layer_text: text });
    await env.DOCS.put(`${PREFIX}p${n}.png`, Uint8Array.from(atob(PNG_B64), (c) => c.charCodeAt(0)));
  }
  await putJson(`${PREFIX}parts.json`, { parts: [{ ordinal: 0, pages: [1] }, { ordinal: 1, pages: [2] }] });
  await putJson(`${PREFIX}identity.json`, { result: "conflicts", pages: [{ n: 1, result: "matches" }, { n: 2, result: "conflicts" }] });
});
afterEach(() => vi.restoreAllMocks());

// The page reader and the model. extractPart2 decides what the model answers for part 2.
function mocks(extractPart2: () => Response) {
  const sentToModel: string[] = [];
  const redactAsked: string[] = [];
  const m = mockFetch(async (req) => {
    const u = new URL(req.url);
    if (u.host === "page-reader.test" && u.pathname === "/v1/redact") {
      const b = await req.json<{ pages: { n: number }[]; identity: unknown }>();
      redactAsked.push(JSON.stringify(b.identity));
      return Response.json({ pages: b.pages.map((p) => ({ n: p.n, png_b64: REDACTED, hits: [{ reason: "jméno pacienta", box: [1, 1, 1, 1] }] })) });
    }
    if (u.host === "page-reader.test" && u.pathname === "/v1/compare") {
      const b = await req.json<{ pages: { n: number; text: string }[] }>();
      const at = b.pages[0]!.text.indexOf("C20");
      return Response.json({ pages: [{ n: b.pages[0]!.n, verify: [{ vision: "C20", start: at, end: at + 3, tess: "C2O", conf: 50, box: null, reason: "disagree" }] }] });
    }
    if (u.host === "model.test") {
      const body = await req.text();
      sentToModel.push(body);
      if (body.includes("image_url")) return answer(VISION_P1);
      if (body.includes("Vrbensk") || body.includes("metastatické postižení jater")) return extractPart2();
      return answer(JSON.stringify({ facts: [modelFact({ kind: "diagnosis", quote: "C20 Zhoubný novotvar konečníku", text: "Zhoubný novotvar konečníku", code: "C20", primary: true })] }));
    }
    throw new Error(`unexpected ${u.host}${u.pathname}`);
  });
  return { ...m, sentToModel, redactAsked };
}

async function run() {
  const wf = await introspectWorkflow(env.EXTRACT_DOCUMENT);
  await wf.modifyAll(async (m) => {
    await m.disableRetryDelays();
  });
  await env.EXTRACT_DOCUMENT.create({ id: "ai-pl-1", params: { org: "demo-a", caseId: "NO-A", docId: DOC, runId: "pl-1" } });
  const [inst] = await wf.get();
  return { wf, inst: inst! };
}

const fragment = async () => (await env.DOCS.get(`${PREFIX}fragment-ai.json`))!.json<any>();

describe("ExtractDocumentWorkflow", () => {
  it("reads the page that needs it from the redacted image, extracts per part and writes the fragment", async () => {
    const part2 = JSON.stringify({ facts: [modelFact({ kind: "metastasis", quote: "CT břicha 24.9.2026: metastatické postižení jater.", text: "metastázy jater", site: "játra", metastasis_status: "confirmed", date_as_written: "24.9.2026" })] });
    const m = mocks(() => answer(part2));
    const { wf, inst } = await run();
    await using _ = wf;
    await inst.waitForStatus("complete");

    // Page 1 went to the model as the redacted image only; page 2 (good, with a text layer) was not read by vision.
    const images = m.sentToModel.filter((b) => b.includes("image_url"));
    expect(images).toHaveLength(1);
    expect(images[0]).toContain(`data:image/png;base64,${REDACTED}`);
    expect(images[0]).not.toContain(PNG_B64);
    // The redaction got the case's name forms from the record.
    expect(m.redactAsked[0]).toContain("testova");
    // No identifier of the case reached the model in any text.
    for (const b of m.sentToModel) for (const bad of ["Testová", "645312", "1.1.1964"]) expect(b).not.toContain(bad);

    const vision = await (await env.DOCS.get(`${PREFIX}p1.vision.json`))!.json<{ text: string; verify: number[][]; engine: string }>();
    expect(vision.text).toBe(VISION_P1);
    expect(vision.verify).toEqual([[VISION_P1.indexOf("C20"), VISION_P1.indexOf("C20") + 3]]);

    const f = await fragment();
    expect(f).toMatchObject({ schema: "codebridge.fragment/1", producer: "ai", document_id: DOC, pipeline_run: "pl-1", alerts: [] });
    expect(f.stages.map((s: { name: string }) => s.name)).toEqual(["read_pages", "extract_facts"]);
    expect(f.facts.map((x: any) => [x.draft_id, x.kind, x.quarantined, x.certainty])).toEqual([
      [`ai:${DOC}:1`, "diagnosis", false, "verify"], // the vision and Tesseract readings disagree on "C20"
      [`ai:${DOC}:2`, "metastasis", true, "clear"], // page 2 shows another patient: kept, quarantined
    ]);
    expect(f.facts[0].certainty_reason.code).toBe("ocr_check");
    expect(f.sources.map((s: any) => [s.id, s.page, s.part, s.quote_text, s.identity])).toEqual([
      [`src-ai-${DOC}-1`, 1, `${DOC}/p0`, "vision", "matches"],
      [`src-ai-${DOC}-2`, 2, `${DOC}/p1`, "pdf_text", "conflicts"],
    ]);
    expect(f.facts.every((x: any) => x.id === undefined && x.key === undefined)).toBe(true);
    const diag = f.checks.find((c: any) => c.looks_for === "diagnosis");
    expect(diag).toMatchObject({ result: "found", covered: [{ document_id: DOC, part: `${DOC}/p0` }, { document_id: DOC, part: `${DOC}/p1` }], unreadable: [] });

    // One access-log row per page and call: page 1 read and extracted, page 2 extracted.
    const log = (await env.DB.prepare("SELECT document_id, page_n, what_cs FROM access_log WHERE action = 'model.call' ORDER BY id").all<any>()).results;
    expect(log.map((l) => [l.document_id, l.page_n])).toEqual([[DOC, 1], [DOC, 1], [DOC, 2]]);
    expect(log[0].what_cs).toContain("read_page");

    // Step results: IDs, counts and codes only.
    for (const name of ["plan", "read p1", `extract ${DOC}/p0`, `extract ${DOC}/p1`, "fragment", "case"]) {
      const r = JSON.stringify(await inst.waitForStepResult({ name }));
      for (const bad of [FAKE_NAME, "Vrbensk", "C20", "novotvar", "jater", "1964"]) expect(r).not.toContain(bad);
    }
    expect(await inst.waitForStepResult({ name: "case" })).toEqual({ started: false });
  });

  it("lists a part the content filter refused as unread, never as nothing found, and still writes the fragment", async () => {
    mocks(() => answer("", "content_filter"));
    const { wf, inst } = await run();
    await using _ = wf;
    await inst.waitForStatus("complete");
    const f = await fragment();
    expect(f.facts.map((x: any) => x.kind)).toEqual(["diagnosis"]);
    const meta = f.checks.find((c: any) => c.looks_for === "metastasis");
    expect(meta).toMatchObject({ result: "nothing_found", unreadable: [{ document_id: DOC, part: null, page: 2 }] });
    expect(await inst.waitForStepResult({ name: `extract ${DOC}/p1` })).toEqual({ part: 1, code: "refused", facts: 0 });
  });

  it("stops on a document withdrawn meanwhile, and runs only for orgs in MODEL_ORGS", async () => {
    await env.DB.prepare("UPDATE documents SET lifecycle = 'withdrawn', lifecycle_reason_cs = 'x', lifecycle_changed_at = '2026-10-20T09:00:00Z', lifecycle_changed_by = 'd2p1' WHERE id = ?1").bind(DOC).run();
    const m = mocks(() => answer("{}"));
    const { wf, inst } = await run();
    await using _ = wf;
    await inst.waitForStatus("errored");
    expect(m.sentToModel).toEqual([]);
    expect(await env.DOCS.get(`${PREFIX}fragment-ai.json`)).toBeNull();

    expect(modelOn(testEnv({ MODEL_ORGS: "" }), "demo-a")).toBe(false);
    expect(modelOn(testEnv({ MODEL_ORGS: "demo-b" }), "demo-a")).toBe(false);
    expect(modelOn(testEnv({ MODEL_ORGS: "*" }), "demo-a")).toBe(true);
    expect(modelOn(testEnv({ MODEL_ORGS: "*", AZURE_OPENAI_KEY: "" }), "demo-a")).toBe(false);
  });
});
