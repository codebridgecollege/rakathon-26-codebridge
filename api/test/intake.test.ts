// Route tests of "Nový pacient" on the server (step 6, slice a-2): FHIR referral, the open intake hidden from everyone
// else, uploads, and the attach of the prepared extraction only when every document matches by hash and name and birth
// number match; a name mismatch, a partial upload and a second intake give "nezpracováno"; discard, the 24-hour sweep,
// the reset, and no identity in the stored extraction or the access log. The attached extraction is a
// codebridge.extraction/2 run stored through store/runs.ts, with every reference on the uploaded file and its page.
import { beforeEach, describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import { sourceIdFor, validateRun, viewLineId, type ExtractionRun } from "@codebridge/domain/extraction/index";
import { call } from "./helpers";
import { loadFixture } from "./data";
import { sweep } from "../src/scheduled";
import type { DraftRun } from "../src/store/runs";
import example from "../../packages/domain/schema/examples/worked-examples.json";

type Body = { data?: Record<string, any>; state?: Record<string, any>; error?: { code: string; message_cs: string } };
const q = async <T = Record<string, unknown>>(sql: string, ...args: unknown[]) => (await env.DB.prepare(sql).bind(...args).all<T>()).results;
// Org A's rows: the fixture's org B look-alikes must stay as they are, and never count here.
const count = async (table: string, where = "1", org = "demo-a") => (await q<{ n: number }>(`SELECT COUNT(*) AS n FROM ${table} WHERE org_id = '${org}' AND (${where})`))[0]!.n;

const NAME = ["Věra", "Lipenská"] as const;
const RC = "585614/4019";
const enc = new TextEncoder();
const FILES = ["01-zprava.pdf", "02-histologie.pdf", "03-laborator.pdf"];
const bytesOf = (name: string) => enc.encode(`%PDF-1.4\n% ${name}\n%%EOF\n`);
const hex = async (b: Uint8Array) => [...new Uint8Array(await crypto.subtle.digest("SHA-256", b))].map((x) => x.toString(16).padStart(2, "0")).join("");
const PNG = Uint8Array.from(atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII="), (ch) => ch.charCodeAt(0));

// The prepared run as seed.py run_for_uploads() writes it: the format's worked example (one document with parts p0, p1,
// p2) spread over the three uploads, part pK onto FILES[K] with every page numbered 1 inside its file; document and part
// IDs are placeholders, facts carry their example ID as draft_id, alerts have no ID.
const EX = example as unknown as ExtractionRun;
const fileOf = (part: string | null) => FILES[Number(/p(\d+)$/.exec(part ?? "p0")![1])]!;
const at = <T extends { document_id: string; part: string | null }>(x: T): T => ({
  ...x,
  document_id: `@upload:${fileOf(x.part)}`,
  part: x.part ? `@upload-part:${fileOf(x.part)}` : null,
});
const DRAFT: DraftRun = {
  ...EX,
  run: { id: "fixture-NO-S02-v2", producer: "fixture", created_at: "2026-10-19T00:00:00Z", stages: [{ name: "convert", engine: "fixtures/convert/convert_v2.py" }] },
  documents: FILES.map((f) => ({ document_id: `@upload:${f}`, sha256: null, parts: [`@upload-part:${f}`] })),
  sources: EX.sources.map((src) => (src.type === "document" ? { ...at(src), page: 1 } : src)),
  facts: EX.facts.map(({ id, key: _k, ...f }) => ({ ...f, draft_id: id })),
  alerts: EX.alerts.map(({ id: _id, ...a }) => a),
  checks: EX.checks.map((c) => ({ ...c, covered: c.covered.map(at), unreadable: c.unreadable.map((u) => ({ ...at(u), page: 1 })) })),
};
const PREPARED = {
  schema: "codebridge.prepared/2",
  fixture_id: "FX",
  run: DRAFT,
  documents: FILES.map((f, i) => ({ upload_name: f, title_cs: `Dokument ${i + 1}`, type: "laboratorní výsledky", date: "2026-03-10", readability: "good", reason_cs: "Syntetický tištěný text." })),
  case_row: { diagnosis_text: "Adenokarcinom rekta", summary_one_line: "Souhrn.", question_text: "Adjuvance?", question_explicit: true, question_purpose: "Adjuvance?", question_source_json: { file: "@upload:01-zprava.pdf", page: 1, quote: "Otázka" }, page_count: 3 },
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

    // The run: codebridge.extraction/2, the intake's own (not seeded, under runs/), on the uploaded documents.
    const runRow = (await q<{ id: string; r2_key: string; producer: string; seeded: number; schema: string; supersedes: string | null; is_current: number }>(
      "SELECT id, r2_key, producer, seeded, schema, supersedes, is_current FROM extraction_runs WHERE case_id = 'NO-FX'",
    ))[0]!;
    expect(runRow).toMatchObject({ producer: "fixture", seeded: 0, schema: "codebridge.extraction/2", supersedes: null, is_current: 1 });
    expect(runRow.r2_key).toBe(`org/demo-a/runs/NO-FX/${runRow.id}.json`);
    expect(done.body.data!.run_id).toBe(runRow.id);
    const stored = await (await env.DOCS.get(runRow.r2_key))!.json<ExtractionRun>();
    expect(validateRun(stored)).toMatchObject({ ok: true });
    const raw = JSON.stringify(stored);
    for (const bad of [NAME[0], NAME[1], "585614", "4019", "@upload"]) expect(raw).not.toContain(bad);
    const docs = await q<{ id: string; file_name: string; state: string; sha256: string }>("SELECT id, file_name, state, sha256 FROM documents WHERE case_id = 'NO-FX' ORDER BY file_name");
    expect(docs.map((d) => d.state)).toEqual(["prepared", "prepared", "prepared"]);
    const byFile = (f: string) => docs.find((d) => d.file_name === `kopie-${f}`)!;
    const zprava = byFile(FILES[0]!);
    // One document per uploaded file with its hash and one part; each source on its file's page 1, its ID derived from
    // that place; the same facts and alerts as the prepared run, with IDs of this case registered in D1.
    expect(stored.documents).toEqual(FILES.map((f) => ({ document_id: byFile(f).id, sha256: byFile(f).sha256, parts: [`${byFile(f).id}/p0`] })));
    for (const src of stored.sources) {
      if (src.type !== "document") continue;
      expect(src.page).toBe(1);
      const { id, ...rest } = src;
      expect(id).toBe(sourceIdFor(rest));
    }
    const histology = EX.sources.find((x) => x.type === "document" && x.part === "10_pacient/p1")!;
    expect(stored.sources.filter((x) => x.type === "document" && x.quote === (histology as { quote: string }).quote).map((x) => (x as { document_id: string }).document_id)).toEqual([byFile(FILES[1]!).id]);
    expect(stored.facts.map((f) => f.kind).sort()).toEqual(EX.facts.map((f) => f.kind).sort());
    expect(stored.alerts.map((x) => x.rule)).toEqual(EX.alerts.map((x) => x.rule));
    // Composed view lines rest on this case's fact IDs, and their IDs follow from them.
    const factIds = new Set(stored.facts.map((f) => f.id));
    const viewLines = [...(stored.views?.onco_lines ?? []), ...(stored.views?.timeline ?? [])];
    expect(viewLines.length).toBe((EX.views?.onco_lines?.length ?? 0) + (EX.views?.timeline?.length ?? 0));
    expect(viewLines.length).toBeGreaterThan(0);
    for (const l of viewLines) expect(l.facts.every((f) => factIds.has(f))).toBe(true);
    expect(stored.views!.onco_lines![0]!.id).toBe(viewLineId("onco_lines", stored.views!.onco_lines![0]!.facts));
    expect(stored.run).toMatchObject({ id: runRow.id, producer: "fixture", supersedes: null });
    expect((await q<{ fact_id: string }>("SELECT fact_id FROM fact_ids WHERE case_id = 'NO-FX' ORDER BY fact_id")).map((r) => r.fact_id)).toEqual(stored.facts.map((f) => f.id).sort());
    expect((await q<{ id: string }>("SELECT id FROM alert_identities WHERE case_id = 'NO-FX'")).map((r) => r.id)).toEqual(stored.alerts.map((x) => x.id));
    expect(await count("alerts", "case_id = 'NO-FX'")).toBe(0);
    const served = await get("/cases/NO-FX/extraction");
    expect(served.body).toMatchObject({ case_id: "NO-FX", run: { id: runRow.id, producer: "fixture" }, data: { schema: "codebridge.extraction/2", case_id: "NO-FX" } });
    // The source view opens the page of the uploaded file.
    const page = await get(`/documents/${zprava.id}/pages/1`);
    expect(page.status).toBe(200);
    expect(page.body).toMatchObject({ document_id: zprava.id, case_id: "NO-FX", n: 1, doc_title: "Dokument 1" });
    expect(page.body.text).toContain("MR pánve");
    expect(await q("SELECT part_id FROM document_parts WHERE document_id = ?1", zprava.id)).toEqual([{ part_id: `${zprava.id}/p0` }]);
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

  it("attaches with a listed extra file, which stays nezpracováno and has no content, and takes the fixture's birth date", async () => {
    await env.DB.prepare("UPDATE fixture_patients SET birth_as_written = '14.6.1958' WHERE fixture_id = 'FX'").run();
    await startIntake();
    for (const f of FILES) await upload("NO-FX", f);
    const extra = await call("/api/cases/NO-FX/documents", {
      method: "POST",
      headers: { "content-type": "application/msword", "x-demo-user": "d2p1", "x-data-epoch": "1", "x-file-name": "propousteci.doc", "content-length": "5" },
      body: enc.encode("hello"),
    });
    expect(extra.status).toBe(201);
    const done = await w("POST", "/cases/NO-FX/intake/complete");
    expect(done.body.data!.attached).toBe(true);
    expect((await q<{ file_name: string; state: string; k: string | null }>("SELECT file_name, state, original_r2_key AS k FROM documents WHERE case_id = 'NO-FX' AND fixture_id IS NULL"))).toEqual([{ file_name: "propousteci.doc", state: "stored", k: null }]);
    expect(done.body.state!.patient).toMatchObject({ birth: "14.6.1958" });
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
    expect((await env.DOCS.list({ prefix: "org/demo-a/uploads/NO-FX/" })).objects).toHaveLength(1);
    const d = await w("DELETE", "/cases/NO-FX/intake");
    expect(d.status).toBe(200);
    expect(await count("cases", "id = 'NO-FX'")).toBe(0);
    expect(await count("patients", "id = 'pt-NO-FX'")).toBe(0);
    expect(await count("documents", "case_id = 'NO-FX'")).toBe(0);
    expect((await env.DOCS.list({ prefix: "org/demo-a/uploads/NO-FX/" })).objects).toHaveLength(0);

    await startIntake();
    await upload("NO-FX", FILES[0]!);
    await sweep(env, Date.now() + 2 * 3600_000);
    expect(await count("cases", "id = 'NO-FX'")).toBe(1);
    await sweep(env, Date.now() + 25 * 3600_000);
    expect(await count("cases", "id = 'NO-FX'")).toBe(0);
    expect((await env.DOCS.list({ prefix: "org/demo-a/uploads/NO-FX/" })).objects).toHaveLength(0);
    expect((await q<{ what_cs: string }>("SELECT what_cs FROM access_log WHERE action = 'intake.discard'")).map((r) => r.what_cs)).toEqual([
      "zrušil(a) rozpracovaný příjem pacienta (dokumenty smazány)",
      "rozpracovaný příjem pacienta smazán po 24 hodinách (dokumenty smazány)",
    ]);

    await startIntake();
    for (const f of FILES) await upload("NO-FX", f);
    expect((await w("POST", "/cases/NO-FX/intake/complete")).body.data!.attached).toBe(true);
    const alertId = (await q<{ id: string }>("SELECT id FROM alert_identities WHERE case_id = 'NO-FX'"))[0]!.id;
    expect((await w("POST", `/cases/NO-FX/alerts/${alertId}/events`, { action: "ack", expected_state: "open" })).status).toBe(200);
    expect(await count("alert_events", "case_id = 'NO-FX'")).toBe(1);
    await env.DB.prepare("UPDATE demo_state SET reset_in_progress = 1 WHERE org_id = 'demo-a'").run();
    // The trigger removes the intake's run with the IDs it issued and the events on them; the seeded runs stay.
    expect(await count("extraction_runs", "seeded = 0")).toBe(0);
    expect(await count("fact_ids", "case_id = 'NO-FX'")).toBe(0);
    expect(await count("alert_identities", "case_id = 'NO-FX'")).toBe(0);
    expect(await count("alert_events", "case_id = 'NO-FX'")).toBe(0);
    expect(await count("documents", "origin = 'upload'")).toBe(0);
    expect(await count("extraction_runs", "seeded = 1")).toBe(2);
    await env.DB.prepare("UPDATE demo_state SET reset_in_progress = 0 WHERE org_id = 'demo-a'").run();
  });
});
