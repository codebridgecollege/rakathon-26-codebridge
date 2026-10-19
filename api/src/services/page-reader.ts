// The page reader service (step 6, slice b-1): pipeline/container/server.py, the deterministic page logic (render,
// Tesseract, the text layer as a second reading, readability, the lab parser) over HTTP, contract version 1.
//
// Two ways to reach it, in this order:
// - PAGE_READER_URL: a plain HTTP base URL. Local work runs the Python service natively (`cd pipeline && uv run python
//   container/server.py`, port 8080) and `wrangler dev` with PAGE_READER_URL=http://localhost:8080; the tests point it at a
//   mocked host.
// - PAGE_READER: the Cloudflare Container binding (a Durable Object namespace of class PageReader,
//   page-reader-container.ts), used when PAGE_READER_CONTAINER is "on" (the deployed Worker). Local workers, the tests
//   and the browser suite set it "off": wrangler dev runs no containers (`dev.enable_containers: false`), yet the
//   binding still exists, so its presence alone cannot say whether a container answers.
// Without either, the pipeline is off and the routes say so; uploads and intake never depend on it.
//
// Bodies are patient documents: nothing here logs a request or a response.

export class PageReaderError extends Error {
  constructor(
    public code: string,
    public status: number,
  ) {
    super(code);
  }
}

type Fetcher = { fetch(input: string, init?: RequestInit): Promise<Response> };
type Namespace = { getByName(name: string): Fetcher };

const containerOf = (env: Env): Namespace | null =>
  env.PAGE_READER_CONTAINER === "on" && env.PAGE_READER ? env.PAGE_READER : null;

// Whether the host can reach a page reader at all (/api/health's features.pipeline).
export const pipelineAvailable = (env: Env) => !!env.PAGE_READER_URL || !!containerOf(env);

// Whether the pipeline runs for an org: available, and the org listed in PIPELINE_ORGS (comma-separated org ids, "*"
// for every org). Demo org A is left out on the deployed host so the hackathon demo looks as it did before the
// pipeline (no processing states, no "Přečíst bez AI"); demo org B, the team's own test org, is in.
export function pipelineOn(env: Env, org: string): boolean {
  if (!pipelineAvailable(env)) return false;
  const list = String(env.PIPELINE_ORGS ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  return list.includes("*") || list.includes(org);
}

// A small pool of named instances, picked by case. One instance per document would start as many containers as documents
// in flight (an intake, a batch upload) and run into max_instances (page-reader.wrangler.jsonc); with the pool at most
// POOL_SIZE start. A case's documents share one warm instance and queue on it (server.py works one request at a time on
// half a vCPU), so the Workflow steps that call it wait with the OCR timeout; two cases can run side by side.
// POOL_SIZE must not exceed max_instances.
export const POOL_SIZE = 3;
export function poolInstance(caseId: string): string {
  // FNV-1a: a stable spread of case IDs over the pool. The name only routes the request and holds no patient data.
  let h = 0x811c9dc5;
  for (let i = 0; i < caseId.length; i++) h = Math.imul(h ^ caseId.charCodeAt(i), 0x01000193) >>> 0;
  return `pool-${h % POOL_SIZE}`;
}

// A container error code is a fixed code from server.py; anything else is reduced to the HTTP status.
const codeOf = (body: unknown, status: number) => {
  const c = (body as { error?: { code?: unknown } } | null)?.error?.code;
  return typeof c === "string" && /^[a-z_]{1,40}$/.test(c) ? c : `http_${status}`;
};

// instance: the pool instance's name (poolInstance); not used when PAGE_READER_URL is set.
export async function pageReaderFetch(env: Env, instance: string, path: string, init: RequestInit = {}): Promise<Response> {
  const base = env.PAGE_READER_URL?.replace(/\/$/, "");
  if (base) return fetch(base + path, init);
  const ns = containerOf(env);
  if (ns) return ns.getByName(instance).fetch(`http://page-reader${path}`, init);
  throw new PageReaderError("pipeline_off", 503);
}

export async function pageReaderJson<T>(env: Env, instance: string, path: string, init: RequestInit = {}): Promise<T> {
  let res: Response;
  try {
    res = await pageReaderFetch(env, instance, path, init);
  } catch (e) {
    if (e instanceof PageReaderError) throw e;
    throw new PageReaderError("page_reader_unreachable", 503);
  }
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new PageReaderError(codeOf(body, res.status), res.status);
  return body as T;
}

const json = (b: unknown): RequestInit => ({ method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(b) });
const pdf = (b: ArrayBuffer): RequestInit => ({ method: "POST", headers: { "content-type": "application/pdf" }, body: b });

export type Word = { t: string; c: number; b: [number, number, number, number] };
export type Versions = { page_reader: string; pymupdf: string; tesseract: string | null; ces_model: string | boolean };
export type RawPage = { n: number; size: [number, number]; png_b64: string; words: Word[]; tess_text: string; layer_text: string };
export type VerifyItem = { tess: string; start: number; end: number; layer: string | null; conf: number | null; box: number[] | null; reason: string };
export type PageRecord = {
  n: number;
  size: [number, number];
  text: string;
  engine: "tesseract";
  words: Word[];
  mean_conf: number | null;
  low_conf_words: number | null;
  verify: VerifyItem[];
  second_reading: "text_layer" | null;
};
export type Readability = { level: "good" | "fair" | "poor" | "empty"; reasons_cs: string[]; metrics: Record<string, unknown> };
export type LabPoint = { value: string; certainty: "documented" | "unclear_ocr"; date: string | null; time: string | null; unit?: string; reference_range?: string; [k: string]: unknown };
export type LabTest = { code: string; unit: string; reference_range: string; points: LabPoint[]; [k: string]: unknown };
export type Labs = { draws: unknown[]; tests: LabTest[]; indices: unknown[]; unparsed: unknown[]; counts: Record<string, number> };

export type RedactionHit = { reason: string; box: [number, number, number, number] };
export type RedactBody = {
  pages: { n: number; png_b64: string; words: Word[] }[];
  identity: { names: string[][]; staff: string[][]; birth_number: string | null; birth_date: string | null };
  ink_marks: boolean;
};

// Each call names the pool instance of the document's case (poolInstance).
export const pageReader = {
  healthz: (env: Env, instance: string) => pageReaderJson<{ ok: boolean; versions: Versions }>(env, instance, "/healthz"),
  // A JPEG or PNG photo of a page into a one-page PDF (base64), upright by its EXIF orientation, without its metadata.
  convert: (env: Env, instance: string, b: ArrayBuffer, mediaType: string) =>
    pageReaderJson<{ pdf_b64: string; width: number; height: number }>(env, instance, "/v1/convert", { method: "POST", headers: { "content-type": mediaType }, body: b }),
  inspect: (env: Env, instance: string, b: ArrayBuffer) =>
    pageReaderJson<{ page_count: number; encrypted: boolean; has_text_layer: boolean[] }>(env, instance, "/v1/inspect", pdf(b)),
  pages: (env: Env, instance: string, b: ArrayBuffer, from: number, to: number) =>
    pageReaderJson<{ pages: RawPage[] }>(env, instance, `/v1/pages?from=${from}&to=${to}`, pdf(b)),
  analyze: (env: Env, instance: string, pages: Omit<RawPage, "png_b64">[]) =>
    pageReaderJson<{ pages: { n: number; page: PageRecord; readability: Readability }[]; document: { level: Readability["level"]; reasons_cs: string[] } }>(env, instance, "/v1/analyze", json({ pages })),
  // Where a vision reading disagrees with Tesseract's words (/v1/compare): the "ověřit" ranges of a page read by the
  // vision model (issue #20).
  compare: (env: Env, docId: string, pages: { n: number; text: string; words: Word[] }[]) =>
    pageReaderJson<{ pages: { n: number; verify: VerifyItem[] }[] }>(env, docId, "/v1/compare", json({ pages })),
  // Black out direct identifiers on page images (pipeline/container/server.py, /v1/redact); see services/redaction.ts.
  redact: (env: Env, instance: string, body: RedactBody) =>
    pageReaderJson<{ pages: { n: number; png_b64: string; hits: RedactionHit[] }[] }>(env, instance, "/v1/redact", json(body)),
  labs: (env: Env, instance: string, docId: string, pages: { n: number; text: string; layer_text: string; readability_level: string; words: Word[]; engine: string; doc_id: string }[]) =>
    pageReaderJson<Labs>(env, instance, "/v1/labs", json({ pages, document: { doc_id: docId } })),
};
