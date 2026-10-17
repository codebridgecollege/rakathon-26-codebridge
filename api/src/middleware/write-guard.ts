import type { MiddlewareHandler } from "hono";
import type { AppEnv } from "../types";
import { ApiError, E } from "../http/errors";
import { D, DomainError } from "../domain/errors";
import { refusedLine } from "../domain/audit";
import { auditStatement } from "../store/write";
import { D1Work } from "../store/work";

// The approve route carries the report snapshot the doctor confirmed; every other write is small.
const MAX_BODY = 64 * 1024;
const MAX_REPORT_BODY = 256 * 1024;
const AUDIO_PART = /^\/api\/cases\/[^/]+\/transcript\/audio\/parts\/\d+$/;

// Common to every write route (step-4.md section 5): JSON only, a size limit, the data epoch of the shared demo,
// and an access-log row for every refusal by role or membership, so a break-the-glass review also sees attempts.
// The same-origin check (CSRF) runs before this for every non-GET (http/origin.ts).
export const writeGuard = (): MiddlewareHandler<AppEnv> => async (c, next) => {
  const m = c.req.method;
  if (m === "GET" || m === "HEAD") return next();
  const type = (c.req.header("content-type") || "").toLowerCase();
  // Step 5: a part of a case's audio is raw PCM, not JSON; its route checks the size itself and streams nothing else.
  if (m === "PUT" && AUDIO_PART.test(c.req.path)) {
    if (!type.startsWith("application/octet-stream")) throw E.unsupportedMediaType();
    c.set("body", {});
  } else {
    if (!type.startsWith("application/json")) throw E.unsupportedMediaType();
    const max = /\/decisions$/.test(c.req.path) ? MAX_REPORT_BODY : MAX_BODY;
    if (Number(c.req.header("content-length") || 0) > max) throw E.bodyTooLarge();
    const text = await c.req.text();
    if (new TextEncoder().encode(text).length > max) throw E.bodyTooLarge();
    let body: unknown;
    try {
      body = text ? JSON.parse(text) : {};
    } catch {
      throw E.badRequest();
    }
    if (!body || typeof body !== "object" || Array.isArray(body)) throw E.badRequest();
    c.set("body", body as Record<string, unknown>);
  }

  const st = await new D1Work(c.env.DB).epoch();
  if (!st) throw E.notConfigured();
  if (st.reset_in_progress) throw D.resetting();
  // A tab opened before a reset-demo would write into data it never saw; it reloads instead.
  if (c.req.header("x-data-epoch") !== String(st.data_epoch)) throw E.dataReset();
  c.set("epoch", st.data_epoch);
  c.set("auditCase", null);
  c.set("auditLabel", `${m} ${c.req.routePath || c.req.path}`);

  await next();

  const err = c.error;
  // Role and membership refusals come as DomainError (write rules) or ApiError (the read check reused by view events).
  const refused = (err instanceof DomainError && err.status === 403) || (err instanceof ApiError && (err.code === "not_member" || err.code === "role_forbidden"));
  if (refused && c.var.viewer) {
    try {
      await auditStatement(
        c.env.DB,
        c.var.viewer,
        { action: "write.refused", what_cs: refusedLine(c.var.auditLabel), case_id: c.var.auditCase },
        { requestId: c.req.header("cf-ray") ?? null, epoch: st.data_epoch },
      ).run();
    } catch {
      // The refusal stands either way; a failed log row is reported in the Worker log without request data.
      console.error(JSON.stringify({ route: c.req.path, audit: "refusal_insert_failed" }));
    }
  }
};
