// The case merge (ProcessCase; docs/research/2026-10-20-case-merge-contract.md): the latest fragment of every producer
// for every current document of a case, and the case's NIS import while its patient stays linked to that record, become
// one stored codebridge.extraction/2 run (producer "pipeline", or "nis" when only the NIS import is in it), so a
// new patient's case view shows its documents, lab values and alerts without any AI. Called by ProcessCaseWorkflow,
// which every finished document run (and a withdraw) starts; it always composes what exists, so it is idempotent, and
// a run stored in between (run_stale) makes the Workflow compose again.
import { composeFragments, FRAGMENT_SCHEMA, type Fragment } from "@codebridge/domain/fragments";
import type { ExtractionRun, RunStage } from "@codebridge/domain/extraction/index";
import { withCaseRulesAndViews } from "@codebridge/domain/extraction/compose";
import { currentRunRow, matchInputs, prepareRun, queueQuestionDraft, storeRun, withoutDocuments } from "./runs";
import { orgStmt } from "./sql";
import { Tx } from "./write";
import { sha256Hex } from "./work";
import type { Viewer } from "@codebridge/domain/access";
import { nisFragmentFor } from "./nis";
import { D } from "@codebridge/domain/errors";
import { nisConfig } from "../services/fhir";

export type MergeResult = { result: "stored" | "other_producer" | "nothing"; documents: number; facts: number; run_id: string | null };

// The case rules and composed views (stream E): they run on the prepared run, on its final fact IDs, because some of
// their alert subjects contain "|" and prepareRun would rewrite them.
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
 * A composed, prepared run ready to store, with what storing it needs. `nis_import`: the NIS import composed into it,
 * or null; the store step checks it again, so an unlink or relink in between never stores the old record's facts.
 */
export type ComposedRun = { run: ExtractionRun; stages: RunStage[]; nis_import: string | null; nis_link: { nis_patient_id: string; at: string } | null };

/** The NIS system configured for the org now, or null (a config that cannot be read leaves the NIS out). */
export function configuredNis(env: Env, org: string): string | null {
  try {
    return nisConfig(env, org)?.base_url ?? null;
  } catch {
    return null;
  }
}

/**
 * Composes the case's pipeline run from its documents' fragments and prepares it (fact IDs carried over), then runs the
 * case rules and the composed views (`rules`, stream E's withCaseRulesAndViews by default; on the prepared run, since
 * some rule subjects contain "|"). The case's NIS import joins while its patient stays linked to that record. Leaves the
 * case alone when its current run came from a prepared fixture: combining with fixtures is not built, and replacing
 * that run would drop its facts.
 * Only current uploads without prepared data count: a superseded or withdrawn document is never read again.
 */
export async function composeCaseRun(env: Env, org: string, caseId: string, rules: CaseRules = withCaseRulesAndViews): Promise<ComposedRun | MergeResult> {
  const db = env.DB;
  const current = await currentRunRow(db, org, caseId);
  // A run of the documents, of the NIS import, or of both is the merge's own; a prepared fixture's is not.
  if (current && current.producer !== "pipeline" && current.producer !== "nis") return { result: "other_producer", documents: 0, facts: 0, run_id: null };
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
  const docFragments = fragments.length > 0;
  // The case's NIS import (issue #22), while its patient stays linked to the record it came from. One that no longer
  // counts (unlinked, relinked, the NIS no longer configured) leaves its facts out; the log says why, in a code.
  const { fragment: nis, excluded, link } = await nisFragmentFor(db, env.DOCS, org, caseId, configuredNis(env, org));
  if (nis) fragments.push(nis);
  if (excluded) console.log(JSON.stringify({ route: "case_merge", nis_excluded: excluded }));
  // Nothing to show and nothing shown: no run. A run whose documents all left the case is replaced by an empty one, so
  // a withdrawn document's values do not stay on screen.
  if (!fragments.length && !current) return { result: "nothing", documents: 0, facts: 0, run_id: null };

  const at = new Date().toISOString();
  // The producer composeFragments gives the run: "pipeline" with any document fragment, "nis" with the NIS alone.
  const producer = docFragments || !nis ? "pipeline" : "nis";
  const runId = `${producer}-${caseId}-${(await sha256Hex(`${org}|${caseId}|${at}`)).slice(0, 8)}`;
  const inputs = await matchInputs(db, env.DOCS, org, caseId);
  const draft = composeFragments(caseId, runId, at, fragments);
  const { run } = prepareRun(inputs, draft);
  return { run: rules(run), stages: fragments.flatMap((f) => f.stages), nis_import: nis?.pipeline_run ?? null, nis_link: link };
}

/**
 * Stores a composed run in one batch: the run (storeRun refuses it with run_stale when another run became current in
 * between, and the caller composes again), the retirement of the documents' interim alerts, the drafted question when
 * the brief step made one (`withQuestion`), the case's processing level and one access-log line.
 */
export async function storeCaseRun(env: Env, org: string, caseId: string, who: Viewer, c: ComposedRun, withQuestion = false): Promise<MergeResult> {
  const db = env.DB;
  const final = c.run;
  // The model and prompt that made the facts (the extraction stage), not the page reading that may run before it.
  const modelStages = c.stages.filter((s) => s.model);
  const ai = modelStages.find((s) => s.name === "extract_facts") ?? modelStages[0];
  const t = new Tx(db, who, { requestId: null, epoch: null });
  // A run with NIS facts is stored only while the patient is still linked to that record by that very link: an unlink
  // or relink after composing makes the batch fail as stale, and the merge composes again without them.
  if (c.nis_link)
    t.guard(
      "nis_link",
      "(SELECT COUNT(*) FROM patient_nis_links l JOIN cases k ON k.patient_id = l.patient_id AND k.org_id = l.org_id WHERE k.org_id = ?org AND k.id = ? AND l.nis_patient_id = ? AND l.at = ?) = 1",
      [caseId, c.nis_link.nis_patient_id, c.nis_link.at],
      () => D.runStale(),
    );
  const docIds = final.documents.map((d) => d.document_id);
  const stored = await storeRun(t, { db, docs: env.DOCS }, final, {
    // The documents read, and the NIS link the NIS facts came by ("nis": "<NIS patient id>|<link time>"), so a later
    // read of this run can tell whether its NIS facts are still the linked patient's.
    inputHashes: {
      ...Object.fromEntries(final.documents.flatMap((d) => (d.sha256 ? [[d.document_id, d.sha256]] : []))),
      ...(c.nis_link ? { nis: `${c.nis_link.nis_patient_id}|${c.nis_link.at}` } : {}),
    },
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
  // The drafted MDT question goes onto the case with the run that holds it (stream E): only for a case without an
  // explicit question, never over what a doctor confirmed or edited. Only when the brief step ran: a run made without
  // the model has no draft, and must not clear one made earlier.
  if (withQuestion) queueQuestionDraft(t, final, (doc) => `${doc}.pdf`);
  // The case list's "nezpracováno" ends once the case has a run with documents or NIS records.
  const withNis = c.nis_import !== null;
  t.run("UPDATE cases SET processing_level = ?1 WHERE org_id = ?org AND id = ?2 AND processing_level <> 'full'", docIds.length || withNis ? "partial" : "none", caseId);
  t.audit({
    action: "case.pipeline_run",
    what_cs: `sestaven přehled případu ze zpracovaných dokumentů${withNis ? " a ze záznamů v NIS" : ""} (dokumentů: ${docIds.length}, údajů: ${final.facts.length})`,
    case_id: caseId,
    target_type: "extraction_run",
    target_id: final.run.id,
  });
  try {
    await t.commit();
  } catch (e) {
    await env.DOCS.delete(stored.r2_key).catch(() => {});
    throw e;
  }
  return { result: "stored", documents: docIds.length, facts: final.facts.length, run_id: final.run.id };
}

/** Composes and stores in one go, without the brief (tests, and a caller with no model step). */
export async function publishCaseRun(env: Env, org: string, caseId: string, who: Viewer, rules: CaseRules = withCaseRulesAndViews): Promise<MergeResult> {
  const c = await composeCaseRun(env, org, caseId, rules);
  return "result" in c ? c : storeCaseRun(env, org, caseId, who, c);
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
