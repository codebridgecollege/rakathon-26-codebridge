// PrognosisWorkflow: one study search for one case (PRODUCT.md, "Prognosis evidence search"). The model call with web
// search can take minutes, longer than a browser request lives, so it runs here and the page polls the job.
//
// The clinical profile waits between the request and this run in R2 (jobs/<case>/prognosis-<job>.json), because a
// Workflow's parameters are no place for patient text; params and the step result hold ids, counts and codes only. The
// profile holds no name or birth number (packages/domain/src/prognosis-profile.ts). There is no retry: one click is one
// model call (CLAUDE.md, calling LLMs), and a failed search is started again by hand.
import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from "cloudflare:workers";
import type { Profile } from "@codebridge/domain/prognosis-profile";
import { prognosisConfig, PrognosisProblem, searchStudies } from "../services/prognosis-search";
import { orgKey, orgStmt } from "../store/sql";

export type PrognosisParams = { org: string; caseId: string; jobId: string; file: string; scheduledDate: string };

export const prognosisDraftKey = (org: string, caseId: string, jobId: string) => orgKey(org, `jobs/${caseId}/prognosis-${jobId}.json`);
export const prognosisSavedKey = (org: string, caseId: string, date: string) => orgKey(org, `prognosis-runs/${caseId}/saved-${date}.json`);

const setJob = (env: Env, p: PrognosisParams, state: "running" | "done" | "error", phase: "search" | "normalize" | null, code: string | null, ref: string | null = null) =>
  orgStmt(
    env.DB,
    p.org,
    "UPDATE jobs SET state = ?1, phase = ?2, error_code = ?3, result_ref = COALESCE(?4, result_ref), updated_at = ?5 WHERE org_id = ?org AND id = ?6 AND kind = 'prognosis'",
    state, phase, code, ref, new Date().toISOString(), p.jobId,
  ).run();

// The whole job, outside the Workflow class so a test can run it with a stubbed fetch. Returns the outcome as a code.
export async function runPrognosisJob(env: Env, p: PrognosisParams, fetchFn?: typeof fetch): Promise<{ state: "done" | "error"; code: string | null }> {
  const draftKey = prognosisDraftKey(p.org, p.caseId, p.jobId);
  const fail = async (code: string) => {
    await setJob(env, p, "error", null, code);
    await env.DOCS.delete(draftKey);
    return { state: "error" as const, code };
  };
  await setJob(env, p, "running", "search", null);
  const draft = await env.DOCS.get(draftKey);
  if (!draft) return fail("draft_missing");
  const profile = (await draft.json()) as Profile;
  const cfg = prognosisConfig(env);
  const model = cfg.models[0];
  if (!env.OPENROUTER_API_KEY || !model?.id) return fail(!env.OPENROUTER_API_KEY ? "missing_key" : "models_not_configured");
  let result: Record<string, unknown>;
  try {
    result = await searchStudies({ profile, apiKey: env.OPENROUTER_API_KEY, model: model.id, modelLabel: model.label, reasoningEffort: env.OPENROUTER_REASONING_EFFORT || undefined, fetchFn });
  } catch (e) {
    // The type and a fixed code only: the message may echo the request.
    console.error(JSON.stringify({ job: "prognosis_failed", error: e instanceof Error ? e.name : "Error" }));
    return fail(e instanceof PrognosisProblem ? e.code : "search_failed");
  }
  await setJob(env, p, "running", "normalize", null);
  // The result always goes in, also one with a model error or no rows, so the tab can show what the search found or why
  // it found nothing.
  const key = prognosisSavedKey(p.org, p.caseId, p.scheduledDate);
  await env.DOCS.put(key, JSON.stringify({ patient_id: p.file, scheduled_date: p.scheduledDate, result }), { httpMetadata: { contentType: "application/json" } });
  await env.DOCS.delete(draftKey);
  await setJob(env, p, "done", null, null, key);
  return { state: "done", code: null };
}

export class PrognosisWorkflow extends WorkflowEntrypoint<Env, PrognosisParams> {
  async run(event: WorkflowEvent<PrognosisParams>, step: WorkflowStep) {
    const p = event.payload;
    return step.do("search", { retries: { limit: 0, delay: "1 second" }, timeout: "8 minutes" }, async () => runPrognosisJob(this.env, p));
  }
}
