import type { Context } from "hono";
import type { AppEnv } from "../types";
import type { AuditEntry } from "../store/types";
import { E } from "../http/errors";

// Writes the access-log row for a read of case content. Routes call it after the access check and before they read
// the content, so a failed insert means the caller gets a 500 and no data: no access without a trace.
// what_cs is the line Administrace shows; it never holds a quote, document text or search terms.
export async function audit(c: Context<AppEnv>, e: Omit<AuditEntry, "viewer" | "request_id">): Promise<void> {
  // The session cookie is SameSite=Lax, so a link or redirect from another site still brings it on a top-level GET.
  // A read that writes an access-log row must come from our own page, or another site could fill the log with views
  // nobody made (AUTH.md, "Cross-site requests"). Browsers always send the header; tools that send none are let through,
  // as the same-origin check of writes does (http/origin.ts).
  const site = c.req.header("sec-fetch-site");
  if (site === "cross-site" || site === "same-site") throw E.badOrigin();
  try {
    await c.var.stores.audit.append({ ...e, viewer: c.var.viewer, request_id: c.req.header("cf-ray") ?? null, break_glass_reason: c.var.breakGlass ?? null });
  } catch {
    console.error(JSON.stringify({ route: c.req.path, audit: "insert_failed" }));
    throw E.internal();
  }
}
