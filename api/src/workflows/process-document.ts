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
import { PageReaderError, pageReader, pipelineListed, poolInstance, type Labs, type PageRecord, type RawPage, type Readability } from "../services/page-reader";
import { actorFor } from "../store/audio";
import { orgStmt } from "../store/sql";
import { LEGACY_ORG } from "../domain/orgs";
import { auditStatement } from "../store/write";
import { documentAlerts, partRows, type PagePart } from "../domain/document-checks";
import type { Identity } from "../domain/documents";
import { diffLabs, pipelineErrorCs, PIPELINE_BATCH, READABILITY_CS, type PreparedPoint } from "../domain/pipeline";
import { pipelineFragment, type ParsedLabs } from "@codebridge/domain/fragments";
import { startCaseMerge } from "./process-case";
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
// An output a step may not have written (an older page reader without that endpoint, or a step that did not apply).
const optionalJson = async <T>(env: Env, key: string): Promise<T | null> => ((await env.DOCS.get(key))?.json<T>() ?? null);
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

// The page reader's add-on checks (/v1/parts, /v1/identity): pages, readability and labs stand without them, so a
// failure of these never fails the run. An image from before them answers 404 ("missing"); any other failure is
// recorded as "error" in the step result and the run goes on without that result.
async function optional<T>(f: () => Promise<T>): Promise<{ ok: T } | { skipped: "missing" | "error" }> {
  try {
    return { ok: await kit(f) };
  } catch (e) {
    return { skipped: e instanceof Error && /(^|: )(not_found|http_404)$/.test(e.message) ? "missing" : "error" };
  }
}
const IDENTITIES = new Set(["matches", "conflicts", "cannot_verify"]);

// Each page's text of record and readability level, from the run's page records.
async function pageTexts(env: Env, run: RunRow, n: number) {
  const out: { n: number; text: string; level: string }[] = [];
  for (let k = 1; k <= n; k++) {
    const rec = await getJson<PageRecord & { readability: Readability }>(env, `${run.output_prefix}p${k}.json`);
    out.push({ n: k, text: rec.text, level: rec.readability.level });
  }
  return out;
}

// Whether the pipeline's split may describe this document: an upload without prepared data, whose parts (if any)
// came from an earlier run. The seed's and the intake's prepared parts are never replaced.
async function ownParts(env: Env, org: string, docId: string) {
  const r = await orgStmt(env.DB, org,
    `SELECT d.origin, d.state, (SELECT COUNT(*) FROM document_parts dp WHERE dp.org_id = ?org AND dp.document_id = ?1 AND dp.producer IS NULL) AS other
     FROM documents d WHERE d.org_id = ?org AND d.id = ?1`, docId).first<{ origin: string; state: string | null; other: number }>();
  return !!r && r.origin === "upload" && r.state !== "prepared" && r.other === 0;
}

// The pipeline's fragment of an upload that counts for the case: processed, current, without prepared data (a prepared
// document belongs to its fixture run). Null for any other document.
async function pipelineFragmentOf(env: Env, org: string, docId: string, run: RunRow) {
  const d = await orgStmt(env.DB, org, "SELECT origin, state, lifecycle, sha256, identity FROM documents WHERE org_id = ?org AND id = ?1", docId).first<{
    origin: string;
    state: string | null;
    lifecycle: string;
    sha256: string | null;
    identity: Identity | null;
  }>();
  if (!d || d.origin !== "upload" || d.state !== "processed" || d.lifecycle !== "current") return null;
  const parts = (await orgStmt(env.DB, org, "SELECT part_id, pages_json FROM document_parts WHERE org_id = ?org AND document_id = ?1 ORDER BY ordinal", docId).all<{ part_id: string; pages_json: string }>()).results;
  const versions = await orgStmt(env.DB, org, "SELECT container_versions_json FROM pipeline_runs WHERE org_id = ?org AND id = ?1", run.id).first<{ container_versions_json: string | null }>();
  const tess = versions?.container_versions_json ? (JSON.parse(versions.container_versions_json) as { tesseract?: string | null }).tesseract : null;
  const rb = await getJson<{ pages: { n: number; level: string }[] }>(env, `${run.output_prefix}readability.json`);
  const ident = await optionalJson<{ pages: { n: number; result: Identity }[] }>(env, `${run.output_prefix}identity.json`);
  const labs = await optionalJson<ParsedLabs>(env, `${run.output_prefix}labs.json`);
  return pipelineFragment({
    documentId: docId,
    sha256: d.sha256,
    pipelineRun: run.id,
    engine: tess ? `${tess} ces` : null,
    parts: parts.map((x) => ({ part_id: x.part_id, pages: JSON.parse(x.pages_json) as number[] })),
    pages: rb.pages.map((x) => ({ n: x.n, level: x.level })),
    identity: ident?.pages ?? [],
    documentIdentity: d.identity,
    labs,
  });
}

const b64 = (s: string) =>Uint8Array.from(atob(s), (ch) => ch.charCodeAt(0));

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
      // The clinical documents inside the file (title, type, date as printed), for an upload without prepared data;
      // the rows are written with the run's result in "write". An older page reader without /v1/parts skips it.
      keep(await step.do("parts", STEP, () =>
        timed("parts", async () => {
          const run = await runOf(this.env, p.org, p.runId);
          if (!(await ownParts(this.env, p.org, p.docId))) return { parts: "skipped" };
          const pages = await pageTexts(this.env, run, n);
          const r = await optional(() => pageReader.parts(this.env, poolInstance(p.caseId), pages.map((x) => ({ n: x.n, text: x.text, readability_level: x.level }))));
          if (!("ok" in r) || !Array.isArray(r.ok.parts)) return { parts: "skipped" in r ? r.skipped : "error" };
          await putJson(this.env, `${run.output_prefix}parts.json`, { parts: r.ok.parts });
          return { parts: r.ok.parts.length, verify: r.ok.parts.filter((x) => x.certainty === "verify").length };
        }),
      ));
      // Whose document it is, from the page text against the case's patient, for an upload the fixture registry did
      // not already decide. Only the result leaves this step; the name and birth number stay inside it.
      keep(await step.do("identity", STEP, () =>
        timed("identity", async () => {
          const run = await runOf(this.env, p.org, p.runId);
          const who = await orgStmt(this.env.DB, p.org,
            `SELECT d.origin, d.fixture_id, pt.full_name, pt.birth_number, pt.birth_as_written FROM documents d
             JOIN cases c ON c.org_id = d.org_id AND c.id = d.case_id JOIN patients pt ON pt.org_id = c.org_id AND pt.id = c.patient_id
             WHERE d.org_id = ?org AND d.id = ?1`, p.docId).first<{ origin: string; fixture_id: string | null; full_name: string; birth_number: string | null; birth_as_written: string | null }>();
          if (!who || who.origin !== "upload" || who.fixture_id) return { identity: "skipped" };
          const pages = await pageTexts(this.env, run, n);
          const r = await optional(() => pageReader.identity(this.env, poolInstance(p.caseId), pages.map((x) => ({ n: x.n, text: x.text })),
            { name: who.full_name, birth_number: who.birth_number, birth_date: who.birth_as_written }));
          if (!("ok" in r)) return { identity: r.skipped };
          // Only known codes go on; the evidence (offsets) is not kept here.
          const pagesOk = (Array.isArray(r.ok.pages) ? r.ok.pages : []).filter((x) => IDENTITIES.has(x.result)).map((x) => ({ n: Number(x.n), result: x.result }));
          if (!IDENTITIES.has(r.ok.result)) return { identity: "error" };
          await putJson(this.env, `${run.output_prefix}identity.json`, { result: r.ok.result, pages: pagesOk });
          return { identity: r.ok.result };
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
      // The document's share of the case run (packages/domain/src/fragments.ts): its lab values with their passages,
      // readability and identity per page, written next to the run's other outputs, so a withdraw deletes it too.
      // Only for orgs the case merge runs for (never demo org A). A failure here never marks the read document as
      // failed: the document is processed; it only stays out of the case run until a later run writes its fragment.
      const frag = pipelineListed(this.env, p.org)
        ? await step.do("fragment", STEP, async () => {
            try {
              const run = await runOf(this.env, p.org, p.runId);
              const f = await pipelineFragmentOf(this.env, p.org, p.docId, run);
              if (!f) return { fragment: false, facts: 0 };
              await putJson(this.env, `${run.output_prefix}fragment-pipeline.json`, f);
              return { fragment: true, facts: f.facts.length };
            } catch {
              return { fragment: false, facts: 0, error: "fragment_failed" };
            }
          })
        : { fragment: false, facts: 0 };
      // The case's run is composed again with this document (ProcessCaseWorkflow).
      if (frag.fragment)
        await step.do("start case merge", STEP, async () => {
          const run = await runOf(this.env, p.org, p.runId);
          return { started: await startCaseMerge(this.env, { org: p.org, caseId: p.caseId, by: run.created_by, byActor: run.created_by_actor }) };
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
      const pageLevels = (await getJson<{ pages: { n: number; level: string }[] }>(env, `${run.output_prefix}readability.json`)).pages;
      const before = await orgStmt(db, p.org, "SELECT identity FROM documents WHERE org_id = ?org AND id = ?1", p.docId).first<{ identity: string | null }>();
      const levelOf = (k: number) => pageLevels.find((x) => x.n === k)?.level;
      // The split replaces the previous run's split of this document (ownParts checked that no prepared part exists).
      const split = await optionalJson<{ parts: PagePart[] }>(env, `${run.output_prefix}parts.json`);
      if (split) {
        stmts.push(orgStmt(db, p.org, "DELETE FROM document_parts WHERE org_id = ?org AND document_id = ?1 AND producer = 'pipeline'", p.docId));
        const rows = partRows(split.parts, levelOf);
        if (rows.length)
          stmts.push(
            orgStmt(db, p.org, `INSERT INTO document_parts (org_id, document_id, ordinal, title_cs, type, date, date_note_cs, pages_json, readability, reason_cs, date_as_written, certainty, producer)
                 SELECT ?org, ?1, json_extract(value, '$.ordinal'), json_extract(value, '$.title_cs'), json_extract(value, '$.type'), json_extract(value, '$.date'), NULL,
                   json_extract(value, '$.pages_json'), json_extract(value, '$.readability'), json_extract(value, '$.reason_cs'), json_extract(value, '$.date_as_written'),
                   json_extract(value, '$.certainty'), 'pipeline' FROM json_each(?2)`, p.docId, JSON.stringify(rows)),
          );
      }
      // The identity the pages show, when the registry did not decide it; only the result is stored. One page of another
      // patient makes the document a conflict whatever the overall answer says (a mixed-up page inside a PDF).
      const ident = await optionalJson<{ result: Identity; pages: { n: number; result: Identity }[] }>(env, `${run.output_prefix}identity.json`);
      const flagged = ident?.pages.filter((x) => x.result === "conflicts").map((x) => x.n) ?? [];
      const found: Identity | null = ident ? (flagged.length ? "conflicts" : ident.result) : null;
      // A conflict a doctor has not resolved is never cleared by a later reading: the earlier one saw another patient.
      const keepsConflict = before?.identity === "conflicts" && found !== "conflicts";
      if (found && !keepsConflict) {
        stmts.push(orgStmt(db, p.org, "UPDATE documents SET identity = ?1 WHERE org_id = ?org AND id = ?2 AND fixture_id IS NULL", found, p.docId));
        if (found === "conflicts")
          stmts.push(auditStatement(db, who, { action: "document.identity_conflict", what_cs: "zpracovaný dokument podle textu stránek možná patří jinému pacientovi", case_id: p.caseId, target_type: "document", target_id: p.docId }, { requestId: null, epoch: null }));
      }
      // The document's alerts as this run found them: they replace the previous run's.
      const poor = pageLevels.filter((x) => x.level === "poor" || x.level === "empty").map((x) => x.n);
      // The pages that show another patient; a document-level conflict without a page named counts every page.
      const conflictPages = found === "conflicts" ? (flagged.length ? flagged : pageLevels.map((x) => x.n)) : [];
      const alerts = documentAlerts(p.docId, poor, conflictPages);
      // Replaced with this run's findings, except an identity alert this run could not confirm or clear (no identity
      // result, or a kept conflict): that one stays as it was.
      stmts.push(orgStmt(db, p.org, `DELETE FROM document_alerts WHERE org_id = ?org AND document_id = ?1 AND (rule <> 'identity_conflict' OR ?2 = 1)`,
        p.docId, found && !keepsConflict ? 1 : 0));
      if (alerts.length)
        stmts.push(
          orgStmt(db, p.org, `INSERT OR REPLACE INTO document_alerts (id, org_id, case_id, document_id, rule, subject, kind, message_id, args_json, run_id, created_at)
               SELECT json_extract(value, '$.id'), ?org, ?1, ?2, json_extract(value, '$.rule'), json_extract(value, '$.subject'), json_extract(value, '$.kind'),
                 json_extract(value, '$.message_id'), json_extract(value, '$.args'), ?3, ?4 FROM json_each(?5)`,
            p.caseId, p.docId, p.runId, iso(), JSON.stringify(alerts)),
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
