// Starting a run of the document pipeline without an LLM (ProcessDocumentWorkflow), shared by "Přečíst bez AI"
// (POST /documents/:id/process), by an upload and by the end of an intake. Its own module because the upload route and
// the pipeline routes import each other's helpers otherwise.
import type { Context } from "hono";
import type { AppEnv } from "../types";
import { ApiError } from "../http/errors";
import { DomainError } from "@codebridge/domain/errors";
import { UNLOCKED_COND } from "../store/documents";
import { UP } from "../domain/documents";
import { pipelineOn } from "../services/page-reader";
import { actorOf, isoNow, newId, orgQuery, tx } from "./write-context";
import { allowed } from "@codebridge/domain/roles";
import { orgKey } from "../store/sql";
import type { ProcessDocumentParams } from "../workflows/process-document";

export const pipelineOff = () => new ApiError(503, "pipeline_off", "Zpracování dokumentů není na tomto serveru zapnuté (služba pro čtení stránek chybí).");
export const pipelineRunning = () => new ApiError(409, "pipeline_running", "Dokument se právě zpracovává.");
// Instance state holds ids and counts only; kept as briefly as the engine allows.
const RETENTION = { successRetention: "1 day", errorRetention: "3 days" } as const;

const MANUAL_CS = "spustil(a) zpracování dokumentu bez AI (čtení stránek, čitelnost, laboratorní hodnoty)";
const AUTO_CS = "zpracování dokumentu bez AI spuštěno po nahrání (čtení stránek, čitelnost, laboratorní hodnoty)";

// One run on a stored document, in the acting user's name: the row, the document's "zpracovává se" and the access-log
// line in one batch, then the Workflow. Throws the route's refusals (locked case, a run already active, no start).
export async function startRun(
  c: Context<AppEnv>,
  d: { id: string; case_id: string; sha256: string },
  breakGlass: string | null,
  auto: boolean,
): Promise<string> {
  const runId = `pl-${newId()}`;
  const at = isoNow();
  const v = c.var.viewer;
  const t = tx(c, breakGlass).onConstraint(/pipeline_runs_active|UNIQUE constraint failed: pipeline_runs\.document_id/, pipelineRunning);
  t.guard("unlocked", UNLOCKED_COND, [d.case_id, d.case_id], () => UP.locked());
  // The document may have left the case (withdrawn, its file deleted) between the caller's read and this batch.
  t.guard("current", "(SELECT lifecycle = 'current' AND original_r2_key IS NOT NULL FROM documents WHERE org_id = ?org AND id = ?) = 1", [d.id], () =>
    new ApiError(409, "no_file", "Dokument nemá uložený soubor ke zpracování."));
  t.run(
    `INSERT INTO pipeline_runs (org_id, id, document_id, case_id, state, pipeline_version, input_sha256, output_prefix, created_by, created_by_name, created_by_actor, created_at, updated_at)
     VALUES (?org, ?1, ?2, ?3, 'queued', ?4, ?5, ?6, ?7, ?8, ?10, ?9, ?9)`,
    runId, d.id, d.case_id, c.env.GIT_SHA || "dev", d.sha256, orgKey(v.org, `uploads/${d.case_id}/${d.id}/${runId}/`), v.id, v.name, at, v.actor?.id ?? null,
  );
  // Only an upload without prepared data shows the run's state; seeded documents and prepared ones keep theirs.
  t.run("UPDATE documents SET state = 'queued', state_detail_cs = NULL WHERE org_id = ?org AND id = ?1 AND origin = 'upload' AND state <> 'prepared'", d.id);
  t.audit({ action: "pipeline.start", what_cs: auto ? AUTO_CS : MANUAL_CS, case_id: d.case_id, target_type: "document", target_id: d.id });
  await t.commit();
  const params: ProcessDocumentParams = { org: v.org, runId, docId: d.id, caseId: d.case_id };
  try {
    await c.env.PROCESS_DOCUMENT.create({ id: runId, params, retention: RETENTION });
  } catch {
    await c.env.DB.batch([
      orgQuery(c, "UPDATE pipeline_runs SET state = 'error', error_code = 'start_failed', updated_at = ?1 WHERE org_id = ?org AND id = ?2", isoNow(), runId),
      orgQuery(c, "UPDATE documents SET state = 'failed', state_detail_cs = 'zpracování se nespustilo' WHERE org_id = ?org AND id = ?1 AND origin = 'upload' AND state <> 'prepared'", d.id),
    ]);
    throw new ApiError(503, "start_failed", "Zpracování se nespustilo; zkuste to znovu.");
  }
  return runId;
}

// After an upload or an intake: start runs on the given stored documents when the pipeline is on for the org. Never
// refuses or fails the request that called it (the upload is done; "Přečíst bez AI" stays as the way to try again), and
// logs only a fixed code. An open intake waits: its documents start when the intake ends, after the prepared-data
// attach has decided which of them need reading at all.
export async function autoStart(c: Context<AppEnv>, docIds: string[], breakGlass: string | null): Promise<void> {
  if (!docIds.length || !pipelineOn(c.env, c.var.viewer.org)) return;
  // The caller checked the case membership for document.upload (caseFor). document.process is case-scoped with the same
  // roles (test/pipeline.test.ts checks that they stay equal), so only the role is checked here.
  if (!allowed(actorOf(c), "document.process", { member: true, grant: !!breakGlass })) return;
  // In parallel: an intake ends with up to seven files (40 at most), and each start is a D1 batch plus a Workflow
  // create; one after another they would hold the request for seconds.
  await Promise.all(
    docIds.map(async (id) => {
      try {
        const d = await orgQuery(
          c,
          `SELECT d.id, d.case_id, d.sha256 FROM documents d JOIN cases k ON k.org_id = d.org_id AND k.id = d.case_id
           WHERE d.org_id = ?org AND d.id = ?1 AND d.origin = 'upload' AND d.state = 'stored' AND d.original_r2_key IS NOT NULL
             AND d.sha256 IS NOT NULL AND k.intake_open = 0`,
          id,
        ).first<{ id: string; case_id: string; sha256: string }>();
        if (d) await startRun(c, d, breakGlass, true);
      } catch (e) {
        // Everything here is after the caller's commit, so nothing may fail the request. ApiError and DomainError carry
        // a fixed code; anything else is reduced to "internal", never its message.
        const code = e instanceof ApiError || e instanceof DomainError ? e.code : "internal";
        console.error(JSON.stringify({ route: "pipeline.auto_start", code }));
      }
    }),
  );
}
