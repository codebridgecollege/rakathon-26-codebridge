// Isolation of organizations (docs/design/AUTH.md "Keeping orgs apart", DATABASE.md "Organizations: shared tables").
// An org (organization) is a hospital or another customer; every patient, case and document belongs to exactly one.
// The proof the design names: for every route, a request acting in org B with org A's IDs answers exactly as it would
// for an ID that does not exist (404 or the route's own "not found", never a 403 that confirms the record), lists
// nothing of org A, and leaves every org A row and R2 object as it was. Then the places named as risks one by one
// (idempotency keys, slots, birth numbers, case numbers, break-the-glass, staff and demo resets, the cron sweep, the
// demo user picker), and migration 0011 on data in the schema from before orgs.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { env } from "cloudflare:workers";
import { applyD1Migrations, reset } from "cloudflare:test";
import { call, mockFetch, testEnv } from "./helpers";
import { B_NAME, FAKE_NAME, MUTABLE_B, RUN_A2, RUN_A2_ID, loadFixture, resetDoc } from "./data";
import { ORG_TABLES } from "../src/store/sql";
import { sweep } from "../src/scheduled";

type Body = { data?: Record<string, any>; data_epoch?: number; state?: Record<string, any>; error?: { code: string; message_cs: string; current?: any }; [k: string]: any };
type Res = { status: number; body: Body; text: string };

const q = async <T = Record<string, any>>(sql: string, ...args: unknown[]) => (await env.DB.prepare(sql).bind(...args).all<T>()).results;
const one = async <T = Record<string, any>>(sql: string, ...args: unknown[]) => (await q<T>(sql, ...args))[0]!;

async function send(method: string, path: string, user: string, body: unknown = {}, headers: Record<string, string> = {}, e: Env = testEnv()): Promise<Res> {
  const init: RequestInit =
    method === "GET"
      ? { headers: { "x-demo-user": user, ...headers } }
      : { method, headers: { "content-type": "application/json", "x-demo-user": user, "x-data-epoch": "1", ...headers }, body: body instanceof Uint8Array ? body : JSON.stringify(body) };
  const r = await call(`/api${path}`, init, e);
  // A page image is bytes, not text; its body cannot carry org A's text markers.
  const text = (r.headers.get("content-type") ?? "").startsWith("image/") ? (await r.arrayBuffer(), "") : await r.text();
  let parsed: Body = {};
  try {
    parsed = JSON.parse(text);
  } catch {
    /* a page image */
  }
  return { status: r.status, body: parsed, text };
}
const w = (method: string, path: string, body: unknown, user: string, headers: Record<string, string> = {}) => send(method, path, user, body, headers);
const get = (path: string, user: string, headers: Record<string, string> = {}) => send("GET", path, user, undefined, headers);

const decisionsBody = (o: Record<string, unknown> = {}) => ({
  protocol_version: 1,
  conclusion: "Kontrolní MR za 3 měsíce.",
  picked_sections: ["summary"],
  report_html: "<p>report</p>",
  attendance_expected: ["MUDr. Svobodová"],
  ...o,
});
const form = (birth_number: string, o: Record<string, unknown> = {}) => ({ first_name: "Nová", last_name: "Pacientka", birth_number, consent: true, ...o });
const key = (n: number) => ({ "idempotency-key": `0rg50000-aaaa-bbbb-cccc-${String(n).padStart(12, "0")}` });

// Text that only org A's data holds. Org B's look-alikes share the case number "NO-A", the file name "A_pacient.pdf",
// the birth number (645312/1234) and the department name "Klinická onkologie", so those are not markers.
const A_MARKERS = [FAKE_NAME, "Testová", "Svobodová", "Novák", "Marková", "Kovář", "Bývalý", "Diagnóza A", "Souhrn A", "úkol A", "úkol B", "Neurochirurgie", "Chybí histologie", "Nejasné datum", "pt-A", "Otázka?", "Kontrolní MR"];
const leaksA = (text: string) => A_MARKERS.filter((m) => text.includes(m));

// The tables that hold org data, read from the schema itself (every table with an org_id column), so a table added
// later is in the snapshot even if nobody adds it to ORG_TABLES.
async function orgTables() {
  // D1 refuses pragma_table_info(), so the column is found in each table's CREATE statement.
  const r = await q<{ name: string; sql: string }>("SELECT name, sql FROM sqlite_master WHERE type = 'table' AND sql IS NOT NULL ORDER BY name");
  return r.filter((x) => /\borg_id\s+TEXT\b/.test(x.sql)).map((x) => x.name);
}

// Every row of one org (every org table, its org row, the people with a membership in it and their identities) and its
// R2 objects, so a test can prove that nothing done in the other org changed any of it. For demo org A the objects are
// everything outside org/demo-b/ (its own prefix, the prefixes used before orgs, and the shared seed objects). Rows
// are sorted by their JSON: the order is not data.
async function snapshotOrg(org: "demo-a" | "demo-b") {
  const out: Record<string, unknown> = {};
  for (const t of await orgTables()) out[t] = (await q(`SELECT * FROM ${t} WHERE org_id = ?1`, org)).map((r) => JSON.stringify(r)).sort();
  out.orgs = await q("SELECT * FROM orgs WHERE id = ?1", org);
  const people = "SELECT 1 FROM memberships m WHERE m.org_id = ?1 AND m.user_id = u.id";
  out.users = (await q(`SELECT u.* FROM users u WHERE EXISTS (${people})`, org)).map((r) => JSON.stringify(r)).sort();
  out.user_identities = (await q(`SELECT i.* FROM user_identities i JOIN users u ON u.id = i.user_id WHERE EXISTS (${people})`, org)).map((r) => JSON.stringify(r)).sort();
  out.r2 = org === "demo-a" ? await r2Outside("org/demo-b/") : (await r2Outside("")).filter((k) => k.startsWith("org/demo-b/"));
  return out;
}
const snapshotA = () => snapshotOrg("demo-a");

// Org A's IDs that appear as a value in any row of org B, or as a part of an org B R2 key. Org B writes may add rows
// in org B; none of them may point at an org A record. case_no is a number people see and counts per org (org B's
// look-alike is "NO-A" too); role columns hold role names, one of which ("admin") is also an org A user id.
async function aIdsInB(): Promise<string[]> {
  const ids = new Set<string>();
  for (const t of ["cases", "documents", "patients", "departments", "recordings", "jobs", "decisions", "upload_sessions", "extraction_runs", "alerts", "notifications"])
    for (const r of await q<{ id: string }>(`SELECT id FROM ${t} WHERE org_id = 'demo-a'`)) ids.add(String(r.id));
  // People of org A only; a person in both orgs is legitimately named in org B.
  for (const r of await q<{ user_id: string }>("SELECT user_id FROM memberships m WHERE org_id = 'demo-a' AND NOT EXISTS (SELECT 1 FROM memberships b WHERE b.org_id = 'demo-b' AND b.user_id = m.user_id)"))
    ids.add(r.user_id);
  const skip = /^(case_no|role_id|acted_as_role|created_by_role|what_cs)$/;
  const found: string[] = [];
  for (const t of await orgTables())
    for (const r of await q(`SELECT * FROM ${t} WHERE org_id = 'demo-b'`))
      for (const [k, v] of Object.entries(r)) {
        if (skip.test(k) || typeof v !== "string") continue;
        // target_id may list several ids ("a,b"); every part counts.
        for (const part of v.split(",")) if (ids.has(part)) found.push(`${t}.${k} = ${v}`);
      }
  for (const k of (await r2Outside("")).filter((x) => x.startsWith("org/demo-b/")))
    for (const seg of k.split(" ")[0]!.split(/[/.]/)) if (ids.has(seg)) found.push(`R2 ${k}`);
  return found;
}

// Every R2 object outside a prefix, with its etag and size: org A's objects under org/demo-a/ and the prefixes used
// before orgs (pages/, extract/, guidance/, prognosis/, uploads/, audio/), plus the shared seed objects.
async function r2Outside(prefix: string) {
  const keys: string[] = [];
  let cursor: string | undefined;
  do {
    const page = await env.DOCS.list({ cursor, limit: 1000 });
    for (const o of page.objects) if (!o.key.startsWith(prefix)) keys.push(`${o.key} ${o.etag} ${o.size}`);
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
  return keys.sort();
}

const enc = new TextEncoder();
const pdf = (marker: string) => enc.encode(`%PDF-1.4\n% ${marker}\n1 0 obj << >> endobj\ntrailer << >>\n%%EOF\n`);

beforeEach(async () => {
  await loadFixture();
  await env.DOCS.put("seed/reset.json", JSON.stringify(resetDoc()));
});
afterEach(() => vi.restoreAllMocks());

// ---------------------------------------------------------------------------------------------------------------
// 1. Every route, acting in org B with org A's IDs.
// ---------------------------------------------------------------------------------------------------------------

type Ids = { case: string; case2: string; doc: string; upDoc: string; task: string; task2: string; sugg: string; job: string; rec: string; us: string; dept: string; person: string };

// One request of the sweep. It runs twice: with org A's IDs and with IDs that exist nowhere, and both answers must
// be the same status and error code, so the answer says nothing about whether org A has the record.
type Probe = { name: string; method: string; path: (i: Ids) => string; user: string; body?: (i: Ids) => unknown; headers?: Record<string, string>; env?: () => Env };

// Both demo orgs with a NIS (a .test host nothing answers), so the NIS probes reach the case lookup.
const NIS_BOTH = () => {
  const nis = { base_url: "https://nis.test/fhir", label_cs: "Testovací NIS", auth: { mode: "none" } };
  return testEnv({ NIS_CONFIG: JSON.stringify({ "demo-a": nis, "demo-b": nis }) });
};

const PROBES: Probe[] = [
  // Reads of one case and its parts (cases.ts, transcript.ts, documents.ts, intake.ts).
  ...["", "/extraction", "/decisions", "/history", "/guidance", "/prognosis", "/documents", "/transcript", "/intake"].map(
    (s): Probe => ({ name: `GET /cases/:id${s}`, method: "GET", path: (i) => `/cases/${i.case}${s}`, user: "b-doc" }),
  ),
  { name: "GET /cases/:id/runs/:runId/facts/:factId", method: "GET", path: (i) => `/cases/${i.case}/runs/${RUN_A2_ID}/facts/${RUN_A2.facts[0]!.id}`, user: "b-doc" },
  { name: "GET /cases/:id (coordinator)", method: "GET", path: (i) => `/cases/${i.case2}`, user: "b-coord" },
  { name: "GET /cases/:id (administrator)", method: "GET", path: (i) => `/cases/${i.case}`, user: "b-admin" },
  // Documents and pages (pages.ts, pipeline.ts, documents.ts).
  { name: "GET /documents/:id/pages/:n", method: "GET", path: (i) => `/documents/${i.doc}/pages/1`, user: "b-doc" },
  { name: "GET /documents/:id/pages/:n/image", method: "GET", path: (i) => `/documents/${i.doc}/pages/1/image`, user: "b-doc" },
  { name: "GET /documents/:id/pages/:n/image?redacted=1", method: "GET", path: (i) => `/documents/${i.doc}/pages/1/image?redacted=1`, user: "b-coord" },
  { name: "GET /documents/:id/pipeline", method: "GET", path: (i) => `/documents/${i.doc}/pipeline`, user: "b-doc" },
  { name: "GET /documents/:id/pipeline (upload)", method: "GET", path: (i) => `/documents/${i.upDoc}/pipeline`, user: "b-doc" },
  { name: "POST /documents/:id/process", method: "POST", path: (i) => `/documents/${i.upDoc}/process`, user: "b-doc" },
  { name: "POST /documents/:id/process (seeded)", method: "POST", path: (i) => `/documents/${i.doc}/process`, user: "b-coord" },
  { name: "DELETE /documents/:id (upload)", method: "DELETE", path: (i) => `/documents/${i.upDoc}`, user: "b-doc" },
  { name: "DELETE /documents/:id (seeded)", method: "DELETE", path: (i) => `/documents/${i.doc}`, user: "b-coord" },
  { name: "POST /documents/:id/withdraw", method: "POST", path: (i) => `/documents/${i.upDoc}/withdraw`, user: "b-doc" },
  { name: "POST /cases/:id/documents", method: "POST", path: (i) => `/cases/${i.case}/documents`, user: "b-doc", body: () => pdf("org B upload"), headers: { "content-type": "application/pdf", "x-file-name": "x.pdf", "content-length": String(pdf("org B upload").length) } },
  // Case writes (write-cases.ts).
  { name: "POST /cases/:id/status", method: "POST", path: (i) => `/cases/${i.case}/status`, user: "b-coord", body: () => ({ to: "attention", expected_status: "done" }) },
  { name: "PUT /cases/:id/slot", method: "PUT", path: (i) => `/cases/${i.case2}/slot`, user: "b-coord", body: () => ({ day: "2026-10-22", time: "14:30" }) },
  { name: "DELETE /cases/:id/slot", method: "DELETE", path: (i) => `/cases/${i.case}/slot`, user: "b-coord" },
  { name: "PUT /cases/:id/protocol", method: "PUT", path: (i) => `/cases/${i.case2}/protocol`, user: "b-doc", body: () => ({ version: 0, concl: "x" }) },
  { name: "POST /cases/:id/decisions", method: "POST", path: (i) => `/cases/${i.case2}/decisions`, user: "b-doc", body: () => decisionsBody(), headers: key(901) },
  { name: "POST /cases/:id/decisions/new-version", method: "POST", path: (i) => `/cases/${i.case}/decisions/new-version`, user: "b-doc", body: () => ({ expected_decision_id: null }) },
  { name: "POST /cases/:id/question/confirm", method: "POST", path: (i) => `/cases/${i.case2}/question/confirm`, user: "b-doc", body: () => ({ draft_sha: "0".repeat(64) }) },
  { name: "PUT /cases/:id/edits/:key", method: "PUT", path: (i) => `/cases/${i.case}/edits/brief`, user: "b-doc", body: () => ({ text: "x", orig: "", expected_edit_id: null }) },
  { name: "DELETE /cases/:id/edits/:key", method: "DELETE", path: (i) => `/cases/${i.case}/edits/brief`, user: "b-doc", body: () => ({ expected_edit_id: null }) },
  { name: "PUT /cases/:id/edits/:key (f: key)", method: "PUT", path: (i) => `/cases/${i.case}/edits/${encodeURIComponent("f:f-5a0b11:t")}`, user: "b-doc", body: () => ({ text: "x", orig: "", expected_edit_id: null }) },
  // Org A's alert and fact IDs: the same for both runs of the probe, so only the case decides the answer.
  { name: "POST /cases/:id/alerts/:alertId/events", method: "POST", path: (i) => `/cases/${i.case}/alerts/al-77205d20/events`, user: "b-coord", body: () => ({ action: "ack", expected_state: "open" }) },
  { name: "POST /cases/:id/alerts/:alertId/events (doctor)", method: "POST", path: (i) => `/cases/${i.case}/alerts/al-77205d20/events`, user: "b-doc", body: () => ({ action: "ack", expected_state: "open" }) },
  { name: "POST /cases/:id/facts/:factId/confirmations", method: "POST", path: (i) => `/cases/${i.case}/facts/f-5a0b11/confirmations`, user: "b-doc", body: () => ({ action: "confirm", expected_state: "unconfirmed" }) },
  { name: "POST /cases/:id/break-glass", method: "POST", path: (i) => `/cases/${i.case}/break-glass`, user: "b-doc", body: () => ({ reason: "konzultace na žádost onkologa" }) },
  // Intake (intake.ts).
  { name: "POST /cases/:id/intake/complete", method: "POST", path: (i) => `/cases/${i.case2}/intake/complete`, user: "b-coord" },
  { name: "DELETE /cases/:id/intake", method: "DELETE", path: (i) => `/cases/${i.case2}/intake`, user: "b-coord" },
  // NIS search and link (nis.ts), with a NIS configured in both orgs.
  { name: "GET /cases/:id/nis", method: "GET", path: (i) => `/cases/${i.case}/nis`, user: "b-doc", env: NIS_BOTH },
  { name: "POST /cases/:id/nis/search", method: "POST", path: (i) => `/cases/${i.case}/nis/search`, user: "b-coord", body: () => ({}), env: NIS_BOTH },
  { name: "POST /cases/:id/nis/link", method: "POST", path: (i) => `/cases/${i.case2}/nis/link`, user: "b-doc", body: () => ({ nis_patient_id: "t-pt-a" }), env: NIS_BOTH },
  { name: "DELETE /cases/:id/nis/link", method: "DELETE", path: (i) => `/cases/${i.case}/nis/link`, user: "b-coord", env: NIS_BOTH },
  // Recording (transcript.ts).
  { name: "PATCH /recordings/:id", method: "PATCH", path: (i) => `/recordings/${i.rec}`, user: "b-doc", body: () => ({ end_reason: "stopped" }) },
  { name: "POST /cases/:id/transcript/lines", method: "POST", path: (i) => `/cases/${i.case2}/transcript/lines`, user: "b-doc", body: (i) => ({ recording_id: i.rec, lines: [{ client_line_id: "line-0000-0001", wall_ms: Date.now(), text: "věta" }] }) },
  {
    name: "PUT /cases/:id/transcript/audio/parts/:n",
    method: "PUT",
    path: (i) => `/cases/${i.case2}/transcript/audio/parts/1?recording_id=${i.rec}&final=1`,
    user: "b-doc",
    body: () => new Uint8Array(3200),
    headers: { "content-type": "application/octet-stream", "content-length": "3200", "x-audio-segments": "[]" },
  },
  { name: "GET /jobs/:id", method: "GET", path: (i) => `/jobs/${i.job}`, user: "b-doc" },
  { name: "POST /jobs/:id/retry", method: "POST", path: (i) => `/jobs/${i.job}/retry`, user: "b-doc" },
  // Phone upload, the desktop side (upload-sessions.ts).
  { name: "POST /upload-sessions", method: "POST", path: () => "/upload-sessions", user: "b-doc", body: (i) => ({ case_id: i.case, target: "documents" }) },
  { name: "GET /upload-sessions/:id", method: "GET", path: (i) => `/upload-sessions/${i.us}`, user: "b-doc" },
  { name: "DELETE /upload-sessions/:id", method: "DELETE", path: (i) => `/upload-sessions/${i.us}`, user: "b-doc" },
  // Tasks, drafted tasks, view events, attendance of a case (write-work.ts).
  { name: "PATCH /tasks/:id", method: "PATCH", path: (i) => `/tasks/${i.task}`, user: "b-coord", body: () => ({ done: true, expected_done: false }) },
  { name: "PATCH /tasks/:id (done task)", method: "PATCH", path: (i) => `/tasks/${i.task2}`, user: "b-doc", body: () => ({ done: false, expected_done: true }) },
  { name: "PATCH /suggestions/:id", method: "PATCH", path: (i) => `/suggestions/${i.sugg}`, user: "b-doc", body: () => ({ text: "jiný text" }) },
  { name: "POST /suggestions/:id/confirm", method: "POST", path: (i) => `/suggestions/${i.sugg}/confirm`, user: "b-doc" },
  { name: "POST /suggestions/:id/dismiss", method: "POST", path: (i) => `/suggestions/${i.sugg}/dismiss`, user: "b-doc" },
  { name: "POST /audit/events", method: "POST", path: () => "/audit/events", user: "b-doc", body: (i) => ({ case_id: i.case, code: "source_viewed", target: 1 }) },
  { name: "POST /audit/events (coordinator)", method: "POST", path: () => "/audit/events", user: "b-coord", body: (i) => ({ case_id: i.case2, code: "source_viewed" }) },
  { name: "PUT /attendance/case:id", method: "PUT", path: (i) => `/attendance/case:${i.case}`, user: "b-coord", body: () => ({ version: 0, by_dept: {} }) },
  { name: "PUT /attendance/case:id (doctor)", method: "PUT", path: (i) => `/attendance/case:${i.case2}`, user: "b-doc", body: () => ({ version: 0, by_dept: {} }) },
  // Staff writes on org A's department and person (write-staff.ts).
  { name: "DELETE /staff/departments/:id", method: "DELETE", path: (i) => `/staff/departments/${i.dept}`, user: "b-coord" },
  { name: "POST /staff/departments/:id/people", method: "POST", path: (i) => `/staff/departments/${i.dept}/people`, user: "b-admin", body: () => ({ pre: "MUDr.", sur: "Vetřelec", post: "", fn: "", role: "doctor" }) },
  { name: "PATCH /staff/people/:id", method: "PATCH", path: (i) => `/staff/people/${i.person}`, user: "b-coord", body: () => ({ field: "sur", value: "Přejmenovaný", expected: "Novák" }) },
  { name: "PATCH /staff/people/:id (function)", method: "PATCH", path: (i) => `/staff/people/${i.person}`, user: "b-admin", body: () => ({ field: "fn", value: "primář", expected: "" }) },
  { name: "DELETE /staff/people/:id", method: "DELETE", path: (i) => `/staff/people/${i.person}`, user: "b-coord" },
];

const UNKNOWN: Ids = {
  case: "NO-ZZZ",
  case2: "NO-YYY",
  doc: "doc-zzz",
  upDoc: "up-zzz",
  task: "999999",
  task2: "999998",
  sugg: "999999",
  job: "job-zzz",
  rec: "00000000-0000-4000-8000-000000000000",
  us: "us-zzz",
  dept: "dzzz",
  person: "dzzzp1",
};

// Org A's own activity, made through the API as org A's users, so the sweep has a suggestion, a recording, a job, an
// upload session, an uploaded document, a running seminar and an attendance set of org A to aim at.
async function seedOrgA(): Promise<Ids> {
  expect((await w("POST", "/sessions", { day: "2026-10-22" }, "coord")).status).toBe(200);
  expect((await w("PUT", "/attendance/2026-10-22", { version: 0, by_dept: { d2: ["d2p1"] } }, "coord")).status).toBe(200);
  const us = await w("POST", "/upload-sessions", { case_id: "NO-A", target: "documents" }, "d2p1");
  expect(us.status).toBe(201);
  const bytes = pdf("org A upload");
  const up = await send("POST", "/cases/NO-A/documents", "d2p1", bytes, { "content-type": "application/pdf", "x-file-name": "nalez.pdf", "content-length": String(bytes.length) });
  expect(up.status).toBe(201);
  const rec = await w("POST", "/recordings", { session_day: null }, "d2p1");
  expect(rec.status).toBe(201);
  expect((await w("PUT", "/cases/NO-A/protocol", { version: 0, concl: "Kontrolní MR za 3 měsíce." }, "d2p1")).status).toBe(200);
  const appr = await w("POST", "/cases/NO-A/decisions", decisionsBody(), "d2p1", key(1));
  expect(appr.status).toBe(200);
  const sugg = (await one<{ id: number }>("SELECT id FROM task_suggestions WHERE org_id = 'demo-a' ORDER BY id LIMIT 1")).id;
  const at = new Date().toISOString();
  await env.DB.prepare(
    `INSERT INTO jobs (org_id, id, kind, case_id, workflow, instance_id, attempt, state, error_code, result_ref, created_by, created_by_name, created_by_role, created_at, updated_at)
     VALUES ('demo-a', 'job-a', 'speaker_pass', 'NO-A', 'SPEAKER_PASS', 'job-a', 1, 'error', 'start_failed', 'sp-a', 'd2p1', 'MUDr. Svobodová', 'doctor', ?1, ?1)`,
  ).bind(at).run();
  // Objects of org A under its own prefix and under a prefix from before orgs.
  await env.DOCS.put("org/demo-a/uploads/NO-A/keep.pdf", "a");
  await env.DOCS.put("audio/NO-A/legacy.pcm", "a");
  return {
    case: "NO-A",
    case2: "NO-B",
    doc: "A_pacient",
    upDoc: up.body.data!.document.id,
    task: "1",
    task2: "2",
    sugg: String(sugg),
    job: "job-a",
    rec: rec.body.data!.recording_id,
    us: us.body.data!.id,
    dept: "d1",
    person: "d1p1",
  };
}

describe("every route, acting in org B with org A's IDs", () => {
  it("answers as for an unknown ID (never 403), shows nothing of org A, and changes nothing in org A", { timeout: 60_000 }, async () => {
    const ids = await seedOrgA();
    // The page reader is not reachable from a test; the warm-up probe below gets a canned health answer.
    mockFetch(() => Response.json({ ok: true, versions: {} }));
    const before = await snapshotA();
    const failures: string[] = [];

    for (const p of PROBES) {
      const run = (i: Ids) => send(p.method, p.path(i), p.user, p.body?.(i) ?? {}, p.headers ?? {}, p.env?.() ?? testEnv());
      const a = await run(ids);
      const u = await run(UNKNOWN);
      const seen = `${p.name}: A ${a.status} ${a.body.error?.code ?? ""}, unknown ${u.status} ${u.body.error?.code ?? ""}`;
      if (a.status !== u.status || a.body.error?.code !== u.body.error?.code) failures.push(`differs from an unknown ID: ${seen}`);
      if (a.status === 403) failures.push(`403 on org A's record: ${seen}`);
      if (a.status >= 500) failures.push(`server error: ${seen}`);
      if (a.status < 300) failures.push(`succeeded on org A's record: ${seen}`);
      // The unknown ID must reach the route's own "not found", or the probe tested validation, not the org boundary.
      if (!/_not_found$|^no_recording$/.test(u.body.error?.code ?? "")) failures.push(`probe never reaches the lookup: ${seen}`);
      // The whole answer is the same, not only the code: no field may differ for a record that exists elsewhere.
      if (a.text.replaceAll(p.path(ids), "") !== u.text.replaceAll(p.path(UNKNOWN), "")) failures.push(`body differs from an unknown ID: ${seen}`);
      const leaked = leaksA(a.text);
      if (leaked.length) failures.push(`${p.name} shows org A's data: ${leaked.join(", ")}`);
    }

    // Lists and directory reads: org B's own records only.
    const pts = await get("/patients", "b-coord");
    if (!pts.body.patients?.length || pts.body.patients.some((x: { id: string }) => !x.id.startsWith("B-"))) failures.push(`/patients: ${pts.text.slice(0, 200)}`);
    const ptsDoc = await get("/patients", "b-doc");
    if (ptsDoc.body.patients?.some((x: { id: string }) => !x.id.startsWith("B-"))) failures.push("/patients (doctor) lists org A");
    if (pts.body.total !== pts.body.patients?.length) failures.push(`/patients total counts across orgs: ${pts.body.total}`);
    const search = await get("/patients?q=645312", "b-coord");
    if (search.body.patients?.some((x: { id: string }) => !x.id.startsWith("B-"))) failures.push("/patients?q= finds org A by birth number");
    // Searches and filters that match only org A's data find nothing.
    for (const f of ["q=testov", "q=NO-B", `dept=${encodeURIComponent("Oddělení X")}`, "status=new"]) {
      const r = await get(`/patients?${f}`, "b-coord");
      if (r.body.patients?.length || r.body.total) failures.push(`/patients?${f} finds org A: ${r.text.slice(0, 200)}`);
    }
    const mine = await get("/tasks?scope=mine", "b-coord");
    if (JSON.stringify(mine.body.tasks?.map((t: { id: number }) => t.id)) !== "[3]") failures.push(`/tasks?scope=mine: ${mine.text.slice(0, 200)}`);
    const byActor = await get("/admin/access-log?actor=d2p1", "b-admin");
    if ((byActor.body.entries ?? []).length) failures.push("/admin/access-log?actor= lists org A's person");
    // Page images send the demo user in a cookie, not a header: the cookie acts in its membership's org the same way.
    for (const path of [`/documents/${ids.doc}/pages/1/image`, `/cases/${ids.case}?via=link`]) {
      const r = await call(`/api${path}`, { headers: { cookie: "cb_demo_user=b-doc" } });
      if (r.status !== 404) failures.push(`cookie ${path}: ${r.status}`);
      await r.arrayBuffer();
    }
    const tasks = await get("/tasks", "b-coord");
    if (JSON.stringify(tasks.body.tasks?.map((t: { id: number }) => t.id)) !== "[3]") failures.push(`/tasks: ${tasks.text.slice(0, 200)}`);
    const cal = await get("/calendar?week=2026-10-19", "b-coord");
    if (cal.body.slots?.some((s: { case_id: string }) => !s.case_id.startsWith("B-")) || !cal.body.slots?.length) failures.push(`/calendar: ${cal.text.slice(0, 200)}`);
    const wf = await get("/workflow", "b-coord");
    if (Object.keys(wf.body.cases ?? {}).some((id) => !id.startsWith("B-"))) failures.push("/workflow lists org A's cases");
    // Org A runs a seminar and holds an attendance set on 2026-10-22; org B has neither.
    if ((wf.body.sessions ?? []).length || Object.keys(wf.body.att ?? {}).length) failures.push(`/workflow shows org A's seminar: ${JSON.stringify([wf.body.sessions, wf.body.att])}`);
    const staff = await get("/staff", "b-coord");
    if (JSON.stringify(staff.body.depts?.map((d: { id: string }) => d.id)) !== '["b-d1"]') failures.push(`/staff: ${staff.text.slice(0, 200)}`);
    const logB = await get("/admin/access-log", "b-admin");
    const logCase = await get("/admin/access-log?case=NO-A", "b-admin");
    if ((logCase.body.entries ?? []).length) failures.push("/admin/access-log?case=NO-A lists rows");
    const me = await get("/me", "b-doc");
    if (me.body.org?.id !== "demo-b" || me.body.memberships?.some((m: { org: { id: string } }) => m.org.id !== "demo-b")) failures.push(`/me: ${me.text.slice(0, 200)}`);
    for (const [n, r] of Object.entries({ pts, ptsDoc, search, tasks, mine, cal, wf, staff, logB, logCase, byActor, me })) {
      const leaked = leaksA(r.text);
      if (leaked.length) failures.push(`${n} shows org A's data: ${leaked.join(", ")}`);
    }

    // Writes that are org B's own and legitimately succeed there: they must still leave org A alone.
    const own: [string, Res][] = [
      ["POST /sessions", await w("POST", "/sessions", { day: "2026-10-22" }, "b-coord")],
      ["PUT /attendance/:day", await w("PUT", "/attendance/2026-10-22", { version: 0, by_dept: { "b-d1": ["b-doc"] } }, "b-coord")],
      ["DELETE /sessions/:day", await w("DELETE", "/sessions/2026-10-22", {}, "b-coord")],
      ["POST /recordings (org A's case named)", await w("POST", "/recordings", { session_day: null, case_id: "NO-A" }, "b-doc")],
      ["POST /notifications/digest", await w("POST", "/notifications/digest", {}, "b-coord")],
      ["POST /staff/departments (org A's name)", await w("POST", "/staff/departments", { name: "Neurochirurgie" }, "b-coord")],
      ["POST /cases", await w("POST", "/cases", form("700101/1234"), "b-coord", key(2))],
      ["POST /fhir/referral", await w("POST", "/fhir/referral", { resourceType: "Patient", name: [{ family: "Béčková", given: ["Eva"] }] }, "b-coord")],
      // The pipeline runs for org B here, as on the deployed host.
      ["POST /admin/pipeline/warm", await send("POST", "/admin/pipeline/warm", "b-admin", {}, {}, testEnv({ PIPELINE_ORGS: "demo-b" }))],
    ];
    // A refusal here (session_running, dept_name_taken, duplicate_birth_number) would be a collision with org A.
    for (const [n, r] of own) if (r.status >= 300) failures.push(`org B's own write failed: ${n} ${r.status} ${r.body.error?.code ?? ""}`);
    // Stopping org B's own recording with org A's case in the body: the log row must not take the case from the body.
    const recB = own[3]![1].body.data?.recording_id;
    const stop = await w("PATCH", `/recordings/${recB}`, { end_reason: "stopped", case_id: "NO-A" }, "b-doc");
    if (stop.status !== 200) failures.push(`PATCH /recordings (org B's own): ${stop.status}`);
    // A drafted case in org B naming org A's owner and department: free text, never a link to org A's people.
    const named = await w("POST", "/cases", form("700101/9999", { owner: "MUDr. Svobodová", dept: "Neurochirurgie" }), "b-coord", key(3));
    if (named.status !== 200) failures.push(`POST /cases with org A's names: ${named.status} ${named.body.error?.code ?? ""}`);
    // An attendee from org A is not a person of org B's department.
    const att = await w("PUT", "/attendance/2026-10-22", { version: 1, by_dept: { d2: ["d2p1"] } }, "b-coord");
    if (att.status < 400 || att.status === 403 || leaksA(att.text).length) failures.push(`attendance with org A's people: ${att.status} ${att.text.slice(0, 200)}`);
    // No org B row and no org B object points at an org A record (the recordings above named org A's case).
    failures.push(...(await aIdsInB()).map((f) => `org B points at org A: ${f}`));
    const digest = own[4]![1];
    if (digest.body.data?.n !== 1) failures.push(`digest counts across orgs: ${JSON.stringify(digest.body.data)}`);

    expect(failures).toEqual([]);
    expect(await snapshotA()).toEqual(before);

    // The control: the same reads as org A's own users find the records, so the 404s above are the org boundary and
    // not a malformed request. (The intake read answers 409 on a completed case; that too says the case exists.)
    const asA: Record<string, string> = { "b-doc": "d2p1", "b-coord": "coord", "b-admin": "admin" };
    const found: string[] = [];
    for (const p of PROBES.filter((x) => x.method === "GET")) {
      const r = await send("GET", p.path(ids), asA[p.user]!, {}, {}, p.env?.() ?? testEnv());
      found.push(`${p.name} ${r.status}`);
    }
    expect(found.filter((f) => !/ 200$/.test(f))).toEqual(["GET /cases/:id/intake 409"]);
  });

  it("covers every route the Worker mounts", async () => {
    // A reminder that keeps the sweep complete: each data route in src/routes is in PROBES above or in the list of
    // routes tested elsewhere in this file (the org-less ones and the org B writes).
    const covered = new Set([
      ...PROBES.map((p) => `${p.method} ${p.name.replace(/^\w+ /, "").replace(/ \(.*\)$/, "").replace(/\?.*$/, "")}`),
      "GET /patients", "GET /tasks", "GET /calendar", "GET /workflow", "GET /staff", "GET /admin/access-log", "GET /me", "GET /demo/memberships", "GET /",
      "POST /sessions", "DELETE /sessions/:day", "PUT /attendance/:key", "POST /recordings", "POST /notifications/digest", "POST /staff/departments",
      "POST /cases", "POST /fhir/referral", "POST /admin/pipeline/warm", "POST /staff/reset", "POST /admin/reset-demo",
      // The phone's two routes take a session token, which names its org; the upload-sessions tests cover them.
      "GET /upload-sessions/current", "POST /upload-sessions/current/files",
      // No org data: the speech-to-text token and diarization, the summary of text the page sends.
      "POST /token", "POST /diarize", "POST /",
      // The login and the session switches (OIDC mode); test/oidc.test.ts refuses a switch into another org or to
      // another org's membership.
      "GET /login", "GET /callback", "POST /logout", "POST /session/org", "POST /session/role",
    ]);
    const norm = (p: string) =>
      p
        .replace(/:id\/edits\/:key/, ":id/edits/:key")
        .replace(/\/attendance\/case:id/, "/attendance/:key")
        .replace(/\/attendance\/:day/, "/attendance/:key");
    const mounted: string[] = [];
    for (const [file, src] of Object.entries(env.TEST_SOURCES as Record<string, string>)) {
      if (!file.startsWith("routes/") && !file.startsWith("routes\\")) continue;
      for (const m of src.matchAll(/\.(get|post|put|patch|delete)\(\s*"(\/[^"]*)"/g)) mounted.push(`${m[1]!.toUpperCase()} ${m[2]}`);
    }
    const missing = mounted.filter((r) => ![...covered].some((c) => norm(c) === norm(r)));
    expect(missing).toEqual([]);
  });

  it("checks every org table and would see an org B row that points at org A", async () => {
    // The snapshot reads the schema; ORG_TABLES (the source scan's list) must not miss a table the schema has.
    expect(await orgTables()).toEqual([...ORG_TABLES].sort());
    expect(await aIdsInB()).toEqual([]);
    await env.DB.prepare("INSERT INTO notifications (org_id, id, kind, case_id, count, link, created_by, created_by_name, created_at) VALUES ('demo-b', 'n-x', 'digest', 'NO-A', 0, '/', 'b-coord', 'x', '2026-10-19T10:00:00.000Z')").run();
    expect(await aIdsInB()).toEqual(["notifications.case_id = NO-A"]);
  });
});

// ---------------------------------------------------------------------------------------------------------------
// 2. The places the design names one by one.
// ---------------------------------------------------------------------------------------------------------------

describe("idempotency keys", () => {
  it("a person in both orgs who reuses org A's key in org B makes a new request there, not a replay", async () => {
    await env.DB.prepare("INSERT INTO memberships (id, org_id, user_id, role_id, active_from) VALUES ('coord-b', 'demo-b', 'coord', 'coordinator', '2026-01-01T00:00:00.000Z')").run();
    const body = form("700101/1234");
    const a = await w("POST", "/cases", body, "coord", key(10));
    expect(a.status).toBe(200);
    expect(a.body.data!.case_id).toBe("NO-100");
    const b = await w("POST", "/cases", body, "coord-b", key(10));
    expect(b.status).toBe(200);
    expect(b.body.data!.case_id).toBe("B-NO-100");
    expect(b.text).not.toContain('"NO-100"');
    expect(await q("SELECT org_id, user_id, json_extract(response_json, '$.case_id') AS c FROM idempotency_keys ORDER BY org_id")).toEqual([
      { org_id: "demo-a", user_id: "coord", c: "NO-100" },
      { org_id: "demo-b", user_id: "coord", c: "B-NO-100" },
    ]);
    // Each org replays its own answer.
    expect((await w("POST", "/cases", body, "coord", key(10))).body.data!.case_id).toBe("NO-100");
    expect((await w("POST", "/cases", body, "coord-b", key(10))).body.data!.case_id).toBe("B-NO-100");
    // The replay rows went to each org's own access log.
    expect((await q("SELECT org_id FROM access_log WHERE action = 'request.replay' ORDER BY org_id")).map((r) => r.org_id)).toEqual(["demo-a", "demo-b"]);
  });

  it("an approval key used in org A does not replay in org B", async () => {
    await env.DB.prepare("INSERT INTO memberships (id, org_id, user_id, role_id, active_from) VALUES ('d2p1-b', 'demo-b', 'd2p1', 'doctor', '2026-01-01T00:00:00.000Z')").run();
    await env.DB.prepare("INSERT INTO dept_members (org_id, dept_id, user_id, position) VALUES ('demo-b', 'b-d1', 'd2p1', 1)").run();
    await w("PUT", "/cases/NO-A/protocol", { version: 0, concl: "Kontrolní MR za 3 měsíce." }, "d2p1");
    expect((await w("POST", "/cases/NO-A/decisions", decisionsBody(), "d2p1", key(11))).status).toBe(200);
    // The same key on org A's case, from org B: the case is not there, whatever the key says.
    const r = await w("POST", "/cases/NO-A/decisions", decisionsBody(), "d2p1-b", key(11));
    expect([r.status, r.body.error?.code]).toEqual([404, "case_not_found"]);
    expect(await q("SELECT org_id FROM decisions")).toEqual([{ org_id: "demo-a" }]);
  });
});

describe("slots", () => {
  it("org B books a time org A holds, and org A's refusal never names org B", async () => {
    expect((await w("PUT", "/cases/NO-B/slot", { day: "2026-10-22", time: "14:10" }, "coord")).status).toBe(200);
    const b = await w("PUT", "/cases/B-NO-A/slot", { day: "2026-10-22", time: "14:10" }, "b-coord");
    expect([b.status, b.body.error?.code]).toEqual([200, undefined]);
    expect(b.body.state!.cases["B-NO-A"].slot).toEqual({ day: "2026-10-22", time: "14:10" });
    // Org A's own collision is refused, with nothing of org B in the answer.
    const a = await w("PUT", "/cases/NO-A/slot", { day: "2026-10-22", time: "14:10" }, "coord");
    expect([a.status, a.body.error?.code]).toEqual([409, "slot_taken"]);
    for (const s of ["B-NO-A", B_NAME, "Bédoktorová", "Békoordinátorová"]) expect(a.text).not.toContain(s);
    // Org B's refusal on its own calendar does not name org A either.
    await env.DB.prepare("INSERT INTO cases (id, org_id, case_no, patient_id, source_file, list_order, status, processing_level, question_explicit, owner_name, submitted_on, updated_on) VALUES ('B-NO-C', 'demo-b', 'NO-C', 'pt-BA', 'C.pdf', 1, 'new', 'none', 0, 'x', '2026-10-01', '2026-10-01')").run();
    await env.DB.prepare("INSERT INTO case_members (org_id, case_id, dept_id, reason) VALUES ('demo-b', 'B-NO-C', 'b-d1', 'test')").run();
    const bb = await w("PUT", "/cases/B-NO-C/slot", { day: "2026-10-22", time: "14:10" }, "b-coord");
    expect([bb.status, bb.body.error?.code]).toEqual([409, "slot_taken"]);
    expect(leaksA(bb.text)).toEqual([]);
    expect(await q("SELECT org_id, time, case_id FROM slots WHERE day = '2026-10-22' ORDER BY org_id, time")).toEqual([
      { org_id: "demo-a", time: "14:00", case_id: "NO-A" },
      { org_id: "demo-a", time: "14:10", case_id: "NO-B" },
      { org_id: "demo-b", time: "14:10", case_id: "B-NO-A" },
    ]);
  });
});

describe("birth numbers and case numbers", () => {
  it("a birth number known only in org A is no duplicate in org B, and is one in org A", async () => {
    const a = await w("POST", "/cases", form("700101/1234"), "coord", key(20));
    expect(a.status).toBe(200);
    const b = await w("POST", "/cases", form("7001011234"), "b-coord", key(21));
    expect([b.status, b.body.error?.code]).toEqual([200, undefined]);
    const again = await w("POST", "/cases", form("700101/1234"), "coord", key(22));
    expect(again.body.error).toMatchObject({ code: "duplicate_birth_number", current: { case_id: a.body.data!.case_id } });
    // The fixture's birth number is in both orgs: org B's refusal names org B's case, never org A's.
    const shared = await w("POST", "/cases", form("645312/1234"), "b-coord", key(23));
    expect(shared.body.error).toMatchObject({ code: "duplicate_birth_number", current: { case_id: "B-NO-A" } });
    expect(leaksA(shared.text)).toEqual([]);
  });

  it("counts case numbers per org; internal IDs carry the org's prefix and differ", async () => {
    const b1 = await w("POST", "/cases", form("700101/1111"), "b-coord", key(30));
    const a1 = await w("POST", "/cases", form("700101/2222"), "coord", key(31));
    const b2 = await w("POST", "/cases", form("700101/3333"), "b-coord", key(32));
    expect([b1.body.data!.case_id, a1.body.data!.case_id, b2.body.data!.case_id]).toEqual(["B-NO-100", "NO-100", "B-NO-101"]);
    expect(await q("SELECT org_id, id, case_no, patient_id FROM cases WHERE case_no GLOB 'NO-[0-9]*' ORDER BY org_id, id")).toEqual([
      { org_id: "demo-a", id: "NO-100", case_no: "NO-100", patient_id: "pt-NO-100" },
      { org_id: "demo-b", id: "B-NO-100", case_no: "NO-100", patient_id: "pt-B-NO-100" },
      { org_id: "demo-b", id: "B-NO-101", case_no: "NO-101", patient_id: "pt-B-NO-101" },
    ]);
    // Org B's new case is a member of org B's departments only.
    expect((await q("SELECT DISTINCT org_id FROM case_members WHERE case_id LIKE 'B-NO-1%'")).map((r) => r.org_id)).toEqual(["demo-b"]);
  });
});

describe("break-the-glass", () => {
  it("an org B doctor on an org A case gets 404 and no grant", async () => {
    const before = await snapshotA();
    const r = await w("POST", "/cases/NO-A/break-glass", { reason: "konzultace na žádost onkologa" }, "b-doc");
    expect([r.status, r.body.error?.code]).toEqual([404, "case_not_found"]);
    expect(await q("SELECT * FROM case_access_grants")).toEqual([]);
    expect(await q("SELECT * FROM access_log WHERE case_id = 'NO-A'")).toEqual([]);
    // And the case stays closed to them afterwards.
    expect((await get("/cases/NO-A", "b-doc")).status).toBe(404);
    expect(await snapshotA()).toEqual(before);
  });

  it("a grant in org A does not open org B's look-alike case to the same person", async () => {
    await env.DB.prepare("INSERT INTO memberships (id, org_id, user_id, role_id, active_from) VALUES ('d1p1-b', 'demo-b', 'd1p1', 'doctor', '2026-01-01T00:00:00.000Z')").run();
    expect((await w("POST", "/cases/NO-A/break-glass", { reason: "konzultace na žádost onkologa" }, "d1p1")).status).toBe(200);
    expect((await get("/cases/NO-A", "d1p1")).status).toBe(200);
    // In org B the same person is not on B-NO-A's team and holds no grant there.
    expect((await get("/cases/B-NO-A", "d1p1-b")).status).toBe(403);
    expect((await get("/cases/NO-A", "d1p1-b")).status).toBe(404);
  });
});

describe("staff and demo resets", () => {
  // The real seed leaves demo org B empty (people and departments only, api/seed/seed.py); its reset section then holds
  // only those rows and no patient. The fixture's org B has a case, so this test gives org B the seed's shape first.
  it("an empty demo org answers empty lists, keeps a patient created there in it, and its reset empties it again", async () => {
    const setup = MUTABLE_B.filter((x) => /^INSERT INTO (users|memberships|departments|dept_members) /.test(x));
    expect(setup).toHaveLength(4);
    const doc = resetDoc();
    await env.DOCS.put("seed/reset.json", JSON.stringify({ ...doc, orgs: { ...doc.orgs, "demo-b": { statements: setup, patient_ids: [], membership_ids: ["b-doc", "b-coord", "b-admin"] } } }));
    const before = await snapshotA();
    // The fixture also seeds org B a document, its page, an extraction run and an alert, which a reset keeps (seed
    // rows); the real seed has none in org B, so they go first, inside an org B reset window as the triggers require.
    await env.DB.batch([
      "UPDATE demo_state SET reset_in_progress = 1 WHERE org_id = 'demo-b'",
      ...["alerts", "extraction_runs", "pages", "document_parts", "documents"].map((t) => `DELETE FROM ${t} WHERE org_id = 'demo-b'`),
      "UPDATE demo_state SET reset_in_progress = 0 WHERE org_id = 'demo-b'",
    ].map((x) => env.DB.prepare(x)));
    expect((await w("POST", "/admin/reset-demo", { confirm: "OBNOVIT" }, "b-admin")).status).toBe(200);
    const e2 = { "x-data-epoch": "2" };
    for (const t of ["patients", "cases", "documents", "alerts", "slots", "tasks"]) expect(await q(`SELECT * FROM ${t} WHERE org_id = 'demo-b'`), t).toEqual([]);
    expect((await q("SELECT id FROM departments WHERE org_id = 'demo-b'")).map((r) => r.id)).toEqual(["b-d1"]);
    // Every list a screen reads answers, and empty.
    const pts = await get("/patients", "b-doc");
    expect([pts.status, pts.body.patients, pts.body.total]).toEqual([200, [], 0]);
    expect((await get("/tasks", "b-coord")).body.tasks).toEqual([]);
    const wf = await get("/workflow", "b-coord");
    expect([wf.status, Object.keys(wf.body.cases ?? {})]).toEqual([200, []]);
    for (const path of ["/calendar", "/staff", "/me"]) expect((await get(path, "b-doc")).status, path).toBe(200);
    expect((await get("/admin/access-log", "b-admin")).status).toBe(200);

    // A patient created in the empty org stays in it.
    const made = await w("POST", "/cases", form("700101/1234"), "b-doc", { ...key(40), ...e2 });
    expect(made.status).toBe(200);
    expect(made.body.data!.case_id).toBe("B-NO-100");
    expect((await get("/patients", "b-doc")).body.patients.map((x: { id: string }) => x.id)).toEqual(["B-NO-100"]);
    expect((await q("SELECT org_id FROM patients WHERE birth_number = '700101/1234'")).map((r) => r.org_id)).toEqual(["demo-b"]);

    // The next reset returns org B to its people and departments, and org A never changed.
    expect((await w("POST", "/admin/reset-demo", { confirm: "OBNOVIT" }, "b-admin", e2)).status).toBe(200);
    for (const t of ["patients", "cases"]) expect(await q(`SELECT * FROM ${t} WHERE org_id = 'demo-b'`), t).toEqual([]);
    expect((await q("SELECT id FROM memberships WHERE org_id = 'demo-b' AND active_until IS NULL ORDER BY id")).map((r) => r.id)).toEqual(["b-admin", "b-coord", "b-doc"]);
    expect(await snapshotA()).toEqual(before);
  });

  it("the staff reset in org B leaves org A's departments and names alone", async () => {
    const deptsA = await q("SELECT * FROM departments WHERE org_id = 'demo-a' ORDER BY id");
    const before = await snapshotA();
    const r = await w("POST", "/staff/reset", {}, "b-coord");
    expect(r.status).toBe(200);
    expect(r.body.state!.staff.depts.every((d: { id: string }) => d.id.startsWith("b-"))).toBe(true);
    expect(leaksA(r.text)).toEqual([]);
    expect(await q("SELECT * FROM departments WHERE org_id = 'demo-a' ORDER BY id")).toEqual(deptsA);
    expect(await snapshotA()).toEqual(before);
  });

  // A person on both orgs' staff lists: org B's staff screen changes their membership in org B only.
  async function d1p1InB() {
    await env.DB.batch([
      env.DB.prepare("INSERT INTO memberships (id, org_id, user_id, role_id, active_from) VALUES ('d1p1-b', 'demo-b', 'd1p1', 'doctor', '2026-01-01T00:00:00.000Z')"),
      env.DB.prepare("INSERT INTO dept_members (org_id, dept_id, user_id, position) VALUES ('demo-b', 'b-d1', 'd1p1', 1)"),
    ]);
  }

  it("org B removing a person who is also in org A ends their org B membership only", async () => {
    await d1p1InB();
    const before = await snapshotA();
    const r = await w("DELETE", "/staff/people/d1p1", {}, "b-coord");
    expect(r.status).toBe(200);
    expect(await q("SELECT id, active_until IS NOT NULL AS ended FROM memberships WHERE user_id = 'd1p1' ORDER BY id")).toEqual([
      { id: "d1p1", ended: 0 },
      { id: "d1p1-b", ended: 1 },
    ]);
    expect(await snapshotA()).toEqual(before);
    expect((await get("/me", "d1p1")).body).toMatchObject({ membership_id: "d1p1", org: { id: "demo-a" } });
  });

  it("org B's staff reset ends an extra person's org B membership only", async () => {
    await d1p1InB();
    const before = await snapshotA();
    expect((await w("POST", "/staff/reset", {}, "b-coord")).status).toBe(200);
    expect((await one("SELECT active_until FROM memberships WHERE id = 'd1p1-b'")).active_until).not.toBeNull();
    expect(await snapshotA()).toEqual(before);
  });

  it("org B renaming a person who is also in org A renames the person (names are the person's, AUTH.md)", async () => {
    await d1p1InB();
    const r = await w("PATCH", "/staff/people/d1p1", { field: "sur", value: "Přejmenovaný", expected: "Novák" }, "b-coord");
    expect(r.status).toBe(200);
    // The person is shared, so org A's staff list shows the new name; org A's rows (tasks, attendance) are not
    // rewritten by org B's request.
    const staffA = await get("/staff", "coord");
    expect(staffA.text).toContain("Přejmenovaný");
    expect((await one("SELECT assignee_name FROM tasks WHERE id = 2")).assignee_name).toBe("MUDr. Novák");
  });

  it("reset-demo by org B's administrator resets org B only", async () => {
    // Activity in both orgs first, and transient objects under both orgs' prefixes and the legacy ones.
    expect((await w("POST", "/cases/NO-A/status", { to: "attention", expected_status: "ready" }, "d2p1")).status).toBe(200);
    expect((await w("POST", "/cases/B-NO-A/status", { to: "attention", expected_status: "ready" }, "b-doc")).status).toBe(200);
    expect((await w("POST", "/cases", form("700101/1234"), "b-coord", key(40))).status).toBe(200);
    await env.DOCS.put("uploads/NO-A/legacy.pdf", "a");
    await env.DOCS.put("audio/NO-A/legacy.pcm", "a");
    await env.DOCS.put("org/demo-a/uploads/NO-A/x.pdf", "a");
    await env.DOCS.put("org/demo-b/uploads/B-NO-A/x.pdf", "b");
    const before = await snapshotA();
    const logA = await q("SELECT * FROM access_log WHERE org_id = 'demo-a' ORDER BY id");
    expect(logA.length).toBeGreaterThan(0);

    expect((await w("POST", "/admin/reset-demo", { confirm: "OBNOVIT" }, "admin", { "x-data-epoch": "1" })).status).toBe(200);
    // That was org A's own reset; start the comparison from here.
    const afterA = await snapshotA();
    expect(afterA).not.toEqual(before);

    const r = await w("POST", "/admin/reset-demo", { confirm: "OBNOVIT" }, "b-admin");
    expect(r.status).toBe(200);
    expect(r.body.data).toMatchObject({ data_epoch: 2, r2_left: 0 });
    expect(await snapshotA()).toEqual(afterA);
    expect(await q("SELECT org_id, data_epoch FROM demo_state ORDER BY org_id")).toEqual([
      { org_id: "demo-a", data_epoch: 2 },
      { org_id: "demo-b", data_epoch: 2 },
    ]);
    // Org B is back to its seed: no extra case, the status as seeded, one log row (the reset).
    expect(await q("SELECT id, status FROM cases WHERE org_id = 'demo-b'")).toEqual([{ id: "B-NO-A", status: "ready" }]);
    expect((await q("SELECT what_cs FROM access_log WHERE org_id = 'demo-b'")).map((x) => x.what_cs)).toEqual(["obnovil(a) ukázková data (seed test)"]);
    expect((await env.DOCS.list({ prefix: "org/demo-b/audit-archive/" })).objects).toHaveLength(1);
    expect((await env.DOCS.list({ prefix: "org/demo-a/audit-archive/" })).objects).toHaveLength(1);
    expect((await env.DOCS.list({ prefix: "audit-archive/" })).objects).toHaveLength(0);
    expect(await env.DOCS.head("org/demo-b/uploads/B-NO-A/x.pdf")).toBeNull();
    // Org B's archive holds org B's rows only.
    const archive = (await env.DOCS.list({ prefix: "org/demo-b/audit-archive/" })).objects[0]!.key;
    const lines = (await (await env.DOCS.get(archive))!.text()).trim().split("\n").map((l) => JSON.parse(l) as { row: { org_id?: string; case_id?: string } });
    expect(lines.length).toBeGreaterThan(0);
    expect(lines.every((l) => l.row.org_id === "demo-b")).toBe(true);
  });

  it("reset-demo in org B keeps org A's activity, epoch, log and legacy objects", async () => {
    expect((await w("POST", "/cases/NO-A/status", { to: "attention", expected_status: "ready" }, "d2p1")).status).toBe(200);
    await env.DOCS.put("uploads/NO-A/legacy.pdf", "a");
    await env.DOCS.put("audio/NO-A/legacy.pcm", "a");
    await env.DOCS.put("jobs/NO-A/x.json", "a");
    await env.DOCS.put("cache/summary/x.json", "a");
    const before = await snapshotA();
    const r = await w("POST", "/admin/reset-demo", { confirm: "OBNOVIT" }, "b-admin");
    expect(r.status).toBe(200);
    expect(await snapshotA()).toEqual(before);
    expect((await one("SELECT data_epoch FROM demo_state WHERE org_id = 'demo-a'")).data_epoch).toBe(1);
    expect((await one("SELECT status FROM cases WHERE id = 'NO-A'")).status).toBe("attention");
    // Org A's tab keeps writing with its epoch; org B's old tab must reload.
    expect((await w("POST", "/cases/NO-A/status", { to: "ready", expected_status: "attention" }, "d2p1")).status).toBe(200);
    expect((await w("POST", "/cases/B-NO-A/status", { to: "attention", expected_status: "ready" }, "b-doc")).body.error?.code).toBe("data_reset");
  });

  it("the administrator of org B cannot reset with org A's epoch view, and org A's administrator only resets org A", async () => {
    await env.DB.prepare("UPDATE demo_state SET data_epoch = 5 WHERE org_id = 'demo-b'").run();
    // Org A's epoch (1) is stale for org B.
    expect((await w("POST", "/admin/reset-demo", { confirm: "OBNOVIT" }, "b-admin")).body.error?.code).toBe("data_reset");
    const bRows = await q("SELECT * FROM cases WHERE org_id = 'demo-b'");
    expect((await w("POST", "/admin/reset-demo", { confirm: "OBNOVIT" }, "admin")).status).toBe(200);
    expect(await q("SELECT * FROM cases WHERE org_id = 'demo-b'")).toEqual(bRows);
    expect((await one("SELECT data_epoch FROM demo_state WHERE org_id = 'demo-b'")).data_epoch).toBe(5);
  });
});

describe("the cron sweep", () => {
  async function audio(org: string, caseId: string, user: string, id: string, ageMs: number) {
    const at = new Date(Date.now() - ageMs).toISOString();
    const k = `org/${org}/audio/${caseId}/${id}.pcm`;
    await env.DB.batch([
      env.DB.prepare("INSERT INTO recordings (org_id, id, started_by, started_by_name, started_at) VALUES (?1, ?2, ?3, 'x', ?4)").bind(org, `rec-${id}`, user, at),
      env.DB.prepare("INSERT INTO audio_uploads (org_id, id, case_id, recording_id, r2_key, state, created_by, created_at) VALUES (?1, ?2, ?3, ?4, ?5, 'completed', ?6, ?7)").bind(org, id, caseId, `rec-${id}`, k, user, at),
    ]);
    await env.DOCS.put(k, "pcm");
    return k;
  }

  it("deletes old audio only in the org that has it", async () => {
    const oldA = await audio("demo-a", "NO-A", "d2p1", "au-a", 7 * 3600_000);
    const freshB = await audio("demo-b", "B-NO-A", "b-doc", "au-b", 60_000);
    expect((await sweep(env)).purged).toBe(1);
    expect(await env.DOCS.head(oldA)).toBeNull();
    expect(await env.DOCS.head(freshB)).not.toBeNull();
    expect(await q("SELECT org_id, id, state FROM audio_uploads ORDER BY org_id")).toEqual([
      { org_id: "demo-a", id: "au-a", state: "deleted" },
      { org_id: "demo-b", id: "au-b", state: "completed" },
    ]);
    expect((await q("SELECT org_id FROM access_log WHERE action = 'recording.audio_deleted'")).map((r) => r.org_id)).toEqual(["demo-a"]);

    // The other way round: org B's old audio goes, org A's fresh audio stays.
    const freshA = await audio("demo-a", "NO-A", "d2p1", "au-a2", 60_000);
    await env.DB.prepare("UPDATE audio_uploads SET created_at = ?1 WHERE id = 'au-b'").bind(new Date(Date.now() - 7 * 3600_000).toISOString()).run();
    const before = await snapshotA();
    expect((await sweep(env)).purged).toBe(1);
    expect(await env.DOCS.head(freshB)).toBeNull();
    expect(await env.DOCS.head(freshA)).not.toBeNull();
    expect(await snapshotA()).toEqual(before);
  });

  it("an ended seminar in org B does not end org A's audio of the same day", async () => {
    const day = "2026-10-22";
    const at = new Date(Date.now() - 3600_000).toISOString();
    await env.DB.batch([
      env.DB.prepare("INSERT INTO sessions (org_id, day, started_by, started_at, ended_at) VALUES ('demo-b', ?1, 'b-coord', ?2, ?3)").bind(day, at, new Date().toISOString()),
      env.DB.prepare("INSERT INTO sessions (org_id, day, started_by, started_at) VALUES ('demo-a', ?1, 'coord', ?2)").bind(day, at),
      env.DB.prepare("INSERT INTO recordings (org_id, id, session_day, started_by, started_by_name, started_at) VALUES ('demo-a', 'rec-s', ?1, 'd2p1', 'x', ?2)").bind(day, at),
      env.DB.prepare("INSERT INTO audio_uploads (org_id, id, case_id, recording_id, r2_key, state, created_by, created_at) VALUES ('demo-a', 'au-s', 'NO-A', 'rec-s', 'org/demo-a/audio/NO-A/au-s.pcm', 'completed', 'd2p1', ?1)").bind(at),
    ]);
    await env.DOCS.put("org/demo-a/audio/NO-A/au-s.pcm", "pcm");
    expect((await sweep(env)).purged).toBe(0);
    expect((await one("SELECT state FROM audio_uploads WHERE id = 'au-s'")).state).toBe("completed");
    // The control: org A's own seminar ending does end that audio.
    await env.DB.prepare("UPDATE sessions SET ended_at = ?1 WHERE org_id = 'demo-a'").bind(new Date().toISOString()).run();
    expect((await sweep(env)).purged).toBe(1);
  });

  it("removes expired upload sessions of each org on that org's clock only", async () => {
    const at = (h: number) => new Date(Date.now() - h * 3600_000).toISOString();
    await env.DB.batch([
      env.DB.prepare("INSERT INTO upload_sessions (org_id, id, token_hash, case_id, target, created_by, created_at, expires_at) VALUES ('demo-b', 'us-b', ?1, 'B-NO-A', 'documents', 'b-doc', ?2, ?3)").bind("b".repeat(64), at(30), at(26)),
      env.DB.prepare("INSERT INTO upload_sessions (org_id, id, token_hash, case_id, target, created_by, created_at, expires_at) VALUES ('demo-a', 'us-a', ?1, 'NO-A', 'documents', 'd2p1', ?2, ?3)").bind("a".repeat(64), at(2), at(1)),
    ]);
    const before = await snapshotA();
    await sweep(env);
    expect((await q("SELECT id FROM upload_sessions ORDER BY id")).map((r) => r.id)).toEqual(["us-a"]);
    expect(await snapshotA()).toEqual(before);
  });
});

describe("upload from a phone", () => {
  const phone = async (token: string, bytes?: Uint8Array, extra: Record<string, string> = {}) => {
    const r = bytes
      ? await call("/api/upload-sessions/current/files", {
          method: "POST",
          headers: { authorization: `Bearer ${token}`, "content-type": "application/pdf", "x-file-name": "foto.pdf", "content-length": String(bytes.length), ...extra },
          body: bytes,
        })
      : await call("/api/upload-sessions/current", { headers: { authorization: `Bearer ${token}`, ...extra } });
    return { status: r.status, body: (await r.json()) as Body };
  };

  it("acts with the creator's membership in the session's org, never one in another org", async () => {
    // A doctor on B-NO-A's team in org B who is also an active doctor on org A's oncology team.
    await env.DB.batch([
      env.DB.prepare("INSERT INTO users (id, pre, sur) VALUES ('dual', 'MUDr.', 'Dvojí')"),
      env.DB.prepare(
        "INSERT INTO memberships (id, org_id, user_id, role_id, active_from) VALUES ('dual-a', 'demo-a', 'dual', 'doctor', '2026-01-01T00:00:00.000Z'), ('dual-b', 'demo-b', 'dual', 'doctor', '2026-01-01T00:00:00.000Z')",
      ),
      env.DB.prepare("INSERT INTO dept_members (org_id, dept_id, user_id, position) VALUES ('demo-b', 'b-d1', 'dual', 1), ('demo-a', 'd2', 'dual', 1)"),
    ]);
    const s = await w("POST", "/upload-sessions", { case_id: "B-NO-A", target: "documents" }, "dual-b");
    expect(s.status).toBe(201);
    const token = s.body.data!.token as string;
    expect((await phone(token)).body).toMatchObject({ case_id: "B-NO-A" });
    // A demo-user header on the phone's request changes nothing: the token names the session and its org.
    const sent = await phone(token, pdf("phone in B"), { "x-demo-user": "d2p1" });
    expect(sent.status).toBe(201);
    expect(await q("SELECT org_id, case_id, uploaded_by FROM documents WHERE origin = 'upload'")).toEqual([{ org_id: "demo-b", case_id: "B-NO-A", uploaded_by: "dual" }]);
    expect((await q("SELECT org_id FROM access_log WHERE action = 'document.upload'")).map((r) => r.org_id)).toEqual(["demo-b"]);
    // Org B ends the membership: the link ends, although the person still acts in org A.
    const before = await snapshotA();
    await env.DB.prepare("UPDATE memberships SET active_until = '2026-02-01T00:00:00.000Z' WHERE id = 'dual-b'").run();
    expect((await phone(token)).status).toBe(410);
    expect((await phone(token, pdf("after the end"))).status).toBe(410);
    expect(await snapshotA()).toEqual(before);
    expect((await get("/me", "dual")).body).toMatchObject({ org: { id: "demo-a" } });
  });

  it("the same bytes are a new document in each org", async () => {
    const bytes = pdf("same file");
    const up = (caseId: string, user: string) => send("POST", `/cases/${caseId}/documents`, user, bytes, { "content-type": "application/pdf", "x-file-name": "same.pdf", "content-length": String(bytes.length) });
    expect((await up("NO-A", "d2p1")).status).toBe(201);
    expect((await up("B-NO-A", "b-doc")).status).toBe(201);
    expect((await up("NO-A", "d2p1")).status).toBe(200);
    expect((await q("SELECT org_id FROM documents WHERE origin = 'upload' ORDER BY org_id")).map((r) => r.org_id)).toEqual(["demo-a", "demo-b"]);
  });
});

describe("who a request acts as", () => {
  it("/api/health reports the epoch of the picked user's org", async () => {
    await env.DB.prepare("UPDATE demo_state SET data_epoch = 7 WHERE org_id = 'demo-b'").run();
    const h = async (user?: string) => (await (await call("/api/health", user ? { headers: { "x-demo-user": user } } : {})).json<{ demo: { data_epoch: number } }>()).demo.data_epoch;
    expect(await h("b-doc")).toBe(7);
    expect(await h("d2p1")).toBe(1);
    expect(await h()).toBe(1);
    // An unknown user falls back to demo org A's state, revealing nothing about another org.
    expect(await h("nobody")).toBe(1);
  });

  it("/api/me as an org B doctor names org B and only org B's memberships", async () => {
    await env.DB.prepare("UPDATE demo_state SET data_epoch = 3 WHERE org_id = 'demo-b'").run();
    const me = await get("/me", "b-doc");
    expect(me.status).toBe(200);
    expect(me.body).toMatchObject({ membership_id: "b-doc", org: { id: "demo-b" }, data_epoch: 3, user: { id: "b-doc", dept: { id: "b-d1", name: "Klinická onkologie" } } });
    expect(me.body.memberships.map((m: { id: string; org: { id: string } }) => [m.id, m.org.id])).toEqual([["b-doc", "demo-b"]]);
  });

  it("/api/demo/memberships lists both orgs, each with its own people", async () => {
    const r = await get("/demo/memberships", "b-doc");
    expect(r.status).toBe(200);
    const orgs = r.body.orgs as { id: string; people: { id: string }[] }[];
    expect(orgs.map((o) => o.id)).toEqual(["demo-a", "demo-b"]);
    expect(orgs[0]!.people.map((p) => p.id).sort()).toEqual(["admin", "coord", "d1p1", "d2p1"]);
    expect(orgs[1]!.people.map((p) => p.id).sort()).toEqual(["b-admin", "b-coord", "b-doc"]);
  });

  it("a person with an ended membership cannot act; a person id resolves to the first active membership", async () => {
    expect((await get("/me", "gone")).status).toBe(401);
    expect((await w("POST", "/cases/NO-A/status", { to: "attention", expected_status: "ready" }, "gone")).status).toBe(401);
    await env.DB.batch([
      env.DB.prepare("INSERT INTO users (id, pre, sur) VALUES ('dual', 'MUDr.', 'Dvojí')"),
      env.DB.prepare(
        "INSERT INTO memberships (id, org_id, user_id, role_id, active_from) VALUES ('dual-a', 'demo-a', 'dual', 'doctor', '2026-01-01T00:00:00.000Z'), ('dual-b', 'demo-b', 'dual', 'doctor', '2026-01-01T00:00:00.000Z')",
      ),
    ]);
    const first = await get("/me", "dual");
    expect(first.body).toMatchObject({ membership_id: "dual-a", org: { id: "demo-a" } });
    expect(first.body.memberships.map((m: { id: string }) => m.id)).toEqual(["dual-a", "dual-b"]);
    expect((await get("/me", "dual-b")).body).toMatchObject({ membership_id: "dual-b", org: { id: "demo-b" } });
    // Org A ends the membership: the membership id no longer acts, and the person id lands in org B.
    await env.DB.prepare("UPDATE memberships SET active_until = '2026-02-01T00:00:00.000Z' WHERE id = 'dual-a'").run();
    expect((await get("/me", "dual-a")).status).toBe(401);
    expect((await get("/patients", "dual-a")).status).toBe(401);
    const now = await get("/me", "dual");
    expect(now.body).toMatchObject({ membership_id: "dual-b", org: { id: "demo-b" } });
    expect(now.body.memberships.map((m: { id: string }) => m.id)).toEqual(["dual-b"]);
    // An inactive person acts nowhere, whatever their memberships say.
    await env.DB.prepare("UPDATE users SET active = 0 WHERE id = 'dual'").run();
    expect((await get("/me", "dual")).status).toBe(401);
    expect((await get("/me", "dual-b")).status).toBe(401);
  });

  it("the staff list of org B does not show a person of org A", async () => {
    const r = await get("/staff", "b-coord");
    expect(Object.keys(r.body.roles).sort()).toEqual(["b-admin", "b-coord", "b-doc"]);
    expect(leaksA(r.text)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------------------------
// 3. Migration 0011 on data in the schema from before orgs.
// ---------------------------------------------------------------------------------------------------------------

// The fixture as it was before orgs (api/test/data.ts at commit a9b7310, the parent of the commit that scoped the store by org), plus a row in every kind of activity table:
// decisions with one superseding another, the access log, status history, a task from a drafted task, attendance, a
// seminar, a recording with its audio, a speaker pass and its job, a grant, an outbox row and an idempotency key.
const TS = "2026-10-15T10:00:00.000Z";
const OLD_SQL = [
  "INSERT INTO roles (id, label_cs) VALUES ('doctor','lékař'), ('coordinator','koordinátor(ka) MDT'), ('admin','správce systému'), ('staff','personál pracoviště')",
  "INSERT INTO departments (id, name, sort) VALUES ('d1','Neurochirurgie',0), ('d2','Klinická onkologie',1)",
  `INSERT INTO users (id, pre, sur, role_id) VALUES ('d1p1','MUDr.','Novák','doctor'), ('d2p1','MUDr.','Svobodová','doctor'),
     ('coord','Bc.','Marková','coordinator'), ('admin','Ing.','Kovář','admin')`,
  "INSERT INTO users (id, pre, sur, role_id, active) VALUES ('gone','MUDr.','Bývalý','doctor',0)",
  "INSERT INTO dept_members (dept_id, user_id, position) VALUES ('d1','d1p1',0), ('d2','d2p1',0)",
  `INSERT INTO patients (id, full_name, name_as_written, birth_number, data_origin) VALUES
     ('pt-A','${FAKE_NAME}','Pacientka Testová','645312/1234','codebridge_synthetic'), ('pt-B','Druhý Testovací',NULL,NULL,'fno_challenge')`,
  `INSERT INTO cases (id, patient_id, source_file, list_order, status, processing_level, question_text, question_explicit,
     question_purpose, diagnosis_text, mkn10, summary_one_line, page_count, referring_dept, referring_dept_is_example, owner_user_id,
     owner_name, owner_is_example, submitted_on, submitted_is_example, updated_on) VALUES
     ('NO-A','pt-A','A_pacient.pdf',0,'ready','full','Otázka?',1,'Otázka?','Diagnóza A','C64','Souhrn A',NULL,'Oddělení X',1,'d2p1','MUDr. Svobodová',1,'2026-10-14',1,'2026-10-16'),
     ('NO-B','pt-B','B_pacient.pdf',1,'new','none',NULL,0,NULL,'Diagnóza B',NULL,NULL,2,'Oddělení Y',0,NULL,'MUDr. Novák',0,'2026-10-01',1,'2026-10-15')`,
  "INSERT INTO case_members (case_id, dept_id, reason) VALUES ('NO-A','d2','test'), ('NO-B','d1','test'), ('NO-B','d2','test')",
  "INSERT INTO slots (day, time, case_id) VALUES ('2026-10-22','14:00','NO-A')",
  `INSERT INTO documents (id, case_id, file_name, page_count, origin, processing, note_cs) VALUES
     ('A_pacient','NO-A','A_pacient.pdf',2,'seed','processed','Poznámka'), ('B_pacient','NO-B','B_pacient.pdf',1,'seed','unprocessed',NULL)`,
  "INSERT INTO document_parts (document_id, ordinal, title_cs, type, pages_json) VALUES ('A_pacient',0,'Ambulantní zpráva','ambulantní zpráva','[1,2]')",
  `INSERT INTO pages (document_id, n, json_r2_key, image_r2_key, redacted_r2_key, width, height, engine, is_empty) VALUES
     ('A_pacient',1,'pages/A_pacient/p1.json','pages/A_pacient/p1.png','pages/A_pacient/p1.redacted.png',10,10,'vision',0),
     ('A_pacient',2,'pages/A_pacient/p2.json','pages/A_pacient/p2.png',NULL,10,10,'vision',0),
     ('B_pacient',1,'pages/B_pacient/p1.json','pages/B_pacient/p1.png',NULL,10,10,'vision',0)`,
  `INSERT INTO extraction_runs (id, case_id, kind, input_hashes_json, r2_key, sha256) VALUES
     ('run-A','NO-A','seed_fixture','{}','extract/NO-A/run-A.json','${"a".repeat(64)}')`,
  `INSERT INTO alerts (id, case_id, run_id, origin, position, kind, text_cs, relevant) VALUES
     ('al-1','NO-A','run-A','flag',0,'missing','Chybí histologie.',1), ('al-2','NO-A','run-A','gap',0,'unclear','Nejasné datum.',0)`,
  `INSERT INTO tasks (id, case_id, text, assignee_user_id, assignee_name, due, done) VALUES
     (1,'NO-A','úkol A','coord','Bc. Marková','2026-10-21',0), (2,'NO-B','úkol B','d1p1','MUDr. Novák','2026-10-21',1)`,
  "INSERT INTO seed_meta (id, seeded_at, git_commit, fixtures_json) VALUES (1,'2026-10-17T12:00:00.000Z','test','{}')",
  // Activity.
  `INSERT INTO protocols (case_id, conclusion, state, version, updated_by, updated_by_name, approved_by_name, approved_at)
     VALUES ('NO-A','Závěr 2','approved',4,'d2p1','MUDr. Svobodová','MUDr. Svobodová','${TS}')`,
  `INSERT INTO decisions (id, case_id, version, conclusion, approved_by_user_id, approved_by_name, approved_at, slot_day, slot_time, report_snapshot_json, attendance_snapshot_json, supersedes_id) VALUES
     ('dec-1','NO-A',1,'Závěr 1','d2p1','MUDr. Svobodová','2026-10-14T10:00:00.000Z','2026-10-22','14:00','{}','["MUDr. Svobodová"]',NULL),
     ('dec-2','NO-A',2,'Závěr 2','d2p1','MUDr. Svobodová','${TS}','2026-10-22','14:00','{}','["MUDr. Svobodová"]','dec-1')`,
  `INSERT INTO status_history (case_id, from_status, to_status, by_user_id, by_name, how, at) VALUES
     ('NO-A','new','scheduled','coord','Bc. Marková','rezervace termínu','2026-10-13T09:00:00.000Z'), ('NO-A','scheduled','ready','d2p1','MUDr. Svobodová','ručně','2026-10-13T10:00:00.000Z')`,
  `INSERT INTO task_suggestions (id, case_id, decision_id, decision_version, text, quote, who, state, decided_by, decided_by_name, decided_at)
     VALUES (7,'NO-A','dec-1',1,'MR mozku','Kontrolní MR','Bc. Marková','confirmed','d2p1','MUDr. Svobodová','${TS}'),
            (8,'NO-A','dec-2',2,'CT hrudníku','Kontrolní CT','Bc. Marková','draft',NULL,NULL,NULL)`,
  "INSERT INTO tasks (id, case_id, text, assignee_user_id, assignee_name, from_suggestion_id, confirmed_by, created_by) VALUES (3,'NO-A','MR mozku','coord','Bc. Marková',7,'MUDr. Svobodová','d2p1')",
  "INSERT INTO attendance (set_key, dept_id, position, user_id, user_name) VALUES ('2026-10-22','d2',0,'d2p1','MUDr. Svobodová')",
  `INSERT INTO attendance_sets (set_key, version, updated_by, updated_at) VALUES ('2026-10-22',1,'coord','${TS}')`,
  `INSERT INTO sessions (day, started_by, started_by_name, started_at) VALUES ('2026-10-22','coord','Bc. Marková','${TS}')`,
  `INSERT INTO recordings (id, session_day, started_by, started_by_name, started_at) VALUES ('rec-1','2026-10-22','d2p1','MUDr. Svobodová','${TS}')`,
  `INSERT INTO jobs (id, kind, case_id, workflow, instance_id, attempt, state, result_ref, created_by, created_by_name, created_by_role, created_at, updated_at)
     VALUES ('job-1','speaker_pass','NO-A','SPEAKER_PASS','job-1',1,'done','sp-1','d2p1','MUDr. Svobodová','doctor','${TS}','${TS}')`,
  `INSERT INTO transcript_passes (id, case_id, decision_id, job_id, from_wall_ms, cutoff_wall_ms, state, created_at, updated_at)
     VALUES ('sp-1','NO-A','dec-2','job-1',0,1000,'done','${TS}','${TS}')`,
  `INSERT INTO transcript_lines (id, case_id, recording_id, client_line_id, source, wall_ms, text, created_by, created_at)
     VALUES ('tl-1','NO-A','rec-1','line-0000-0001','live',500,'věta','d2p1','${TS}')`,
  `INSERT INTO audio_uploads (id, case_id, recording_id, pass_id, r2_key, state, bytes, created_by, created_at)
     VALUES ('au-1','NO-A','rec-1','sp-1','audio/NO-A/au-1.pcm','completed',10,'d2p1','${TS}')`,
  "INSERT INTO audio_parts (upload_id, part_number, etag, bytes, is_final) VALUES ('au-1',1,'etag-1',10,1)",
  "INSERT INTO audio_segments (upload_id, start_sample, wall_ms) VALUES ('au-1',0,500)",
  `INSERT INTO case_access_grants (id, case_id, user_id, reason, granted_at, expires_at) VALUES ('g-1','NO-A','d1p1','konzultace na žádost onkologa','${TS}','2026-10-15T18:00:00.000Z')`,
  `INSERT INTO notifications (id, kind, to_user_id, case_id, count, link, created_by, created_by_name, created_at) VALUES ('n-1','approval','coord','NO-A',1,'/','d2p1','MUDr. Svobodová','${TS}')`,
  `INSERT INTO idempotency_keys (key, user_id, route, body_sha, response_json, status, created_at) VALUES ('key-1','d2p1','approve:NO-A','${"c".repeat(64)}','{"decision_id":"dec-2"}',200,'${TS}')`,
  `INSERT INTO access_log (actor_user_id, actor_name, acted_as_role, auth_mode, case_id, action, what_cs, data_epoch) VALUES
     ('d2p1','MUDr. Svobodová','doctor','demo','NO-A','case.open','otevřel(a) případ',5), ('coord','Bc. Marková','coordinator','demo',NULL,'list.view','zobrazil(a) seznam pacientů',5)`,
  `INSERT INTO question_confirmations (case_id, text, by_user_id, by_name, at) VALUES ('NO-A','Otázka?','d2p1','MUDr. Svobodová','${TS}')`,
  `INSERT INTO edit_log (case_id, key, orig, text, reverted, by_user_id, by_name, at, confirmed) VALUES ('NO-A','brief','původně','opraveno',0,'d2p1','MUDr. Svobodová','${TS}',0)`,
  `INSERT INTO fact_edits (case_id, key, text, orig, by_user_id, by_name, at, log_id, extraction_run_id) VALUES ('NO-A','brief','opraveno','původně','d2p1','MUDr. Svobodová','${TS}',1,'run-A')`,
  `INSERT INTO alert_events (alert_id, action, by_user_id, by_name, at) VALUES ('al-1','ack','coord','Bc. Marková','${TS}')`,
  `INSERT INTO pipeline_runs (id, document_id, case_id, state, pipeline_version, input_sha256, output_prefix, created_by, created_by_name, created_at, updated_at)
     VALUES ('pl-1','B_pacient','NO-B','done','dev','${"d".repeat(64)}','uploads/NO-B/B_pacient/pl-1/','d1p1','MUDr. Novák','${TS}','${TS}')`,
  `INSERT INTO upload_sessions (id, token_hash, case_id, target, created_by, created_at, expires_at) VALUES ('us-1','${"e".repeat(64)}','NO-A','documents','d2p1','${TS}','2026-10-15T10:15:00.000Z')`,
  `INSERT INTO transcript_summaries (id, case_id, pass_id, state, basis, text, created_at) VALUES ('ts-1','NO-A','sp-1','done','speaker_pass','Shrnutí.','${TS}')`,
  "UPDATE demo_state SET data_epoch = 5, seed_version = 'old'",
];

describe("migration 0011 on data from before orgs", () => {
  it("puts every row into demo org A with its references intact", async () => {
    await reset();
    const migrations = env.TEST_MIGRATIONS;
    await applyD1Migrations(env.DB, migrations.filter((m) => m.name < "0011"));
    await env.DB.batch(OLD_SQL.map((s) => env.DB.prepare(s)));
    const tables = (await q<{ name: string }>("SELECT name FROM sqlite_master WHERE type = 'table'")).map((t) => t.name);
    const oldCounts: Record<string, number> = {};
    // write_guards holds rows only inside a batch, so the migration copies none (0011, section 12).
    for (const t of ORG_TABLES) if (tables.includes(t) && t !== "write_guards") oldCounts[t] = (await one<{ n: number }>(`SELECT COUNT(*) AS n FROM ${t}`)).n;
    const usersBefore = (await one<{ n: number }>("SELECT COUNT(*) AS n FROM users")).n;
    // Every org table that existed before holds a row, so the copy statement of each is checked.
    for (const [t, n] of Object.entries(oldCounts)) expect(n, t).toBeGreaterThan(0);
    // Every row as it was, to compare whole rows after the copy (a swapped column would otherwise pass the counts).
    const oldRows: Record<string, Record<string, unknown>[]> = {};
    for (const t of Object.keys(oldCounts)) oldRows[t] = await q(`SELECT * FROM ${t}`);

    // Up to the migration before 0016, which moves the /1 alert events aside and recomputes run columns on purpose
    // (test/runs.test.ts checks it on its own).
    await applyD1Migrations(env.DB, migrations.filter((m) => m.name < "0016"));

    for (const [t, n] of Object.entries(oldCounts)) {
      expect((await one<{ n: number }>(`SELECT COUNT(*) AS n FROM ${t}`)).n, t).toBe(n);
      expect((await one<{ n: number }>(`SELECT COUNT(*) AS n FROM ${t} WHERE org_id IS NOT 'demo-a'`)).n, t).toBe(0);
      // The columns both versions have hold the same values; new columns (org_id and the like) are checked above.
      const cols = Object.keys(oldRows[t]![0]!);
      const now = await q(`SELECT * FROM ${t}`);
      const common = cols.filter((c) => c in now[0]!);
      const pick = (r: Record<string, unknown>) => JSON.stringify(common.map((c) => r[c]));
      expect(now.map(pick).sort(), t).toEqual(oldRows[t]!.map(pick).sort());
    }
    expect((await one<{ n: number }>("SELECT COUNT(*) AS n FROM users")).n).toBe(usersBefore);
    expect(await q("SELECT id, org_id, user_id, role_id, active_until IS NOT NULL AS ended FROM memberships ORDER BY id")).toEqual([
      { id: "admin", org_id: "demo-a", user_id: "admin", role_id: "admin", ended: 0 },
      { id: "coord", org_id: "demo-a", user_id: "coord", role_id: "coordinator", ended: 0 },
      { id: "d1p1", org_id: "demo-a", user_id: "d1p1", role_id: "doctor", ended: 0 },
      { id: "d2p1", org_id: "demo-a", user_id: "d2p1", role_id: "doctor", ended: 0 },
      { id: "gone", org_id: "demo-a", user_id: "gone", role_id: "doctor", ended: 1 },
    ]);
    expect(await q("PRAGMA foreign_key_check")).toEqual([]);
    expect((await q("SELECT name FROM sqlite_master WHERE name LIKE '%\\_old' ESCAPE '\\'")).map((r) => r.name)).toEqual([]);
    expect(await q("SELECT org_id, data_epoch, seed_version, reset_in_progress FROM demo_state")).toEqual([{ org_id: "demo-a", data_epoch: 5, seed_version: "old", reset_in_progress: 0 }]);
    // Values survive the copy: the superseding decision, the task's drafted origin, the idempotency key and the log.
    expect(await q("SELECT id, version, supersedes_id FROM decisions ORDER BY version")).toEqual([
      { id: "dec-1", version: 1, supersedes_id: null },
      { id: "dec-2", version: 2, supersedes_id: "dec-1" },
    ]);
    expect((await one("SELECT from_suggestion_id FROM tasks WHERE id = 3")).from_suggestion_id).toBe(7);
    expect(await one("SELECT org_id, user_id, key, route FROM idempotency_keys")).toEqual({ org_id: "demo-a", user_id: "d2p1", key: "key-1", route: "approve:NO-A" });
    expect((await q("SELECT action, data_epoch, acted_as_membership FROM access_log ORDER BY id")).map((r) => [r.action, r.data_epoch, r.acted_as_membership])).toEqual([
      ["case.open", 5, null],
      ["list.view", 5, null],
    ]);
    expect(await one("SELECT id, case_no FROM cases WHERE id = 'NO-A'")).toEqual({ id: "NO-A", case_no: "NO-A" });

    // The append-only triggers are there and refuse changes outside a reset.
    const triggers = (await q<{ name: string }>("SELECT name FROM sqlite_master WHERE type = 'trigger'")).map((t) => t.name);
    for (const t of ["decisions", "status_history", "edit_log", "alert_events", "question_confirmations", "access_log"]) {
      expect(triggers).toContain(`${t}_no_update`);
      expect(triggers).toContain(`${t}_no_delete`);
    }
    expect(triggers).toEqual(expect.arrayContaining(["demo_reset_uploads", "demo_reset_upload_sessions", "decisions_supersede_same_case"]));
    await expect(env.DB.prepare("UPDATE decisions SET conclusion = 'x'").run()).rejects.toThrow(/append-only/);
    await expect(env.DB.prepare("DELETE FROM decisions").run()).rejects.toThrow(/append-only/);
    await expect(env.DB.prepare("DELETE FROM access_log").run()).rejects.toThrow(/append-only/);
    await expect(env.DB.prepare("UPDATE status_history SET by_name = 'x'").run()).rejects.toThrow(/append-only/);

    // The later migrations apply on top, leave no table aside, and the API serves the migrated data as before.
    await applyD1Migrations(env.DB, migrations);
    expect((await q("SELECT name FROM sqlite_master WHERE name LIKE '%\\_old' ESCAPE '\\'")).map((r) => r.name)).toEqual([]);
    expect(await q("PRAGMA foreign_key_check")).toEqual([]);
    const c = await get("/cases/NO-A", "d2p1");
    expect(c.status).toBe(200);
    expect(c.body).toMatchObject({ id: "NO-A" });
    const d = await get("/cases/NO-A/decisions", "d2p1");
    expect(d.body.decisions.map((x: { id: string }) => x.id)).toEqual(["dec-1", "dec-2"]);
    expect((await get("/me", "d2p1")).body).toMatchObject({ org: { id: "demo-a" }, data_epoch: 5 });
    expect((await get("/me", "gone")).status).toBe(401);
  });
});
