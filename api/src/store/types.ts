// Storage the routes use, as interfaces, so a hospital pilot can swap D1/R2 for Postgres/S3 without touching
// the routes or the access rules. The D1 and R2 implementations are in d1.ts and r2.ts.
import type { Role, Viewer } from "@codebridge/domain/access";
import type { CaseJoinRow, StatusHistItem } from "../domain/rows";

// A person as one org knows them (store/d1.ts ORG_USER): role, function and activity are those of the membership.
export type UserRow = { id: string; pre: string; sur: string; post: string; fn: string; role_id: Role; active: number; membership_id: string };

export type StaffPerson = { id: string; pre: string; sur: string; post: string; fn: string };
export type StaffDirectory = {
  depts: { id: string; name: string; people: StaffPerson[] }[];
  coord: StaffPerson | null;
  admin: StaffPerson | null;
  roles: Record<string, Role>;
};

export type CaseFilter = { q?: string; status?: string; dept?: string; from?: string; to?: string; page: number; pageSize: number };

// The current extraction run of a case (store/runs.ts has the /2 reads and writes).
export type RunRow = { id: string; producer: string; seeded: number; schema: string; created_at: string; r2_key: string; case_id: string };

export type DocumentRow = {
  id: string;
  case_id: string;
  file_name: string;
  page_count: number;
  processing: string;
  note_cs: string | null;
  parts: {
    title_cs: string;
    type: string | null;
    date: string | null;
    date_note_cs: string | null;
    pages: number[];
    readability: string | null;
    reason_cs: string | null;
    // Issue #18: set on the page reader's parts (producer 'pipeline'), null on prepared ones.
    date_as_written: string | null;
    certainty: string | null;
  }[];
};

export type PageRow = {
  document_id: string;
  n: number;
  json_r2_key: string;
  image_r2_key: string;
  redacted_r2_key: string | null;
  is_empty: number;
};

export type TaskRow = {
  id: number;
  case_id: string;
  source_file: string;
  text: string;
  assignee_name: string;
  due: string | null;
  done: number;
  due_source: string | null;
  due_by: string | null;
  timing: string | null;
  from_suggestion_id: number | null;
  confirmed_by: string | null;
};

export type DecisionRow = {
  id: string;
  version: number;
  conclusion: string;
  approved_by_name: string;
  approved_at: string;
  slot_day: string | null;
  slot_time: string | null;
  report_snapshot_json: string;
  attendance_snapshot_json: string;
  supersedes_id: string | null;
};

export type AuditEntry = {
  viewer: Viewer;
  action: string;
  what_cs: string;
  case_id?: string | null;
  document_id?: string | null;
  page_n?: number | null;
  request_id?: string | null;
  break_glass_reason?: string | null;
  target_type?: string | null;
  target_id?: string | null;
};

export type AuditFilter = { caseId?: string; actor?: string; from?: string; to?: string; limit: number };
export type AuditRow = {
  at: string;
  actor_name: string;
  acted_as_role: string;
  impersonating: number;
  case_id: string | null;
  source_file: string | null;
  what_cs: string;
  // The person acted as after a role switch (impersonating = 1); null otherwise.
  as_pre: string | null;
  as_sur: string | null;
  as_post: string | null;
};

export interface DirectoryStore {
  userById(id: string): Promise<UserRow | null>;
  firstDeptOf(userId: string): Promise<{ id: string; name: string } | null>;
  staff(): Promise<StaffDirectory>;
}

export interface CaseStore {
  seededAt(): Promise<string | null>;
  listCases(viewer: Viewer, onlyMember: boolean, f: CaseFilter): Promise<{ rows: CaseJoinRow[]; total: number }>;
  caseById(id: string): Promise<CaseJoinRow | null>;
  isMember(caseId: string, viewer: Viewer): Promise<boolean>;
  memberDepts(caseId: string): Promise<string[]>;
  statusHistory(caseId: string): Promise<StatusHistItem[]>;
  currentRun(caseId: string): Promise<RunRow | null>;
  documents(caseId: string): Promise<DocumentRow[]>;
  documentById(id: string): Promise<DocumentRow | null>;
  pages(docId: string): Promise<PageRow[]>;
  tasks(viewer: Viewer, onlyMember: boolean, mine: boolean): Promise<TaskRow[]>;
  decisions(caseId: string): Promise<DecisionRow[]>;
  editHistory(caseId: string): Promise<unknown[]>;
  questionConfirmations(caseId: string): Promise<unknown[]>;
  slots(viewer: Viewer, onlyMember: boolean, from: string, to: string): Promise<{ day: string; time: string; case_id: string; file: string }[]>;
}

export interface AuditStore {
  append(e: AuditEntry): Promise<void>;
  list(f: AuditFilter): Promise<AuditRow[]>;
}

export interface BlobStore {
  getJson<T>(key: string): Promise<T | null>;
  getStream(key: string): Promise<{ body: ReadableStream; contentType: string } | null>;
  listKeys(prefix: string): Promise<string[]>;
}

// One set per request, bound to the org the request acts in.
export type Stores = { org: string; dir: DirectoryStore; cases: CaseStore; audit: AuditStore; blobs: BlobStore };
