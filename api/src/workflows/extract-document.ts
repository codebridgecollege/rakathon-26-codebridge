// ExtractDocumentWorkflow (issue #20): the AI part of one document's processing, after the pipeline's run
// (ProcessDocumentWorkflow) and on its outputs. The contract with the case merge is
// docs/research/2026-10-20-case-merge-contract.md.
//
// Steps:
// 1. plan: which pages the vision model reads (domain/extract/plan.ts), and the document's parts;
// 2. read p<n>, one step per page that needs it: the page image redacted by the page reader (/v1/redact, names from the
//    case record and the org's staff), read by the model (read-page-cs), compared with Tesseract's words (/v1/compare);
//    the reading goes to R2 as p<n>.vision.json;
// 3. extract <part>, one step per part: the part's page readings, pseudonymized, to the model (extract-facts-cs); the
//    pseudonymized answer goes to R2 as ai-part-<ordinal>.json;
// 4. fragment: the answers checked against the readings (domain/extract/build.ts draftDocument), each fact's
//    quarantine from the pipeline's identity per page, written as fragment-ai.json;
// 5. case: starts the case merge (PROCESS_CASE), which composes this fragment with the pipeline's into the case run.
//
// Every model call goes through callModel: pseudonymization, the gate, the audit row per page, the budget and the cache.
// A call the budget, the content filter or the provider refuses leaves its page or part unread (listed as such in the
// fragment's checks), never failed silently and never "nothing found"; a busy provider is retried by the step.
//
// Privacy: params and step results hold IDs, counts and fixed codes only; readings, answers and the fragment live in R2
// (EU) under the pipeline run's prefix, which a withdraw of the document deletes. The pseudonymization mapping is never
// stored: the fragment step rebuilds it from the same texts (model-payload.ts pseudonymizeParts).
import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from "cloudflare:workers";
import { NonRetryableError } from "cloudflare:workflows";
import type { IdentityResult } from "@codebridge/domain/extraction/types";
import { aiFragmentIds, draftDocument, type CallAnswer, type PageReading } from "../domain/extract/build";
import { needsVision, readingFor, shortReading, type PageFacts } from "../domain/extract/plan";
import type { ModelAnswer } from "../domain/extract/schema";
import { loadPrompt } from "../prompts";
import { callModel, forStep, MODEL_STEP, ModelError, modelConfig } from "../services/model";
import { pseudonymizeParts } from "../services/model-payload";
import { pageReader, poolInstance, type PageRecord, type RawPage, type Readability } from "../services/page-reader";
import { redactPages } from "../services/redaction";
import { actorFor } from "../store/audio";
import { loadCaseIdentity } from "../store/identity";
import { orgStmt } from "../store/sql";
import { sha256Hex } from "../store/work";

export type ExtractDocumentParams = { org: string; caseId: string; docId: string; runId: string };

const STEP = { retries: { limit: 3, delay: "5 seconds", backoff: "exponential" }, timeout: "2 minutes" } as const;
// The extraction asks for a long JSON answer (a page can hold dozens of facts); the reading for a page's text.
const EXTRACT_TOKENS = 24000;
const READ_TOKENS = 8000;

/** Whether the AI extraction runs for an org: the model configured, and the org listed in MODEL_ORGS ("*": all). */
export function modelOn(env: Env, org: string): boolean {
  try {
    modelConfig(env);
  } catch {
    return false;
  }
  const list = String((env as unknown as Record<string, string | undefined>).MODEL_ORGS ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  return list.includes("*") || list.includes(org);
}

/** Starts the extraction of a document whose pipeline run is done (called at the end of that run). */
export async function startExtraction(env: Env, p: ExtractDocumentParams): Promise<boolean> {
  const wf = (env as unknown as { EXTRACT_DOCUMENT?: Workflow<ExtractDocumentParams> }).EXTRACT_DOCUMENT;
  if (!wf || !modelOn(env, p.org)) return false;
  await wf.create({ id: `ai-${p.runId}`, params: p });
  return true;
}

type RunRow = { output_prefix: string; state: string; input_sha256: string; created_by: string; created_by_actor: string | null; document_id: string; case_id: string };
type PartRef = { id: string; ordinal: number; pages: number[] };
type VisionReading = { text: string; verify: [number, number][]; engine: string };

const json = async <T>(env: Env, key: string): Promise<T | null> => (await env.DOCS.get(key))?.json<T>() ?? null;
const putJson = (env: Env, key: string, v: unknown) => env.DOCS.put(key, JSON.stringify(v), { httpMetadata: { contentType: "application/json" } });

async function runOf(env: Env, p: ExtractDocumentParams): Promise<RunRow> {
  const r = await orgStmt(
    env.DB,
    p.org,
    `SELECT r.output_prefix, r.state, r.input_sha256, r.created_by, r.created_by_actor, r.document_id, r.case_id
       FROM pipeline_runs r JOIN documents d ON d.org_id = r.org_id AND d.id = r.document_id
      WHERE r.org_id = ?org AND r.id = ?1 AND d.lifecycle = 'current'
        AND NOT EXISTS (SELECT 1 FROM pipeline_runs n WHERE n.org_id = r.org_id AND n.document_id = r.document_id AND n.state = 'done' AND n.created_at > r.created_at)`,
    p.runId,
  ).first<RunRow>();
  // A document withdrawn or replaced meanwhile is not read any more (its outputs are being deleted), and a newer
  // pipeline run of the document makes this one's outputs stale: its own extraction follows it.
  if (!r || r.state !== "done" || r.document_id !== p.docId || r.case_id !== p.caseId) throw new NonRetryableError("run_not_current");
  return r;
}

const actorOf = (env: Env, p: ExtractDocumentParams, run: RunRow) => actorFor(env.DB, p.org, run.created_by, env.AUTH_MODE === "oidc" ? "oidc" : "demo", run.created_by_actor);

async function pageCount(env: Env, prefix: string): Promise<number> {
  const rb = await json<{ pages: { n: number }[] }>(env, `${prefix}readability.json`);
  if (!rb) throw new NonRetryableError("output_missing");
  return rb.pages.length;
}

async function pageFacts(env: Env, prefix: string, n: number): Promise<PageFacts & { rec: PageRecord & { readability: Readability }; raw: Omit<RawPage, "png_b64"> }> {
  const [rec, raw] = await Promise.all([json<PageRecord & { readability: Readability }>(env, `${prefix}p${n}.json`), json<Omit<RawPage, "png_b64">>(env, `${prefix}p${n}.raw.json`)]);
  if (!rec || !raw) throw new NonRetryableError("output_missing");
  return { n, level: rec.readability.level, disagreements: rec.verify.length, layerChars: (raw.layer_text ?? "").trim().length, rec, raw };
}

// The document's parts as the pipeline split it (parts.json); without a split, the whole document is one part.
async function partsOf(env: Env, prefix: string, docId: string, n: number): Promise<PartRef[]> {
  const split = await json<{ parts: { ordinal: number; pages: number[] }[] }>(env, `${prefix}parts.json`);
  // Each ordinal once (step names come from it), and only pages the document has.
  const seen = new Set<number>();
  const parts = (split?.parts ?? [])
    .filter((x) => Number.isInteger(x.ordinal) && !seen.has(x.ordinal) && (seen.add(x.ordinal), true))
    .map((x) => ({ ordinal: x.ordinal, pages: [...new Set((x.pages ?? []).filter((k) => Number.isInteger(k) && k >= 1 && k <= n))].sort((a, b) => a - b) }))
    .filter((x) => x.pages.length);
  if (!parts.length) return [{ id: `${docId}/p0`, ordinal: 0, pages: Array.from({ length: n }, (_, i) => i + 1) }];
  return parts.map((x) => ({ id: `${docId}/p${x.ordinal}`, ordinal: x.ordinal, pages: x.pages }));
}

async function readingOf(env: Env, prefix: string, n: number) {
  const f = await pageFacts(env, prefix, n);
  const vision = await json<VisionReading>(env, `${prefix}p${n}.vision.json`);
  return { f, reading: readingFor({ vision, layerText: f.raw.layer_text ?? "", tessText: f.rec.text, tessVerify: f.rec.verify, tessEngine: "tesseract" }) };
}

// A model refusal that waiting will not change (budget, content filter, a refused request) leaves the page or part
// unread; one that waiting may change is the step's retry.
function settle(e: unknown): string {
  if (e instanceof ModelError && !e.retryable) return e.code;
  throw forStep(e);
}

export class ExtractDocumentWorkflow extends WorkflowEntrypoint<Env, ExtractDocumentParams> {
  async run(event: WorkflowEvent<ExtractDocumentParams>, step: WorkflowStep) {
    const p = event.payload;
    const env = this.env;

    const plan = await step.do("plan", STEP, async () => {
      const run = await runOf(env, p);
      const n = await pageCount(env, run.output_prefix);
      // A page that shows another patient is never sent to the model, as text or image: the pseudonymization knows the
      // case's identifiers, not the other patient's. It stays unread here; the pipeline's fragment keeps its facts
      // quarantined and raises the identity alert.
      const ident = await json<{ pages?: { n: number; result: IdentityResult }[] }>(env, `${run.output_prefix}identity.json`);
      const foreign = (ident?.pages ?? []).filter((x) => x.result === "conflicts").map((x) => x.n);
      const vision: number[] = [];
      for (let k = 1; k <= n; k++) if (!foreign.includes(k) && needsVision(await pageFacts(env, run.output_prefix, k))) vision.push(k);
      const parts = (await partsOf(env, run.output_prefix, p.docId, n)).map((x) => ({ ...x, pages: x.pages.filter((k) => !foreign.includes(k)) }));
      return { pages: n, vision, parts: parts.filter((x) => x.pages.length), foreign };
    });

    const unread: Record<string, string> = {};
    // A step whose retries run out (the shared endpoint stays busy, the page reader is down) leaves its page or part
    // unread with a fixed code; the fragment is still written and the case merge still starts.
    const stepped = async <T>(name: string, f: () => Promise<T>, fallback: T): Promise<T> => {
      try {
        // The step results here are plain objects of IDs, counts and codes; the engine's Serializable typing is generic.
        return (await step.do(name, MODEL_STEP, f as never)) as T;
      } catch {
        return fallback;
      }
    };
    for (const n of plan.vision) {
      const r = await stepped(`read p${n}`, async () => {
        const run = await runOf(env, p);
        const identity = await loadCaseIdentity(env.DB, p.org, p.caseId);
        const f = await pageFacts(env, run.output_prefix, n);
        const img = await env.DOCS.get(`${run.output_prefix}p${n}.png`);
        if (!img) throw new NonRetryableError("output_missing");
        const [page] = await redactPages(env, { org: p.org, caseId: p.caseId, docId: p.docId, identity }, [{ n, png: new Uint8Array(await img.arrayBuffer()), words: f.rec.words }]);
        let text: string;
        try {
          const ans = await callModel(env, { org: p.org, caseId: p.caseId, actor: await actorOf(env, p, run), purpose: "read_page", prompt: "read-page-cs", identity, images: [page!], text: [], maxOutputTokens: READ_TOKENS });
          text = ans.output;
        } catch (e) {
          return { n, code: settle(e) };
        }
        const cmp = await pageReader.compare(env, poolInstance(p.caseId), [{ n, text, words: f.rec.words }]);
        let verify = (cmp.pages[0]?.verify ?? []).map((v) => [v.start, v.end] as [number, number]);
        if (shortReading(text, f.rec.words.length)) verify = [[0, text.length]];
        const prompt = await loadPrompt("read-page-cs");
        const reading: VisionReading = { text, verify, engine: `vision ${modelConfig(env).model} ${prompt.ref}` };
        await putJson(env, `${run.output_prefix}p${n}.vision.json`, reading);
        return { n, code: null as string | null, marks: verify.length };
      }, { n, code: "busy", marks: 0 });
      // A page the model did not read keeps its local reading; it is not "unread" for the extraction.
      if (r.code) unread[`p${n}`] = r.code;
    }

    const unreadParts: number[] = [];
    for (const part of plan.parts) {
      const r = await stepped(`extract ${part.id}`, async () => {
        const run = await runOf(env, p);
        const identity = await loadCaseIdentity(env.DB, p.org, p.caseId);
        const texts = await Promise.all(part.pages.map(async (n) => ({ ref: { docId: p.docId, page: n }, text: (await readingOf(env, run.output_prefix, n)).reading.text })));
        try {
          const ans = await callModel(env, { org: p.org, caseId: p.caseId, actor: await actorOf(env, p, run), purpose: "extract_facts", prompt: "extract-facts-cs", identity, text: texts, maxOutputTokens: EXTRACT_TOKENS });
          // The schema is strict, but an answer without its facts list is refused here, not in the fragment step.
          const facts = (ans.json as ModelAnswer | null)?.facts;
          if (!Array.isArray(facts)) return { part: part.ordinal, code: "bad_output" as string | null, facts: 0 };
          // The identity the texts were pseudonymized with, by hash: the fragment step rebuilds the mapping from the
          // case record and must find the same one, or the placeholders in the quotes would map to other words.
          await putJson(env, `${run.output_prefix}ai-part-${part.ordinal}.json`, { pages: part.pages, output: ans.output, prompt: ans.meta.prompt, model: ans.meta.model, identity_sha256: await sha256Hex(JSON.stringify(identity)) });
          return { part: part.ordinal, code: null as string | null, facts: facts.length };
        } catch (e) {
          return { part: part.ordinal, code: settle(e), facts: 0 };
        }
      }, { part: part.ordinal, code: "busy", facts: 0 });
      if (r.code) unreadParts.push(part.ordinal);
    }

    const frag = await step.do("fragment", STEP, async () => {
      const run = await runOf(env, p);
      const identity = await loadCaseIdentity(env.DB, p.org, p.caseId);
      const identitySha = await sha256Hex(JSON.stringify(identity));
      const ident = await json<{ pages?: { n: number; result: IdentityResult }[] }>(env, `${run.output_prefix}identity.json`);
      const pageIdentity = new Map((ident?.pages ?? []).map((x) => [x.n, x.result]));
      // Every page of the document, in order; a page missing from identity.json cannot be verified.
      const pages: PageReading[] = [];
      for (let n = 1; n <= plan.pages; n++) {
        const { f, reading } = await readingOf(env, run.output_prefix, n);
        pages.push({ page: n, text: reading.text, quoteText: reading.quoteText, engine: reading.engine, words: f.rec.words, readability: f.level, verify: reading.verify, identity: pageIdentity.get(n) ?? "cannot_verify" });
      }
      const calls: CallAnswer[] = [];
      const unreadPages: number[] = [];
      // Pages of another patient were not sent: unread.
      unreadPages.push(...plan.foreign.map((n) => n - 1));
      for (const part of plan.parts) {
        const idx = part.pages.map((n) => n - 1);
        const ans = unreadParts.includes(part.ordinal) ? null : await json<{ output: string; identity_sha256?: string }>(env, `${run.output_prefix}ai-part-${part.ordinal}.json`);
        let answer: ModelAnswer | null = null;
        try {
          if (ans && ans.identity_sha256 === identitySha) answer = JSON.parse(ans.output) as ModelAnswer;
        } catch {
          // A stored answer that does not parse is read as no answer; its message would quote the answer.
          answer = null;
        }
        if (!answer || !Array.isArray(answer.facts)) {
          unreadPages.push(...idx);
          continue;
        }
        calls.push({ pages: idx, part: part.id, parts: pseudonymizeParts(idx.map((i) => pages[i]!.text), identity), answer });
      }
      const allParts = await partsOf(env, run.output_prefix, p.docId, plan.pages);
      const partOf = (i: number) => allParts.find((x) => x.pages.includes(i + 1))?.id ?? null;
      const d = await draftDocument({ doc: { documentId: p.docId, part: null, pages }, calls, unreadPages, ids: aiFragmentIds(p.docId), partOf });
      const [readPrompt, extractPrompt] = await Promise.all([loadPrompt("read-page-cs"), loadPrompt("extract-facts-cs")]);
      const model = modelConfig(env).model;
      const stages = [
        ...(plan.vision.length ? [{ name: "read_pages", model, prompt: readPrompt.ref, prompt_sha256: readPrompt.sha256, temperature: null }] : []),
        { name: "extract_facts", model, prompt: extractPrompt.ref, prompt_sha256: extractPrompt.sha256, temperature: null },
      ];
      await putJson(env, `${run.output_prefix}fragment-ai.json`, {
        schema: "codebridge.fragment/1",
        producer: "ai",
        document_id: p.docId,
        document_sha256: run.input_sha256,
        pipeline_run: p.runId,
        // The document's part IDs, as stream B's Fragment type (packages/domain fragments.ts) lists them.
        parts: allParts.map((x) => x.id),
        stages,
        sources: d.sources,
        facts: d.facts,
        checks: d.checks,
        alerts: [],
      });
      return { facts: d.facts.length, verify: d.report.verify, quarantined: d.report.quarantined, dropped: Object.values(d.report.dropped).reduce((a, b) => a + (b ?? 0), 0), unread_pages: unreadPages.length };
    });

    await step.do("case", STEP, async () => {
      const wf = (env as unknown as { PROCESS_CASE?: Workflow<{ org: string; caseId: string }> }).PROCESS_CASE;
      if (!wf) return { started: false };
      await wf.create({ id: `case-${p.caseId}-${Date.now()}`, params: { org: p.org, caseId: p.caseId } });
      return { started: true };
    });
    return { ...frag, read: plan.vision.length - Object.keys(unread).length, unread_codes: Object.values(unread) };
  }
}
