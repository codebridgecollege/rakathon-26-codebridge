// The document pipeline without an LLM (step 6, slice b-1): start a run on a stored document, read its result, and warm
// the PageKit service before a demo. The run itself is ProcessDocumentWorkflow (workflows/process-document.ts).
import { Hono } from "hono";
import type { AppEnv } from "../types";
import { ApiError, E } from "../http/errors";
import { assertCan } from "../domain/roles";
import { POOR_COPY_CS, READABILITY_CS } from "../domain/pipeline";
import { audit } from "../middleware/audit";
import { UNLOCKED_COND, documentRow, uploadContext } from "../store/documents";
import { assertUnlocked } from "./documents";
import { UP } from "../domain/documents";
import { PageKitError, pagekit, pipelineOn } from "../services/pagekit";
import { openCase } from "./access-check";
import { actorOf, answer, caseFor, isoNow, label, newId, tx } from "./write-context";
import type { ProcessDocumentParams } from "../workflows/process-document";

const off = () => new ApiError(503, "pipeline_off", "Zpracování dokumentů není na tomto serveru zapnuté (služba pro čtení stránek chybí).");
const running = () => new ApiError(409, "pipeline_running", "Dokument se právě zpracovává.");
// Instance state holds ids and counts only; kept as briefly as the engine allows.
const RETENTION = { successRetention: "1 day", errorRetention: "3 days" } as const;
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
    const d = await documentRow(c.env.DB, docId);
    label(c, "zpracování dokumentu", d?.case_id ?? null);
    if (!d) throw E.pageNotFound();
    const { breakGlass } = await caseFor(c, d.case_id, "document.process");
    // A closed case or an approved conclusion: the record must not change under it, as for uploads.
    const u = await uploadContext(c.env.DB, d.case_id);
    if (!u) throw E.caseNotFound();
    assertUnlocked(u);
    if (!pipelineOn(c.env)) throw off();
    if (!d.original_r2_key || !d.sha256) throw new ApiError(409, "no_file", "Dokument nemá uložený soubor ke zpracování.");
    const runId = `pl-${newId()}`;
    const at = isoNow();
    const v = c.var.viewer;
    const t = tx(c, breakGlass).onConstraint(/pipeline_runs_active|UNIQUE constraint failed: pipeline_runs\.document_id/, running);
    t.guard("unlocked", UNLOCKED_COND, [d.case_id, d.case_id], () => UP.locked());
    t.run(
      `INSERT INTO pipeline_runs (id, document_id, case_id, state, pipeline_version, input_sha256, output_prefix, created_by, created_by_name, created_at, updated_at)
       VALUES (?1, ?2, ?3, 'queued', ?4, ?5, ?6, ?7, ?8, ?9, ?9)`,
      runId, docId, d.case_id, c.env.GIT_SHA || "dev", d.sha256, `uploads/${d.case_id}/${docId}/${runId}/`, v.id, v.name, at,
    );
    // Only an upload without prepared data shows the run's state; seeded documents and prepared ones keep theirs.
    t.run("UPDATE documents SET state = 'queued', state_detail_cs = NULL WHERE id = ?1 AND origin = 'upload' AND state <> 'prepared'", docId);
    t.audit({ action: "pipeline.start", what_cs: "spustil(a) zpracování dokumentu bez AI (čtení stránek, čitelnost, laboratorní hodnoty)", case_id: d.case_id, target_type: "document", target_id: docId });
    await t.commit();
    const params: ProcessDocumentParams = { runId, docId, caseId: d.case_id };
    try {
      await c.env.PROCESS_DOCUMENT.create({ id: runId, params, retention: RETENTION });
    } catch {
      await c.env.DB.batch([
        c.env.DB.prepare("UPDATE pipeline_runs SET state = 'error', error_code = 'start_failed', updated_at = ?1 WHERE id = ?2").bind(isoNow(), runId),
        c.env.DB.prepare("UPDATE documents SET state = 'failed', state_detail_cs = 'zpracování se nespustilo' WHERE id = ?1 AND origin = 'upload' AND state <> 'prepared'").bind(docId),
      ]);
      throw new ApiError(503, "start_failed", "Zpracování se nespustilo; zkuste to znovu.");
    }
    return answer(c, { run_id: runId, state: "queued" }, {}, 201);
  })
  .get("/documents/:id/pipeline", async (c) => {
    const docId = c.req.param("id");
    const d = await documentRow(c.env.DB, docId);
    if (!d) throw E.pageNotFound();
    await openCase(c, d.case_id, "clinical");
    await audit(c, { action: "pipeline.view", case_id: d.case_id, document_id: docId, what_cs: "zobrazil(a) výsledek zpracování dokumentu bez AI" });
    const r = await c.env.DB.prepare("SELECT * FROM pipeline_runs WHERE document_id = ?1 ORDER BY created_at DESC, id DESC LIMIT 1").bind(docId).first<RunRow>();
    if (!r) return c.json({ document_id: docId, run: null, enabled: pipelineOn(c.env) });
    const out = r.state === "done";
    const get = async (name: string) => (out ? ((await (await c.env.DOCS.get(`${r.output_prefix}${name}`))?.json<Record<string, unknown>>()) ?? null) : null);
    const reasons = r.readability_reasons_json ? (JSON.parse(r.readability_reasons_json) as string[]) : [];
    return c.json({
      document_id: docId,
      enabled: pipelineOn(c.env),
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
  // Before a demo: the first call after a deploy waits for the container image (minutes); this brings it up.
  .post("/admin/pipeline/warm", async (c) => {
    label(c, "zahřátí zpracování dokumentů");
    assertCan(actorOf(c), "demo.reset");
    if (!pipelineOn(c.env)) throw off();
    try {
      const h = await pagekit.healthz(c.env, "warm");
      await tx(c).audit({ action: "pipeline.warm", what_cs: "ověřil(a) službu pro čtení stránek" }).commit();
      return answer(c, { ok: h.ok, versions: h.versions });
    } catch (e) {
      if (e instanceof PageKitError) throw new ApiError(503, e.code, "Služba pro čtení stránek neodpovídá.");
      throw e;
    }
  });
