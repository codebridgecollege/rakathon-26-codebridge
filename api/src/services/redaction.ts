// Page images before they may go to a cloud model (DATA-PROTECTION.md, option B): the page reader blacks out the
// case patient's name, birth number and birth date, the org's staff names, any name after a title, form-field values,
// phone numbers and e-mail addresses, and (best effort) signatures, stamps and handwriting. The names come from the
// case record and the org's staff in D1 (store/identity.ts), never from fixture files.
//
// A RedactedPage can only be made here, so the model interface (services/model.ts) can refuse any image that did not
// pass through the redaction for the same org and case.
import { birthDateOf, nameForms, nameParts, type CaseIdentity } from "../domain/pseudonymize";
import { pageReader, poolInstance, type RedactionHit, type Word } from "./page-reader";

const MADE_HERE = Symbol("redacted-page");

export class RedactedPage {
  // The reasons only (for the access log and the page record), never the values that were blacked out.
  readonly reasons: string[];
  readonly hitCount: number;
  constructor(
    token: symbol,
    readonly org: string,
    readonly caseId: string,
    readonly docId: string,
    readonly n: number,
    readonly png: Uint8Array,
    readonly hits: RedactionHit[],
  ) {
    if (token !== MADE_HERE) throw new Error("redacted_page_outside_redaction");
    this.reasons = [...new Set(hits.map((h) => h.reason))];
    this.hitCount = hits.length;
  }
}

// The same name parts as the text pseudonymization, so a double surname is split at its hyphen here too; the forms
// of each part are one list, so the page reader can tell "jan hlava" (two parts) from "hlavy Hlava" (one part).
const nameList = (names: string[]) => nameParts(names).map(nameForms);

// What the page reader needs to find the case's identifiers: folded, declined name forms (computed once, here, so
// the text and the image redaction match the same forms) and the birth number and date as the record holds them.
export function imageIdentity(id: CaseIdentity) {
  return { names: nameList(id.patientNames), staff: nameList(id.staffNames), birth_number: id.birthNumber, birth_date: birthDateOf(id) };
}

export function toBase64(bytes: Uint8Array): string {
  let s = "";
  // In chunks: String.fromCharCode with a whole page image as arguments would overflow the stack.
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

const fromBase64 = (b64: string) => Uint8Array.from(atob(b64), (ch) => ch.charCodeAt(0));

export async function redactPages(
  env: Env,
  o: { org: string; caseId: string; docId: string; identity: CaseIdentity; inkMarks?: boolean },
  pages: { n: number; png: Uint8Array; words: Word[] }[],
): Promise<RedactedPage[]> {
  const r = await pageReader.redact(env, poolInstance(o.caseId), {
    pages: pages.map((p) => ({ n: p.n, png_b64: toBase64(p.png), words: p.words })),
    identity: imageIdentity(o.identity),
    ink_marks: o.inkMarks ?? true,
  });
  return r.pages.map((p) => new RedactedPage(MADE_HERE, o.org, o.caseId, o.docId, p.n, fromBase64(p.png_b64), p.hits));
}

// A page the document Workflow already read (run output in R2: p<n>.png and p<n>.raw.json): redacts it and stores the
// redacted image and its boxes with reasons next to it, so the source viewer can show what left the hospital.
// The caller passes the run's own prefix (pipeline_runs.output_prefix of this org and case); it is not checked here.
export async function redactStoredPage(env: Env, o: { org: string; caseId: string; docId: string; identity: CaseIdentity; prefix: string; n: number }): Promise<RedactedPage> {
  const [img, raw] = await Promise.all([env.DOCS.get(`${o.prefix}p${o.n}.png`), env.DOCS.get(`${o.prefix}p${o.n}.raw.json`)]);
  if (!img || !raw) throw new Error("page_missing");
  const words = (await raw.json<{ words: Word[] }>()).words ?? [];
  const [page] = await redactPages(env, o, [{ n: o.n, png: new Uint8Array(await img.arrayBuffer()), words }]);
  if (!page) throw new Error("page_missing");
  await env.DOCS.put(`${o.prefix}p${o.n}.redacted.png`, page.png, { httpMetadata: { contentType: "image/png" } });
  await env.DOCS.put(`${o.prefix}p${o.n}.redactions.json`, JSON.stringify(page.hits), { httpMetadata: { contentType: "application/json" } });
  return page;
}
