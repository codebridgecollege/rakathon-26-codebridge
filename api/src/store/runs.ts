// Storage of codebridge.extraction/2 runs (docs/design/EXTRACTION-FORMAT.md; DATABASE.md, "Extraction runs"). A run is
// one JSON object in R2 and one row in extraction_runs; its fact and alert IDs are registered in D1 so confirmations,
// edits and acknowledgements can attach to them and a later run never reuses a retired ID for another fact.
//
// A producer (the intake, the pipeline, the NIS import) does: matchInputs -> its own extraction -> prepareRun ->
// storeRun inside its write batch (store/write.ts Tx). Every query is bound to the Tx's or the caller's org.
import {
  EXTRACTION_SCHEMA,
  VIEW_NAMES,
  alertId,
  assignFactIds,
  validateRun,
  viewLineId,
  type DraftFact,
  type ExtractionRun,
  type Issue,
  type MatchResult,
} from "@codebridge/domain/extraction/index";
import { confirmationState, confirmedContent, type ConfirmAction } from "@codebridge/domain/confirmations";
import { D } from "@codebridge/domain/errors";
import { E } from "../http/errors";
import type { Tx } from "./write";
import { orgKey, orgStmt } from "./sql";
import { sha256Hex } from "./work";

const RUN_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

/** The current run of a case as D1 knows it. */
export type CurrentRunRow = { id: string; producer: string; seeded: number; schema: string; created_at: string; r2_key: string; case_id: string };

/** A run the validator refused. Carries the issue codes and paths only, never values from the run. */
export class RunInvalid extends Error {
  constructor(readonly issues: Pick<Issue, "code" | "path">[]) {
    super(`run_invalid: ${issues.length} issue(s)`);
  }
}

export function currentRunRow(db: D1Database, org: string, caseId: string): Promise<CurrentRunRow | null> {
  return orgStmt(
    db,
    org,
    "SELECT id, producer, seeded, schema, created_at, r2_key, case_id FROM extraction_runs WHERE org_id = ?org AND case_id = ?1 AND is_current = 1",
    caseId,
  ).first<CurrentRunRow>();
}

/**
 * The current run and, when it is a /2 run, its content. A /1 run gives data null: its facts have no IDs, so nothing
 * can attach to them. A missing R2 object is an error (D1 never points at a missing object; storeRun writes R2 first).
 */
export async function currentRun(db: D1Database, docs: R2Bucket, org: string, caseId: string): Promise<{ row: CurrentRunRow | null; data: ExtractionRun | null }> {
  const row = await currentRunRow(db, org, caseId);
  if (!row || row.schema !== EXTRACTION_SCHEMA) return { row, data: null };
  const obj = await docs.get(row.r2_key);
  if (!obj) throw E.dataUnavailable();
  return { row, data: await obj.json<ExtractionRun>() };
}

/**
 * The run as the case view receives it: the stored run minus its quarantined content. A quarantined fact rests on a
 * page that shows another patient, so neither the fact nor a source that only it cites may reach the browser
 * (CLAUDE.md: expose as little as possible). Its ID also leaves every alert's `facts`; the identity alert itself stays,
 * and its message arguments name the document and page. The result is therefore not a whole run for validateRun.
 */
export function withoutQuarantined(run: ExtractionRun): ExtractionRun {
  const gone = new Set(run.facts.filter((f) => f.quarantined).map((f) => f.id));
  if (!gone.size) return run;
  const facts = run.facts.filter((f) => !gone.has(f.id));
  const kept = new Set(facts.flatMap((f) => f.sources));
  const onlyQuarantined = new Set(run.facts.filter((f) => gone.has(f.id)).flatMap((f) => f.sources).filter((s) => !kept.has(s)));
  return {
    ...run,
    facts,
    sources: run.sources.filter((s) => !onlyQuarantined.has(s.id)),
    alerts: run.alerts.map((a) => ({ ...a, facts: a.facts.filter((id) => !gone.has(id)) })),
  };
}

/** What the matcher needs from D1 for a new run of a case (match.ts assignFactIds). */
export type MatchInputs = {
  caseId: string;
  /** The current run when it is a /2 run; its fact IDs are carried over. */
  previous: ExtractionRun | null;
  /** The ID of the current run whatever its format: the new run supersedes it. */
  currentRunId: string | null;
  /** Documents of the case that left the current set (documents.lifecycle, migration 0013). */
  retiredDocuments: string[];
  /** Every fact ID ever issued for the case (fact_ids). */
  issuedIds: string[];
};

export async function matchInputs(db: D1Database, docs: R2Bucket, org: string, caseId: string): Promise<MatchInputs> {
  const [{ row, data }, retired, issued] = await Promise.all([
    currentRun(db, docs, org, caseId),
    orgStmt(db, org, "SELECT id FROM documents WHERE org_id = ?org AND case_id = ?1 AND lifecycle <> 'current' ORDER BY id", caseId).all<{ id: string }>(),
    orgStmt(db, org, "SELECT fact_id FROM fact_ids WHERE org_id = ?org AND case_id = ?1 ORDER BY fact_id", caseId).all<{ fact_id: string }>(),
  ]);
  return {
    caseId,
    previous: data,
    currentRunId: row?.id ?? null,
    retiredDocuments: retired.results.map((r) => r.id),
    issuedIds: issued.results.map((r) => r.fact_id),
  };
}

/** A fact as a producer builds it: no key or ID yet, and a draft_id that the run's other parts may use to point at it. */
export type DraftedFact = DraftFact & { draft_id?: string };
/** A run as a producer builds it: drafted facts; alerts without IDs; references by draft_id or by final ID. */
export type DraftRun = Omit<ExtractionRun, "facts" | "alerts" | "run"> & {
  run: Omit<ExtractionRun["run"], "supersedes">;
  facts: DraftedFact[];
  alerts: Omit<ExtractionRun["alerts"][number], "id">[];
};

/**
 * Assigns keys and IDs to a drafted run against the case's previous run, rewrites every draft_id reference (alerts,
 * checks, brief, question, composed view lines) to the final IDs, derives the alert and view line IDs and sets
 * `supersedes`. The result still goes through
 * storeRun, which validates it.
 */
export function prepareRun(inputs: MatchInputs, draft: DraftRun): { run: ExtractionRun; match: MatchResult } {
  if (draft.case_id !== inputs.caseId) throw new Error("prepare_run_case_mismatch");
  const match = assignFactIds(inputs.caseId, draft.facts, draft.sources, inputs.previous, {
    retiredDocuments: inputs.retiredDocuments,
    issuedIds: inputs.issuedIds,
  });
  const final = new Map<string, string>();
  draft.facts.forEach((f, i) => {
    if (f.draft_id) final.set(f.draft_id, match.facts[i]!.id);
  });
  const id = (x: string) => final.get(x) ?? x;
  const ids = (xs: string[]) => xs.map(id);
  // A pair subject ("f-a|f-b") stays sorted after the rewrite, so the alert ID does not depend on the order of drafts.
  const subject = (s: string) =>
    s
      .split("|")
      .map(id)
      .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
      .join("|");
  const alerts = draft.alerts.map((a) => {
    const subj = a.subject.includes("|") ? subject(a.subject) : id(a.subject);
    const args = Object.fromEntries(Object.entries(a.message.args).map(([k, v]) => [k, typeof v === "string" ? id(v) : v]));
    return { ...a, id: alertId({ rule: a.rule, subject: subj }), subject: subj, facts: ids(a.facts), message: { ...a.message, args } };
  });
  const run: ExtractionRun = {
    ...draft,
    run: { ...draft.run, supersedes: inputs.currentRunId },
    facts: match.facts,
    alerts,
    checks: draft.checks.map((c) => (c.expected ? { ...c, expected: { of_fact: id(c.expected.of_fact) } } : c)),
    brief: draft.brief ? { ...draft.brief, sentences: draft.brief.sentences.map((s) => ({ ...s, facts: ids(s.facts) })) } : null,
    question_draft: draft.question_draft
      ? { ...draft.question_draft, basis: draft.question_draft.basis.map((b) => ({ ...b, facts: ids(b.facts) })) }
      : null,
  };
  // A composed line's ID follows from its view and its facts (keys.ts viewLineId), so it is derived again from the final
  // fact IDs; an absent `views` stays absent.
  if (draft.views) {
    const views = { ...draft.views };
    for (const name of VIEW_NAMES) {
      const lines = draft.views[name];
      if (lines) views[name] = lines.map((l) => ({ ...l, id: viewLineId(name, ids(l.facts)), facts: ids(l.facts) }));
    }
    run.views = views;
  }
  return { run, match };
}

export type StoreRunOptions = {
  /** 1 only for the seed: the demo reset keeps seeded runs and removes every other one. */
  seeded?: boolean;
  /** sha256 of each input (document or fixture file), for the run's provenance. */
  inputHashes?: Record<string, string>;
  model?: string | null;
  promptVersion?: string | null;
  temperature?: number | null;
};

/**
 * Adds a run to the caller's write batch: validates it (an invalid run is refused, nothing is written), writes the R2
 * object, and queues the D1 rows: the previous current run stops being current, the new row, its fact IDs and alert
 * IDs. Returns the R2 key; the caller deletes it when its batch fails, as for any object it wrote before the batch.
 *
 * Seeded runs go under extract/, every other run under runs/, which the demo reset empties with the rows the reset
 * trigger removes (src/routes/demo.ts R2_TRANSIENT).
 *
 * Guards in the batch: the run supersedes exactly the run that is current when the batch commits (another run stored
 * in between would make the carried-over IDs stale), and every document the run read belongs to this case in this org.
 */
export async function storeRun(
  t: Tx,
  store: { db: D1Database; docs: R2Bucket },
  run: ExtractionRun,
  opts: StoreRunOptions = {},
): Promise<{ r2_key: string; sha256: string }> {
  const v = validateRun(run);
  if (!v.ok) throw new RunInvalid(v.issues.map((i) => ({ code: i.code, path: i.path })));
  // The run ID and the case ID become part of the R2 key, so neither may name another folder, and the case must be
  // this org's before anything is written.
  if (!RUN_ID.test(run.run.id)) throw new RunInvalid([{ code: "schema", path: "/run/id" }]);
  const caseId = run.case_id;
  if (!(await orgStmt(store.db, t.org, "SELECT 1 AS ok FROM cases WHERE org_id = ?org AND id = ?1", caseId).first())) throw D.caseNotFound();
  const body = JSON.stringify(run);
  const sha = await sha256Hex(body);
  const key = orgKey(t.org, `${opts.seeded ? "extract" : "runs"}/${caseId}/${run.run.id}.json`);
  // Never over another run's object: a run ID that is taken would otherwise replace a stored run, and the caller's
  // cleanup after the refused batch would then delete it.
  const put = await store.docs.put(key, body, { httpMetadata: { contentType: "application/json" }, onlyIf: { etagDoesNotMatch: "*" } });
  if (!put) throw D.runStale();

  const docIds = [...new Set(run.documents.map((d) => d.document_id))];
  t.guard("run_previous", "(SELECT id FROM extraction_runs WHERE org_id = ?org AND case_id = ? AND is_current = 1) IS ?", [caseId, run.run.supersedes], () => D.runStale());
  t.guard(
    "run_documents",
    "(SELECT COUNT(*) FROM documents WHERE org_id = ?org AND case_id = ? AND id IN (SELECT value FROM json_each(?))) = ?",
    [caseId, JSON.stringify(docIds), docIds.length],
    () => D.runStale(),
  );
  t.run("UPDATE extraction_runs SET is_current = 0 WHERE org_id = ?org AND case_id = ?1 AND is_current = 1", caseId);
  t.run(
    `INSERT INTO extraction_runs (org_id, id, case_id, producer, seeded, schema, supersedes, model, prompt_version, temperature, input_hashes_json, r2_key, sha256,
       is_current, created_at)
     VALUES (?org, ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, 1, strftime('%Y-%m-%dT%H:%M:%fZ','now'))`,
    run.run.id,
    caseId,
    run.run.producer,
    opts.seeded ? 1 : 0,
    EXTRACTION_SCHEMA,
    run.run.supersedes,
    opts.model ?? null,
    opts.promptVersion ?? null,
    opts.temperature ?? null,
    JSON.stringify(opts.inputHashes ?? {}),
    key,
    sha,
  );
  // An ID registered by an earlier run keeps its first run; the trigger refuses any change to an issued ID.
  t.run(
    `INSERT INTO fact_ids (org_id, case_id, fact_id, first_run_id) SELECT ?org, ?1, value, ?2 FROM json_each(?3) WHERE 1
     ON CONFLICT (org_id, case_id, fact_id) DO NOTHING`,
    caseId,
    run.run.id,
    JSON.stringify(run.facts.map((f) => f.id)),
  );
  t.run(
    `INSERT INTO alert_identities (org_id, case_id, id, rule, subject, kind, first_run_id)
     SELECT ?org, ?1, json_extract(value, '$.id'), json_extract(value, '$.rule'), json_extract(value, '$.subject'), json_extract(value, '$.kind'), ?2
     FROM json_each(?3) WHERE 1 ON CONFLICT (org_id, case_id, id) DO NOTHING`,
    caseId,
    run.run.id,
    JSON.stringify(run.alerts.map((a) => ({ id: a.id, rule: a.rule, subject: a.subject, kind: a.kind }))),
  );
  return { r2_key: key, sha256: sha };
}

/**
 * The facts of a run whose doctor confirmation still stands for the value this run holds (confirmations.ts state
 * "confirmed"). A confirmation of another value ("changed": a re-extraction read it differently) does not count, so the
 * brief never states a value nobody confirmed as verified. Used for composeBrief's `confirmed`.
 */
export async function confirmedFactIds(db: D1Database, org: string, run: ExtractionRun): Promise<string[]> {
  const rows = (
    await orgStmt(db, org, "SELECT fact_id, action, value_sha256 FROM fact_confirmations WHERE org_id = ?org AND case_id = ?1 ORDER BY at, id", run.case_id).all<{
      fact_id: string;
      action: ConfirmAction;
      value_sha256: string;
    }>()
  ).results;
  const byFact = new Map<string, typeof rows>();
  for (const r of rows) byFact.set(r.fact_id, [...(byFact.get(r.fact_id) ?? []), r]);
  const out: string[] = [];
  for (const f of run.facts) {
    const mine = byFact.get(f.id);
    // A quarantined fact is never confirmed (EXTRACTION-FORMAT.md); a stale row must not make it verified either.
    if (!mine || f.quarantined) continue;
    if (confirmationState(mine, await sha256Hex(confirmedContent(f))) === "confirmed") out.push(f.id);
  }
  return out;
}

/** One row of the case's question basis as the question box shows it (cases.question_basis_json). */
export type QuestionBasisRow = { role: string; quote: string; source: { file: string; page: number } };

/**
 * The drafted question's basis as quotes: for each basis fact, its first passage in a document, so the question box
 * shows what the draft rests on and can open it. `fileOf` names a document's file as the case view keys it.
 */
export function questionBasisRows(run: ExtractionRun, fileOf: (documentId: string) => string): QuestionBasisRow[] {
  const facts = new Map(run.facts.map((f) => [f.id, f]));
  const sources = new Map(run.sources.map((s) => [s.id, s]));
  return (run.question_draft?.basis ?? []).flatMap((b) =>
    b.facts.flatMap((id) => {
      const src = facts.get(id)?.sources.map((s) => sources.get(s)).find((s) => s?.type === "document");
      return src?.type === "document" ? [{ role: b.role, quote: src.quote, source: { file: fileOf(src.document_id), page: src.page } }] : [];
    }),
  );
}

/**
 * Queues the run's drafted MDT question onto the case (cases.question_draft, shown as a draft until a doctor confirms
 * it). Only for a case whose referral states no question, never over a draft a doctor has confirmed and never under a
 * question a doctor has edited (fact_edits key "q"): new documents may update a draft, never what a doctor confirmed or
 * wrote (CLAUDE.md). A run without a draft clears the earlier unconfirmed draft, so a question that rests on documents
 * since read differently does not stay on the case.
 */
export function queueQuestionDraft(t: Tx, run: ExtractionRun, fileOf: (documentId: string) => string): void {
  const d = run.question_draft;
  t.run(
    `UPDATE cases SET question_draft = ?2, question_kind = ?3, question_basis_json = ?4
     WHERE org_id = ?org AND id = ?1 AND question_explicit = 0
       AND NOT EXISTS (SELECT 1 FROM question_confirmations q WHERE q.org_id = cases.org_id AND q.case_id = cases.id AND q.text = cases.question_draft)
       AND NOT EXISTS (SELECT 1 FROM fact_edits e WHERE e.org_id = cases.org_id AND e.case_id = cases.id AND e.key = 'q')`,
    run.case_id,
    d?.text ?? null,
    d?.question_kind ?? null,
    d ? JSON.stringify(questionBasisRows(run, fileOf)) : null,
  );
}
