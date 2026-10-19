// Route tests of uploads (step 6, slice a-1) on local D1 and R2: the fixture registry by hash, that every other file is
// accepted but only listed (no content, hash or identity kept), repeats, the wrong-patient check, removal, the document
// list, the reset, and that no access-log line carries a file name or patient text.
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import { call, testEnv } from "./helpers";
import { fileKind, imageType, uploadPolicy } from "../src/domain/documents";
import { FAKE_NAME, loadFixture } from "./data";
import { sweep } from "../src/scheduled";
import { cacheKey, cacheScope } from "../src/services/model-cache";
import { deleteDocumentObjects } from "../src/routes/documents";

type Body = { data?: Record<string, any>; data_epoch?: number; state?: Record<string, any>; error?: { code: string; message_cs: string } };

const q = async <T = Record<string, unknown>>(sql: string, ...args: unknown[]) => (await env.DB.prepare(sql).bind(...args).all<T>()).results;
// Org A's rows: the fixture's org B look-alikes must stay as they are, and never count here.
const count = async (table: string, where = "1", org = "demo-a") => (await q<{ n: number }>(`SELECT COUNT(*) AS n FROM ${table} WHERE org_id = '${org}' AND (${where})`))[0]!.n;
const log = () => q<{ action: string; what_cs: string; case_id: string | null; target_id: string | null }>("SELECT * FROM access_log ORDER BY id");
const seenLog: string[] = [];

const enc = new TextEncoder();
// Small PDFs that differ by one marker, so each has its own hash. The bytes only need the PDF header.
const pdf = (marker: string) => enc.encode(`%PDF-1.4\n% ${marker}\n1 0 obj << >> endobj\ntrailer << >>\n%%EOF\n`);
const hex = async (b: Uint8Array) => [...new Uint8Array(await crypto.subtle.digest("SHA-256", b))].map((x) => x.toString(16).padStart(2, "0")).join("");

// The patient of case NO-A is the test fixture's FAKE_NAME with birth number 645312/1234.
const MINE = pdf("fixture of patient A");
const OTHER = pdf("fixture of another patient");
const NO_ID = pdf("fixture without a patient");
const UNKNOWN = pdf("not registered");

async function registerFixtures() {
  await env.DB.batch([
    env.DB.prepare("INSERT INTO fixture_patients (fixture_id, full_name, birth_number, data_origin) VALUES ('FX-A', ?1, '645312/1234', 'codebridge_synthetic'), ('FX-O', 'Jiná Osoba', '585614/4019', 'codebridge_synthetic')").bind("Pacientka Testová"),
    env.DB.prepare(
      `INSERT INTO fixture_files (sha256, fixture_id, file_name, r2_prefix, kind, size_bytes, title_cs, doc_type, doc_date, page_count, combined_pages_json) VALUES
       (?1, 'FX-A', 'a.pdf', 'fixtures/FX-A/', 'upload', 1, 'Laboratorní výsledky', 'laboratorní výsledky', '2026-03-10', 1, '[5]'),
       (?2, 'FX-O', 'o.pdf', 'fixtures/FX-O/', 'upload', 1, 'Histologie', 'histologie', '2026-03-12', 1, '[3]'),
       (?3, 'FX-N', 'n.pdf', 'fixtures/FX-N/', 'upload', 1, NULL, NULL, NULL, 1, NULL)`,
    ).bind(await hex(MINE), await hex(OTHER), await hex(NO_ID)),
  ]);
}

async function upload(caseId: string, bytes: Uint8Array, name = "zprava.pdf", user = "d2p1", over: Record<string, string> = {}, e = testEnv()) {
  const r = await call(
    `/api/cases/${caseId}/documents`,
    {
      method: "POST",
      headers: { "content-type": "application/pdf", "x-demo-user": user, "x-data-epoch": "1", "x-file-name": encodeURIComponent(name), "content-length": String(bytes.length), ...over },
      body: bytes,
    },
    e,
  );
  return { status: r.status, body: (await r.json()) as Body };
}
async function w(method: string, path: string, body: unknown = {}, user = "d2p1") {
  const r = await call(`/api${path}`, { method, headers: { "content-type": "application/json", "x-demo-user": user, "x-data-epoch": "1" }, body: JSON.stringify(body) });
  return { status: r.status, body: (await r.json()) as Body };
}
// Uploads go under the case's org (DATABASE.md, R2 prefixes).
const uploadsInR2 = async () => (await env.DOCS.list({ prefix: "org/demo-a/uploads/" })).objects.map((o) => o.key);

beforeEach(async () => {
  for (const r of await log().catch(() => [])) seenLog.push(r.what_cs);
  await loadFixture();
  await registerFixtures();
});

describe("upload of a registered fixture", () => {
  it("stores the file in R2 under uploads/, writes the row with the hash, one audit line without the name", async () => {
    const r = await upload("NO-A", MINE, "Pacientka Testova lab.pdf");
    expect(r.status).toBe(201);
    const d = r.body.data!.document;
    expect(d).toMatchObject({ name: "Pacientka Testova lab.pdf", state: "stored", state_cs: "nezpracováno", fixture: true, identity: "matches", identity_cs: null, type_cs: "Laboratorní výsledky", uploaded_by: "MUDr. Svobodová" });
    expect(d.sha256).toBe(await hex(MINE));
    const row = (await q<{ original_r2_key: string; sha256: string; origin: string }>("SELECT * FROM documents WHERE id = ?1", d.id))[0]!;
    expect(row.origin).toBe("upload");
    const obj = await env.DOCS.get(row.original_r2_key);
    expect(row.original_r2_key).toBe(`org/demo-a/uploads/NO-A/${d.id}.pdf`);
    expect(new Uint8Array(await obj!.arrayBuffer())).toEqual(MINE);
    const lines = (await log()).filter((l) => l.action === "document.upload");
    expect(lines).toHaveLength(1);
    expect(lines[0]!.what_cs).toMatch(/^nahrál\(a\) dokument k případu \(PDF, 1 kB, otisk [0-9a-f]{12}\)$/);
    expect(lines[0]!.what_cs).not.toMatch(/Testova|lab\.pdf/);
  });

  it("matches a renamed copy by its bytes", async () => {
    expect((await upload("NO-A", MINE, "kopie.pdf")).body.data!.document.fixture).toBe(true);
  });

  it("raises the wrong-patient alert for another patient's fixture, without blocking", async () => {
    const r = await upload("NO-A", OTHER, "histo.pdf");
    expect(r.status).toBe(201);
    expect(r.body.data!.document).toMatchObject({ identity: "conflicts", identity_cs: "Jméno nebo rodné číslo v dokumentu se neshoduje s pacientem případu; ověřte, zda dokument patří tomuto pacientovi." });
    expect((await log()).map((l) => l.action)).toContain("document.identity_conflict");
    // The answer never carries the fixture's patient.
    expect(JSON.stringify(r.body)).not.toMatch(/Jiná Osoba|585614/);
  });

  it("cannot verify a fixture whose registry names no patient", async () => {
    expect((await upload("NO-A", NO_ID)).body.data!.document.identity).toBe("cannot_verify");
  });
});

describe("any other file is listed, never stored", () => {
  const listed = async (id: string) => (await q<Record<string, unknown>>("SELECT original_r2_key, sha256, fixture_id, identity, title_cs, size_bytes, media_type, state FROM documents WHERE id = ?1", id))[0];
  const LISTED = { original_r2_key: null, sha256: null, fixture_id: null, identity: null, title_cs: null, state: "stored" };

  it("accepts an unregistered PDF in the shared demo and keeps only its name, size, uploader and time", async () => {
    const r = await upload("NO-A", UNKNOWN, "cizi zprava.pdf");
    expect(r.status).toBe(201);
    expect(r.body.data!.document).toMatchObject({ name: "cizi zprava.pdf", size: UNKNOWN.length, fixture: false, content_stored: false, identity: null, sha256: null, uploaded_by: "MUDr. Svobodová" });
    expect(await listed(r.body.data!.document.id)).toMatchObject({ ...LISTED, size_bytes: UNKNOWN.length, media_type: "application/pdf" });
    expect(await uploadsInR2()).toEqual([]);
    expect((await log()).filter((l) => l.action === "document.upload").map((l) => l.what_cs)).toEqual(["nahrál(a) soubor k případu (uložen jen název a velikost, 1 kB)"]);
  });

  it("lists other formats, ZIP, empty and oversized files the same way, without an error", async () => {
    const word = await upload("NO-A", enc.encode("hello, I am not a PDF"), "zprava.docx", "d2p1", { "content-type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document" });
    const zip = await upload("NO-A", Uint8Array.from([0x50, 0x4b, 3, 4, 1, 2, 3]), "docs.zip", "d2p1", { "content-type": "application/zip" });
    const empty = await upload("NO-A", new Uint8Array(), "prazdny.pdf");
    const big = await upload("NO-A", MINE, "velky.pdf", "d2p1", {}, testEnv({ UPLOAD_MAX_BYTES: "20" }));
    for (const r of [word, zip, empty, big]) {
      expect(r.status).toBe(201);
      expect(await listed(r.body.data!.document.id)).toMatchObject(LISTED);
    }
    // An oversized fixture is not read, so it is not recognised either.
    expect(big.body.data!.document).toMatchObject({ fixture: false, size: MINE.length });
    expect((await listed(word.body.data!.document.id))!.media_type).toBe("application/vnd.openxmlformats-officedocument.wordprocessingml.document");
    expect(await uploadsInR2()).toEqual([]);
  });

  it("lists a declared size over the limit without reading the body", async () => {
    const r = await upload("NO-A", MINE, "x.pdf", "d2p1", { "content-length": String(30 * 1024 * 1024) });
    expect([r.status, r.body.data!.document.size]).toEqual([201, 30 * 1024 * 1024]);
    expect(await uploadsInR2()).toEqual([]);
  });

  it("answers a repeat with the document already there", async () => {
    const a = (await upload("NO-A", MINE, "a.pdf")).body.data!.document;
    const dup = await upload("NO-A", MINE, "b.pdf");
    expect([dup.status, dup.body.data!.document.id]).toEqual([200, a.id]);
    const l1 = (await upload("NO-A", UNKNOWN, "c.docx")).body.data!.document;
    expect((await upload("NO-A", UNKNOWN, "c.docx")).body.data!.document.id).toBe(l1.id);
    // A different file under a taken name is its own document, renamed; another patient's fixture still raises the alert.
    const other = await upload("NO-A", OTHER, "a.pdf");
    expect([other.status, other.body.data!.document.name, other.body.data!.document.identity]).toEqual([201, "a (2).pdf", "conflicts"]);
    const listed = await upload("NO-A", UNKNOWN, "a.pdf");
    expect([listed.status, listed.body.data!.document.name]).toEqual([201, "a (3).pdf"]);
    // The case's own seeded PDF is not a repeat of an upload: same name as the seed row, a new listed document.
    const seedName = (await q<{ file_name: string }>("SELECT file_name FROM documents WHERE origin = 'seed' AND case_id = 'NO-A'"))[0]!.file_name;
    const again = await upload("NO-A", enc.encode("not the seed"), seedName);
    expect([again.status, again.body.data!.document.origin]).toEqual([201, "upload"]);
    expect(await uploadsInR2()).toHaveLength(2);
    expect(await count("documents", "origin = 'upload'")).toBe(5);
  });

  it("removes a listed file", async () => {
    const d = (await upload("NO-A", UNKNOWN, "x.pdf")).body.data!.document;
    expect((await w("DELETE", `/documents/${d.id}`)).status).toBe(200);
    expect(await count("documents", "origin = 'upload'")).toBe(0);
  });

  it("refuses uploads to an approved or closed case", async () => {
    await env.DB.prepare("INSERT INTO protocols (org_id, case_id, conclusion, state) VALUES ('demo-a', 'NO-A', 'x', 'approved')").run();
    const r = await upload("NO-A", MINE);
    expect([r.status, r.body.error!.code]).toEqual([409, "case_locked"]);
    await env.DB.prepare("UPDATE cases SET status = 'closed' WHERE id = 'NO-B'").run();
    expect((await upload("NO-B", MINE)).body.error!.code).toBe("case_locked");
    expect(await uploadsInR2()).toEqual([]);
  });

  it("refuses the administrator and a doctor outside the team, and logs the refusal", async () => {
    expect((await upload("NO-A", MINE, "x.pdf", "admin")).status).toBe(403);
    const r = await upload("NO-A", MINE, "x.pdf", "d1p1");
    expect([r.status, r.body.error!.code]).toEqual([403, "not_member"]);
    expect((await log()).filter((l) => l.action === "write.refused").map((l) => l.what_cs)).toEqual(["odmítnuto: nahrání dokumentu", "odmítnuto: nahrání dokumentu"]);
    expect(await uploadsInR2()).toEqual([]);
  });

  it("refuses without a file name or with a stale data epoch", async () => {
    expect((await upload("NO-A", MINE, "", "d2p1", { "x-file-name": "" })).status).toBe(422);
    expect((await upload("NO-A", MINE, "x.pdf", "d2p1", { "x-data-epoch": "9" })).body.error!.code).toBe("data_reset");
  });
});

describe("other policies", () => {
  it("store_unprocessed keeps an unknown PDF as nezpracováno, with no identity result, and still only lists a Word file", async () => {
    const r = await upload("NO-A", UNKNOWN, "x.pdf", "d2p1", {}, testEnv({ UPLOAD_POLICY: "store_unprocessed" }));
    expect(r.status).toBe(201);
    expect(r.body.data!.document).toMatchObject({ fixture: false, identity: null, state: "stored", content_stored: true });
    const word = await upload("NO-A", enc.encode("not a pdf"), "y.docx", "d2p1", {}, testEnv({ UPLOAD_POLICY: "store_unprocessed" }));
    expect(word.body.data!.document.content_stored).toBe(false);
    expect((await q<{ sha256: string }>("SELECT sha256 FROM documents WHERE origin = 'upload'"))[0]!.sha256).toBe(await hex(UNKNOWN));
  });

  it("UPLOAD_STORE_ORGS keeps content for a listed org only (never demo org A), a photo under its own type, an office file listed only", async () => {
    const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]);
    const on = testEnv({ UPLOAD_STORE_ORGS: "demo-b" });
    // Demo org A stays listed only, as the demo always showed it, even when the list names it by mistake.
    const a = await upload("NO-A", UNKNOWN, "x.pdf", "d2p1", {}, testEnv({ UPLOAD_STORE_ORGS: "demo-b, demo-a" }));
    expect(a.body.data!.document).toMatchObject({ content_stored: false, sha256: null });
    const aPhoto = await upload("NO-A", JPEG, "image.jpg", "d2p1", {}, testEnv({ UPLOAD_STORE_ORGS: "demo-a" }));
    expect(aPhoto.body.data!.document).toMatchObject({ content_stored: false, sha256: null });
    // Demo org B, listed: the photo is stored under its own type; the Word file is not.
    const photo = await upload("B-NO-A", JPEG, "image.jpg", "b-doc", {}, on);
    expect(photo.status).toBe(201);
    expect(photo.body.data!.document).toMatchObject({ content_stored: true, state: "stored", fixture: false, identity: null });
    const row = (await q<{ media_type: string; original_r2_key: string; sha256: string }>("SELECT media_type, original_r2_key, sha256 FROM documents WHERE case_id = 'B-NO-A' AND file_name = 'image.jpg'"))[0]!;
    expect(row.media_type).toBe("image/jpeg");
    expect(row.original_r2_key).toMatch(/^org\/demo-b\/uploads\/B-NO-A\/up-[^/]+\.jpg$/);
    expect(row.sha256).toBe(await hex(JPEG));
    expect((await env.DOCS.head(row.original_r2_key))?.httpMetadata?.contentType).toBe("image/jpeg");
    // The same photo again is the document already there.
    const again = await upload("B-NO-A", JPEG, "other-name.jpg", "b-doc", {}, on);
    expect([again.status, again.body.data!.document.id]).toEqual([200, photo.body.data!.document.id]);
    const word = await upload("B-NO-A", enc.encode("PK\u0003\u0004 docx"), "z.docx", "b-doc", {}, on);
    expect(word.body.data!.document.content_stored).toBe(false);
    expect((await log()).map((l) => l.what_cs)).toContain(`nahrál(a) dokument k případu (obrázek, 1 kB, otisk ${(await hex(JPEG)).slice(0, 12)})`);
  });

  it("tells a photo from a PDF by its bytes, and never switches demo org A on", () => {
    const b = (...x: number[]) => new Uint8Array(x);
    expect(fileKind(b(0xff, 0xd8, 0xff, 0xdb))).toBe("image");
    expect(fileKind(b(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0))).toBe("image");
    expect(fileKind(enc.encode("%PDF-1.7\n"))).toBe("pdf");
    expect(fileKind(enc.encode("junk %PDF-1.4"))).toBe("pdf");
    expect(fileKind(b(0xff, 0xd8))).toBe("other");
    expect(fileKind(enc.encode("PK\u0003\u0004"))).toBe("zip");
    expect(imageType(b(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a))).toEqual({ mediaType: "image/png", ext: ".png" });
    expect(uploadPolicy("fixtures_only", "demo-a", "demo-a")).toBe("fixtures_only");
    expect(uploadPolicy("fixtures_only", "demo-b", " demo-b ")).toBe("store_unprocessed");
  });
});

describe("withdrawing another patient's processed upload", () => {
  const withdraw = (id: string, reason: unknown = "wrong_patient", user = "d2p1") =>
    call(`/api/documents/${id}/withdraw`, { method: "POST", headers: { "content-type": "application/json", "x-demo-user": user, "x-data-epoch": "1" }, body: JSON.stringify({ reason }) })
      .then(async (r) => ({ status: r.status, body: (await r.json()) as Body }));

  // Another patient's document, uploaded and read by the pipeline: its file, a run's outputs, a page row and a part.
  async function processedOther() {
    const d = (await upload("NO-A", OTHER, "o.pdf")).body.data!.document;
    const key = (await q<{ original_r2_key: string }>("SELECT original_r2_key FROM documents WHERE id = ?1", d.id))[0]!.original_r2_key;
    const prefix = key.replace(/\.pdf$/, "/pl-1/");
    await env.DOCS.put(`${prefix}p1.png`, "png");
    await env.DOCS.put(`${prefix}p1.json`, "{}");
    await env.DB.batch([
      env.DB.prepare("UPDATE documents SET state = 'processed', processing = 'processed', page_count = 1 WHERE id = ?1").bind(d.id),
      env.DB.prepare(
        `INSERT INTO pipeline_runs (org_id, id, document_id, case_id, state, pipeline_version, input_sha256, output_prefix, created_by, created_by_name, created_at, updated_at)
         VALUES ('demo-a', 'pl-1', ?1, 'NO-A', 'done', 'dev', ?2, ?3, 'd2p1', 'x', '2026-10-19T08:00:00Z', '2026-10-19T08:00:00Z')`,
      ).bind(d.id, await hex(OTHER), prefix),
      env.DB.prepare("INSERT INTO pages (org_id, document_id, n, json_r2_key, image_r2_key, width, height, engine, is_empty) VALUES ('demo-a', ?1, 1, ?2, ?3, 1, 1, 'tesseract', 0)")
        .bind(d.id, `${prefix}p1.json`, `${prefix}p1.png`),
      env.DB.prepare("INSERT INTO document_parts (org_id, document_id, ordinal, title_cs, pages_json) VALUES ('demo-a', ?1, 0, 'Histologie', '[1]')").bind(d.id),
    ]);
    return { id: d.id as string, key, prefix };
  }

  it("keeps a neutral row with its reason and the run's history, deletes everything of the other patient, and lets the file come again", async () => {
    const { id, key, prefix } = await processedOther();
    // The model's cached answers: one about this document, one over several documents of the case, one about another
    // document of the case and one in another case. The first two go with the withdraw, the others stay.
    const cached = {
      own: cacheKey("demo-a", "NO-A", cacheScope([id]), "m", { ref: "p@1", sha256: "a".repeat(64) }, "1".repeat(64)),
      multi: cacheKey("demo-a", "NO-A", cacheScope([id, "A_pacient"]), "m", { ref: "p@1", sha256: "a".repeat(64) }, "2".repeat(64)),
      other: cacheKey("demo-a", "NO-A", cacheScope(["A_pacient"]), "m", { ref: "p@1", sha256: "a".repeat(64) }, "3".repeat(64)),
      otherCase: cacheKey("demo-a", "NO-B", cacheScope([id]), "m", { ref: "p@1", sha256: "a".repeat(64) }, "4".repeat(64)),
      // A document whose ID starts with the withdrawn one's: its folder must not match the prefix.
      longerId: cacheKey("demo-a", "NO-A", cacheScope([`${id}0`]), "m", { ref: "p@1", sha256: "a".repeat(64) }, "5".repeat(64)),
    };
    for (const k of Object.values(cached)) await env.DOCS.put(k, "{}");
    const r = await withdraw(id);
    expect(r.status).toBe(200);
    expect(await env.DOCS.head(cached.own)).toBeNull();
    expect(await env.DOCS.head(cached.multi)).toBeNull();
    expect(await env.DOCS.head(cached.other)).not.toBeNull();
    expect(await env.DOCS.head(cached.otherCase)).not.toBeNull();
    expect(await env.DOCS.head(cached.longerId)).not.toBeNull();
    // The cron retry leaves a multi-document answer written after the withdraw (it cannot have read the document).
    const later = cacheKey("demo-a", "NO-A", cacheScope(["A_pacient", "B_pacient"]), "m", { ref: "p@1", sha256: "a".repeat(64) }, "6".repeat(64));
    await env.DOCS.put(later, "{}");
    await deleteDocumentObjects(env, "demo-a", "NO-A", id, "2000-01-01T00:00:00.000Z");
    expect(await env.DOCS.head(later)).not.toBeNull();
    expect(r.body.data!.document).toMatchObject({ lifecycle: "withdrawn", lifecycle_reason_cs: "dokument jiného pacienta", content_stored: false, sha256: null, type_cs: null, doc_date: null, fixture: false });
    expect(r.body.data!.document.name).toBe(`odebraný dokument ${id.slice(-6)}`);
    const row = (await q<Record<string, unknown>>("SELECT lifecycle, lifecycle_changed_by, original_r2_key, sha256, file_name, title_cs FROM documents WHERE id = ?1", id))[0]!;
    expect(row).toMatchObject({ lifecycle: "withdrawn", lifecycle_changed_by: "d2p1", original_r2_key: null, sha256: null, title_cs: null });
    expect(await count("pages", `document_id = '${id}'`)).toBe(0);
    expect(await count("document_parts", `document_id = '${id}'`)).toBe(0);
    expect(await count("pipeline_runs", `document_id = '${id}'`)).toBe(1);
    expect(await env.DOCS.head(key)).toBeNull();
    expect((await env.DOCS.list({ prefix })).objects).toEqual([]);
    expect((await log()).map((l) => l.what_cs)).toContain("odebral(a) dokument z případu jako dokument jiného pacienta (obsah smazán)");
    // Once out, it stays out; the list shows the neutral row, and the case's level no longer counts it.
    expect((await withdraw(id)).body.error!.code).toBe("document_not_withdrawable");
    const list = (await (await call("/api/cases/NO-A/documents", { headers: { "x-demo-user": "d2p1" } })).json()) as { documents: any[] };
    expect(list.documents.find((d) => d.id === id)).toMatchObject({ lifecycle: "withdrawn", parts: [] });
    // The same bytes again are a new document under their own name, not the withdrawn one.
    const again = await upload("NO-A", OTHER, "o.pdf");
    expect([again.status, again.body.data!.document.name]).toEqual([201, "o.pdf"]);
    expect(again.body.data!.document.id).not.toBe(id);
    // A run cannot start on the withdrawn document.
    const run = await call(`/api/documents/${id}/process`, { method: "POST", headers: { "content-type": "application/json", "x-demo-user": "d2p1", "x-data-epoch": "1" }, body: "{}" }, testEnv({ PIPELINE_ORGS: "*" }));
    expect(((await run.json()) as Body).error!.code).toBe("no_file");
  });

  it("the cron sweep deletes the content again when the delete after the withdraw failed", async () => {
    const { id, prefix } = await processedOther();
    expect((await withdraw(id)).status).toBe(200);
    // As if the delete had failed: an object left under the document's prefix.
    await env.DOCS.put(`${prefix}left.json`, "{}");
    await sweep(env);
    expect((await env.DOCS.list({ prefix })).objects).toEqual([]);
  });

  it("refuses a stored upload (DELETE removes it), a prepared one, a seeded one, a bad reason, a running document and another org", async () => {
    const stored = (await upload("NO-A", MINE, "m.pdf")).body.data!.document;
    expect((await withdraw(stored.id)).body.error!.code).toBe("document_not_withdrawable");
    expect((await withdraw("A_pacient")).body.error!.code).toBe("document_not_withdrawable");
    await env.DB.prepare("UPDATE documents SET state = 'prepared' WHERE id = ?1").bind(stored.id).run();
    expect((await withdraw(stored.id)).body.error!.code).toBe("document_prepared");
    const { id } = await processedOther();
    expect((await withdraw(id, "not_needed")).status).toBe(422);
    await env.DB.prepare("UPDATE pipeline_runs SET state = 'running' WHERE id = 'pl-1'").run();
    expect((await withdraw(id)).body.error!.code).toBe("pipeline_running");
    expect((await withdraw(id, "wrong_patient", "b-doc")).status).toBe(404);
    expect((await q<{ lifecycle: string }>("SELECT lifecycle FROM documents WHERE id = ?1", id))[0]!.lifecycle).toBe("current");
  });
});

describe("listing and removal", () => {
  it("lists documents with their state and identity, and the coordinator removes an unprocessed upload", async () => {
    const a = (await upload("NO-A", OTHER, "o.pdf", "coord")).body.data!.document;
    const list = await call("/api/cases/NO-A/documents", { headers: { "x-demo-user": "d2p1" } });
    const body = (await list.json()) as { processing_level: string; documents: any[] };
    expect(body.documents.map((d) => [d.origin, d.state_cs, d.identity])).toEqual([["seed", null, null], ["upload", "nezpracováno", "conflicts"]]);
    expect(body.processing_level).toBe("partial");
    expect(JSON.stringify(body)).not.toMatch(/uploads\/|original_r2_key/);
    const del = await w("DELETE", `/documents/${a.id}`, {}, "coord");
    expect(del.status).toBe(200);
    expect(await uploadsInR2()).toEqual([]);
    expect(await count("documents", "origin = 'upload'")).toBe(0);
    expect((await log()).filter((l) => l.action === "document.remove").map((l) => l.what_cs)).toEqual(["odebral(a) nahraný dokument"]);
  });

  it("does not remove a seeded or a prepared document", async () => {
    expect((await w("DELETE", "/documents/A_pacient")).body.error!.code).toBe("document_not_removable");
    const a = (await upload("NO-A", MINE)).body.data!.document;
    await env.DB.prepare("UPDATE documents SET state = 'prepared' WHERE id = ?1").bind(a.id).run();
    expect((await w("DELETE", `/documents/${a.id}`)).body.error!.code).toBe("document_not_removable");
    expect((await w("DELETE", "/documents/nope")).status).toBe(404);
  });
});

describe("reset-demo removes uploads", () => {
  it("deletes upload rows through the reset trigger and keeps the seeded documents", async () => {
    await upload("NO-A", MINE);
    await env.DB.prepare("INSERT INTO pages (org_id, document_id, n, json_r2_key, image_r2_key, width, height, engine, is_empty) SELECT org_id, id, 1, 'x', 'y', 1, 1, 'tesseract', 0 FROM documents WHERE origin = 'upload'").run();
    await env.DB.prepare("UPDATE demo_state SET reset_in_progress = 1 WHERE org_id = 'demo-a'").run();
    expect(await count("documents", "origin = 'upload'")).toBe(0);
    expect(await count("pages", "document_id LIKE 'up-%'")).toBe(0);
    expect(await count("documents", "origin = 'seed'")).toBe(2);
    await env.DB.prepare("UPDATE demo_state SET reset_in_progress = 0 WHERE org_id = 'demo-a'").run();
  });
});

afterAll(async () => {
  for (const r of await log()) seenLog.push(r.what_cs);
});

describe("privacy of the access log", () => {
  it("never holds a file name, a patient name or a birth number", async () => {
    for (const r of await log()) seenLog.push(r.what_cs);
    const text = seenLog.join("\n");
    expect(seenLog.length).toBeGreaterThan(5);
    for (const bad of [FAKE_NAME, "Testova", "Pacientka", "645312", "585614", "Jiná Osoba", ".pdf", "zprava"]) expect(text).not.toContain(bad);
  });
});
