// Route tests of uploads (step 6, slice a-1) on local D1 and R2: the fixture registry by hash, every refusal (and that a
// refused file leaves no trace), the wrong-patient check, removal, the document list, the reset, and that no
// access-log line carries a file name or patient text.
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import { call, testEnv } from "./helpers";
import { FAKE_NAME, loadFixture } from "./data";

type Body = { data?: Record<string, any>; data_epoch?: number; state?: Record<string, any>; error?: { code: string; message_cs: string } };

const q = async <T = Record<string, unknown>>(sql: string, ...args: unknown[]) => (await env.DB.prepare(sql).bind(...args).all<T>()).results;
const count = async (table: string, where = "1") => (await q<{ n: number }>(`SELECT COUNT(*) AS n FROM ${table} WHERE ${where}`))[0]!.n;
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
const uploadsInR2 = async () => (await env.DOCS.list({ prefix: "uploads/" })).objects.map((o) => o.key);

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
    expect(row.original_r2_key).toBe(`uploads/NO-A/${d.id}.pdf`);
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
    expect(r.body.data!.document).toMatchObject({ identity: "conflicts", identity_cs: "Dokument patří jinému pacientovi: jméno nebo rodné číslo se neshoduje." });
    expect((await log()).map((l) => l.action)).toContain("document.identity_conflict");
    // The answer never carries the fixture's patient.
    expect(JSON.stringify(r.body)).not.toMatch(/Jiná Osoba|585614/);
  });

  it("cannot verify a fixture whose registry names no patient", async () => {
    expect((await upload("NO-A", NO_ID)).body.data!.document.identity).toBe("cannot_verify");
  });
});

describe("refusals leave no trace", () => {
  const traces = async () => ({ r2: await uploadsInR2(), docs: await count("documents", "origin = 'upload'"), log: (await log()).filter((l) => l.action.startsWith("document.")).length });

  it("refuses an unregistered PDF in the shared demo and stores nothing", async () => {
    const r = await upload("NO-A", UNKNOWN);
    expect(r.status).toBe(422);
    expect(r.body.error).toMatchObject({ code: "upload_not_fixture" });
    expect(r.body.error!.message_cs).toMatch(/^Ve sdílené ukázce lze nahrát jen připravené syntetické dokumenty/);
    expect(await traces()).toEqual({ r2: [], docs: 0, log: 0 });
  });

  it("checks the type by the bytes, gives ZIP its own message, and refuses empty and oversized files", async () => {
    const txt = await upload("NO-A", enc.encode("hello, I am not a PDF"), "fake.pdf");
    expect([txt.status, txt.body.error!.code]).toEqual([415, "type_not_allowed"]);
    const zip = await upload("NO-A", Uint8Array.from([0x50, 0x4b, 3, 4, 1, 2, 3]), "docs.zip");
    expect(zip.body.error!.message_cs).toBe("ZIP rozbalte a nahrajte jednotlivé PDF.");
    const small = testEnv({ UPLOAD_MAX_BYTES: "20" });
    const big = await upload("NO-A", MINE, "x.pdf", "d2p1", {}, small);
    expect([big.status, big.body.error!.code]).toEqual([413, "too_large"]);
    expect(await traces()).toEqual({ r2: [], docs: 0, log: 0 });
  });

  it("refuses a declared size over the limit before reading the body", async () => {
    const r = await upload("NO-A", MINE, "x.pdf", "d2p1", { "content-length": String(30 * 1024 * 1024) });
    expect(r.status).toBe(413);
  });

  it("refuses a duplicate and a second file of the same name", async () => {
    await upload("NO-A", MINE, "a.pdf");
    const dup = await upload("NO-A", MINE, "b.pdf");
    expect([dup.status, dup.body.error!.code, dup.body.error!.message_cs]).toEqual([409, "duplicate", "Tento dokument už je u případu nahraný."]);
    const same = await upload("NO-A", NO_ID, "a.pdf");
    expect([same.status, same.body.error!.code]).toEqual([409, "name_taken"]);
    expect(await uploadsInR2()).toHaveLength(1);
  });

  it("refuses uploads to an approved or closed case", async () => {
    await env.DB.prepare("INSERT INTO protocols (case_id, conclusion, state) VALUES ('NO-A', 'x', 'approved')").run();
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
  it("store_unprocessed keeps an unknown PDF as nezpracováno, with no identity result", async () => {
    const r = await upload("NO-A", UNKNOWN, "x.pdf", "d2p1", {}, testEnv({ UPLOAD_POLICY: "store_unprocessed" }));
    expect(r.status).toBe(201);
    expect(r.body.data!.document).toMatchObject({ fixture: false, identity: null, state: "stored" });
    expect((await q<{ sha256: string }>("SELECT sha256 FROM documents WHERE origin = 'upload'"))[0]!.sha256).toBe(await hex(UNKNOWN));
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
    await env.DB.prepare("INSERT INTO pages (document_id, n, json_r2_key, image_r2_key, width, height, engine, is_empty) SELECT id, 1, 'x', 'y', 1, 1, 'tesseract', 0 FROM documents WHERE origin = 'upload'").run();
    await env.DB.prepare("UPDATE demo_state SET reset_in_progress = 1 WHERE id = 1").run();
    expect(await count("documents", "origin = 'upload'")).toBe(0);
    expect(await count("pages", "document_id LIKE 'up-%'")).toBe(0);
    expect(await count("documents", "origin = 'seed'")).toBe(2);
    await env.DB.prepare("UPDATE demo_state SET reset_in_progress = 0 WHERE id = 1").run();
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
