import type { ErrorHandler, NotFoundHandler } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import type { AppEnv } from "../types";

// Every /api error has the same shape, { error: { code, message_cs } }, so the page can show message_cs as is.
// Messages never carry the upstream status, upstream body or a key.
export class ApiError extends Error {
  constructor(
    public status: ContentfulStatusCode,
    public code: string,
    public message_cs: string,
    public headers: Record<string, string> = {},
  ) {
    super(code);
  }
}

// One factory per row of the shared error table in docs/research/backend-steps/step-0-1.md.
export const E = {
  badRequest: () => new ApiError(400, "bad_request", "Neplatný požadavek."),
  badAudio: () => new ApiError(400, "bad_audio", "Záznam není ve formátu WAV."),
  unauthenticated: () => new ApiError(401, "unauthenticated", "Přihlášení chybí nebo vypršelo. Obnovte stránku."),
  badOrigin: () => new ApiError(403, "bad_origin", "Požadavek nepřišel z této aplikace."),
  notFound: () => new ApiError(404, "not_found", "Neznámá adresa API."),
  lengthRequired: () => new ApiError(411, "length_required", "Chybí velikost nahrávaného záznamu."),
  transcriptTooLarge: () => new ApiError(413, "too_large", "Přepis je příliš dlouhý ke shrnutí."),
  audioTooLarge: () => new ApiError(413, "too_large", "Záznam případu je příliš dlouhý (nad 50 minut)."),
  unsupportedMediaType: () => new ApiError(415, "unsupported_media_type", "Nepodporovaný formát dat."),
  rateLimited: () =>
    new ApiError(429, "rate_limited", "Příliš mnoho požadavků, zkuste to za minutu.", { "Retry-After": "60" }),
  internal: () => new ApiError(500, "internal", "Interní chyba serveru."),
  misconfigured: () => new ApiError(500, "misconfigured", "Server není správně nastaven."),
  upstreamError: (service: "přepisu" | "jazykového modelu") =>
    new ApiError(502, "upstream_error", `Služba ${service} odpověděla chybou.`),
  notConfigured: () => new ApiError(503, "not_configured", "Tato služba na tomto serveru není zapnutá."),
  upstreamBusy: () => new ApiError(503, "upstream_busy", "Služba je přetížená, zkuste to znovu za chvíli."),
  upstreamTimeout: () => new ApiError(504, "upstream_timeout", "Služba neodpověděla včas."),
};

export const onError: ErrorHandler<AppEnv> = (err, c) => {
  if (err instanceof ApiError) {
    return c.json({ error: { code: err.code, message_cs: err.message_cs } }, err.status, err.headers);
  }
  // Unknown errors: log the type and route only; the message may hold request text.
  console.error(JSON.stringify({ route: c.req.path, error: err?.name ?? "Error" }));
  const e = E.internal();
  return c.json({ error: { code: e.code, message_cs: e.message_cs } }, e.status);
};

export const notFound: NotFoundHandler<AppEnv> = (c) =>
  c.json({ error: { code: "not_found", message_cs: "Neznámá adresa API." } }, 404);

// fetch() raises TimeoutError when AbortSignal.timeout fires; the route answers 504 instead of a generic 500.
export function isTimeout(e: unknown): boolean {
  return e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError");
}

// Vars are strings; a missing or malformed number is a deploy mistake, so the route fails closed.
export function numVar(value: string | undefined): number {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) throw E.misconfigured();
  return n;
}
