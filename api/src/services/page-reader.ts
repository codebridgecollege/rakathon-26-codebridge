// The page reader service (step 6, slice b-1): pipeline/container/server.py, the deterministic page logic (render,
// Tesseract, the text layer as a second reading, readability, the lab parser) over HTTP, contract version 1.
//
// Two ways to reach it, in this order:
// - PAGE_READER_URL: a plain HTTP base URL. Local work runs the Python service natively (`cd pipeline && uv run python
//   container/server.py`, port 8080) and `wrangler dev` with PAGE_READER_URL=http://localhost:8080; the tests point it at a
//   mocked host.
// - PAGE_READER: a Cloudflare Container binding (a Durable Object namespace), one named instance per document so a
//   document's batches land on one warm instance. Not configured yet: the image is built by `wrangler deploy` with
//   Docker, which this deploy did not have (step-6.md "As implemented").
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
type WithPageReader = Env & { PAGE_READER?: { getByName(name: string): Fetcher } };

export const pipelineOn = (env: Env) => !!env.PAGE_READER_URL || !!(env as WithPageReader).PAGE_READER;

// A container error code is a fixed code from server.py; anything else is reduced to the HTTP status.
const codeOf = (body: unknown, status: number) => {
  const c = (body as { error?: { code?: unknown } } | null)?.error?.code;
  return typeof c === "string" && /^[a-z_]{1,40}$/.test(c) ? c : `http_${status}`;
};

export async function pageReaderFetch(env: Env, docId: string, path: string, init: RequestInit = {}): Promise<Response> {
  const base = env.PAGE_READER_URL?.replace(/\/$/, "");
  if (base) return fetch(base + path, init);
  const ns = (env as WithPageReader).PAGE_READER;
  if (ns) return ns.getByName(`doc-${docId}`).fetch(`http://page-reader${path}`, init);
  throw new PageReaderError("pipeline_off", 503);
}

export async function pageReaderJson<T>(env: Env, docId: string, path: string, init: RequestInit = {}): Promise<T> {
  let res: Response;
  try {
    res = await pageReaderFetch(env, docId, path, init);
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
  identity: { names: string[]; staff: string[]; birth_number: string | null; birth_date: string | null };
  ink_marks: boolean;
};

export const pageReader = {
  healthz: (env: Env, docId: string) => pageReaderJson<{ ok: boolean; versions: Versions }>(env, docId, "/healthz"),
  inspect: (env: Env, docId: string, b: ArrayBuffer) =>
    pageReaderJson<{ page_count: number; encrypted: boolean; has_text_layer: boolean[] }>(env, docId, "/v1/inspect", pdf(b)),
  pages: (env: Env, docId: string, b: ArrayBuffer, from: number, to: number) => pageReaderJson<{ pages: RawPage[] }>(env, docId, `/v1/pages?from=${from}&to=${to}`, pdf(b)),
  analyze: (env: Env, docId: string, pages: Omit<RawPage, "png_b64">[]) =>
    pageReaderJson<{ pages: { n: number; page: PageRecord; readability: Readability }[]; document: { level: Readability["level"]; reasons_cs: string[] } }>(env, docId, "/v1/analyze", json({ pages })),
  // Black out direct identifiers on page images (pipeline/container/server.py, /v1/redact); see services/redaction.ts.
  redact: (env: Env, docId: string, body: RedactBody) => pageReaderJson<{ pages: { n: number; png_b64: string; hits: RedactionHit[] }[] }>(env, docId, "/v1/redact", json(body)),
  labs: (env: Env, docId: string, pages: { n: number; text: string; layer_text: string; readability_level: string; words: Word[]; engine: string; doc_id: string }[]) =>
    pageReaderJson<Labs>(env, docId, "/v1/labs", json({ pages, document: { doc_id: docId } })),
};
