// A small synthetic fixture for the data routes. Tests never read data/ or fixtures/; the seed has its own check.
import { env } from "cloudflare:workers";
import { applyD1Migrations, reset } from "cloudflare:test";

// The fake patient name sits in the page text so tests can prove it never reaches the access log.
export const FAKE_NAME = "Testová Pacientka";
// Where the fake document names the patient, written differently from the name, so a test can tell where it went.
export const NAME_QUOTE = "TESTOVÁ Pacientka";
// A 1x1 PNG.
const PNG = Uint8Array.from(atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII="), (ch) => ch.charCodeAt(0));

export const SQL = [
  "INSERT INTO roles (id, label_cs) VALUES ('doctor','lékař'), ('coordinator','koordinátor(ka) MDT'), ('admin','správce systému'), ('staff','personál pracoviště')",
  "INSERT INTO departments (id, name, sort) VALUES ('d1','Neurochirurgie',0), ('d2','Klinická onkologie',1)",
  `INSERT INTO users (id, pre, sur, role_id) VALUES ('d1p1','MUDr.','Novák','doctor'), ('d2p1','MUDr.','Svobodová','doctor'),
     ('coord','Bc.','Marková','coordinator'), ('admin','Ing.','Kovář','admin')`,
  "INSERT INTO users (id, pre, sur, role_id, active) VALUES ('gone','MUDr.','Bývalý','doctor',0)",
  "INSERT INTO dept_members (dept_id, user_id, position) VALUES ('d1','d1p1',0), ('d2','d2p1',0)",
  `INSERT INTO patients (id, full_name, name_as_written, birth_number, data_origin, identity_source_json) VALUES
     ('pt-A','${FAKE_NAME}','Pacientka Testová','645312/1234','codebridge_synthetic','{"source":{"file":"A_pacient.pdf","page":1,"quote":"${NAME_QUOTE}"}}'),
     ('pt-B','Druhý Testovací',NULL,NULL,'fno_challenge',NULL)`,
  `INSERT INTO cases (id, patient_id, source_file, list_order, status, processing_level, question_text, question_explicit,
     question_purpose, diagnosis_text, mkn10, summary_one_line, page_count, referring_dept, referring_dept_is_example, owner_user_id,
     owner_name, owner_is_example, submitted_on, submitted_is_example, updated_on) VALUES
     ('NO-A','pt-A','A_pacient.pdf',0,'ready','full','Otázka?',1,'Otázka?','Diagnóza A','C64','Souhrn A',NULL,'Oddělení X',1,'d2p1','MUDr. Svobodová',1,'2026-10-14',1,'2026-10-16'),
     ('NO-B','pt-B','B_pacient.pdf',1,'new','none',NULL,0,NULL,'Diagnóza B',NULL,NULL,2,'Oddělení Y',0,NULL,'MUDr. Novák',0,'2026-10-01',1,'2026-10-15')`,
  // NO-A belongs to the oncology team only; NO-B to both teams.
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
];

const page = (n: number, redacted: boolean) =>
  JSON.stringify({
    n,
    size: [10, 10],
    text: `Pacient: ${FAKE_NAME}, strana ${n}`,
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
    env.DOCS.put("guidance/NO-A.json", JSON.stringify({ guidelines: [{ id: "g1" }], statements: [] })),
    env.DOCS.put("prognosis/NO-A/saved-2026-10-22.json", JSON.stringify({ patient_id: "A_pacient.pdf" })),
  ]);
}

export type LogRow = { actor_user_id: string; acted_as_role: string; case_id: string | null; document_id: string | null; page_n: number | null; action: string; what_cs: string };

export async function accessLog(): Promise<LogRow[]> {
  return (await env.DB.prepare("SELECT * FROM access_log ORDER BY id").all<LogRow>()).results;
}

export const as = (user: string) => ({ headers: { "X-Demo-User": user } });
