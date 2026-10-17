// Route tests of "Nový pacient" on the server (step 6, slice a-2): FHIR referral, the open intake hidden from everyone
// else, uploads, and the attach of the prepared extraction only when every document matches by hash and name and birth
// number match; a name mismatch, a partial upload and a second intake give "nezpracováno"; discard, the 24-hour sweep,
// the reset, and no identity in the stored extraction or the access log.
import { beforeEach, describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import { call } from "./helpers";
import { loadFixture } from "./data";
import { sweep } from "../src/scheduled";

type Body = { data?: Record<string, any>; state?: Record<string, any>; error?: { code: string; message_cs: string } };
const q = async <T = Record<string, unknown>>(sql: string, ...args: unknown[]) => (await env.DB.prepare(sql).bind(...args).all<T>()).results;
const count = async (table: string, where = "1") => (await q<{ n: number }>(`SELECT COUNT(*) AS n FROM ${table} WHERE ${where}`))[0]!.n;

const NAME = ["Věra", "Lipenská"] as const;
const RC = "585614/4019";
const enc = new TextEncoder();
const FILES = ["01-zprava.pdf", "02-histologie.pdf", "03-laborator.pdf"];
const bytesOf = (name: string) => enc.encode(`%PDF-1.4\n% ${name}\n%%EOF\n`);
const hex = async (b: Uint8Array) => [...new Uint8Array(await crypto.subtle.digest("SHA-256", b))].map((x) => x.toString(16).padStart(2, "0")).join("");
const PNG = Uint8Array.from(atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII="), (ch) => ch.charCodeAt(0));

// A prepared extraction as seed.py writes it: references into the uploads by name, pages under each upload's name.
const PREPARED = {
  schema: "codebridge.prepared/1",
  fixture_id: "FX",
  syn: {
    file: "FX_pacient.pdf",
    list_entry: { file: "FX_pacient.pdf", page_count: 3 },
    documents: FILES.map((f, i) => ({ title_cs: `Dokument ${i + 1}`, type: "laboratorní výsledky", date: "2026-03-10", pages: [1], orig_pages: [i + 1], readability: "good", reason_cs: "Syntetický tištěný text.", upload_name: f, file: `@upload:${f}` })),
    data_gaps: [{ kind: "missing", text_cs: "Chybí popis MR.", source: { file: "@upload:01-zprava.pdf", page: 1, quote: "MR pánve", orig_file: "FX_pacient.pdf", orig_page: 1 } }],
    labs_series: { draws: [{ date: "2026-03-10", time: "07:25", source: { file: "@upload:03-laborator.pdf", page: 1, quote: "Odběr: 10.3.2026 07:25" } }], tests: [] },
  },
  case_row: { diagnosis_text: "Adenokarcinom rekta", summary_one_line: "Souhrn.", question_text: "Adjuvance?", question_explicit: true, question_purpose: "Adjuvance?", question_source_json: { file: "@upload:01-zprava.pdf", page: 1, quote: "Otázka" }, page_count: 3 },
  alerts: [{ origin: "gap", position: 0, kind: "missing", text_cs: "Chybí popis MR.", relevant: false, basis: "FX_pacient.pdf:1:MR pánve" }],
  pages: Object.fromEntries(FILES.map((f) => [f, [{ n: 1, width: 10, height: 10, engine: "vision", mean_conf: 90, low_conf_words: 0, is_empty: false, verify_count: 0, redacted: false, redaction_count: null, redaction_reasons: null }]])),
};

async function registerFixture() {
  const stmts = [env.DB.prepare("INSERT INTO fixture_patients (fixture_id, full_name, birth_number, data_origin) VALUES ('FX', ?1, ?2, 'codebridge_synthetic')").bind(NAME.join(" "), RC)];
  for (const f of FILES)
    stmts.push(
      env.DB.prepare("INSERT INTO fixture_files (sha256, fixture_id, file_name, r2_prefix, kind, title_cs, doc_type, page_count, combined_pages_json) VALUES (?1, 'FX', ?2, 'fixtures/FX/', 'upload', ?3, 'laboratorní výsledky', 1, '[1]')").bind(await hex(bytesOf(f)), f, `Dokument ${f}`),
    );
  await env.DB.batch(stmts);
  await env.DOCS.put("fixtures/FX/prepared.json", JSON.stringify(PREPARED));
  for (const f of FILES) {
    const stem = f.replace(".pdf", "");
    await env.DOCS.put(`fixtures/FX/pages/${stem}/p1.json`, JSON.stringify({ n: 1, size: [10, 10], text: "MR pánve. Otázka. Odběr: 10.3.2026 07:25", engine: "vision", words: [], mean_conf: 90, low_conf_words: 0, verify: [], redacted: null }));
    await env.DOCS.put(`fixtures/FX/pages/${stem}/p1.png`, PNG, { httpMetadata: { contentType: "image/png" } });
  }
}

async function w(method: string, path: string, body: unknown = {}, user = "d2p1", headers: Record<string, string> = {}) {
  const r = await call(`/api${path}`, { method, headers: { "content-type": "application/json", "x-demo-user": user, "x-data-epoch": "1", ...headers }, body: JSON.stringify(body) });
  return { status: r.status, body: (await r.json()) as Body };
}
const get = async (path: string, user = "d2p1") => {
  const r = await call(`/api${path}`, { headers: { "x-demo-user": user } });
  return { status: r.status, body: (await r.json()) as any };
};
async function upload(caseId: string, name: string, as = `kopie-${name}`, user = "d2p1") {
  const b = bytesOf(name);
  const r = await call(`/api/cases/${caseId}/documents`, {
    method: "POST",
    headers: { "content-type": "application/pdf", "x-demo-user": user, "x-data-epoch": "1", "x-file-name": encodeURIComponent(as), "content-length": String(b.length) },
    body: b,
  });
  return { status: r.status, body: (await r.json()) as Body };
}
let key = 0;
const startIntake = async (first: string = NAME[0], last: string = NAME[1], over: Record<string, unknown> = {}, user = "d2p1") =>
  w("POST", "/cases", { first_name: first, last_name: last, birth_number: RC, consent: true, intake: true, ...over }, user, { "idempotency-key": `intake-key-${++key}-aaaaaaaa` });

beforeEach(async () => {
  await loadFixture();
  await registerFixture();
});

describe("the FHIR referral", () => {
  it("fills the form on the server and logs the import without identity", async () => {
    const b = { resourceType: "Bundle", entry: [{ fullUrl: "urn:p", resource: { resourceType: "Patient", identifier: [{ system: "https://ncez.mzcr.cz/fhir/sid/rcis", value: RC }], name: [{ family: NAME[1], given: [NAME[0]] }] } }] };
    const r = await w("POST", "/fhir/referral", b);
    expect(r.status).toBe(200);
    expect(r.body.data!.fields).toEqual({ nf0: NAME[0], nf1: NAME[1], nf2: RC });
    expect(r.body.data!.referral_sha256).toMatch(/^[0-9a-f]{64}$/);
    expect((await w("POST", "/fhir/referral", { resourceType: "Bundle", entry: [] })).body.error!.code).toBe("fhir_invalid");
    expect((await w("POST", "/fhir/referral", b, "admin")).status).toBe(403);
    const lines = (await q<{ what_cs: string }>("SELECT what_cs FROM access_log WHERE action = 'fhir.import'")).map((l) => l.what_cs);
    expect(lines).toEqual(["importoval(a) žádost o konzultaci z FHIR"]);
  });
});

describe("intake with every fixture document and the matching person", () => {
  it("is hidden while open, then attaches the prepared data with references to the uploaded files", async () => {
    const s = await startIntake();
    expect(s.status).toBe(200);
    expect(s.body.data).toMatchObject({ case_id: "NO-FX", file: "FX_pacient.pdf", intake: true });
    expect(s.body.state).toEqual({});
    // Hidden from the list, the workflow and anyone but its creator; no change but uploads.
    expect((await get("/patients", "coord")).body.patients.map((p: { id: string }) => p.id)).not.toContain("NO-FX");
    expect(Object.keys((await get("/workflow", "d2p1")).body.cases)).not.toContain("NO-FX");
    expect((await get("/cases/NO-FX", "coord")).status).toBe(404);
    expect((await upload("NO-FX", FILES[0]!, "x.pdf", "coord")).status).toBe(404);
    expect((await w("POST", "/cases/NO-FX/status", { to: "ready", expected_status: "new" })).body.error!.code).toBe("intake_open");

    for (const f of FILES) expect((await upload("NO-FX", f)).body.data!.document.identity).toBe("matches");
    const st = await get("/cases/NO-FX/intake");
    expect(st.body).toMatchObject({ ready: true, expected: 3, present: 3, fixture_id: "FX" });
    expect(st.body.docByUpload).toBeUndefined();

    const done = await w("POST", "/cases/NO-FX/intake/complete");
    expect(done.status).toBe(200);
    expect(done.body.data).toMatchObject({ case_id: "NO-FX", attached: true, documents: 3 });
    expect(done.body.state!.patient).toMatchObject({ id: "NO-FX", processing: "partial", diagnosis: "Adenokarcinom rekta", question: "Adjuvance?" });
    expect((await get("/patients", "coord")).body.patients.map((p: { id: string }) => p.id)).toContain("NO-FX");
    expect((await w("POST", "/cases/NO-FX/intake/complete")).body.error!.code).toBe("intake_done");

    // The stored extraction: references point at the uploaded documents, and no name or birth number anywhere.
    const ex = await get("/cases/NO-FX/extraction");
    const raw = JSON.stringify(ex.body);
    for (const bad of [NAME[0], NAME[1], "585614", "4019"]) expect(raw).not.toContain(bad);
    expect(raw).not.toContain("@upload:");
    const docs = await q<{ id: string; file_name: string; state: string }>("SELECT id, file_name, state FROM documents WHERE case_id = 'NO-FX' ORDER BY file_name");
    expect(docs.map((d) => d.state)).toEqual(["prepared", "prepared", "prepared"]);
    const zprava = docs.find((d) => d.file_name === "kopie-01-zprava.pdf")!;
    expect(ex.body.data.syn.data_gaps[0].source).toMatchObject({ file: `${zprava.id}.pdf`, page: 1, orig_file: "FX_pacient.pdf", orig_page: 1 });
    expect(ex.body.data.syn.documents[0]).toMatchObject({ file: `${zprava.id}.pdf`, pages: [1] });
    // The source view opens the page of the uploaded file.
    const page = await get(`/documents/${zprava.id}/pages/1`);
    expect(page.status).toBe(200);
    expect(page.body).toMatchObject({ document_id: zprava.id, case_id: "NO-FX", n: 1, doc_title: "Dokument 1" });
    expect(page.body.text).toContain("MR pánve");
    expect((await get("/cases/NO-FX/alerts")).body.alerts).toHaveLength(1);
    // The access log names counts, never the patient.
    const lines = (await q<{ what_cs: string }>("SELECT what_cs FROM access_log ORDER BY id")).map((l) => l.what_cs).join("\n");
    expect(lines).toContain("vytvořil(a) pacienta z žádosti a 3 nahraných dokumentů");
    for (const bad of [NAME[0], NAME[1], "585614", "kopie-", ".pdf"]) expect(lines).not.toContain(bad);
  });

  it("matches the name in the other order", async () => {
    const s = await startIntake(NAME[1], NAME[0]);
    expect(s.body.data!.case_id).toBe("NO-FX");
    for (const f of FILES) await upload("NO-FX", f);
    expect((await w("POST", "/cases/NO-FX/intake/complete")).body.data!.attached).toBe(true);
  });
});

describe("intake without the attach", () => {
  it("never joins a differently named person to the documents", async () => {
    const s = await startIntake("Věra", "Lipenská-Nová");
    const id = s.body.data!.case_id as string;
    expect(id).toMatch(/^NO-1\d\d$/);
    for (const f of FILES) expect((await upload(id, f)).body.data!.document.identity).toBe("conflicts");
    // Nothing about the fixture's other documents is told to someone who typed another name.
    const st = await get(`/cases/${id}/intake`);
    expect(st.body).toMatchObject({ ready: false, expected: 0, present: 0, missing_cs: [] });
    const done = await w("POST", `/cases/${id}/intake/complete`);
    expect(done.body.data).toMatchObject({ attached: false });
    expect(done.body.data!.reason_cs).toMatch(/^Jméno nebo rodné číslo v žádosti se neshoduje/);
    expect(JSON.stringify(done.body.data)).not.toMatch(/Lipenská"|585614/);
    expect(done.body.state!.patient).toMatchObject({ processing: "none" });
    expect(await count("documents", `case_id = '${id}' AND state = 'stored'`)).toBe(3);
    expect(await count("extraction_runs", `case_id = '${id}'`)).toBe(0);
  });

  it("leaves a partial upload nezpracováno and refuses a second intake of the same fixture", async () => {
    await startIntake();
    await upload("NO-FX", FILES[0]!);
    await upload("NO-FX", FILES[1]!);
    const part = await w("POST", "/cases/NO-FX/intake/complete");
    expect(part.body.data).toMatchObject({ attached: false, reason_cs: "Chybí ještě 1 z 3 dokumentů ukázkového pacienta; záznam zůstane bez zpracovaných dokumentů." });

    // A second record for the birth number needs the override; it gets the next number and no attach either way.
    const first = await startIntake(NAME[0], NAME[1], { duplicate_override: { birth_number: RC, reason: "druhý záznam pro test ukázky" } });
    expect(first.body.data!.case_id).toMatch(/^NO-1\d\d$/);
  });

  it("does not attach the fixture twice", async () => {
    await startIntake();
    for (const f of FILES) await upload("NO-FX", f);
    expect((await w("POST", "/cases/NO-FX/intake/complete")).body.data!.attached).toBe(true);
    const s = await startIntake(NAME[0], NAME[1], { duplicate_override: { birth_number: RC, reason: "druhý záznam pro test ukázky" } });
    const id = s.body.data!.case_id as string;
    for (const f of FILES) await upload(id, f);
    const second = await w("POST", `/cases/${id}/intake/complete`);
    expect(second.body.data).toMatchObject({ attached: false, reason_cs: "Ukázkový pacient už v databázi je; nový záznam zůstane bez zpracovaných dokumentů." });
  });
});

describe("an open intake is not there for anyone else", () => {
  it("takes no break-the-glass grant and no attendance, and does not count as a duplicate", async () => {
    await startIntake();
    expect((await w("POST", "/cases/NO-FX/break-glass", { reason: "akutní konzultace pacienta" }, "d1p1")).status).toBe(404);
    expect((await w("PUT", "/attendance/case:NO-FX", { rows: [], expected_version: 0 }, "coord")).status).toBe(404);
    // Another user's referral for the same birth number is not told about the open intake.
    const other = await startIntake(NAME[0], NAME[1], {}, "coord");
    expect(other.status).toBe(200);
    expect(other.body.data!.case_id).toMatch(/^NO-1\d\d$/);
    expect((await w("DELETE", "/cases/NO-FX/intake")).status).toBe(200);
  });
});

describe("abandoned intakes", () => {
  it("are removed with their files by the creator, by the 24-hour sweep and by the reset trigger", async () => {
    await startIntake();
    await upload("NO-FX", FILES[0]!);
    expect((await env.DOCS.list({ prefix: "uploads/NO-FX/" })).objects).toHaveLength(1);
    const d = await w("DELETE", "/cases/NO-FX/intake");
    expect(d.status).toBe(200);
    expect(await count("cases", "id = 'NO-FX'")).toBe(0);
    expect(await count("patients", "id = 'pt-NO-FX'")).toBe(0);
    expect(await count("documents", "case_id = 'NO-FX'")).toBe(0);
    expect((await env.DOCS.list({ prefix: "uploads/NO-FX/" })).objects).toHaveLength(0);

    await startIntake();
    await upload("NO-FX", FILES[0]!);
    await sweep(env, Date.now() + 2 * 3600_000);
    expect(await count("cases", "id = 'NO-FX'")).toBe(1);
    await sweep(env, Date.now() + 25 * 3600_000);
    expect(await count("cases", "id = 'NO-FX'")).toBe(0);
    expect((await env.DOCS.list({ prefix: "uploads/NO-FX/" })).objects).toHaveLength(0);
    expect((await q<{ what_cs: string }>("SELECT what_cs FROM access_log WHERE action = 'intake.discard'")).map((r) => r.what_cs)).toEqual([
      "zrušil(a) rozpracovaný příjem pacienta (dokumenty smazány)",
      "rozpracovaný příjem pacienta smazán po 24 hodinách (dokumenty smazány)",
    ]);

    await startIntake();
    for (const f of FILES) await upload("NO-FX", f);
    await w("POST", "/cases/NO-FX/intake/complete");
    await env.DB.prepare("INSERT INTO alert_events (alert_id, action, by_user_id, by_name) SELECT id, 'ack', 'd2p1', 'x' FROM alerts WHERE case_id = 'NO-FX'").run();
    await env.DB.prepare("UPDATE demo_state SET reset_in_progress = 1 WHERE id = 1").run();
    expect(await count("extraction_runs", "producer IS NOT NULL")).toBe(0);
    expect(await count("alerts", "case_id = 'NO-FX'")).toBe(0);
    expect(await count("documents", "origin = 'upload'")).toBe(0);
    expect(await count("extraction_runs", "producer IS NULL")).toBe(1);
    await env.DB.prepare("UPDATE demo_state SET reset_in_progress = 0 WHERE id = 1").run();
  });
});
