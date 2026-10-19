// End-to-end check of step 6 against a running Worker (local `wrangler dev` or the deployed demo), with the committed
// synthetic files only: the S02 referral from FHIR, an intake with the seven PDFs uploaded under other names, the
// prepared data attached by hash, the source page of an uploaded file, an unknown file listed without its content, a
// wrong-patient upload,
// and (with --reset) reset-demo afterwards so the shared demo is clean again.
// With --pipeline it then runs the document pipeline (no LLM) on the four lab sheets and checks that every prepared lab
// value is either read the same or marked "ověřit" (needs PAGE_READER_URL or the page reader container on that Worker).
// Usage: node api/scripts/e2e-intake.mjs https://backend-codebridge-mdt.<sub>.workers.dev [--pipeline] [--reset]
// It prints counts and codes only, never page text or identity.
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const base = (process.argv[2] || "http://localhost:8787").replace(/\/$/, "");
const reset = process.argv.includes("--reset");
const runPipeline = process.argv.includes("--pipeline");
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const up = path.join(root, "samples/S02_pacient/upload");
let epoch = null;

async function api(method, p, { body, user = "d2p1", headers = {} } = {}) {
  const raw = body instanceof Uint8Array;
  const r = await fetch(base + "/api" + p, {
    method,
    headers: {
      Accept: "application/json", "X-Demo-User": user, Origin: base,
      ...(method !== "GET" ? { "Content-Type": raw ? "application/pdf" : "application/json", "X-Data-Epoch": String(epoch) } : {}),
      ...headers,
    },
    body: method === "GET" ? undefined : raw ? body : JSON.stringify(body ?? {}),
  });
  const j = await r.json();
  if (j?.data_epoch != null) epoch = j.data_epoch;
  return { status: r.status, j };
}

const h = await api("GET", "/health");
epoch = h.j.demo?.data_epoch;
assert.ok(epoch, "the demo is seeded");
console.log(`health: version ${h.j.version}, epoch ${epoch}`);

const fhir = await api("POST", "/fhir/referral", { body: JSON.parse(readFileSync(path.join(up, "zadost-fhir.json"), "utf8")) });
assert.equal(fhir.status, 200, JSON.stringify(fhir.j.error));
const f = fhir.j.data.form;
console.log(`fhir: found ${fhir.j.data.found.join(", ")}; missing ${fhir.j.data.missing_cs.length}`);

const create = await api("POST", "/cases", {
  body: { first_name: f.first_name, last_name: f.last_name, birth_number: f.birth_number, question: f.question, owner: f.owner, dept: f.dept, consent: true, intake: true, referral_sha256: fhir.j.data.referral_sha256 },
  headers: { "Idempotency-Key": `e2e-${Date.now()}-intake` },
});
assert.equal(create.status, 200, JSON.stringify(create.j.error));
const id = create.j.data.case_id;
console.log(`intake opened: ${id}`);
const listed = await api("GET", "/patients", { user: "coord" });
assert.ok(!listed.j.patients.some((p) => p.id === id), "an open intake is not listed");

const unknown = await api("POST", `/cases/${id}/documents`, { body: new TextEncoder().encode("%PDF-1.4\n% e2e unknown\n%%EOF\n"), headers: { "X-File-Name": "neznamy.pdf" } });
// Accepted and listed by name and size only; it does not stop the attach (listed files are extras).
assert.equal(unknown.status, 201, JSON.stringify(unknown.j.error));
assert.equal(unknown.j.data.document.content_stored, false);
console.log(`unknown PDF: ${unknown.status}, listed without content`);

const pdfs = readdirSync(up).filter((n) => n.endsWith(".pdf")).sort();
for (const n of pdfs) {
  const r = await api("POST", `/cases/${id}/documents`, { body: new Uint8Array(readFileSync(path.join(up, n))), headers: { "X-File-Name": encodeURIComponent(`kopie ${n}`) } });
  assert.equal(r.status, 201, JSON.stringify(r.j.error));
  assert.equal(r.j.data.document.identity, "matches");
}
console.log(`uploaded ${pdfs.length} renamed PDFs`);
const st = await api("GET", `/cases/${id}/intake`);
assert.equal(st.j.ready, true, st.j.reason_cs);
const done = await api("POST", `/cases/${id}/intake/complete`);
assert.equal(done.status, 200, JSON.stringify(done.j.error));
assert.equal(done.j.data.attached, true);
console.log(`intake complete: attached=${done.j.data.attached}, run ${done.j.data.run_id}`);

const ex = await api("GET", `/cases/${id}/extraction`);
const run = ex.j.data;
assert.equal(run?.schema, "codebridge.extraction/2", "the intake attaches a codebridge.extraction/2 run");
const raw = JSON.stringify(ex.j);
for (const bad of [f.first_name, f.last_name, f.birth_number, f.birth_number.replace("/", ""), "@upload"]) assert.ok(!raw.includes(bad), "no identity or placeholder in the stored extraction");
const labs = run.facts.filter((x) => x.kind === "lab_result");
console.log(`extraction: ${run.documents.length} documents, ${run.facts.length} facts (${labs.length} lab results), ${run.alerts.length} alerts; no identity`);
// Every quote is on the page of the uploaded file its source names: the page numbers were mapped from the combined PDF.
const pageText = new Map();
let quotes = 0;
for (const src of run.sources.filter((x) => x.type === "document")) {
  const k = `${src.document_id}/${src.page}`;
  if (!pageText.has(k)) {
    const pg = await api("GET", `/documents/${src.document_id}/pages/${src.page}`);
    assert.equal(pg.status, 200, `page ${k}`);
    pageText.set(k, pg.j.text.replace(/\*/g, "").replace(/\s+/g, " "));
  }
  assert.ok(pageText.get(k).includes(src.quote.replace(/\s+/g, " ")), `the quote of ${src.id} is on ${k}`);
  quotes++;
}
console.log(`sources: ${quotes} quotes, each found on its uploaded file's page (${pageText.size} pages)`);
const docs = await api("GET", `/cases/${id}/documents`);
console.log(`documents: ${docs.j.documents.map((d) => d.state).join(", ")}; level ${docs.j.processing_level}`);

// A sheet of S02 uploaded into another patient's case raises the identity alert.
const other = await api("POST", "/cases/NO-S01/documents", { body: new Uint8Array(readFileSync(path.join(up, pdfs[3]))), headers: { "X-File-Name": "lab.pdf" } });
assert.equal(other.status, 201, JSON.stringify(other.j.error));
assert.equal(other.j.data.document.identity, "conflicts");
console.log(`S02 sheet into NO-S01: identity ${other.j.data.document.identity}`);

if (runPipeline) {
  const labDocs = docs.j.documents.filter((d) => d.doc_type === "laboratorní výsledky");
  assert.equal(labDocs.length, 4);
  const sum = { points: 0, unclear: 0, same: 0, verify: 0, silent: 0, missing: 0 };
  for (const d of labDocs) {
    const s = await api("POST", `/documents/${d.id}/process`);
    assert.equal(s.status, 201, JSON.stringify(s.j.error));
    let run;
    for (let i = 0; i < 120; i++) {
      run = (await api("GET", `/documents/${d.id}/pipeline`)).j.run;
      if (run && (run.state === "done" || run.state === "error")) break;
      await new Promise((r) => setTimeout(r, 1000));
    }
    assert.equal(run.state, "done", `run ${run?.state} ${run?.error_code}`);
    console.log(`pipeline ${d.doc_date}: readability ${run.readability}, ${run.verify_count} ověřit marks, ${run.lab_points} lab points (${run.lab_unclear} k ověření); vs prepared: same ${run.diff.same}, ověřit ${run.diff.verify}, silent ${run.diff.silent}, missing ${run.diff.missing}`);
    sum.points += run.lab_points; sum.unclear += run.lab_unclear;
    for (const k of ["same", "verify", "silent", "missing"]) sum[k] += run.diff[k];
  }
  assert.equal(sum.silent, 0, "no prepared value read differently without an ověřit mark");
  assert.equal(sum.missing, 0, "every prepared value found");
  assert.equal(sum.same + sum.verify, 72, "18 tests x 4 draws");
  console.log(`pipeline total: ${sum.points} points, ${sum.same} same as prepared, ${sum.verify} marked ověřit, ${sum.silent} silent differences, ${sum.missing} missing`);
}

if (reset) {
  const r = await api("POST", "/admin/reset-demo", { body: { confirm: "OBNOVIT" }, user: "admin" });
  assert.equal(r.status, 200, JSON.stringify(r.j.error));
  const after = await api("GET", "/patients", { user: "coord" });
  assert.ok(!after.j.patients.some((p) => p.id === id), "reset removed the intake case");
  console.log(`reset-demo: ${r.j.data.statements} statements, r2_left ${r.j.data.r2_left}, epoch ${r.j.data.data_epoch}`);
}
console.log("e2e intake: passed");
