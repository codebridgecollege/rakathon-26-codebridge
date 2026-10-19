// The transport under every API call: the same headers, timeouts and error handling, so the app talks to the Worker in one way.
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

// Catalog IDs (i18n/cs/) of the client's own errors. GET and write differ: a failed write asks
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
  // Called when the login session is gone (401): the app logs in again and resolves true to send the request once
  // more, or false to let it fail (docs/design/AUTH.md, "Losing the session mid-work"). sentAt is when the refused
  // request left (performance.now()), so the app can tell a request that still carried the session of before a switch.
  onUnauthenticated?: (info: { sentAt: number; method: string }) => Promise<boolean>;
  // Called once when the login session now acts as someone else than this tab shows (409 session_changed: a switch
  // or another login in a second tab); the app reloads.
  onSessionChanged?: () => void;
};

export type RequestOptions = {
  timeout?: number;
  idem?: string;
  query?: Record<string, string | number | boolean | undefined>;
  // Route-specific headers of the raw uploads (X-File-Name, X-Audio-Segments).
  headers?: Record<string, string>;
  // false: a 401 fails at once instead of waiting for a new login (the check whether the login is back).
  retryAfterLogin?: boolean;
  // false: sent without X-Acting-As (GET /me, which tells the app whom the session acts as).
  sendIdentity?: boolean;
};

export type Transport = {
  // The demo user (a membership id) sent as X-Demo-User; null sends none and the server uses its default.
  userId: string | null;
  // With a login: whom this tab shows, as "<membership id>:<person id>" (X-Acting-As); the server refuses a request
  // when the session acts as someone else (a switch or a login in another tab). Null sends none.
  actingAs: string | null;
  // The reset epoch of the shared demo data, sent as X-Data-Epoch on writes and refreshed from every answer.
  epoch: number | null;
  get<T>(path: string, o?: RequestOptions): Promise<T>;
  write<T>(method: "POST" | "PUT" | "PATCH" | "DELETE", path: string, body?: unknown, o?: RequestOptions): Promise<T>;
  // A raw body (a document or an audio part), sent as is with its media type.
  upload<T>(method: "POST" | "PUT", path: string, body: Blob | ArrayBuffer | Uint8Array, contentType: string, o?: RequestOptions): Promise<T>;
  // A write sent while the page goes away (pagehide): keepalive, not awaited, errors ignored. Only for clean-ups the
  // server also does by itself later (an upload session expires within 15 minutes anyway).
  sendOnUnload(method: "DELETE" | "POST", path: string, body?: unknown): void;
  newKey(): string;
};

// The answers that mean "log in again": no session or an expired one, or a session whose membership ended.
const LOGIN_CODES = new Set(["unauthenticated", "unknown_user"]);
// A request goes out at most three times, so a login that keeps failing cannot loop.
const MAX_LOGIN_RETRIES = 2;

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

  // A request the session refused goes out again once the app has a session back. The server checks the session
  // before anything else, so nothing was done, and a write that carries an idempotency key keeps it.
  async function withLogin<T>(o: RequestOptions & { method: string }, run: () => Promise<T>): Promise<T> {
    for (let i = 0; ; i++) {
      const sentAt = performance.now();
      try {
        return await run();
      } catch (e) {
        const hook = opts.onUnauthenticated;
        const loginLost = e instanceof ApiError && e.status === 401 && LOGIN_CODES.has(e.code);
        if (!hook || !loginLost || o.retryAfterLogin === false || i >= MAX_LOGIN_RETRIES || !(await hook({ sentAt, method: o.method }))) throw e;
      }
    }
  }

  const t: Transport = {
    userId: null,
    actingAs: null,
    epoch: null,
    newKey: opts.newKey ?? defaultKey,

    get<T>(path: string, o: RequestOptions = {}): Promise<T> {
      return withLogin({ ...o, method: "GET" }, () => getOnce<T>(path, o));
    },

    write<T>(method: "POST" | "PUT" | "PATCH" | "DELETE", path: string, body: unknown = {}, o: RequestOptions = {}): Promise<T> {
      const text = JSON.stringify(body ?? {});
      return withLogin({ ...o, method }, () => send<T>(method, path, text, "application/json", o));
    },

    upload<T>(method: "POST" | "PUT", path: string, body: Blob | ArrayBuffer | Uint8Array, contentType: string, o: RequestOptions = {}): Promise<T> {
      return withLogin({ ...o, method }, () => send<T>(method, path, body as BodyInit, contentType, o));
    },

    sendOnUnload(method: "DELETE" | "POST", path: string, body: unknown = {}): void {
      try {
        void doFetch(base + path, {
          method,
          keepalive: true,
          credentials: "same-origin",
          body: JSON.stringify(body ?? {}),
          headers: {
            "Content-Type": "application/json",
            ...identity({}),
            ...(t.epoch != null ? { "X-Data-Epoch": String(t.epoch) } : {}),
          },
        }).catch(() => {});
      } catch {
        // A browser that refuses the request while unloading: the server's own expiry cleans up.
      }
    },
  };

  async function getOnce<T>(path: string, o: RequestOptions): Promise<T> {
    const ids = CLIENT_ERROR_IDS.get;
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), o.timeout ?? 8000);
    try {
      const r = await doFetch(base + withQuery(path, o.query), {
        signal: ctl.signal,
        credentials: "same-origin",
        cache: "no-store",
        // The demo has no login: the picked user travels as a membership id (ASCII; a name with "ř" cannot be a header).
        headers: { Accept: "application/json", ...identity(o) },
      });
      // A static host answers unknown paths with an HTML page; only a JSON answer comes from our API.
      if (!isJson(r)) throw new ApiError("no_api", r.status, null, ids.no_api);
      const body = (await r.json()) as T & Partial<ApiErrorBody>;
      if (!r.ok) throw signal(fromBody(body, r.status, ids.fallback));
      return body;
    } catch (e) {
      if (e instanceof ApiError) throw e;
      if ((e as Error)?.name === "AbortError") throw new ApiError("timeout", 0, null, ids.timeout);
      throw new ApiError("network", 0, null, ids.network);
    } finally {
      clearTimeout(timer);
    }
  }

  // Who the request is for: the demo user (no login) and, with a login, whom this tab shows.
  function identity(o: RequestOptions): Record<string, string> {
    return {
      ...(t.userId ? { "X-Demo-User": t.userId } : {}),
      ...(t.actingAs && o.sendIdentity !== false ? { "X-Acting-As": t.actingAs } : {}),
    };
  }

  // The answers after which the whole page may reload.
  function signal(err: ApiError): ApiError {
    if (err.code === "data_reset" && !resetSignalled) {
      resetSignalled = true;
      opts.onDataReset?.();
    }
    // Reported every time: the app ignores the ones it expects (the lost-login dialog) and reloads once otherwise.
    if (err.code === "session_changed") opts.onSessionChanged?.();
    return err;
  }

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
          ...identity(o),
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
      throw signal(fromBody(out, r.status, ids.fallback));
    }
    return out as T;
  }

  return t;
}
