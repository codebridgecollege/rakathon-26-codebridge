// Uploads (step 6, slice a-1): one PDF per request to a case, the case's document list and removing an unprocessed
// upload. In the shared demo (UPLOAD_POLICY=fixtures_only) only registered synthetic fixtures are stored; the file is
// read into memory and hashed first, so a refused file never touches R2 or D1. Design: step-6.md "As implemented".
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
  fileNameOf,
  uploadLine,
  uploadPolicy,
  type Identity,
} from "../domain/documents";
import { audit } from "../middleware/audit";
import { UNLOCKED_COND, caseDocuments, documentRow, fixtureByHash, uploadContext, type DocRow, type FixtureRow } from "../store/documents";
import { openCase } from "./access-check";
import { answer, caseFor, isoNow, label, newId, tx } from "./write-context";

const hex = (b: ArrayBuffer) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("");

// Reads the body up to max bytes; one byte more refuses the upload without reading the rest.
async function readLimited(body: ReadableStream<Uint8Array> | null, max: number): Promise<Uint8Array> {
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
      throw UP.tooLarge();
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
    state: d.state,
    state_cs: d.state ? STATE_CS[d.state] ?? d.state : null,
    state_detail_cs: d.state_detail_cs,
    identity: d.identity,
    identity_cs: d.identity === "conflicts" ? IDENTITY_ALERT_CS : null,
    readability: d.readability,
    readability_reasons_cs: reasons,
    uploaded_by: d.uploaded_by_name,
    uploaded_at: d.created_at,
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

export const documents = new Hono<AppEnv>()
  .post("/cases/:id/documents", async (c) => {
    const id = c.req.param("id");
    label(c, "nahrání dokumentu", id);
    const { breakGlass } = await caseFor(c, id, "document.upload");
    const db = c.env.DB;
    const u = await uploadContext(db, id);
    if (!u) throw E.caseNotFound();
    assertUnlocked(u);
    if (u.doc_count >= MAX_DOCUMENTS_PER_CASE) throw UP.tooMany();
    await limitOrThrow(c, "RL_UPLOAD");
    const max = numVar(c.env.UPLOAD_MAX_BYTES);
    const len = c.req.header("content-length");
    if (!len || !/^\d+$/.test(len)) throw UP.lengthRequired();
    // Refused before reading: the declared size is over the limit.
    if (Number(len) > max) throw UP.tooLarge();
    const name = fileNameOf(c.req.header("x-file-name"));
    const bytes = await readLimited(c.req.raw.body, max);
    if (!bytes.length) throw UP.empty();
    if (bytes.length !== Number(len)) throw E.badRequest();
    const kind = fileKind(bytes);
    if (kind === "zip") throw UP.zip();
    if (kind !== "pdf") throw UP.notPdf();
    const sha = hex(await crypto.subtle.digest("SHA-256", bytes));
    const fx = await fixtureByHash(db, sha);
    const policy = uploadPolicy(c.env.UPLOAD_POLICY);
    // Matching is by the bytes only: a renamed copy matches, an edited file with the same name does not.
    if (policy === "fixtures_only" && (!fx || fx.kind === "referral")) throw UP.notFixture();
    const dup = await db
      .prepare("SELECT sha256 = ?2 AS same_sha FROM documents WHERE case_id = ?1 AND (sha256 = ?2 OR file_name = ?3) ORDER BY same_sha DESC LIMIT 1")
      .bind(id, sha, name)
      .first<{ same_sha: number }>();
    if (dup) throw dup.same_sha ? UP.duplicate() : UP.nameTaken();

    const identity: Identity | null = fx && fx.fx_full_name ? compareIdentity({ full_name: fx.fx_full_name, birth_number: fx.fx_birth_number }, u) : fx ? "cannot_verify" : null;
    const docId = `up-${newId()}`;
    const key = `uploads/${id}/${docId}.pdf`;
    const at = isoNow();
    // R2 first, so D1 never points at a missing object; the batch below deletes nothing if it fails, so the object is
    // removed here (and the reset clears uploads/ in any case).
    await c.env.DOCS.put(key, bytes, { httpMetadata: { contentType: "application/pdf" }, sha256: sha });
    const t = tx(c, breakGlass)
      .onConstraint(/UNIQUE constraint failed: documents\.case_id, documents\.sha256|documents_case_sha/, () => UP.duplicate())
      .onConstraint(/UNIQUE constraint failed: documents\.case_id, documents\.file_name/, () => UP.nameTaken());
    t.guard("unlocked", UNLOCKED_COND, [id, id], () => UP.locked());
    t.guard("count", "(SELECT COUNT(*) FROM documents WHERE case_id = ?) < ?", [id, MAX_DOCUMENTS_PER_CASE], () => UP.tooMany());
    t.run(
      `INSERT INTO documents (id, case_id, file_name, media_type, page_count, original_r2_key, sha256, size_bytes, origin, processing,
         uploaded_by, created_at, state, fixture_id, identity, title_cs, doc_type, doc_date)
       VALUES (?1, ?2, ?3, 'application/pdf', ?4, ?5, ?6, ?7, 'upload', 'unprocessed', ?8, ?9, 'stored', ?10, ?11, ?12, ?13, ?14)`,
      docId, id, name, fx?.page_count ?? 0, key, sha, bytes.length, c.var.viewer.id, at,
      fx?.fixture_id ?? null, identity, fx?.title_cs ?? null, fx?.doc_type ?? null, fx?.doc_date ?? null,
    );
    t.audit({ action: "document.upload", what_cs: uploadLine(bytes.length, sha), case_id: id, target_type: "document", target_id: docId });
    // The reviewer sees that a document of another patient reached this case; the line names no one.
    if (identity === "conflicts")
      t.audit({ action: "document.identity_conflict", what_cs: "nahraný dokument patří podle registru ukázkových dat jinému pacientovi", case_id: id, target_type: "document", target_id: docId });
    try {
      await t.commit();
    } catch (e) {
      await c.env.DOCS.delete(key).catch(() => {});
      throw e;
    }
    const row = await documentRow(db, docId);
    return answer(c, { document: docOut(row!) }, {}, 201);
  })
  .get("/cases/:id/documents", async (c) => {
    const id = c.req.param("id");
    await openCase(c, id, "header");
    await audit(c, { action: "case.documents", case_id: id, what_cs: "zobrazil(a) seznam dokumentů" });
    const docs = await caseDocuments(c.env.DB, id);
    const parts = await c.var.stores.cases.documents(id);
    return c.json({
      case_id: id,
      processing_level: levelOf(docs),
      documents: docs.map((d) => ({ ...docOut(d), parts: parts.find((p) => p.id === d.id)?.parts ?? [] })),
    });
  })
  .delete("/documents/:id", async (c) => {
    const docId = c.req.param("id");
    const d = await documentRow(c.env.DB, docId);
    label(c, "odebrání nahraného dokumentu", d?.case_id ?? null);
    if (!d) throw UP.notFound();
    const { breakGlass } = await caseFor(c, d.case_id, "document.upload");
    const u = await uploadContext(c.env.DB, d.case_id);
    if (!u) throw E.caseNotFound();
    assertUnlocked(u);
    // A prepared or processed document is part of what the case shows; removing it would change the record under it.
    if (d.origin !== "upload" || d.state !== "stored") throw UP.notRemovable();
    const t = tx(c, breakGlass);
    t.guard("unlocked", UNLOCKED_COND, [d.case_id, d.case_id], () => UP.locked());
    t.guard("stored", "(SELECT state FROM documents WHERE id = ?) = 'stored'", [docId], () => UP.notRemovable());
    t.run("DELETE FROM pages WHERE document_id = ?1", docId);
    t.run("DELETE FROM document_parts WHERE document_id = ?1", docId);
    t.run("DELETE FROM documents WHERE id = ?1", docId);
    t.audit({ action: "document.remove", what_cs: "odebral(a) nahraný dokument", case_id: d.case_id, target_type: "document", target_id: docId });
    await t.commit();
    // The file goes with its row; a failed delete is left to the reset, which clears uploads/.
    await deleteUploadObjects(c, d).catch(() => console.error(JSON.stringify({ route: "document.remove", r2: "delete_failed" })));
    return answer(c, { removed: docId });
  });

export async function deleteUploadObjects(c: Context<AppEnv> | { env: Env }, d: Pick<DocRow, "id" | "case_id" | "original_r2_key">) {
  const keys: string[] = d.original_r2_key ? [d.original_r2_key] : [];
  const prefix = `uploads/${d.case_id}/${d.id}/`;
  const listed = await c.env.DOCS.list({ prefix, limit: 1000 });
  keys.push(...listed.objects.map((o) => o.key));
  if (keys.length) await c.env.DOCS.delete(keys);
}

export type { FixtureRow };
