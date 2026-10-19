// The one interface the Worker uses to send case content to an external language model (issue #20, stream D).
// Built to run inside a Workflow step; the extraction prompts (phase 2) call it.
//
// What every call goes through, in this order:
// 1. Configuration only: provider, endpoint, model and key come from vars and secrets (MODEL_*), never from code, so
//    moving from the hackathon Azure gateway to another EU model is a configuration change.
// 2. The prompt by ID from the repository (src/prompts), with its version and SHA-256.
// 3. Pseudonymization of every text part (domain/pseudonymize.ts) with the case's identity and the org's staff; the
//    mapping stays in this isolate's memory and is returned to the caller, never sent, stored or logged.
// 4. A gate over the whole payload: any identifier of the case or the staff, any birth number, phone or e-mail left
//    anywhere in it (prompt included) refuses the call. Images must be RedactedPage objects of the same org and case.
// 5. The output cache in R2, keyed by org, case, model, prompt version, prompt hash and input hash: a hit sends
//    nothing.
// 6. The budget (pages per org, per case and per page in a time window) and the audit, committed in one D1 batch
//    before the first attempt: one access-log row per page sent (which document and page, which provider, no patient
//    text) and one `model_calls` row, which gets the attempt count and outcome afterwards (the access log is
//    append-only).
// 7. The call, retried on 429 and 503 with backoff that honours Retry-After, within a deadline below the step timeout.
//    What is left over is the Workflow step's retry policy: `forStep` turns a final error into NonRetryableError.
//
// Logs carry the purpose, prompt reference, upstream status, attempts, duration and counts; never text or images.
import { NonRetryableError } from "cloudflare:workflows";
import type { Viewer } from "@codebridge/domain/access";
import type { CaseIdentity, Pseudonymized } from "../domain/pseudonymize";
import { buildPayload, ModelError, type ModelErrorCode } from "./model-payload";
import { loadPrompt, type LoadedPrompt, type PromptId } from "../prompts";
import { orgStmt } from "../store/sql";
import { cacheKey, cacheScope } from "./model-cache";
import { sha256Hex } from "../store/work";
import { Tx } from "../store/write";
import { RedactedPage, toBase64 } from "./redaction";
import { fetchWithRetry } from "./retry";

export { ModelError, type ModelErrorCode } from "./model-payload";

// Inside a Workflow step: a final error stops the step's retries; a retryable one leaves them to the step's policy.
export function forStep(e: unknown): Error {
  if (e instanceof ModelError) return e.retryable ? new Error(`model:${e.code}`) : new NonRetryableError(`model:${e.code}`);
  return e instanceof Error ? e : new Error("model:internal");
}

// The step settings a model call is meant to run under: the in-process retries stop at MODEL_DEADLINE_MS (default
// 150 s), below this timeout, and the step's own retries then back off for longer than one Retry-After.
export const MODEL_STEP = { retries: { limit: 3, delay: "30 seconds", backoff: "exponential" }, timeout: "5 minutes" } as const;

type Provider = { secret: keyof Env | "MODEL_API_KEY"; headers: (key: string) => Record<string, string> };
// Each provider names its secret and how the key is sent. A new EU provider with an OpenAI-compatible API needs only
// MODEL_PROVIDER=openai-compatible, MODEL_BASE, MODEL_NAME and the MODEL_API_KEY secret.
const PROVIDERS: Record<string, Provider> = {
  "azure-openai": { secret: "AZURE_OPENAI_KEY", headers: (k) => ({ "api-key": k }) },
  "openai-compatible": { secret: "MODEL_API_KEY", headers: (k) => ({ authorization: `Bearer ${k}` }) },
};

type Vars = Record<string, string | undefined>;
const num = (v: string | undefined, fallback: number) => {
  const n = Number(v);
  return v !== undefined && v !== "" && Number.isFinite(n) && n > 0 ? n : fallback;
};

export function modelConfig(env: Env) {
  const v = env as unknown as Vars;
  const provider = PROVIDERS[v.MODEL_PROVIDER ?? ""];
  if (!provider || !v.MODEL_BASE || !v.MODEL_NAME) throw new ModelError("misconfigured", false);
  const key = v[provider.secret as string];
  // No key: the model is off for this deployment, which is a state, not a failure to retry.
  if (!key) throw new ModelError("model_off", false);
  return {
    provider: v.MODEL_PROVIDER!,
    url: `${v.MODEL_BASE.replace(/\/+$/, "")}/chat/completions`,
    model: v.MODEL_NAME,
    headers: { ...provider.headers(key), "content-type": "application/json" },
    reasoningEffort: v.MODEL_REASONING_EFFORT || null,
    attempts: num(v.LLM_MAX_ATTEMPTS, 4),
    baseMs: num(v.LLM_RETRY_BASE_MS, 1000),
    maxWaitMs: num(v.MODEL_MAX_RETRY_WAIT_MS, 20000),
    timeoutMs: num(v.MODEL_TIMEOUT_MS, 120000),
    deadlineMs: num(v.MODEL_DEADLINE_MS, 150000),
    maxInputChars: num(v.MODEL_MAX_INPUT_CHARS, 200000),
    maxImageBytes: num(v.MODEL_MAX_IMAGE_BYTES, 4000000),
    maxOutputTokens: num(v.MODEL_MAX_OUTPUT_TOKENS, 8000),
    budget: {
      windowHours: num(v.MODEL_BUDGET_WINDOW_HOURS, 24),
      pagesPerOrg: num(v.MODEL_BUDGET_PAGES_PER_ORG, 600),
      pagesPerCase: num(v.MODEL_BUDGET_PAGES_PER_CASE, 80),
      callsPerPage: num(v.MODEL_BUDGET_CALLS_PER_PAGE, 4),
    },
  };
}

// docId is the `documents.id` of the case's document (never a file name, fixture or part ID): the cache folder and the
// purge on withdraw (model-cache.ts) go by it.
export type PageRef = { docId: string; page: number | null };

export type ModelRequest = {
  org: string;
  caseId: string;
  // Who the call is made for (the person who started the run), as the access log records it.
  actor: Viewer;
  // A short code for the access log and model_calls ("read_page", "extract_facts").
  purpose: string;
  prompt: PromptId;
  identity: CaseIdentity;
  // Original text; pseudonymized here. Each part names the page it comes from, for the audit and the budget.
  text?: { ref: PageRef; text: string }[];
  images?: RedactedPage[];
  maxOutputTokens?: number;
};

export type ModelMeta = {
  provider: string;
  model: string;
  prompt: string; // "read-page-cs@1"
  prompt_sha256: string;
  temperature: null; // the gateway's model accepts only its default (docs/research/2026-10-19-azure-gateway-check.md)
  input_sha256: string;
  cached: boolean;
  call_id: string | null;
};

export type ModelResult = {
  // The model's answer, still pseudonymized: placeholders such as [PACIENT] stay until the caller maps a quote back
  // with `pseudonymized[i].originalRange` (domain/pseudonymize.ts). Its mapping is in private fields, so returning
  // this result from a Workflow step stores no name; still, return the stored output's R2 key instead.
  output: string;
  json: unknown;
  pseudonymized: Pseudonymized[];
  meta: ModelMeta;
};

export { cacheKey, cachePrefixesOf, cacheScope } from "./model-cache";

const iso = () => new Date().toISOString();

export async function callModel(env: Env, req: ModelRequest): Promise<ModelResult> {
  const cfg = modelConfig(env);
  const prompt = await loadPrompt(req.prompt);
  const images = req.images ?? [];
  if (images.length && !prompt.images) throw new ModelError("image_not_redacted", false);
  for (const im of images) {
    // Only a page that went through the redaction for this org and case may leave as an image.
    if (!(im instanceof RedactedPage) || im.org !== req.org || im.caseId !== req.caseId) throw new ModelError("image_not_redacted", false);
    if (im.png.byteLength > cfg.maxImageBytes) throw new ModelError("too_large", false);
  }

  const { body, parts, chars } = buildPayload({
    prompt,
    text: req.text ?? [],
    imagesBase64: images.map((im) => toBase64(im.png)),
    identity: req.identity,
    model: cfg.model,
    maxOutputTokens: req.maxOutputTokens ?? cfg.maxOutputTokens,
    reasoningEffort: cfg.reasoningEffort,
    maxInputChars: cfg.maxInputChars,
    purpose: req.purpose,
  });

  const payload = JSON.stringify(body);
  const inputSha = await sha256Hex(payload);
  const scope = cacheScope([...(req.text ?? []).map((t) => t.ref.docId), ...images.map((im) => im.docId)]);
  const key = cacheKey(req.org, req.caseId, scope, cfg.model, prompt, inputSha);
  const meta: ModelMeta = { provider: cfg.provider, model: cfg.model, prompt: prompt.ref, prompt_sha256: prompt.sha256, temperature: null, input_sha256: inputSha, cached: false, call_id: null };

  const hit = await (await env.DOCS.get(key))?.json<{ output: string }>().catch(() => null);
  const hitJson = hit && typeof hit.output === "string" ? parseOutput(hit.output, !!prompt.schema) : undefined;
  // A cache entry that does not parse is treated as a miss and overwritten.
  if (hit && hitJson !== undefined) {
    console.log(JSON.stringify({ route: "model", purpose: req.purpose, prompt: prompt.ref, cached: true }));
    return { output: hit.output, json: hitJson, pseudonymized: parts.map((x) => x.p), meta: { ...meta, cached: true } };
  }

  const refs = pageRefs(req, images);
  const callId = crypto.randomUUID();
  meta.call_id = callId;
  await commitBudgetAndAudit(env, req, cfg, prompt, { callId, refs, images: images.length, chars, inputSha });

  const started = Date.now();
  let res: Response;
  let attempts: number;
  try {
    ({ res, attempts } = await fetchWithRetry(cfg.url, { method: "POST", headers: cfg.headers, body: payload }, {
      attempts: cfg.attempts,
      baseMs: cfg.baseMs,
      maxDelayMs: cfg.maxWaitMs,
      timeoutMs: cfg.timeoutMs,
      deadlineMs: cfg.deadlineMs,
    }));
  } catch (e) {
    const n = (e as { attempts?: number }).attempts ?? 1;
    await finish(env, req.org, callId, { state: "error", attempts: n, status: null, code: "network", ms: Date.now() - started });
    console.log(JSON.stringify({ route: "model", purpose: req.purpose, prompt: prompt.ref, upstream: "network", attempts: n, ms: Date.now() - started }));
    throw new ModelError("network", true, "network");
  }
  const ms = Date.now() - started;
  console.log(JSON.stringify({ route: "model", purpose: req.purpose, prompt: prompt.ref, upstream: res.status, attempts, ms, pages: refs.length, images: images.length }));

  const fail = async (code: ModelErrorCode, retryable: boolean) => {
    if (!res.bodyUsed) await res.body?.cancel();
    await finish(env, req.org, callId, { state: "error", attempts, status: res.status, code, ms });
    return new ModelError(code, retryable, res.status);
  };
  if (res.status === 429 || res.status === 503) throw await fail("busy", true);
  if (res.status === 401 || res.status === 403 || res.status === 404) throw await fail("misconfigured", false);
  if (res.status >= 500) throw await fail("upstream_error", true);
  if (!res.ok) throw await fail(res.status === 413 ? "too_large" : "refused", false);

  let d: { choices?: { message?: { content?: string | null }; finish_reason?: string }[] } | null = null;
  try {
    d = await res.json();
  } catch {
    d = null;
  }
  const choice = d?.choices?.[0];
  const output = choice?.message?.content ?? null;
  // The provider's content filter answers the same way every time: not worth a retry.
  if (choice?.finish_reason === "content_filter") throw await fail("refused", false);
  // A cut-off answer would look complete; it is refused, and a longer limit is a prompt or config change.
  if (output === null || choice?.finish_reason === "length") throw await fail("bad_output", choice?.finish_reason !== "length");
  const json = parseOutput(output, !!prompt.schema);
  if (json === undefined) throw await fail("bad_output", true);
  await finish(env, req.org, callId, { state: "done", attempts, status: res.status, code: null, ms });
  await env.DOCS.put(key, JSON.stringify({ output, ...meta, cached: undefined, created_at: iso() }), { httpMetadata: { contentType: "application/json" } });
  return { output, json, pseudonymized: parts.map((x) => x.p), meta };
}

// The answer as JSON for a prompt with a schema (undefined when it does not parse), null for a text prompt.
function parseOutput(output: string, schema: boolean): unknown {
  if (!schema) return null;
  try {
    return JSON.parse(output);
  } catch {
    return undefined;
  }
}

// The pages a call sends, once each: a page as text and as an image is still one page sent.
function pageRefs(req: ModelRequest, images: RedactedPage[]): PageRef[] {
  const seen = new Map<string, PageRef>();
  for (const r of [...(req.text ?? []).map((t) => t.ref), ...images.map((im) => ({ docId: im.docId, page: im.n }))]) seen.set(`${r.docId}\u0000${r.page}`, r);
  return [...seen.values()];
}

type Cfg = ReturnType<typeof modelConfig>;

async function commitBudgetAndAudit(env: Env, req: ModelRequest, cfg: Cfg, prompt: LoadedPrompt, c: { callId: string; refs: PageRef[]; images: number; chars: number; inputSha: string }) {
  const since = new Date(Date.now() - cfg.budget.windowHours * 3600_000).toISOString();
  const n = Math.max(1, c.refs.length);
  const tx = new Tx(env.DB, req.actor, { requestId: null, epoch: null });
  tx.guard(
    "model_budget_org",
    "(SELECT COALESCE(SUM(pages), 0) FROM model_calls WHERE org_id = ?org AND created_at > ?) + ? <= ?",
    [since, n, cfg.budget.pagesPerOrg],
    () => new ModelError("budget_org", false),
  );
  tx.guard(
    "model_budget_case",
    "(SELECT COUNT(*) FROM access_log WHERE org_id = ?org AND case_id = ? AND action = 'model.call' AND at > ?) + ? <= ?",
    [req.caseId, since, n, cfg.budget.pagesPerCase],
    () => new ModelError("budget_case", false),
  );
  for (const r of c.refs) {
    // A part without a page number (a whole short document) is budgeted as that document's page "none".
    tx.guard(
      "model_budget_page",
      "(SELECT COUNT(*) FROM access_log WHERE org_id = ?org AND case_id = ? AND action = 'model.call' AND document_id = ? AND page_n IS ? AND at > ?) < ?",
      [req.caseId, r.docId, r.page, since, cfg.budget.callsPerPage],
      () => new ModelError("budget_page", false),
    );
  }
  tx.run(
    `INSERT INTO model_calls (org_id, id, case_id, purpose, prompt_ref, prompt_sha256, provider, model, input_sha256, pages, images, input_chars, state, created_at)
     VALUES (?org, ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, 'sending', ?12)`,
    c.callId, req.caseId, req.purpose, prompt.ref, prompt.sha256, cfg.provider, cfg.model, c.inputSha, n, c.images, c.chars, iso(),
  );
  // One row per page sent, written before the first attempt: a call that dies mid-flight is still on record.
  const what = `Odesláno jazykovému modelu (${cfg.provider}, ${cfg.model}): ${req.purpose}, ${prompt.ref}`;
  const imagePages = new Set(c.refs.length ? (req.images ?? []).map((im) => `${im.docId}\u0000${im.n}`) : []);
  for (const r of c.refs.length ? c.refs : [{ docId: null, page: null }]) {
    const asImage = r.docId !== null && imagePages.has(`${r.docId}\u0000${r.page}`);
    tx.audit({ action: "model.call", what_cs: asImage ? `${what}, obraz strany po začernění` : what, case_id: req.caseId, document_id: r.docId, page_n: r.page, target_type: "model_call", target_id: c.callId });
  }
  await tx.commit();
}

async function finish(env: Env, org: string, callId: string, r: { state: "done" | "error"; attempts: number; status: number | null; code: ModelErrorCode | null; ms: number }) {
  // The outcome row is bookkeeping: a failure to write it must not hide the call's own result or error. The row then
  // stays 'sending', and the access-log rows already record that the pages were sent.
  try {
    await orgStmt(env.DB, org, "UPDATE model_calls SET state = ?1, attempts = ?2, upstream_status = ?3, error_code = ?4, ms = ?5, finished_at = ?6 WHERE org_id = ?org AND id = ?7", r.state, r.attempts, r.status, r.code, r.ms, iso(), callId).run();
  } catch {
    console.log(JSON.stringify({ route: "model", store: "model_call_outcome_failed" }));
  }
}
