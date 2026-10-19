// ProcessCaseWorkflow: one case's run composed from its documents' fragments (store/case-merge.ts). Started by every
// finished document run, by a withdraw, and (stream D) by the AI extraction of a document. A Workflow so the merge
// survives a closed tab and is retried on its own: a run stored by a parallel merge in between makes storeRun refuse
// (run_stale), and the retry composes again from what exists then.
//
// Privacy: params and the step result hold ids, counts and codes only.
import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from "cloudflare:workers";
import { actorFor } from "../store/audio";
import { publishCaseRun } from "../store/case-merge";
import { RunInvalid } from "../store/runs";
import { pipelineListed } from "../services/page-reader";

export type ProcessCaseParams = { org: string; caseId: string; by: string; byActor: string | null };

// Many documents of one case finishing together start as many merges, each retried when another stored first
// (run_stale); ten retries with a growing pause let them settle.
const STEP = { retries: { limit: 10, delay: "3 seconds", backoff: "exponential" }, timeout: "2 minutes" } as const;

export class ProcessCaseWorkflow extends WorkflowEntrypoint<Env, ProcessCaseParams> {
  async run(event: WorkflowEvent<ProcessCaseParams>, step: WorkflowStep) {
    const p = event.payload;
    return step.do("compose and store", STEP, async () => {
      // Only where the pipeline runs for the org: demo org A keeps its prepared runs and its look.
      if (!pipelineListed(this.env, p.org)) return { result: "off", documents: 0, facts: 0 };
      const who = await actorFor(this.env.DB, p.org, p.by, this.env.AUTH_MODE === "oidc" ? "oidc" : "demo", p.byActor);
      try {
        const r = await publishCaseRun(this.env, p.org, p.caseId, who);
        return { result: r.result, documents: r.documents, facts: r.facts };
      } catch (e) {
        // A run the validator refuses will be refused again: no retry. Codes and paths only reach the log.
        if (e instanceof RunInvalid) {
          console.error(JSON.stringify({ workflow: "process_case", invalid: e.issues.slice(0, 10) }));
          return { result: "invalid", documents: 0, facts: 0 };
        }
        throw e;
      }
    });
  }
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
