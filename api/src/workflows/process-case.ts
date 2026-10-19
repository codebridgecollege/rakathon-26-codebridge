// ProcessCaseWorkflow: one case's run composed from its documents' fragments (store/case-merge.ts). Started by every
// finished document run, by a withdraw, and (stream D) by the AI extraction of a document. A Workflow so the merge
// survives a closed tab and each part is retried on its own:
//   compose  the fragments, prepared with the case's fact IDs, the case rules and the composed views (stream E);
//   brief    the brief and the drafted MDT question by the model (stream E's composeBrief), where the model runs;
//   store    the run, the drafted question, the retired document alerts and the audit line, in one batch.
// The composed run waits between the steps in R2 (under the case's runs/, which the demo reset empties), because a
// step result is no place for patient text. When another run became current meanwhile (run_stale), the three steps
// run again on what exists then.
//
// Privacy: params and step results hold ids, counts and codes only.
import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from "cloudflare:workers";
import { actorFor } from "../store/audio";
import { composeCaseRun, storeCaseRun, type ComposedRun } from "../store/case-merge";
import { confirmedFactIds, RunInvalid } from "../store/runs";
import { loadCaseIdentity } from "../store/identity";
import { orgKey, orgStmt } from "../store/sql";
import { composeBrief } from "../domain/brief";
import { forStep, MODEL_STEP } from "../services/model";
import { pipelineListed } from "../services/page-reader";
import { modelOn } from "./extract-document";
import { LEGACY_ORG } from "../domain/orgs";

export type ProcessCaseParams = { org: string; caseId: string; by: string; byActor: string | null };

// One attempt of a step; a merge that meets a run stored in between starts over (ATTEMPTS) rather than retrying the
// step, since the composed run then supersedes the wrong run.
const STEP = { retries: { limit: 3, delay: "3 seconds", backoff: "exponential" }, timeout: "2 minutes" } as const;
const ATTEMPTS = 8;

const isStale = (e: unknown) => e instanceof Error && /run_stale/.test(`${(e as { code?: string }).code ?? ""} ${e.message}`);

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
          if ("result" in c) return { result: c.result, documents: 0, facts: 0 };
          await env.DOCS.put(draftKey, JSON.stringify(c), { httpMetadata: { contentType: "application/json" } });
          return { result: "composed", documents: c.run.documents.length, facts: c.run.facts.length };
        } catch (e) {
          if (e instanceof RunInvalid) return invalid(e);
          throw e;
        }
      });
      if (composed.result !== "composed") return composed;

      // The brief, only where the model runs for the org (MODEL_ORGS) and never in demo org A. A refusal the model
      // cannot change gives a run without a brief (composeBrief); a retryable model error is the step's to retry.
      const briefed = p.org !== LEGACY_ORG && modelOn(env, p.org);
      if (briefed)
        await step.do(`brief ${i}`, MODEL_STEP, async () => {
          try {
            const c = (await (await env.DOCS.get(draftKey))!.json()) as ComposedRun;
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

      const stored = await step.do(`store ${i}`, STEP, async () => {
        const c = (await (await env.DOCS.get(draftKey))?.json()) as ComposedRun | undefined;
        // A retry after a store that committed finds the draft gone: the run is stored.
        if (!c) return { result: "stored", documents: 0, facts: 0 };
        const who = await actorFor(env.DB, p.org, p.by, env.AUTH_MODE === "oidc" ? "oidc" : "demo", p.byActor);
        try {
          const r = await storeCaseRun(env, p.org, p.caseId, who, c, briefed);
          await env.DOCS.delete(draftKey);
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
