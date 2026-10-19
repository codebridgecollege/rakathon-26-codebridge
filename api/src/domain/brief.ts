// The brief and the drafted MDT question for a case run (issue #21), composed by the model through the one model
// interface (services/model.ts: pseudonymization, the identifier gate, the budget, the audit, the cache, retries on
// 429). What the model sees and what of its answer is kept is decided in packages/domain/src/extraction/brief.ts:
// verified facts only in, and only sentences whose dates, numbers, negations, sides and drug names are in their facts
// out. When the brief leaves out unverified facts of its kinds, an alert says so and lists them, so a brief without an
// unverified key finding never reads as complete. The case merge calls composeBrief after the case rules and the
// composed views, before storeRun.
import type { Viewer } from "@codebridge/domain/access";
import { acceptBrief, BRIEF_WITHHELD_RULE, briefFacts, briefPrompt, withWithheldAlert, type AcceptedBrief, type BriefAnswer } from "@codebridge/domain/extraction/brief";
import type { ExtractionRun } from "@codebridge/domain/extraction/types";
import { callModel, ModelError } from "../services/model";
import type { CaseIdentity } from "./pseudonymize";

export type BriefRequest = {
  org: string;
  caseId: string;
  /** Who the run is made for, as the model call's audit records it. */
  actor: Viewer;
  identity: CaseIdentity;
  /** True when the referral states no question for the MDT (CLAUDE.md: then the assistant drafts one). */
  draftQuestion: boolean;
  /** Fact IDs a doctor has confirmed (fact_confirmations): verified even when the extraction marked them "verify". */
  confirmed?: string[];
};

export type BriefOutcome = {
  run: ExtractionRun;
  /** Why sentences were dropped, as codes, for the log; never their text. */
  dropped: AcceptedBrief["dropped"];
  /** "model_off" when no model is configured for the deployment: the run then has no brief, which the view shows. */
  skipped: "no_verified_facts" | "model_off" | null;
};

/**
 * The run with its brief and, when asked, its drafted question. With no verified fact, or no model configured, the
 * run comes back without a brief rather than with one guessed; any other model error is the caller's (a Workflow step
 * retries it through forStep).
 */
export async function composeBrief(env: Env, req: BriefRequest, run: ExtractionRun): Promise<BriefOutcome> {
  const facts = briefFacts(run, { confirmed: req.confirmed });
  // Without a brief there is nothing that could read as complete, so the withheld alert goes too.
  const empty = { ...run, brief: null, question_draft: req.draftQuestion ? null : run.question_draft, alerts: run.alerts.filter((a) => a.rule !== BRIEF_WITHHELD_RULE) };
  if (!facts.length) return { run: empty, dropped: [], skipped: "no_verified_facts" };
  const { parts, refs } = briefPrompt(facts, run.sources, req.draftQuestion);
  let result;
  try {
    result = await callModel(env, {
      org: req.org,
      caseId: req.caseId,
      actor: req.actor,
      purpose: "compose_brief",
      prompt: "compose-brief-cs",
      identity: req.identity,
      text: parts.map((p) => ({ ref: { docId: p.documentId, page: null }, text: p.text })),
    });
  } catch (e) {
    if (e instanceof ModelError && e.code === "model_off") return { run: empty, dropped: [], skipped: "model_off" };
    throw e;
  }
  const answer = result.json as BriefAnswer;
  const accepted = acceptBrief(answer, run, facts, refs, { model: result.meta.model, prompt: result.meta.prompt });
  const stage = { name: "compose_brief", model: result.meta.model, prompt: result.meta.prompt, prompt_sha256: result.meta.prompt_sha256, temperature: null };
  const composed = accepted.brief ? withWithheldAlert(run, facts) : { ...run, alerts: run.alerts.filter((a) => a.rule !== BRIEF_WITHHELD_RULE) };
  return {
    run: {
      ...composed,
      run: { ...run.run, stages: [...run.run.stages.filter((s) => s.name !== "compose_brief"), stage] },
      brief: accepted.brief,
      // A question is drafted only when the referral states none; otherwise the run keeps what it had.
      question_draft: req.draftQuestion ? accepted.question : run.question_draft,
    },
    dropped: accepted.dropped,
    skipped: null,
  };
}
