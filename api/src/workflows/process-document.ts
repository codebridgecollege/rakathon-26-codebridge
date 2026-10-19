// ProcessDocumentWorkflow (step 6, slice b-1): one stored PDF read by the deterministic pipeline, no LLM. The page reader
// (services/page-reader.ts) renders the pages, reads them with Tesseract and the PDF text layer, marks "ověřit" where the
// readings disagree, judges readability from the text, and parses FNO-format lab sheets. Each step writes its output
// to R2 under the run's prefix and is retried on its own.
//
// Privacy: params and step results hold ids, counts and fixed codes only. The engine keeps them for the instance's
// retention outside our EU jurisdiction setting, so page images, text and lab values never pass through them
// (test/pipeline.test.ts checks every step result).
//
// A run never replaces what the case shows: a document with prepared data keeps it, and the run is compared with it
// (diff counts); a document without data gets the run's pages for the source view, labelled as Tesseract's reading.
import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from "cloudflare:workers";
import { NonRetryableError } from "cloudflare:workflows";
import { PageReaderError, pageReader, poolInstance, type Labs, type PageRecord, type RawPage, type Readability } from "../services/page-reader";
import { actorFor } from "../store/audio";
import { orgStmt } from "../store/sql";
import { LEGACY_ORG } from "../domain/orgs";
import { auditStatement } from "../store/write";
import { diffLabs, pipelineErrorCs, PIPELINE_BATCH, READABILITY_CS, type PreparedPoint } from "../domain/pipeline";
import { EXTRACTION_SCHEMA, type ExtractionRun, type LabResultFact } from "@codebridge/domain/extraction/types";

// org: the case's org, given by the route that starts the run (a Workflow has no request); a run started before orgs
// has none, and all data of that time is demo org A's.
export type ProcessDocumentParams = { org: string; runId: string; docId: string; caseId: string };

const STEP = { retries: { limit: 3, delay: "5 seconds", backoff: "exponential" }, timeout: "2 minutes" } as const;
// A batch of pages runs Tesseract at 300 dpi; the first call after a deploy may wait for a cold container, and any call
// that takes the page reader's lock (inspect, pages) may wait behind another document of the same case (poolInstance).
const OCR = { retries: { limit: 3, delay: "10 seconds", backoff: "exponential" }, timeout: "10 minutes" } as const;

const iso = () => new Date().toISOString();

type RunRow = { id: string; document_id: string; case_id: string; output_prefix: string; input_sha256: string; created_by: string; created_by_actor: string | null; state: string };
type DocRow = { id: string; case_id: string; original_r2_key: string | null; sha256: string | null; state: string | null; media_type: string };

async function runOf(env: Env, org: string, runId: string) {
  const r = await orgStmt(env.DB, org, "SELECT id, document_id, case_id, output_prefix, input_sha256, created_by, created_by_actor, state FROM pipeline_runs WHERE org_id = ?org AND id = ?1", runId).first<RunRow>();
  if (!r) throw new NonRetryableError("run_missing");
  return r;
}

// The file the run was started on, exactly as uploaded; a changed or missing file stops the run instead of reading
// something else.
async function docOf(env: Env, org: string, run: RunRow): Promise<DocRow & { original_r2_key: string }> {
  const d = await orgStmt(env.DB, org, "SELECT id, case_id, original_r2_key, sha256, state, media_type FROM documents WHERE org_id = ?org AND id = ?1", run.document_id).first<DocRow>();
  if (!d?.original_r2_key || d.sha256 !== run.input_sha256) throw new NonRetryableError("document_changed");
  return d as DocRow & { original_r2_key: string };
}

async function originalOf(env: Env, org: string, run: RunRow): Promise<{ bytes: ArrayBuffer; mediaType: string }> {
  const d = await docOf(env, org, run);
  const o = await env.DOCS.get(d.original_r2_key);
  if (!o) throw new NonRetryableError("document_missing");
  return { bytes: await o.arrayBuffer(), mediaType: d.media_type };
}

const isImage = (mediaType: string) => mediaType.startsWith("image/");
const convertedKey = (run: RunRow) => `${run.output_prefix}converted.pdf`;

// The PDF the pages are read from: the upload itself, or for a photo the PDF the convert step made from it (the row
// says which, so a photo's original is not downloaded again for every batch).
async function pdfOf(env: Env, org: string, run: RunRow): Promise<ArrayBuffer> {
  const d = await docOf(env, org, run);
  if (!isImage(d.media_type)) return (await originalOf(env, org, run)).bytes;
  const c = await env.DOCS.get(convertedKey(run));
  if (!c) throw new NonRetryableError("output_missing");
  return c.arrayBuffer();
}

const getJson = async <T>(env: Env, key: string): Promise<T> => {
  const o = await env.DOCS.get(key);
  if (!o) throw new NonRetryableError("output_missing");
  return o.json<T>();
};
const putJson = (env: Env, key: string, v: unknown) => env.DOCS.put(key, JSON.stringify(v), { httpMetadata: { contentType: "application/json" } });

// A page reader refusal of the file itself (not a PDF, encrypted, too many pages) will not change on a retry.
const FINAL = new Set(["not_pdf", "encrypted", "too_many_pages", "unreadable_pdf", "too_large", "bad_range", "not_image", "image_too_large"]);
async function kit<T>(f: () => Promise<T>): Promise<T> {
  try {
    return await f();
  } catch (e) {
    if (e instanceof PageReaderError && (FINAL.has(e.code) || e.code === "pipeline_off")) throw new NonRetryableError(e.code);
    throw e instanceof PageReaderError ? new Error(e.code) : e;
  }
}

const stage = (env: Env, org: string, runId: string, s: string, detail: string) =>
  env.DB.batch([
    orgStmt(env.DB, org, "UPDATE pipeline_runs SET state = 'running', stage = ?1, updated_at = ?2 WHERE org_id = ?org AND id = ?3", s, iso(), runId),
    // A document with prepared data keeps its state; the run is shown next to it.
    orgStmt(env.DB, org, "UPDATE documents SET state = 'processing', state_detail_cs = ?1 WHERE org_id = ?org AND id = (SELECT document_id FROM pipeline_runs WHERE org_id = ?org AND id = ?2) AND origin = 'upload' AND state <> 'prepared'", detail, runId),
  ]);

const b64 = (s: string) => Uint8Array.from(atob(s), (ch) => ch.charCodeAt(0));

export class ProcessDocumentWorkflow extends WorkflowEntrypoint<Env, ProcessDocumentParams> {
  async run(event: WorkflowEvent<ProcessDocumentParams>, step: WorkflowStep) {
    const p: ProcessDocumentParams = { ...event.payload, org: event.payload.org ?? LEGACY_ORG };
    // Built from the step results, so a replayed instance (cached results, no callbacks run) records the same stages.
    const stages: Record<string, unknown>[] = [];
    const timed = async <T extends Record<string, unknown>>(name: string, f: () => Promise<T>) => {
      const t0 = Date.now();
      const r = await f();
      return { ...r, stage: name, ms: Date.now() - t0 };
    };
    const keep = <T extends Record<string, unknown>>(r: T) => (stages.push(r), r);
    try {
      // A photo of a page becomes a one-page PDF first (the page reader straightens it by its EXIF orientation and drops
      // its metadata, location included); every later step reads that PDF. The upload itself stays unchanged.
      keep(await step.do("convert", OCR, () =>
        timed("convert", async () => {
          const run = await runOf(this.env, p.org, p.runId);
          const o = await originalOf(this.env, p.org, run);
          if (!isImage(o.mediaType)) return { converted: false };
          await stage(this.env, p.org, p.runId, "inspect", "zpracovává se (fáze: převod fotografie na PDF)");
          const r = await kit(() => pageReader.convert(this.env, poolInstance(p.caseId), o.bytes, o.mediaType));
          await this.env.DOCS.put(convertedKey(run), b64(r.pdf_b64), { httpMetadata: { contentType: "application/pdf" } });
          return { converted: true };
        }),
      ));
      const inspect = keep(await step.do("inspect", OCR, () =>
        timed("inspect", async () => {
          await stage(this.env, p.org, p.runId, "inspect", "zpracovává se (fáze: kontrola souboru)");
          const run = await runOf(this.env, p.org, p.runId);
          const bytes = await pdfOf(this.env, p.org, run);
          const [h, i] = await Promise.all([kit(() => pageReader.healthz(this.env, poolInstance(p.caseId))), kit(() => pageReader.inspect(this.env, poolInstance(p.caseId), bytes))]);
          await orgStmt(this.env.DB, p.org, "UPDATE pipeline_runs SET container_versions_json = ?1, page_count = ?2, updated_at = ?3 WHERE org_id = ?org AND id = ?4", JSON.stringify(h.versions), i.page_count, iso(), p.runId)
            .run();
          return { pages: i.page_count, text_layer_pages: i.has_text_layer.filter(Boolean).length };
        }),
      ));
      const n = inspect.pages;
      for (let from = 1; from <= n; from += PIPELINE_BATCH) {
        const to = Math.min(n, from + PIPELINE_BATCH - 1);
        keep(await step.do(`pages ${from}-${to}`, OCR, () =>
          timed(`pages ${from}-${to}`, async () => {
            await stage(this.env, p.org, p.runId, "pages", `zpracovává se (fáze: čtení stránek ${from}-${to} z ${n})`);
            const run = await runOf(this.env, p.org, p.runId);
            const r = await kit(() => pdfOf(this.env, p.org, run).then((b) => pageReader.pages(this.env, poolInstance(p.caseId), b, from, to)));
            for (const pg of r.pages) {
              const { png_b64, ...raw } = pg;
              await this.env.DOCS.put(`${run.output_prefix}p${pg.n}.png`, b64(png_b64), { httpMetadata: { contentType: "image/png" } });
              await putJson(this.env, `${run.output_prefix}p${pg.n}.raw.json`, raw);
            }
            return { pages: r.pages.length };
          }),
        ));
      }
      const analyzed = keep(await step.do("analyze", STEP, () =>
        timed("analyze", async () => {
          await stage(this.env, p.org, p.runId, "analyze", "zpracovává se (fáze: kontrola čitelnosti)");
          const run = await runOf(this.env, p.org, p.runId);
          const raws: Omit<RawPage, "png_b64">[] = [];
          for (let k = 1; k <= n; k++) raws.push(await getJson(this.env, `${run.output_prefix}p${k}.raw.json`));
          const a = await kit(() => pageReader.analyze(this.env, poolInstance(p.caseId), raws));
          for (const x of a.pages) {
            // The page record in the format the source view loads (step 2), with its readability.
            const rec: PageRecord & { redacted: null; readability: Readability } = { ...x.page, redacted: null, readability: x.readability };
            await putJson(this.env, `${run.output_prefix}p${x.n}.json`, rec);
          }
          await putJson(this.env, `${run.output_prefix}readability.json`, { document: a.document, pages: a.pages.map((x) => ({ n: x.n, ...x.readability })) });
          const verify = a.pages.reduce((s, x) => s + x.page.verify.length, 0);
          await orgStmt(this.env.DB, p.org, "UPDATE pipeline_runs SET readability = ?1, readability_reasons_json = ?2, verify_count = ?3, updated_at = ?4 WHERE org_id = ?org AND id = ?5", a.document.level, JSON.stringify(a.document.reasons_cs), verify, iso(), p.runId)
            .run();
          return { level: a.document.level, verify };
        }),
      ));
      const labs = keep(await step.do("labs", STEP, () =>
        timed("labs", async () => {
          await stage(this.env, p.org, p.runId, "labs", "zpracovává se (fáze: laboratorní hodnoty)");
          const run = await runOf(this.env, p.org, p.runId);
          const pages: Parameters<typeof pageReader.labs>[3] = [];
          for (let k = 1; k <= n; k++) {
            const rec = await getJson<PageRecord & { readability: Readability }>(this.env, `${run.output_prefix}p${k}.json`);
            const raw = await getJson<Omit<RawPage, "png_b64">>(this.env, `${run.output_prefix}p${k}.raw.json`);
            pages.push({ n: k, text: rec.text, layer_text: raw.layer_text, readability_level: rec.readability.level, words: rec.words, engine: rec.engine, doc_id: p.docId });
          }
          const l = await kit(() => pageReader.labs(this.env, poolInstance(p.caseId), p.docId, pages));
          // Sources name the uploaded file, so the source view opens the page the value was read from.
          const withFile = JSON.parse(JSON.stringify(l).replaceAll(`"doc_id":${JSON.stringify(p.docId)}`, `"doc_id":${JSON.stringify(p.docId)},"file":${JSON.stringify(`${p.docId}.pdf`)}`)) as Labs;
          await putJson(this.env, `${run.output_prefix}labs.json`, withFile);
          const points = l.tests.reduce((s, t) => s + t.points.length, 0);
          const unclear = l.tests.reduce((s, t) => s + t.points.filter((x) => x.certainty !== "documented").length, 0);
          await orgStmt(this.env.DB, p.org, "UPDATE pipeline_runs SET lab_points = ?1, lab_unclear = ?2, updated_at = ?3 WHERE org_id = ?org AND id = ?4", points, unclear, iso(), p.runId).run();
          return { tests: l.tests.length, points, unclear, unparsed: l.unparsed.length };
        }),
      ));
      const diff = keep(await step.do("compare with prepared data", STEP, () =>
        timed("compare", async () => {
          const run = await runOf(this.env, p.org, p.runId);
          const prepared = await preparedPoints(this.env, p.org, p.caseId, p.docId);
          if (!prepared) return { compared: 0, same: 0, verify: 0, silent: 0, missing: 0, extra: 0 };
          const l = await getJson<Labs>(this.env, `${run.output_prefix}labs.json`);
          const d = diffLabs(prepared, l);
          await putJson(this.env, `${run.output_prefix}diff.json`, d);
          await orgStmt(this.env.DB, p.org, "UPDATE pipeline_runs SET diff_same = ?1, diff_verify = ?2, diff_silent = ?3, diff_missing = ?4, updated_at = ?5 WHERE org_id = ?org AND id = ?6", d.counts.same, d.counts.verify, d.counts.silent, d.counts.missing, iso(), p.runId)
            .run();
          return { compared: prepared.length, ...d.counts };
        }),
      ));
      await step.do("write", STEP, async () => {
        await this.finish(p, n, analyzed.level, labs.points, labs.unclear, diff.compared ? diff : null, stages);
        return { ok: true };
      });
    } catch (e) {
      // The engine rethrows a failed step as "NonRetryableError: <code>"; only the fixed code is kept, never other text.
      const m = e instanceof Error ? /(?:^|: )([a-z_]{1,40})$/.exec(e.message) : null;
      const code = m?.[1] ?? "internal";
      await step.do("fail", STEP, async () => {
        await this.fail(p, code);
        return { code };
      });
    }
  }

  private async finish(p: ProcessDocumentParams, n: number, level: string, points: number, unclear: number, diff: { same: number; verify: number; silent: number; missing: number } | null, stages: unknown[]) {
    const env = this.env;
    const db = env.DB;
    const run = await runOf(env, p.org, p.runId);
    if (run.state === "done") return;
    const who = await actorFor(db, p.org, run.created_by, env.AUTH_MODE === "oidc" ? "oidc" : "demo", run.created_by_actor);
    const doc = await orgStmt(db, p.org, "SELECT state, origin, (SELECT COUNT(*) FROM pages WHERE org_id = ?org AND document_id = ?1) AS pages FROM documents WHERE org_id = ?org AND id = ?1", p.docId).first<{ state: string | null; origin: string; pages: number }>();
    const stmts: D1PreparedStatement[] = [
      orgStmt(db, p.org, "UPDATE pipeline_runs SET state = 'done', stage = NULL, stages_json = ?1, finished_at = ?2, updated_at = ?2 WHERE org_id = ?org AND id = ?3", JSON.stringify(stages), iso(), p.runId),
    ];
    // Seeded documents are restored by no reset (their rows are not demo state), so a run never changes them.
    if (doc && doc.origin === "upload" && doc.state !== "prepared") {
      const rb = await getJson<{ document: { level: string; reasons_cs: string[] } }>(env, `${run.output_prefix}readability.json`);
      stmts.push(
        orgStmt(db, p.org, "UPDATE documents SET state = 'processed', state_detail_cs = NULL, processing = 'processed', page_count = ?1, readability = ?2, readability_reasons_json = ?3 WHERE org_id = ?org AND id = ?4", n, rb.document.level, JSON.stringify(rb.document.reasons_cs), p.docId),
      );
      // A document without prepared data gets the run's pages for the source view (Tesseract's text with its marks).
      if (!doc.pages) {
        const rows = [];
        for (let k = 1; k <= n; k++) {
          const rec = await getJson<PageRecord & { readability: Readability }>(env, `${run.output_prefix}p${k}.json`);
          rows.push({ n: k, j: `${run.output_prefix}p${k}.json`, i: `${run.output_prefix}p${k}.png`, w: rec.size[0], h: rec.size[1], mc: rec.mean_conf, lc: rec.low_conf_words, em: rec.readability.level === "empty" ? 1 : 0, vc: rec.verify.length });
        }
        stmts.push(
          orgStmt(db, p.org, `INSERT INTO pages (org_id, document_id, n, json_r2_key, image_r2_key, redacted_r2_key, width, height, engine, mean_conf, low_conf_words, is_empty, verify_count)
               SELECT ?org, ?1, json_extract(value, '$.n'), json_extract(value, '$.j'), json_extract(value, '$.i'), NULL, json_extract(value, '$.w'), json_extract(value, '$.h'),
                 'tesseract', json_extract(value, '$.mc'), json_extract(value, '$.lc'), json_extract(value, '$.em'), json_extract(value, '$.vc') FROM json_each(?2)`, p.docId, JSON.stringify(rows)),
        );
      }
    }
    const lv = READABILITY_CS[level] ?? level;
    const cmp = diff ? `; s předem připravenými daty: ${diff.same} shodných, ${diff.verify} k ověření, ${diff.silent} jinak bez označení` : "";
    stmts.push(
      auditStatement(db, who, { action: "pipeline.done", what_cs: `dokument zpracován bez AI (čitelnost: ${lv}; laboratorní hodnoty: ${points}, k ověření ${unclear}${cmp})`, case_id: p.caseId, target_type: "document", target_id: p.docId }, { requestId: null, epoch: null }),
    );
    await db.batch(stmts);
  }

  private async fail(p: ProcessDocumentParams, code: string) {
    const env = this.env;
    const db = env.DB;
    const run = await orgStmt(db, p.org, "SELECT created_by, created_by_actor FROM pipeline_runs WHERE org_id = ?org AND id = ?1", p.runId).first<{ created_by: string; created_by_actor: string | null }>();
    const who = await actorFor(db, p.org, run?.created_by ?? "system", env.AUTH_MODE === "oidc" ? "oidc" : "demo", run?.created_by_actor ?? null);
    await db.batch([
      orgStmt(db, p.org, "UPDATE pipeline_runs SET state = 'error', error_code = ?1, finished_at = ?2, updated_at = ?2 WHERE org_id = ?org AND id = ?3", code, iso(), p.runId),
      orgStmt(db, p.org, "UPDATE documents SET state = 'failed', state_detail_cs = ?1 WHERE org_id = ?org AND id = ?2 AND origin = 'upload' AND state <> 'prepared'", pipelineErrorCs(code), p.docId),
      auditStatement(db, who, { action: "pipeline.failed", what_cs: `zpracování dokumentu selhalo (${code})`, case_id: p.caseId, target_type: "document", target_id: p.docId }, { requestId: null, epoch: null }),
    ]);
  }
}

// The prepared run's lab values of this document, when the case has a codebridge.extraction/2 run (an intake attach
// or the seed): its lab_result facts quoted from this document. A quarantined fact is not compared (it rests on a page
// that shows another patient).
async function preparedPoints(env: Env, org: string, caseId: string, docId: string): Promise<PreparedPoint[] | null> {
  const run = await orgStmt(env.DB, org, "SELECT r2_key, schema FROM extraction_runs WHERE org_id = ?org AND case_id = ?1 AND is_current = 1", caseId).first<{ r2_key: string; schema: string }>();
  if (!run || run.schema !== EXTRACTION_SCHEMA) return null;
  const o = await env.DOCS.get(run.r2_key);
  if (!o) return null;
  const ex = await o.json<ExtractionRun>();
  const fromDoc = new Set(ex.sources.filter((s) => s.type === "document" && s.document_id === docId).map((s) => s.id));
  const pts = ex.facts
    .filter((f): f is LabResultFact => f.kind === "lab_result" && !f.quarantined && f.sources.some((s) => fromDoc.has(s)))
    .map((f) => ({
      code: f.codes[0]?.code ?? f.value.name_as_written,
      value: f.value.value_as_written,
      unit: f.value.unit ?? f.value.unit_as_written ?? "",
      reference_range: f.value.reference_range ?? "",
      // The draw as the comparison reads it: the ISO day and the time, when the sheet gives them.
      date: f.date.sort ? f.date.sort.slice(0, 10) : null,
      time: f.date.sort && f.date.sort.length > 10 ? f.date.sort.slice(11, 16) : null,
    }));
  return pts.length ? pts : null;
}
