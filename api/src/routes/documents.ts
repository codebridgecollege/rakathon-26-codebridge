// Uploads (step 6, slice a-1): one file per request to a case, the case's document list and removing an unprocessed
// upload. Every file is accepted. In the shared demo (UPLOAD_POLICY=fixtures_only) only a registered synthetic fixture's
// bytes go to R2; the body is read into memory and hashed first, and any other file is only listed (name, size,
// uploader, time) with no content, hash or identity result kept. An org in UPLOAD_STORE_ORGS (the team's switch for demo
// org B) keeps unknown PDFs and JPEG/PNG photos too. Design: step-6.md "As implemented".
import { Hono, type Context } from "hono";
import type { AppEnv } from "../types";
import { E, numVar } from "../http/errors";
import { limitOrThrow } from "../http/rate-limit";
import {
  IDENTITY_ALERT_CS,
  MAX_DOCUMENTS_PER_CASE,
  STATE_CS,
  UP,
  compareIdentity,
  fileKind,
  imageType,
  fileNameOf,
  keepsContent,
  listedLine,
  mediaTypeOf,
  uploadLine,
  uploadPolicy,
  type Identity,
} from "../domain/documents";
import { audit } from "../middleware/audit";
import { UNLOCKED_COND, caseDocuments, documentRow, fixtureByHash, uploadContext, type DocRow, type FixtureRow } from "../store/documents";
import { openCase } from "./access-check";
import { answer, caseFor, isoNow, label, newId, orgQuery, tx } from "./write-context";
import { orgKey } from "../store/sql";
import { autoStart } from "./pipeline-start";
import { LEGACY_ORG } from "../domain/orgs";

const hex = (b: ArrayBuffer) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("");

// Reads the body up to max bytes; one byte more stops reading and answers null, so the file is only listed.
async function readLimited(body: ReadableStream<Uint8Array> | null, max: number): Promise<Uint8Array | null> {
  if (!body) return new Uint8Array();
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let n = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    n += value.byteLength;
    if (n > max) {
      await reader.cancel().catch(() => {});
      return null;
    }
    chunks.push(value);
  }
  const out = new Uint8Array(n);
  let at = 0;
  for (const ch of chunks) {
    out.set(ch, at);
    at += ch.byteLength;
  }
  return out;
}

// What the page shows for a document. No R2 keys; the fixture's patient never leaves the server, only the result of
// the comparison does.
export function docOut(d: DocRow) {
  const reasons = d.readability_reasons_json ? (JSON.parse(d.readability_reasons_json) as string[]) : [];
  return {
    id: d.id,
    file: d.file_name,
    name: d.file_name,
    origin: d.origin,
    size: d.size_bytes,
    sha256: d.sha256,
    page_count: d.page_count,
    processing: d.processing,
    note: d.note_cs,
    type_cs: d.title_cs,
    doc_type: d.doc_type,
    doc_date: d.doc_date,
    fixture: !!d.fixture_id,
    // A listed file has no content on the server: nothing to process or show.
    content_stored: !!d.original_r2_key,
    state: d.state,
    state_cs: d.state ? STATE_CS[d.state] ?? d.state : null,
    state_detail_cs: d.state_detail_cs,
    identity: d.identity,
    identity_cs: d.identity === "conflicts" ? IDENTITY_ALERT_CS : null,
    readability: d.readability,
    readability_reasons_cs: reasons,
    uploaded_by: d.uploaded_by_name,
    uploaded_at: d.created_at,
    // "phone" for a file sent through an upload session; the page shows "z telefonu" next to who and when.
    source: d.source,
  };
}

const levelOf = (docs: DocRow[]): "full" | "partial" | "none" => {
  if (!docs.length) return "none";
  const covered = docs.filter((d) => d.origin === "seed" ? d.processing === "processed" : d.state === "prepared" || d.state === "processed").length;
  return covered === docs.length ? "full" : covered ? "partial" : "none";
};

export type UploadCtx = NonNullable<Awaited<ReturnType<typeof uploadContext>>>;

// The checks shared by an upload and a removal: the case takes changes to its documents.
export function assertUnlocked(u: UploadCtx) {
  if (u.status === "closed" || u.approved) throw UP.locked();
}

// Where a file came from: the desktop's own upload, or a phone through an upload session (PHONE-UPLOAD.md). A phone
// file is stored and listed exactly as a desktop one, under the desktop user who opened the session.
export type UploadVia = { source: "phone"; sessionId: string } | null;

// The upload itself, after the route checked who may upload to the case and applied its rate limit: reads the body,
// keeps a registered fixture's bytes, lists anything else, and commits the row with its access-log line.
export async function receiveUpload(c: Context<AppEnv>, id: string, u: UploadCtx, breakGlass: string | null, via: UploadVia) {
  const db = c.env.DB;
  const max = numVar(c.env.UPLOAD_MAX_BYTES);
  const len = c.req.header("content-length");
  if (!len || !/^\d+$/.test(len)) throw UP.lengthRequired();
  const declared = Number(len);
  const name = fileNameOf(c.req.header("x-file-name"));
  // An oversized file is listed without reading its body; an empty one has nothing to read.
  let bytes: Uint8Array | null = null;
  if (declared > 0 && declared <= max) bytes = await readLimited(c.req.raw.body, max);
  else await c.req.raw.body?.cancel().catch(() => {});
  if (bytes && bytes.length !== declared) throw E.badRequest();
  const kind = bytes ? fileKind(bytes) : null;
  // Only a PDF can be a fixture; matching is by the bytes, so a renamed copy matches and an edited file does not.
  const sha0 = bytes && kind === "pdf" ? hex(await crypto.subtle.digest("SHA-256", bytes)) : null;
  const fx0 = sha0 ? await fixtureByHash(db, sha0) : null;
  const keep = keepsContent(uploadPolicy(c.env.UPLOAD_POLICY, c.var.viewer.org, c.env.UPLOAD_STORE_ORGS), kind, fx0);
  const image = kind === "image" && bytes ? imageType(bytes) : null;
  // Nothing derived from a file that is not kept stays on the server, not even its hash.
  const sha = keep ? (sha0 ?? (bytes ? hex(await crypto.subtle.digest("SHA-256", bytes)) : null)) : null;
  const fx = keep ? fx0 : null;
  // A repeat upload (the same stored bytes, or a listed file of the same name) answers with the document already
  // there, so the page never shows a refusal for it. Seeded documents are not repeats: they are the case's own record.
  // From a phone, a listed file is a repeat only within its own session: phones name every camera photo "image.jpg",
  // so a later photo with an earlier one's name is a new file (stored as "image (2).jpg" below).
  const dup = await orgQuery(c, `SELECT id FROM documents WHERE org_id = ?org AND case_id = ?1 AND origin = 'upload' AND ((?2 IS NOT NULL AND sha256 = ?2)
         OR (?2 IS NULL AND sha256 IS NULL AND file_name = ?3 AND (?4 IS NULL OR upload_session_id = ?4))) LIMIT 1`, id, sha, name, via?.sessionId ?? null)
    .first<{ id: string }>();
  if (dup) return { document: docOut((await documentRow(db, c.var.viewer.org, dup.id))!), status: 200 as const };
  // A different file under a name the case already has is kept under "name (2)", so it is stored, logged and checked
  // for the wrong patient like any other (UNIQUE(case_id, file_name)).
  const taken = new Set(
    (await orgQuery(c, "SELECT file_name FROM documents WHERE org_id = ?org AND case_id = ?1", id).all<{ file_name: string }>()).results.map((r) => r.file_name),
  );
  const dot = name.lastIndexOf(".");
  const [stem, ext] = dot > 0 ? [name.slice(0, dot), name.slice(dot)] : [name, ""];
  let fileName = name;
  for (let n = 2; taken.has(fileName); n++) fileName = `${stem} (${n})${ext}`;

  const identity: Identity | null = fx && fx.fx_full_name ? compareIdentity({ full_name: fx.fx_full_name, birth_number: fx.fx_birth_number }, u) : fx ? "cannot_verify" : null;
  const docId = `up-${newId()}`;
  // A kept image (a phone photo of a page) is stored as it came, under its own type; the pipeline converts it to a PDF
  // in its own output, so the original stays unchanged.
  const stored = image ?? { mediaType: "application/pdf", ext: ".pdf" };
  const key = keep ? orgKey(c.var.viewer.org, `uploads/${id}/${docId}${stored.ext}`) : null;
  const at = isoNow();
  // R2 first, so D1 never points at a missing object; the batch below deletes nothing if it fails, so the object is
  // removed here (and the reset clears uploads/ in any case).
  if (key && bytes) await c.env.DOCS.put(key, bytes, { httpMetadata: { contentType: stored.mediaType }, sha256: sha! });
  const t = tx(c, breakGlass).onConstraint(/UNIQUE constraint failed: documents\.org_id, documents\.case_id|documents_case_sha/, () => UP.duplicate());
  t.guard("unlocked", UNLOCKED_COND, [id, id], () => UP.locked());
  t.guard("count", "(SELECT COUNT(*) FROM documents WHERE org_id = ?org AND case_id = ?) < ?", [id, MAX_DOCUMENTS_PER_CASE], () => UP.tooMany());
  t.run(
    `INSERT INTO documents (org_id, id, case_id, file_name, media_type, page_count, original_r2_key, sha256, size_bytes, origin, processing,
       uploaded_by, created_at, state, fixture_id, identity, title_cs, doc_type, doc_date, source, upload_session_id)
     VALUES (?org, ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, 'upload', 'unprocessed', ?9, ?10, 'stored', ?11, ?12, ?13, ?14, ?15, ?16, ?17)`,
    docId, id, fileName, keep ? stored.mediaType : mediaTypeOf(c.req.header("content-type")), fx?.page_count ?? 0, key, sha, declared, c.var.viewer.id, at,
    fx?.fixture_id ?? null, identity, fx?.title_cs ?? null, fx?.doc_type ?? null, fx?.doc_date ?? null, via?.source ?? null, via?.sessionId ?? null,
  );
  const phone = via?.source === "phone";
  t.audit({ action: "document.upload", what_cs: sha ? uploadLine(declared, sha, phone, !!image) : listedLine(declared, phone), case_id: id, target_type: "document", target_id: docId });
  // The reviewer sees that a document of another patient reached this case; the line names no one.
  if (identity === "conflicts")
    t.audit({ action: "document.identity_conflict", what_cs: "nahraný dokument patří podle registru ukázkových dat jinému pacientovi", case_id: id, target_type: "document", target_id: docId });
  try {
    await t.commit();
  } catch (e) {
    if (key) await c.env.DOCS.delete(key).catch(() => {});
    throw e;
  }
  // A kept file is read at once where the pipeline runs for this org (team decision: process on upload, the list shows
  // "zpracovává se"); never in demo org A (PIPELINE_ORGS), and an open intake waits for its end.
  if (key) await autoStart(c, [docId], breakGlass);
  const row = await documentRow(db, c.var.viewer.org, docId);
  return { document: docOut(row!), status: 201 as const };
}

export const documents = new Hono<AppEnv>()
  .post("/cases/:id/documents", async (c) => {
    const id = c.req.param("id");
    label(c, "nahrání dokumentu", id);
    const { breakGlass } = await caseFor(c, id, "document.upload");
    const u = await uploadContext(c.env.DB, c.var.viewer.org, id);
    if (!u) throw E.caseNotFound();
    assertUnlocked(u);
    if (u.doc_count >= MAX_DOCUMENTS_PER_CASE) throw UP.tooMany();
    await limitOrThrow(c, "RL_UPLOAD");
    const r = await receiveUpload(c, id, u, breakGlass, null);
    return answer(c, { document: r.document }, {}, r.status);
  })
  .get("/cases/:id/documents", async (c) => {
    const id = c.req.param("id");
    await openCase(c, id, "header");
    await audit(c, { action: "case.documents", case_id: id, what_cs: "zobrazil(a) seznam dokumentů" });
    const docs = await caseDocuments(c.env.DB, c.var.viewer.org, id);
    const parts = await c.var.stores.cases.documents(id);
    return c.json({
      case_id: id,
      processing_level: levelOf(docs),
      documents: docs.map((d) => ({ ...docOut(d), parts: parts.find((p) => p.id === d.id)?.parts ?? [] })),
    });
  })
  .delete("/documents/:id", async (c) => {
    const docId = c.req.param("id");
    const d = await documentRow(c.env.DB, c.var.viewer.org, docId);
    label(c, "odebrání nahraného dokumentu", d?.case_id ?? null);
    if (!d) throw UP.notFound();
    const { breakGlass } = await caseFor(c, d.case_id, "document.upload");
    const u = await uploadContext(c.env.DB, c.var.viewer.org, d.case_id);
    if (!u) throw E.caseNotFound();
    assertUnlocked(u);
    // A prepared or processed document is part of what the case shows; removing it would change the record under it.
    if (d.origin !== "upload" || d.state !== "stored") throw UP.notRemovable();
    const t = tx(c, breakGlass);
    t.guard("unlocked", UNLOCKED_COND, [d.case_id, d.case_id], () => UP.locked());
    t.guard("stored", "(SELECT state FROM documents WHERE org_id = ?org AND id = ?) = 'stored'", [docId], () => UP.notRemovable());
    t.run("DELETE FROM pages WHERE org_id = ?org AND document_id = ?1", docId);
    t.run("DELETE FROM document_parts WHERE org_id = ?org AND document_id = ?1", docId);
    t.run("DELETE FROM documents WHERE org_id = ?org AND id = ?1", docId);
    t.audit({ action: "document.remove", what_cs: "odebral(a) nahraný dokument", case_id: d.case_id, target_type: "document", target_id: docId });
    await t.commit();
    // The file goes with its row; a failed delete is left to the reset, which clears the org's uploads/.
    await deleteUploadObjects(c, c.var.viewer.org, d).catch(() => console.error(JSON.stringify({ route: "document.remove", r2: "delete_failed" })));
    return answer(c, { removed: docId });
  });

// The document's own objects: its file (by the key its row stores) and the pipeline's outputs under its prefix, under
// the org and, for demo org A, also under the prefix used before orgs.
export async function deleteUploadObjects(c: Context<AppEnv> | { env: Env }, org: string, d: Pick<DocRow, "id" | "case_id" | "original_r2_key">) {
  const keys: string[] = d.original_r2_key ? [d.original_r2_key] : [];
  const prefixes = [orgKey(org, `uploads/${d.case_id}/${d.id}/`), ...(org === LEGACY_ORG ? [`uploads/${d.case_id}/${d.id}/`] : [])];
  for (const prefix of prefixes) {
    const listed = await c.env.DOCS.list({ prefix, limit: 1000 });
    keys.push(...listed.objects.map((o) => o.key));
  }
  if (keys.length) await c.env.DOCS.delete(keys);
}

export type { FixtureRow };
