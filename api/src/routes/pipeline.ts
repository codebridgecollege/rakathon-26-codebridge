// The document pipeline without an LLM (step 6, slice b-1): start a run on a stored document, read its result, and warm
// the page reader service before a demo. The run itself is ProcessDocumentWorkflow (workflows/process-document.ts).
import { Hono } from "hono";
import type { AppEnv } from "../types";
import { ApiError, E } from "../http/errors";
import { assertCan } from "@codebridge/domain/roles";
import { POOR_COPY_CS, READABILITY_CS } from "../domain/pipeline";
import { audit } from "../middleware/audit";
import { documentRow, uploadContext } from "../store/documents";
import { assertUnlocked } from "./documents";
import { POOL_SIZE, PageReaderError, pageReader, pipelineAvailable, pipelineOn } from "../services/page-reader";
import { openCase } from "./access-check";
import { actorOf, answer, caseFor, label, orgQuery, tx } from "./write-context";
import { pipelineOff as off, startRun } from "./pipeline-start";
const STAGE_CS: Record<string, string> = { inspect: "kontrola souboru", pages: "čtení stránek", analyze: "kontrola čitelnosti", labs: "laboratorní hodnoty", write: "zápis výsledku" };

type RunRow = {
  id: string; document_id: string; case_id: string; state: string; stage: string | null; error_code: string | null; pipeline_version: string;
  container_versions_json: string | null; stages_json: string | null; output_prefix: string; page_count: number | null; readability: string | null;
  readability_reasons_json: string | null; verify_count: number | null; lab_points: number | null; lab_unclear: number | null; diff_same: number | null;
  diff_verify: number | null; diff_silent: number | null; diff_missing: number | null; created_by_name: string; created_at: string; finished_at: string | null;
};

export const pipeline = new Hono<AppEnv>()
  .post("/documents/:id/process", async (c) => {
    const docId = c.req.param("id");
    const d = await documentRow(c.env.DB, c.var.viewer.org, docId);
    label(c, "zpracování dokumentu", d?.case_id ?? null);
    if (!d) throw E.pageNotFound();
    const { breakGlass } = await caseFor(c, d.case_id, "document.process");
    // A closed case or an approved conclusion: the record must not change under it, as for uploads.
    const u = await uploadContext(c.env.DB, c.var.viewer.org, d.case_id);
    if (!u) throw E.caseNotFound();
    assertUnlocked(u);
    if (!pipelineOn(c.env, c.var.viewer.org)) throw off();
    if (!d.original_r2_key || !d.sha256) throw new ApiError(409, "no_file", "Dokument nemá uložený soubor ke zpracování.");
    const runId = await startRun(c, { id: docId, case_id: d.case_id, sha256: d.sha256 }, breakGlass, false);
    return answer(c, { run_id: runId, state: "queued" }, {}, 201);
  })
  .get("/documents/:id/pipeline", async (c) => {
    const docId = c.req.param("id");
    const d = await documentRow(c.env.DB, c.var.viewer.org, docId);
    if (!d) throw E.pageNotFound();
    await openCase(c, d.case_id, "clinical");
    await audit(c, { action: "pipeline.view", case_id: d.case_id, document_id: docId, what_cs: "zobrazil(a) výsledek zpracování dokumentu bez AI" });
    const r = await orgQuery(c, "SELECT * FROM pipeline_runs WHERE org_id = ?org AND document_id = ?1 ORDER BY created_at DESC, id DESC LIMIT 1", docId).first<RunRow>();
    if (!r) return c.json({ document_id: docId, run: null, enabled: pipelineOn(c.env, c.var.viewer.org) });
    const out = r.state === "done";
    const get = async (name: string) => (out ? ((await (await c.env.DOCS.get(`${r.output_prefix}${name}`))?.json<Record<string, unknown>>()) ?? null) : null);
    const reasons = r.readability_reasons_json ? (JSON.parse(r.readability_reasons_json) as string[]) : [];
    return c.json({
      document_id: docId,
      enabled: pipelineOn(c.env, c.var.viewer.org),
      run: {
        id: r.id, state: r.state, stage: r.stage, stage_cs: r.stage ? STAGE_CS[r.stage] ?? null : null, error_code: r.error_code, by: r.created_by_name, started_at: r.created_at, finished_at: r.finished_at,
        // Always labelled: this is the assistant's reading of the page by Tesseract, compared with the PDF text layer.
        label_cs: "Zpracováno pipeline bez AI (Tesseract a textová vrstva PDF); pozorování asistenta, ne dokumentace",
        pipeline_version: r.pipeline_version, container_versions: r.container_versions_json ? JSON.parse(r.container_versions_json) : null,
        stages: r.stages_json ? JSON.parse(r.stages_json) : [],
        page_count: r.page_count, readability: r.readability, readability_cs: r.readability ? READABILITY_CS[r.readability] ?? r.readability : null,
        readability_reasons_cs: reasons, readability_alert_cs: r.readability === "poor" || r.readability === "empty" ? POOR_COPY_CS : null,
        verify_count: r.verify_count, lab_points: r.lab_points, lab_unclear: r.lab_unclear,
        diff: r.diff_same === null ? null : { same: r.diff_same, verify: r.diff_verify, silent: r.diff_silent, missing: r.diff_missing },
      },
      labs: await get("labs.json"),
      diff_points: ((await get("diff.json")) as { points?: unknown } | null)?.points ?? null,
    });
  })
  // Before a demo: the first call after a deploy waits for the container image (minutes); this brings up every
  // instance of the pool, since any case may land on any of them.
  .post("/admin/pipeline/warm", async (c) => {
    label(c, "zahřátí zpracování dokumentů");
    assertCan(actorOf(c), "demo.reset");
    if (!pipelineAvailable(c.env)) throw off();
    try {
      const all = await Promise.all(Array.from({ length: POOL_SIZE }, (_, i) => pageReader.healthz(c.env, `pool-${i}`)));
      const h = { ok: all.every((x) => x.ok), versions: all[0]!.versions };
      await tx(c).audit({ action: "pipeline.warm", what_cs: "ověřil(a) službu pro čtení stránek" }).commit();
      return answer(c, { ok: h.ok, versions: h.versions });
    } catch (e) {
      if (e instanceof PageReaderError) throw new ApiError(503, e.code, "Služba pro čtení stránek neodpovídá.");
      throw e;
    }
  });
