// The case merge (ProcessCase; docs/research/2026-10-20-case-merge-contract.md): the latest fragment of every producer
// for every current document of a case becomes one stored codebridge.extraction/2 run with producer "pipeline", so a
// new patient's case view shows its documents, lab values and alerts without any AI. Called by ProcessCaseWorkflow,
// which every finished document run (and a withdraw) starts; it always composes what exists, so it is idempotent, and
// a run stored in between (run_stale) makes the Workflow retry.
import { composeFragments, FRAGMENT_SCHEMA, type Fragment } from "@codebridge/domain/fragments";
import type { ExtractionRun } from "@codebridge/domain/extraction/index";
import { currentRunRow, matchInputs, prepareRun, storeRun } from "./runs";
import { orgStmt } from "./sql";
import { Tx } from "./write";
import { sha256Hex } from "./work";
import type { Viewer } from "@codebridge/domain/access";

export type MergeResult = { result: "stored" | "other_producer" | "nothing"; documents: number; facts: number; run_id: string | null };

// A hook for the case rules (stream E, applyCaseRules): they run on the prepared run, on its final fact IDs, because
// some of their alert subjects contain "|" and prepareRun would rewrite them. Until they exist the run goes as it is.
export type CaseRules = (run: ExtractionRun) => ExtractionRun;

/** The fragments of one document's latest finished pipeline run that exist (the AI one may still be pending). */
async function fragmentsOf(env: Env, org: string, docId: string): Promise<Fragment[]> {
  const run = await orgStmt(
    env.DB,
    org,
    "SELECT output_prefix FROM pipeline_runs WHERE org_id = ?org AND document_id = ?1 AND state = 'done' ORDER BY finished_at DESC, id DESC LIMIT 1",
    docId,
  ).first<{ output_prefix: string }>();
  if (!run) return [];
  const out: Fragment[] = [];
  for (const producer of ["pipeline", "ai"]) {
    const f = await (await env.DOCS.get(`${run.output_prefix}fragment-${producer}.json`))?.json<Fragment>();
    // Only a fragment of this document in the agreed format: anything else is left out, never guessed at.
    if (f && f.schema === FRAGMENT_SCHEMA && f.document_id === docId) out.push(f);
  }
  return out;
}

/**
 * Composes and stores the case's pipeline run. Leaves the case alone when its current run came from another producer
 * (a prepared fixture or the NIS import): combining producers is not built yet, and replacing their run would drop
 * their facts. Only processed, current uploads count: a superseded or withdrawn document is never read again.
 */
export async function publishCaseRun(env: Env, org: string, caseId: string, who: Viewer, rules: CaseRules = (r) => r): Promise<MergeResult> {
  const db = env.DB;
  const current = await currentRunRow(db, org, caseId);
  if (current && current.producer !== "pipeline") return { result: "other_producer", documents: 0, facts: 0, run_id: null };
  const docs = (
    await orgStmt(
      db,
      org,
      "SELECT id, sha256 FROM documents WHERE org_id = ?org AND case_id = ?1 AND lifecycle = 'current' AND origin = 'upload' AND state = 'processed' ORDER BY created_at, id",
      caseId,
    ).all<{ id: string; sha256: string | null }>()
  ).results;
  const fragments: Fragment[] = [];
  for (const d of docs) fragments.push(...(await fragmentsOf(env, org, d.id)));
  // Nothing to show and nothing shown: no run. A pipeline run whose documents all left the case is replaced by an
  // empty one, so a withdrawn document's values do not stay on screen.
  if (!fragments.length && !current) return { result: "nothing", documents: 0, facts: 0, run_id: null };

  const at = new Date().toISOString();
  const runId = `pipeline-${caseId}-${(await sha256Hex(`${org}|${caseId}|${at}`)).slice(0, 8)}`;
  const inputs = await matchInputs(db, env.DOCS, org, caseId);
  const draft = composeFragments(caseId, runId, at, fragments);
  const { run } = prepareRun(inputs, draft);
  const final = rules(run);

  const ai = fragments.flatMap((f) => f.stages).find((s) => s.model);
  const t = new Tx(db, who, { requestId: null, epoch: null });
  const docIds = final.documents.map((d) => d.document_id);
  const stored = await storeRun(t, { db, docs: env.DOCS }, final, {
    inputHashes: Object.fromEntries(final.documents.flatMap((d) => (d.sha256 ? [[d.document_id, d.sha256]] : []))),
    model: ai?.model ?? null,
    promptVersion: ai?.prompt ?? null,
    temperature: ai?.temperature ?? null,
  });
  // The run now carries the documents' own alerts; their interim rows go (migration 0017, document_alerts).
  t.run("DELETE FROM document_alerts WHERE org_id = ?org AND case_id = ?1 AND document_id IN (SELECT value FROM json_each(?2))", caseId, JSON.stringify(docIds));
  // The case list's "nezpracováno" ends once the case has a run with documents.
  t.run("UPDATE cases SET processing_level = ?1 WHERE org_id = ?org AND id = ?2 AND processing_level <> 'full'", docIds.length ? "partial" : "none", caseId);
  t.audit({
    action: "case.pipeline_run",
    what_cs: `sestaven přehled případu ze zpracovaných dokumentů bez AI (dokumentů: ${docIds.length}, údajů: ${final.facts.length})`,
    case_id: caseId,
    target_type: "extraction_run",
    target_id: runId,
  });
  try {
    await t.commit();
  } catch (e) {
    await env.DOCS.delete(stored.r2_key).catch(() => {});
    throw e;
  }
  return { result: "stored", documents: docIds.length, facts: final.facts.length, run_id: runId };
}
