// D1 reads for uploads and the document pipeline (step 6): the fixture registry, a case's documents and the state an
// upload depends on. Writes go through the guarded batch in store/write.ts.

export type FixtureRow = {
  sha256: string;
  fixture_id: string;
  file_name: string;
  r2_prefix: string;
  kind: "upload" | "combined" | "referral";
  size_bytes: number | null;
  title_cs: string | null;
  doc_type: string | null;
  doc_date: string | null;
  page_count: number | null;
  combined_pages_json: string | null;
  // The fixture's patient (fixture_patients); identity, so it never leaves the server.
  fx_full_name: string | null;
  fx_birth_number: string | null;
};

export type DocRow = {
  id: string;
  case_id: string;
  file_name: string;
  page_count: number;
  size_bytes: number | null;
  sha256: string | null;
  origin: string;
  processing: string;
  note_cs: string | null;
  original_r2_key: string | null;
  uploaded_by: string | null;
  uploaded_by_name: string | null;
  created_at: string;
  state: string | null;
  state_detail_cs: string | null;
  fixture_id: string | null;
  identity: string | null;
  title_cs: string | null;
  doc_type: string | null;
  doc_date: string | null;
  readability: string | null;
  readability_reasons_json: string | null;
  source: string | null;
};

// The uploader's display name comes from the directory, so a renamed user shows their current name.
const DOC_SELECT = `SELECT d.id, d.case_id, d.file_name, d.page_count, d.size_bytes, d.sha256, d.origin, d.processing, d.note_cs,
  d.original_r2_key, d.uploaded_by, trim(u.pre || ' ' || u.sur || CASE WHEN u.post <> '' THEN ', ' || u.post ELSE '' END) AS uploaded_by_name,
  d.created_at, d.state, d.state_detail_cs, d.fixture_id, d.identity, d.title_cs, d.doc_type, d.doc_date, d.readability,
  d.readability_reasons_json, d.source
  FROM documents d LEFT JOIN users u ON u.id = d.uploaded_by`;

export function fixtureByHash(db: D1Database, sha: string) {
  return db
    .prepare(
      `SELECT f.*, p.full_name AS fx_full_name, p.birth_number AS fx_birth_number FROM fixture_files f
       LEFT JOIN fixture_patients p ON p.fixture_id = f.fixture_id WHERE f.sha256 = ?1`,
    )
    .bind(sha)
    .first<FixtureRow>();
}

export function fixtureFiles(db: D1Database, fixtureId: string, kind: FixtureRow["kind"]) {
  return db
    .prepare("SELECT * FROM fixture_files WHERE fixture_id = ?1 AND kind = ?2 ORDER BY file_name")
    .bind(fixtureId, kind)
    .all<Omit<FixtureRow, "fx_full_name" | "fx_birth_number">>()
    .then((r) => r.results);
}

export async function caseDocuments(db: D1Database, caseId: string) {
  return (await db.prepare(`${DOC_SELECT} WHERE d.case_id = ?1 ORDER BY d.created_at, d.id`).bind(caseId).all<DocRow>()).results;
}

// The documents a phone sent through one upload session, for the desktop's poll.
export async function sessionDocuments(db: D1Database, sessionId: string) {
  return (await db.prepare(`${DOC_SELECT} WHERE d.upload_session_id = ?1 ORDER BY d.created_at, d.id`).bind(sessionId).all<DocRow>()).results;
}

export function documentRow(db: D1Database, id: string) {
  return db.prepare(`${DOC_SELECT} WHERE d.id = ?1`).bind(id).first<DocRow>();
}

// What decides whether a case takes uploads: closed, or a conclusion approved (the approved record must not change
// under it, as canUpload() in the page), and the case's patient for the identity check.
export async function uploadContext(db: D1Database, caseId: string) {
  return db
    .prepare(
      `SELECT c.status, c.created_by, p.full_name, p.name_as_written, p.birth_number,
         EXISTS (SELECT 1 FROM protocols pr WHERE pr.case_id = c.id AND pr.state = 'approved') AS approved,
         (SELECT COUNT(*) FROM documents d WHERE d.case_id = c.id) AS doc_count
       FROM cases c JOIN patients p ON p.id = c.patient_id WHERE c.id = ?1`,
    )
    .bind(caseId)
    .first<{
      status: string;
      created_by: string | null;
      full_name: string;
      name_as_written: string | null;
      birth_number: string | null;
      approved: number;
      doc_count: number;
    }>();
}

// The guard every upload write re-checks inside its batch.
export const UNLOCKED_COND = "(SELECT status FROM cases WHERE id = ?) <> 'closed' AND NOT EXISTS (SELECT 1 FROM protocols WHERE case_id = ? AND state = 'approved')";
