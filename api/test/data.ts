// A small synthetic fixture for the data routes. Tests never read data/ or fixtures/; the seed has its own check.
// Two orgs: demo org A (demo-a, the org migration 0011 creates) holds the cases the tests act on; demo org B (demo-b)
// holds look-alikes with the same case number, file name, birth number, slot time and department name, so every test
// also runs next to another org's data and a leak shows up as a wrong count or a refused key.
import { env } from "cloudflare:workers";
import { applyD1Migrations, reset } from "cloudflare:test";
import { assignKeys, type ExtractionRun, type Fact } from "@codebridge/domain/extraction/index";
import example from "../../packages/domain/schema/examples/worked-examples.json";

// NO-A's current run in codebridge.extraction/2: the format's worked example (case NO-010) moved onto the fixture's
// document A_pacient (one part, two pages). Keys depend on the document, so they are computed again; fact and alert IDs
// stay as the example has them. test/runs.test.ts checks that the run passes the validator.
export const RUN_A2_ID = "run-A2";
export const RUN_A2_KEY = `org/demo-a/extract/NO-A/${RUN_A2_ID}.json`;
function buildRunA2(): ExtractionRun {
  const moved = JSON.parse(
    JSON.stringify(example)
      .replace(/10_pacient\/p\d/g, "A_pacient/p0")
      .replaceAll("10_pacient", "A_pacient")
      .replaceAll("NO-010", "NO-A"),
  ) as ExtractionRun;
  const sources = moved.sources.map((s) => (s.type === "document" ? { ...s, page: Math.min(s.page, 2) } : s));
  const facts = assignKeys(moved.facts.map(({ key: _k, ...f }) => f) as Omit<Fact, "key">[] as Fact[], sources);
  return {
    ...moved,
    run: { ...moved.run, id: RUN_A2_ID, supersedes: "run-A" },
    documents: moved.documents.map((d) => ({ ...d, parts: [...new Set(d.parts)] })),
    sources,
    facts,
    checks: moved.checks.map((c) => ({ ...c, unreadable: c.unreadable.map((u) => ({ ...u, page: Math.min(u.page, 2) })) })),
  };
}
export const RUN_A2: ExtractionRun = buildRunA2();

// The fake patient name sits in the page text so tests can prove it never reaches the access log.
export const FAKE_NAME = "Testová Pacientka";
// Where the fake document names the patient, written differently from the name, so a test can tell where it went.
export const NAME_QUOTE = "TESTOVÁ Pacientka";
// Org B's patient: never on any answer to org A.
export const B_NAME = "Béčková Organizace";
// A 1x1 PNG.
const PNG = Uint8Array.from(atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII="), (ch) => ch.charCodeAt(0));

const FROM = "2026-01-01T00:00:00.000Z";
// The reset restores people and memberships with an upsert; they are never deleted (AUTH.md).
// As seed.py writes it: a person is restored only when they have a membership in the org being reset.
const USERS_UPSERT = (org: string) =>
  `ON CONFLICT(id) DO UPDATE SET pre = excluded.pre, sur = excluded.sur, post = excluded.post, active = 1 WHERE EXISTS (SELECT 1 FROM memberships m WHERE m.org_id = '${org}' AND m.user_id = users.id)`;
const MEMBERSHIPS_UPSERT = "ON CONFLICT(id) DO UPDATE SET role_id = excluded.role_id, fn = excluded.fn, active_until = NULL WHERE memberships.org_id = excluded.org_id";

// The rows reset-demo restores, per org (seed/reset.json); the rest of the fixture is seed-only.
export const MUTABLE_A = [
  `INSERT INTO users (id, pre, sur) VALUES ('d1p1','MUDr.','Novák'), ('d2p1','MUDr.','Svobodová'), ('coord','Bc.','Marková'), ('admin','Ing.','Kovář'),
     ('gone','MUDr.','Bývalý') ${USERS_UPSERT("demo-a")}`,
  `INSERT INTO memberships (id, org_id, user_id, role_id, active_from) VALUES ('d1p1','demo-a','d1p1','doctor','${FROM}'), ('d2p1','demo-a','d2p1','doctor','${FROM}'),
     ('coord','demo-a','coord','coordinator','${FROM}'), ('admin','demo-a','admin','admin','${FROM}') ${MEMBERSHIPS_UPSERT}`,
  "INSERT INTO departments (id, org_id, name, sort) VALUES ('d1','demo-a','Neurochirurgie',0), ('d2','demo-a','Klinická onkologie',1)",
  "INSERT INTO dept_members (org_id, dept_id, user_id, position) VALUES ('demo-a','d1','d1p1',0), ('demo-a','d2','d2p1',0)",
  `INSERT INTO cases (id, org_id, case_no, patient_id, source_file, list_order, status, processing_level, question_text, question_explicit,
     question_purpose, diagnosis_text, mkn10, summary_one_line, page_count, referring_dept, referring_dept_is_example, owner_user_id,
     owner_name, owner_is_example, submitted_on, submitted_is_example, updated_on) VALUES
     ('NO-A','demo-a','NO-A','pt-A','A_pacient.pdf',0,'ready','full','Otázka?',1,'Otázka?','Diagnóza A','C64','Souhrn A',NULL,'Oddělení X',1,'d2p1','MUDr. Svobodová',1,'2026-10-14',1,'2026-10-16'),
     ('NO-B','demo-a','NO-B','pt-B','B_pacient.pdf',1,'new','none',NULL,0,NULL,'Diagnóza B',NULL,NULL,2,'Oddělení Y',0,NULL,'MUDr. Novák',0,'2026-10-01',1,'2026-10-15')`,
  // NO-A belongs to the oncology team only; NO-B to both teams.
  "INSERT INTO case_members (org_id, case_id, dept_id, reason) VALUES ('demo-a','NO-A','d2','test'), ('demo-a','NO-B','d1','test'), ('demo-a','NO-B','d2','test')",
  "INSERT INTO slots (org_id, day, time, case_id) VALUES ('demo-a','2026-10-22','14:00','NO-A')",
  `INSERT INTO tasks (id, org_id, case_id, text, assignee_user_id, assignee_name, due, done) VALUES
     (1,'demo-a','NO-A','úkol A','coord','Bc. Marková','2026-10-21',0), (2,'demo-a','NO-B','úkol B','d1p1','MUDr. Novák','2026-10-21',1)`,
];
// The membership of 'gone' ended: a person who left org A's staff list (history still names them).
const ENDED_A = `INSERT INTO memberships (id, org_id, user_id, role_id, active_from, active_until) VALUES ('gone','demo-a','gone','doctor','${FROM}','2026-02-01T00:00:00.000Z')`;

export const MUTABLE_B = [
  `INSERT INTO users (id, pre, sur) VALUES ('b-doc','MUDr.','Bédoktorová'), ('b-coord','Bc.','Békoordinátorová'), ('b-admin','Ing.','Béspráva') ${USERS_UPSERT("demo-b")}`,
  `INSERT INTO memberships (id, org_id, user_id, role_id, active_from) VALUES ('b-doc','demo-b','b-doc','doctor','${FROM}'),
     ('b-coord','demo-b','b-coord','coordinator','${FROM}'), ('b-admin','demo-b','b-admin','admin','${FROM}') ${MEMBERSHIPS_UPSERT}`,
  // The same department name as org A's: names are unique per org.
  "INSERT INTO departments (id, org_id, name, sort) VALUES ('b-d1','demo-b','Klinická onkologie',0)",
  "INSERT INTO dept_members (org_id, dept_id, user_id, position) VALUES ('demo-b','b-d1','b-doc',0)",
  // The same case number and file name as org A's NO-A, with its own internal ID.
  `INSERT INTO cases (id, org_id, case_no, patient_id, source_file, list_order, status, processing_level, question_text, question_explicit,
     diagnosis_text, owner_user_id, owner_name, submitted_on, updated_on) VALUES
     ('B-NO-A','demo-b','NO-A','pt-BA','A_pacient.pdf',0,'ready','full','Otázka B?',1,'Diagnóza v B','b-doc','MUDr. Bédoktorová','2026-10-14','2026-10-16')`,
  "INSERT INTO case_members (org_id, case_id, dept_id, reason) VALUES ('demo-b','B-NO-A','b-d1','test')",
  // The same seminar slot as org A's NO-A: each org books its own calendar.
  "INSERT INTO slots (org_id, day, time, case_id) VALUES ('demo-b','2026-10-22','14:00','B-NO-A')",
  "INSERT INTO tasks (id, org_id, case_id, text, assignee_user_id, assignee_name, due, done) VALUES (3,'demo-b','B-NO-A','úkol v B','b-coord','Bc. Békoordinátorová','2026-10-21',0)",
];

export const SQL = [
  "INSERT INTO roles (id, label_cs) VALUES ('doctor','lékař'), ('coordinator','koordinátor(ka) MDT'), ('admin','správce systému'), ('staff','personál pracoviště')",
  "INSERT INTO orgs (id, name, short_name, is_demo, case_id_prefix) VALUES ('demo-b','Ukázková nemocnice B','Nemocnice B',1,'B-')",
  "INSERT INTO demo_state (org_id, data_epoch) VALUES ('demo-b', 1)",
  `INSERT INTO patients (id, org_id, full_name, name_as_written, birth_number, data_origin, identity_source_json) VALUES
     ('pt-A','demo-a','${FAKE_NAME}','Pacientka Testová','645312/1234','codebridge_synthetic','{"source":{"file":"A_pacient.pdf","page":1,"quote":"${NAME_QUOTE}"}}'),
     ('pt-B','demo-a','Druhý Testovací',NULL,NULL,'fno_challenge',NULL),
     ('pt-BA','demo-b','${B_NAME}',NULL,'645312/1234','codebridge_synthetic',NULL)`,
  ...MUTABLE_A,
  ENDED_A,
  ...MUTABLE_B,
  `INSERT INTO documents (id, org_id, case_id, file_name, page_count, origin, processing, note_cs) VALUES
     ('A_pacient','demo-a','NO-A','A_pacient.pdf',2,'seed','processed','Poznámka'), ('B_pacient','demo-a','NO-B','B_pacient.pdf',1,'seed','unprocessed',NULL),
     ('b-A_pacient','demo-b','B-NO-A','A_pacient.pdf',1,'seed','processed',NULL)`,
  "INSERT INTO document_parts (org_id, document_id, ordinal, title_cs, type, pages_json) VALUES ('demo-a','A_pacient',0,'Ambulantní zpráva','ambulantní zpráva','[1,2]')",
  `INSERT INTO pages (org_id, document_id, n, json_r2_key, image_r2_key, redacted_r2_key, width, height, engine, is_empty) VALUES
     ('demo-a','A_pacient',1,'pages/A_pacient/p1.json','pages/A_pacient/p1.png','pages/A_pacient/p1.redacted.png',10,10,'vision',0),
     ('demo-a','A_pacient',2,'pages/A_pacient/p2.json','pages/A_pacient/p2.png',NULL,10,10,'vision',0),
     ('demo-a','B_pacient',1,'pages/B_pacient/p1.json','pages/B_pacient/p1.png',NULL,10,10,'vision',0),
     ('demo-b','b-A_pacient',1,'org/demo-b/pages/b-A_pacient/p1.json','org/demo-b/pages/b-A_pacient/p1.png',NULL,10,10,'vision',0)`,
  // NO-A: an old /1 run, superseded by the current /2 run built from the format's worked example (RUN_A2). Org B's look-alike
  // keeps a /1 run, so its extraction reads as not processed.
  `INSERT INTO extraction_runs (id, org_id, case_id, producer, seeded, schema, supersedes, input_hashes_json, r2_key, sha256, is_current, created_at) VALUES
     ('run-A','demo-a','NO-A','fixture',1,'codebridge.extraction/1',NULL,'{}','extract/NO-A/run-A.json','${"a".repeat(64)}',0,'2026-10-17T12:00:00.000Z'),
     ('${RUN_A2_ID}','demo-a','NO-A','fixture',1,'codebridge.extraction/2','run-A','{}','${RUN_A2_KEY}','${"c".repeat(64)}',1,'2026-10-18T12:00:00.000Z'),
     ('run-BA','demo-b','B-NO-A','fixture',1,'codebridge.extraction/1',NULL,'{}','org/demo-b/extract/B-NO-A/run-BA.json','${"b".repeat(64)}',1,'2026-10-17T12:00:00.000Z')`,
  // The IDs the /2 run issued, as run storage (src/store/runs.ts) registers them.
  `INSERT INTO fact_ids (org_id, case_id, fact_id, first_run_id) SELECT 'demo-a', 'NO-A', value, '${RUN_A2_ID}' FROM json_each('${JSON.stringify(RUN_A2.facts.map((f) => f.id))}')`,
  `INSERT INTO alert_identities (org_id, case_id, id, rule, subject, kind, first_run_id) VALUES ${RUN_A2.alerts.map((a) => `('demo-a','NO-A','${a.id}','${a.rule}','${a.subject}','${a.kind}','${RUN_A2_ID}')`).join(", ")}`,
  `INSERT INTO alerts (id, org_id, case_id, run_id, origin, position, kind, text_cs, relevant) VALUES
     ('al-1','demo-a','NO-A','run-A','flag',0,'missing','Chybí histologie.',1), ('al-2','demo-a','NO-A','run-A','gap',0,'unclear','Nejasné datum.',0),
     ('al-b1','demo-b','B-NO-A','run-BA','flag',0,'missing','Chybí v B.',1)`,
  "INSERT INTO seed_meta (id, seeded_at, git_commit, fixtures_json) VALUES (1,'2026-10-17T12:00:00.000Z','test','{}')",
];

// seed/reset.json for the fixture: a section per demo org, as seed.py writes it.
export const resetDoc = (seed_version = "test") => ({
  seed_version,
  orgs: {
    "demo-a": { statements: MUTABLE_A, patient_ids: ["pt-A", "pt-B"], membership_ids: ["d1p1", "d2p1", "coord", "admin"] },
    "demo-b": { statements: MUTABLE_B, patient_ids: ["pt-BA"], membership_ids: ["b-doc", "b-coord", "b-admin"] },
  },
});

const page = (n: number, redacted: boolean, name = FAKE_NAME) =>
  JSON.stringify({
    n,
    size: [10, 10],
    text: `Pacient: ${name}, strana ${n}`,
    engine: "vision",
    words: [{ t: "Pacient:", c: 97, b: [1, 1, 3, 1] }],
    mean_conf: 90,
    low_conf_words: 0,
    verify: [],
    redacted: redacted ? { count: 1, reasons: ["jméno"] } : null,
  });

// Wipes every binding, migrates, and loads the fixture; called before each test of the data suites.
export async function loadFixture({ seeded = true } = {}) {
  await reset();
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
  if (!seeded) return;
  await env.DB.batch(SQL.map((s) => env.DB.prepare(s)));
  await Promise.all([
    env.DOCS.put("pages/A_pacient/p1.json", page(1, true)),
    env.DOCS.put("pages/A_pacient/p2.json", page(2, false)),
    env.DOCS.put("pages/B_pacient/p1.json", page(1, false)),
    env.DOCS.put("pages/A_pacient/p1.png", PNG, { httpMetadata: { contentType: "image/png" } }),
    env.DOCS.put("pages/A_pacient/p1.redacted.png", PNG, { httpMetadata: { contentType: "image/png" } }),
    env.DOCS.put("pages/A_pacient/p2.png", PNG, { httpMetadata: { contentType: "image/png" } }),
    env.DOCS.put("org/demo-b/pages/b-A_pacient/p1.json", page(1, false, B_NAME)),
    env.DOCS.put("org/demo-b/pages/b-A_pacient/p1.png", PNG, { httpMetadata: { contentType: "image/png" } }),
    env.DOCS.put(
      "extract/NO-A/run-A.json",
      JSON.stringify({
        schema: "codebridge.extraction/1",
        case_id: "NO-A",
        processing: "full",
        run_id: "run-A",
        case: { file: "A_pacient.pdf", patient: { sex: "žena" }, flags: [] },
        extra: { documents: [] },
        alert_ids: { flag: ["al-1"], gap: ["al-2"] },
      }),
    ),
    env.DOCS.put(RUN_A2_KEY, JSON.stringify(RUN_A2)),
    env.DOCS.put(
      "org/demo-b/extract/B-NO-A/run-BA.json",
      JSON.stringify({ schema: "codebridge.extraction/1", case_id: "B-NO-A", processing: "full", run_id: "run-BA", case: { file: "A_pacient.pdf", flags: [] }, alert_ids: { flag: ["al-b1"], gap: [] } }),
    ),
    env.DOCS.put("guidance/NO-A.json", JSON.stringify({ guidelines: [{ id: "g1" }], statements: [] })),
    env.DOCS.put("prognosis/NO-A/saved-2026-10-22.json", JSON.stringify({ patient_id: "A_pacient.pdf" })),
  ]);
}

export type LogRow = {
  org_id: string;
  actor_user_id: string;
  acted_as_role: string;
  case_id: string | null;
  document_id: string | null;
  page_n: number | null;
  action: string;
  what_cs: string;
};

// Org A's access log (the org the tests act in); orgLog() reads another org's.
export async function accessLog(org = "demo-a"): Promise<LogRow[]> {
  return (await env.DB.prepare("SELECT * FROM access_log WHERE org_id = ?1 ORDER BY id").bind(org).all<LogRow>()).results;
}

export const as = (user: string) => ({ headers: { "X-Demo-User": user } });
