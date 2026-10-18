// The transport under every API call: the same headers, timeouts and error handling as apiGet() and apiWrite() in
// mocks/src/v3-template.html, so the new app talks to the Worker exactly as today's page does.
import type { ApiErrorBody } from "@codebridge/domain/wire";

// Errors the client raises itself (no answer from our API) carry a message ID for the app's catalog instead of Czech
// text: the client has no UI strings. An answer from the API carries its own Czech message (message_cs), which is
// passed through unchanged, because the server's wording is what the doctor must see.
export type ClientErrorCode = "no_api" | "timeout" | "network";

export class ApiError extends Error {
  constructor(
    // The API's error code ("slot_taken", "data_reset", ...) or one of ClientErrorCode.
    public code: string,
    // HTTP status; 0 when the request may never have reached the server (a retry of an approval reuses its key).
    public status: number,
    // The server's Czech message, shown as is; null when the client raised the error itself.
    public message_cs: string | null,
    // The catalog message ID for errors without a server message, so the app translates them.
    public message_id: string | null,
    // On a conflict, the server's current state, so the page redraws without a second call.
    public current?: unknown,
    // Field messages for a form.
    public fields?: Record<string, string>,
  ) {
    super(message_cs ?? message_id ?? code);
    this.name = "ApiError";
  }
}

// Catalog IDs (i18n/cs.ftl) of the client's own errors. GET and write differ as in the template: a failed write asks
// the doctor to try again, because nothing was stored.
export const CLIENT_ERROR_IDS = {
  get: { no_api: "api-error-no-api", timeout: "api-error-timeout", network: "api-error-network", fallback: "api-error-request-failed" },
  write: { no_api: "api-error-write-no-api", timeout: "api-error-write-timeout", network: "api-error-write-network", fallback: "api-error-write-failed" },
} as const;

export type ClientOptions = {
  // "/api" on the Worker; tests pass an absolute URL.
  base?: string;
  fetch?: typeof fetch;
  // A new idempotency key; injectable so tests are deterministic.
  newKey?: () => string;
  // Called once when the server says the shared demo data was reset (409 data_reset); the app reloads.
  onDataReset?: () => void;
};

export type RequestOptions = {
  timeout?: number;
  idem?: string;
  query?: Record<string, string | number | boolean | undefined>;
  // Route-specific headers of the raw uploads (X-File-Name, X-Audio-Segments).
  headers?: Record<string, string>;
};

export type Transport = {
  // The demo user (a staff id) sent as X-Demo-User; null sends none and the server uses its default.
  userId: string | null;
  // The reset epoch of the shared demo data, sent as X-Data-Epoch on writes and refreshed from every answer.
  epoch: number | null;
  get<T>(path: string, o?: RequestOptions): Promise<T>;
  write<T>(method: "POST" | "PUT" | "PATCH" | "DELETE", path: string, body?: unknown, o?: RequestOptions): Promise<T>;
  // A raw body (a document or an audio part), sent as is with its media type.
  upload<T>(method: "POST" | "PUT", path: string, body: Blob | ArrayBuffer | Uint8Array, contentType: string, o?: RequestOptions): Promise<T>;
  newKey(): string;
};

const isJson = (r: Response) => (r.headers.get("content-type") || "").includes("application/json");

function withQuery(path: string, q?: RequestOptions["query"]): string {
  if (!q) return path;
  const s = new URLSearchParams();
  for (const [k, v] of Object.entries(q)) if (v !== undefined) s.set(k, String(v));
  const qs = s.toString();
  return qs ? `${path}${path.includes("?") ? "&" : "?"}${qs}` : path;
}

const defaultKey = () =>
  globalThis.crypto?.randomUUID ? globalThis.crypto.randomUUID() : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;

export function createTransport(opts: ClientOptions = {}): Transport {
  const base = opts.base ?? "/api";
  const doFetch = opts.fetch ?? ((...a: Parameters<typeof fetch>) => globalThis.fetch(...a));
  let resetSignalled = false;

  const t: Transport = {
    userId: null,
    epoch: null,
    newKey: opts.newKey ?? defaultKey,

    async get<T>(path: string, o: RequestOptions = {}): Promise<T> {
      const ids = CLIENT_ERROR_IDS.get;
      const ctl = new AbortController();
      const timer = setTimeout(() => ctl.abort(), o.timeout ?? 8000);
      try {
        const r = await doFetch(base + withQuery(path, o.query), {
          signal: ctl.signal,
          credentials: "same-origin",
          cache: "no-store",
          // The demo has no login: the picked user travels as a staff id (ASCII; a name with "ř" cannot be a header).
          headers: { Accept: "application/json", ...(t.userId ? { "X-Demo-User": t.userId } : {}) },
        });
        // A static host answers unknown paths with an HTML page; only a JSON answer comes from our API.
        if (!isJson(r)) throw new ApiError("no_api", r.status, null, ids.no_api);
        const body = (await r.json()) as T & Partial<ApiErrorBody>;
        if (!r.ok) throw fromBody(body, r.status, ids.fallback);
        return body;
      } catch (e) {
        if (e instanceof ApiError) throw e;
        if ((e as Error)?.name === "AbortError") throw new ApiError("timeout", 0, null, ids.timeout);
        throw new ApiError("network", 0, null, ids.network);
      } finally {
        clearTimeout(timer);
      }
    },

    write<T>(method: "POST" | "PUT" | "PATCH" | "DELETE", path: string, body: unknown = {}, o: RequestOptions = {}): Promise<T> {
      return send<T>(method, path, JSON.stringify(body ?? {}), "application/json", o);
    },

    upload<T>(method: "POST" | "PUT", path: string, body: Blob | ArrayBuffer | Uint8Array, contentType: string, o: RequestOptions = {}): Promise<T> {
      return send<T>(method, path, body as BodyInit, contentType, o);
    },
  };

  function fromBody(body: Partial<ApiErrorBody> | null, status: number, fallbackId: string): ApiError {
    const er = body?.error;
    return new ApiError(er?.code || "error", status, er?.message_cs || null, er?.message_cs ? null : fallbackId, er?.current, er?.fields);
  }

  async function send<T>(method: string, path: string, body: BodyInit, contentType: string, o: RequestOptions): Promise<T> {
    const ids = CLIENT_ERROR_IDS.write;
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), o.timeout ?? 20000);
    let r: Response;
    let out: (T & Partial<ApiErrorBody> & { data_epoch?: number | null }) | null;
    try {
      r = await doFetch(base + withQuery(path, o.query), {
        method,
        signal: ctl.signal,
        credentials: "same-origin",
        cache: "no-store",
        body,
        headers: {
          Accept: "application/json",
          "Content-Type": contentType,
          ...(t.userId ? { "X-Demo-User": t.userId } : {}),
          // A tab opened before a reset must not write into the new data; the server refuses a stale epoch.
          ...(t.epoch != null ? { "X-Data-Epoch": String(t.epoch) } : {}),
          ...(o.idem ? { "Idempotency-Key": o.idem } : {}),
          ...o.headers,
        },
      });
      if (!isJson(r)) throw new ApiError("no_api", r.status, null, ids.no_api);
      out = (await r.json()) as typeof out;
    } catch (e) {
      if (e instanceof ApiError) throw e;
      // Status 0 marks "the server may not have seen it", so an approval keeps its idempotency key for the retry.
      throw new ApiError((e as Error)?.name === "AbortError" ? "timeout" : "network", 0, null, (e as Error)?.name === "AbortError" ? ids.timeout : ids.network);
    } finally {
      clearTimeout(timer);
    }
    if (out?.data_epoch != null) t.epoch = out.data_epoch;
    if (!r.ok) {
      const err = fromBody(out, r.status, ids.fallback);
      if (err.code === "data_reset" && !resetSignalled) {
        resetSignalled = true;
        opts.onDataReset?.();
      }
      throw err;
    }
    return out as T;
  }

  return t;
}
