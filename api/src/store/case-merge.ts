// The case merge (ProcessCase; docs/research/2026-10-20-case-merge-contract.md): the latest fragment of every producer
// for every current document of a case becomes one stored codebridge.extraction/2 run with producer "pipeline", so a
// new patient's case view shows its documents, lab values and alerts without any AI. Called by ProcessCaseWorkflow,
// which every finished document run (and a withdraw) starts; it always composes what exists, so it is idempotent, and
// a run stored in between (run_stale) makes the Workflow retry.
import { composeFragments, FRAGMENT_SCHEMA, type Fragment } from "@codebridge/domain/fragments";
import type { ExtractionRun } from "@codebridge/domain/extraction/index";
import { currentRunRow, matchInputs, prepareRun, storeRun, withoutDocuments } from "./runs";
import { orgStmt } from "./sql";
import { Tx } from "./write";
import { sha256Hex } from "./work";
import type { Viewer } from "@codebridge/domain/access";

export type MergeResult = { result: "stored" | "other_producer" | "nothing"; documents: number; facts: number; run_id: string | null };

// A hook for the case rules (stream E, applyCaseRules): they run on the prepared run, on its final fact IDs, because
// some of their alert subjects contain "|" and prepareRun would rewrite them. Until they exist the run goes as it is.
export type CaseRules = (run: ExtractionRun) => ExtractionRun;

/**
 * The fragments of one document: from its newest finished pipeline run that has the pipeline's fragment (a run that
 * finished but has not written it yet, or a rerun still going, leaves the previous one in place, so the document
 * never drops out of the case run and its fact IDs and confirmations carry over). The AI fragment of that run may
 * still be pending.
 */
async function fragmentsOf(env: Env, org: string, docId: string): Promise<Fragment[]> {
  const runs = (
    await orgStmt(env.DB, org, "SELECT output_prefix FROM pipeline_runs WHERE org_id = ?org AND document_id = ?1 AND state = 'done' ORDER BY finished_at DESC, id DESC LIMIT 5", docId).all<{
      output_prefix: string;
    }>()
  ).results;
  for (const run of runs) {
    const out: Fragment[] = [];
    for (const producer of ["pipeline", "ai"]) {
      const f = await (await env.DOCS.get(`${run.output_prefix}fragment-${producer}.json`))?.json<Fragment>();
      // Only a fragment of this document in the agreed format: anything else is left out, never guessed at.
      if (f && f.schema === FRAGMENT_SCHEMA && f.document_id === docId) out.push(f);
    }
    if (out.some((f) => f.producer === "pipeline")) return out;
  }
  return [];
}

/**
 * A fragment of a document D1 marks as another patient's, read before that was known: unless it already holds
 * something back on a page it names, every fact is held back (quarantined, its passage marked "conflicts"), and the
 * pipeline's fragment raises the identity alert over all its pages (composeFragments lists the held facts).
 */
function heldBack(f: Fragment): Fragment {
  if (f.facts.some((x) => x.quarantined) || f.alerts.some((a) => a.rule === "identity_conflict")) return f;
  const pages = [...new Set(f.sources.flatMap((s) => (s.type === "document" ? [s.page] : [])))].sort((a, b) => a - b);
  return {
    ...f,
    sources: f.sources.map((s) => (s.type === "document" ? { ...s, identity: "conflicts" as const } : s)),
    facts: f.facts.map((x) => ({ ...x, quarantined: true })),
    alerts:
      f.producer === "pipeline"
        ? [
            ...f.alerts,
            {
              rule: "identity_conflict",
              subject: f.document_id,
              kind: "identity",
              facts: f.facts.map((x) => x.draft_id),
              message: { id: "alert-identity-conflict", args: { document: f.document_id, page: pages.join(", ") } },
              note: null,
            },
          ]
        : f.alerts,
  };
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
      // Current uploads without prepared data, whatever their processing state now: a document being read again keeps
      // its last fragment until the new one exists.
      "SELECT id, sha256, identity FROM documents WHERE org_id = ?org AND case_id = ?1 AND lifecycle = 'current' AND origin = 'upload' AND COALESCE(state, '') <> 'prepared' ORDER BY created_at, id",
      caseId,
    ).all<{ id: string; sha256: string | null; identity: string | null }>()
  ).results;
  const fragments: Fragment[] = [];
  for (const d of docs) {
    const own = await fragmentsOf(env, org, d.id);
    // A conflict D1 knows (the registry's, or one a newer reading found whose fragment is not written yet) holds back
    // the document even when the fragment used here was written before it was known.
    fragments.push(...(d.identity === "conflicts" ? own.map(heldBack) : own));
  }
  // Nothing to show and nothing shown: no run. A pipeline run whose documents all left the case is replaced by an
  // empty one, so a withdrawn document's values do not stay on screen.
  if (!fragments.length && !current) return { result: "nothing", documents: 0, facts: 0, run_id: null };

  const at = new Date().toISOString();
  const runId = `pipeline-${caseId}-${(await sha256Hex(`${org}|${caseId}|${at}`)).slice(0, 8)}`;
  const inputs = await matchInputs(db, env.DOCS, org, caseId);
  const draft = composeFragments(caseId, runId, at, fragments);
  const { run } = prepareRun(inputs, draft);
  const final = rules(run);

  // The model and prompt that made the facts (the extraction stage), not the page reading that may run before it.
  const modelStages = fragments.flatMap((f) => f.stages).filter((s) => s.model);
  const ai = modelStages.find((s) => s.name === "extract_facts") ?? modelStages[0];
  const t = new Tx(db, who, { requestId: null, epoch: null });
  const docIds = final.documents.map((d) => d.document_id);
  const stored = await storeRun(t, { db, docs: env.DOCS }, final, {
    inputHashes: Object.fromEntries(final.documents.flatMap((d) => (d.sha256 ? [[d.document_id, d.sha256]] : []))),
    model: ai?.model ?? null,
    promptVersion: ai?.prompt ?? null,
    temperature: ai?.temperature ?? null,
  });
  // The run now carries the documents' own alerts; their interim rows go (migration 0017, document_alerts), except an
  // identity row of a document the run carries no identity alert for: that warning is never lost.
  const withIdentity = final.alerts.filter((a) => a.rule === "identity_conflict").map((a) => a.subject);
  t.run(
    `DELETE FROM document_alerts WHERE org_id = ?org AND case_id = ?1 AND document_id IN (SELECT value FROM json_each(?2))
       AND (rule <> 'identity_conflict' OR document_id IN (SELECT value FROM json_each(?3)))`,
    caseId,
    JSON.stringify(docIds),
    JSON.stringify(withIdentity),
  );
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

/**
 * After a withdraw: every stored pipeline run of the case is rewritten without the withdrawn document (withoutDocuments),
 * so another patient's values do not stay in R2 in an older run, where "potvrzeno dříve" could show them. Runs are
 * otherwise never changed; deleting another patient's data comes first. The row's sha256 follows the new content.
 */
export async function scrubRunsOf(env: Env, org: string, caseId: string, docId: string): Promise<number> {
  // Only the runs that read the document: storeRun records each input document in input_hashes_json.
  const rows = (
    await orgStmt(
      env.DB,
      org,
      `SELECT id, r2_key FROM extraction_runs WHERE org_id = ?org AND case_id = ?1 AND seeded = 0 AND json_type(input_hashes_json, '$."' || ?2 || '"') IS NOT NULL`,
      caseId,
      docId,
    ).all<{ id: string; r2_key: string }>()
  ).results;
  let n = 0;
  for (const r of rows) {
    // Conditional on the object read: two withdraws of one case at once never write back each other's document.
    for (let attempt = 0; attempt < 3; attempt++) {
      const obj = await env.DOCS.get(r.r2_key);
      if (!obj) break;
      const run = await obj.json<ExtractionRun>();
      if (!run.documents?.some((d) => d.document_id === docId)) break;
      const body = JSON.stringify(withoutDocuments(run, new Set([docId])));
      const put = await env.DOCS.put(r.r2_key, body, { httpMetadata: { contentType: "application/json" }, onlyIf: { etagMatches: obj.etag } });
      if (!put) continue;
      await orgStmt(env.DB, org, "UPDATE extraction_runs SET sha256 = ?1 WHERE org_id = ?org AND id = ?2", await sha256Hex(body), r.id).run();
      n++;
      break;
    }
  }
  return n;
}
