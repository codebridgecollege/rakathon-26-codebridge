// Where the model's answers are cached in R2 (issue #20), so the Worker's model calls and the routes that delete a
// document's content agree on the keys without the routes importing the model client.
import type { LoadedPrompt } from "../prompts";
import { orgKey } from "../store/sql";

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9._@-]+/g, "_").slice(0, 80);

// The cache folder of the documents a call read: the document's own folder when the call read one document, so
// withdrawing it (another patient's document) deletes its answers with it; a call over several documents goes under
// "multi-", which a withdraw in the case deletes as a whole (more than needed, never less).
export function cacheScope(docIds: Iterable<string>): string {
  const ids = [...new Set(docIds)].sort();
  if (ids.length === 1) return slug(ids[0]!);
  return `multi-${ids.length ? slug(ids.join("+")).slice(0, 40) : "none"}`;
}

// R2 key of a cached answer. The org prefix keeps one org from ever reading another's cache; the case and document
// folders let the answers go with the case or the document (cachePrefixesOf); reset-demo deletes the org's
// cache/model/.
export function cacheKey(org: string, caseId: string, scope: string, model: string, prompt: Pick<LoadedPrompt, "ref" | "sha256">, inputSha: string): string {
  return orgKey(org, `cache/model/${slug(caseId)}/${scope}/${slug(model)}/${slug(prompt.ref)}/${prompt.sha256.slice(0, 16)}/${inputSha}.json`);
}

// The R2 prefixes holding the cached answers that read a document: its own folder and the case's multi-document ones.
export function cachePrefixesOf(org: string, caseId: string, docId: string): string[] {
  return [orgKey(org, `cache/model/${slug(caseId)}/${slug(docId)}/`), orgKey(org, `cache/model/${slug(caseId)}/multi-`)];
}
