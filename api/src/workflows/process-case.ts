// ProcessCaseWorkflow: one case's run composed from its documents' fragments (store/case-merge.ts). Started by every
// finished document run, by a withdraw, and (stream D) by the AI extraction of a document. A Workflow so the merge
// survives a closed tab and each part is retried on its own:
//   compose  the fragments, prepared with the case's fact IDs, the case rules and the composed views (stream E);
//   brief    the brief and the drafted MDT question by the model (stream E's composeBrief), where the model runs;
//   store    the run, the drafted question, the retired document alerts and the audit line, in one batch.
// The composed run waits between the steps in R2 (runs/<case>/draft-*, which the demo reset empties, a withdraw and the
// cron sweep delete), because a step result is no place for patient text. When another run became current meanwhile
// (run_stale), or a document left the case, the steps run again on what exists then. The brief is an addition: when
// the model cannot make it, the run is stored without it.
//
// Privacy: params and step results hold ids, counts and codes only.
import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from "cloudflare:workers";
import { DomainError } from "@codebridge/domain/errors";
import { actorFor } from "../store/audio";
import { composeCaseRun, configuredNis, storeCaseRun, type ComposedRun } from "../store/case-merge";
import { nisFragmentFor } from "../store/nis";
import { confirmedFactIds, currentRunRow, RunInvalid } from "../store/runs";
import { loadCaseIdentity } from "../store/identity";
import { orgKey, orgStmt } from "../store/sql";
import { composeBrief } from "../domain/brief";
import { forStep, MODEL_STEP } from "../services/model";
import { pipelineListed } from "../services/page-reader";
import { modelOn } from "./extract-document";
import { LEGACY_ORG } from "../domain/orgs";

export type ProcessCaseParams = { org: string; caseId: string; by: string; byActor: string | null };

// One attempt of a step; a merge that meets a run stored in between starts over (ATTEMPTS) rather than retrying the
// step, since the composed run would then supersede the wrong run.
const STEP = { retries: { limit: 3, delay: "3 seconds", backoff: "exponential" }, timeout: "2 minutes" } as const;
const ATTEMPTS = 8;

const isStale = (e: unknown) => e instanceof DomainError && e.code === "run_stale";

// Whether a composed run still fits the case: it supersedes the run current now, and every document it read is still
// current. Checked before the model sees anything, so a document withdrawn meanwhile never goes to it.
async function stillFits(env: Env, org: string, caseId: string, c: ComposedRun): Promise<boolean> {
  const run = c.run;
  const cur = await currentRunRow(env.DB, org, caseId);
  if ((cur?.id ?? null) !== run.run.supersedes) return false;
  // The NIS import composed in (or none) must still be the one that counts: an unlink or relink since composing would
  // otherwise store the old record's facts, possibly another person's.
  const nis = await nisFragmentFor(env.DB, env.DOCS, org, caseId, configuredNis(env, org));
  if ((nis.fragment?.pipeline_run ?? null) !== (c.nis_import ?? null)) return false;
  const ids = run.documents.map((d) => d.document_id);
  if (!ids.length) return true;
  const n = await orgStmt(env.DB, org, "SELECT COUNT(*) AS n FROM documents WHERE org_id = ?org AND case_id = ?1 AND lifecycle = 'current' AND id IN (SELECT value FROM json_each(?2))", caseId, JSON.stringify(ids)).first<{ n: number }>();
  return n?.n === ids.length;
}

export class ProcessCaseWorkflow extends WorkflowEntrypoint<Env, ProcessCaseParams> {
  async run(event: WorkflowEvent<ProcessCaseParams>, step: WorkflowStep) {
    const p = event.payload;
    // Only where the pipeline runs for the org: demo org A keeps its prepared runs and its look.
    if (!pipelineListed(this.env, p.org)) return step.do("compose and store", STEP, async () => ({ result: "off", documents: 0, facts: 0 }));
    const env = this.env;
    for (let i = 0; i < ATTEMPTS; i++) {
      const draftKey = orgKey(p.org, `runs/${p.caseId}/draft-${event.instanceId}-${i}.json`);
      const composed = await step.do(`compose ${i}`, STEP, async () => {
        try {
          const c = await composeCaseRun(env, p.org, p.caseId);
          if ("result" in c) return { result: c.result, documents: 0, facts: 0, brief: false, run: null };
          await env.DOCS.put(draftKey, JSON.stringify(c), { httpMetadata: { contentType: "application/json" } });
          // Decided here, in a step, so a replay after a redeploy that changed MODEL_ORGS keeps the same course.
          const brief = p.org !== LEGACY_ORG && modelOn(env, p.org);
          return { result: "composed", documents: c.run.documents.length, facts: c.run.facts.length, brief, run: c.run.run.id };
        } catch (e) {
          if (e instanceof RunInvalid) return { ...invalid(e), brief: false, run: null };
          throw e;
        }
      });
      if (composed.result !== "composed") return { result: composed.result, documents: composed.documents, facts: composed.facts };

      // The brief, only where the model runs for the org (MODEL_ORGS) and never in demo org A. A refusal the model
      // cannot change gives a run without a brief (composeBrief); a failure after the step's retries stores the run
      // without it too: the documents' facts, alerts and views matter more than the brief.
      let questionFromBrief = false;
      if (composed.brief) {
        let outcome: { skipped: string | null; dropped?: number } = { skipped: "failed" };
        try {
          outcome = await step.do(`brief ${i}`, MODEL_STEP, async () => {
            try {
              const c = (await (await env.DOCS.get(draftKey))?.json()) as ComposedRun | undefined;
              if (!c) return { skipped: "lost" };
              // A document withdrawn, or another run stored, since composing: nothing goes to the model; start over.
              if (!(await stillFits(env, p.org, p.caseId, c))) return { skipped: "stale" };
              const actor = await actorFor(env.DB, p.org, p.by, env.AUTH_MODE === "oidc" ? "oidc" : "demo", p.byActor);
              const row = await orgStmt(env.DB, p.org, "SELECT question_explicit FROM cases WHERE org_id = ?org AND id = ?1", p.caseId).first<{ question_explicit: number }>();
              const out = await composeBrief(
                env,
                { org: p.org, caseId: p.caseId, actor, identity: await loadCaseIdentity(env.DB, p.org, p.caseId), draftQuestion: !row?.question_explicit, confirmed: await confirmedFactIds(env.DB, p.org, c.run) },
                c.run,
              );
              await env.DOCS.put(draftKey, JSON.stringify({ ...c, run: out.run }), { httpMetadata: { contentType: "application/json" } });
              return { skipped: out.skipped, dropped: out.dropped.length };
            } catch (e) {
              throw forStep(e);
            }
          });
        } catch {
          console.error(JSON.stringify({ workflow: "process_case", brief: "failed" }));
        }
        if (outcome.skipped === "stale" || outcome.skipped === "lost") {
          await step.do(`discard ${i}`, STEP, async () => (await env.DOCS.delete(draftKey), { discarded: true }));
          continue;
        }
        // Only a brief the model actually made may set the case's drafted question; a refused or failed one must not
        // clear a draft made earlier.
        questionFromBrief = outcome.skipped === null;
      }

      const stored = await step.do(`store ${i}`, STEP, async () => {
        // A retry after a store that committed: the run is there, and its draft goes.
        if (composed.run && (await orgStmt(env.DB, p.org, "SELECT 1 AS ok FROM extraction_runs WHERE org_id = ?org AND id = ?1", composed.run).first())) {
          await env.DOCS.delete(draftKey);
          return { result: "stored", documents: composed.documents, facts: composed.facts };
        }
        const c = (await (await env.DOCS.get(draftKey))?.json()) as ComposedRun | undefined;
        // The draft is gone and nothing was stored (a demo reset emptied runs/): compose again.
        if (!c) return { result: "stale", documents: 0, facts: 0 };
        const who = await actorFor(env.DB, p.org, p.by, env.AUTH_MODE === "oidc" ? "oidc" : "demo", p.byActor);
        try {
          const r = await storeCaseRun(env, p.org, p.caseId, who, c, questionFromBrief);
          await env.DOCS.delete(draftKey).catch(() => {});
          return { result: r.result, documents: r.documents, facts: r.facts };
        } catch (e) {
          if (isStale(e)) {
            await env.DOCS.delete(draftKey);
            return { result: "stale", documents: 0, facts: 0 };
          }
          if (e instanceof RunInvalid) {
            await env.DOCS.delete(draftKey);
            return invalid(e);
          }
          throw e;
        }
      });
      if (stored.result !== "stale") return stored;
    }
    console.error(JSON.stringify({ workflow: "process_case", result: "gave_up" }));
    return { result: "gave_up", documents: 0, facts: 0 };
  }
}

// A run the validator refuses will be refused again: no retry. Codes and paths only reach the log.
function invalid(e: RunInvalid) {
  console.error(JSON.stringify({ workflow: "process_case", invalid: e.issues.slice(0, 10) }));
  return { result: "invalid", documents: 0, facts: 0 };
}

// Starts a merge of the case; a failed start is left to the next document run or withdraw, which start one again.
export async function startCaseMerge(env: Env, p: ProcessCaseParams): Promise<boolean> {
  try {
    await env.PROCESS_CASE.create({ id: `case-${p.caseId}-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`, params: p, retention: { successRetention: "1 day", errorRetention: "3 days" } });
    return true;
  } catch {
    console.error(JSON.stringify({ workflow: "process_case", start: "failed" }));
    return false;
  }
}

/** The case's composed runs waiting between steps (runs/<case>/draft-*): a withdraw and the cron sweep delete them. */
export async function deleteCaseDrafts(env: Env, org: string, caseId: string, olderThanMs = 0): Promise<number> {
  const listed = await env.DOCS.list({ prefix: orgKey(org, `runs/${caseId}/draft-`), limit: 1000 });
  const keys = listed.objects.filter((o) => !olderThanMs || Date.now() - o.uploaded.getTime() > olderThanMs).map((o) => o.key);
  if (keys.length) await env.DOCS.delete(keys);
  return keys.length;
}
