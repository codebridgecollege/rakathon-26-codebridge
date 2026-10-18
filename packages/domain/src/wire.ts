// The JSON shapes the API sends and the page reads, as types only. The Worker builds these objects in its routes and
// stores; api/src/wire-check.ts asserts at type-check time that what the Worker builds still fits these types, so the
// browser client and the server cannot drift apart silently. Field names are the page's (see mocks/src/v3-template.html).
import type { Role } from "./access";
import type { Status } from "./status";
import type { Step } from "./protocol";

// Every refusal: { error: { code, message_cs } }, plus the server's state on a conflict and field messages for a form.
export type ApiErrorBody = {
  error: { code: string; message_cs: string; current?: unknown; fields?: Record<string, string> };
};

// Every write answers { data, data_epoch, state }: the result of the write, the demo data's reset epoch and the parts
// of the page state the write changed.
export type WriteReply<T = unknown> = { data: T; data_epoch: number | null; state: WorkflowState };

export type Health = {
  ok: boolean;
  service: string;
  runtime: string;
  version: string;
  auth_mode: string;
  features: { stt: boolean; summarize: boolean; data: boolean; transcripts: boolean; pipeline: boolean };
  seeded_at: string | null;
  demo: { data_epoch: number; reset_at: string | null; seed_version: string | null; reset_enabled: boolean } | null;
  limits: { stt_audio_bytes: number; summary_chars: number; audio_part_bytes: number; audio_max_minutes: number };
};

export type Me = {
  user: { id: string; name: string; role: Role; dept: { id: string; name: string } | null };
  auth_mode: "demo" | "access";
  impersonating: boolean;
  notice_cs: string | null;
};

export type StaffPerson = { id: string; pre: string; sur: string; post: string; fn: string };
// GET /staff: departments with their people, the coordinator, the administrator and each person's role.
export type StaffDirectory = {
  depts: { id: string; name: string; people: StaffPerson[] }[];
  coord: StaffPerson | null;
  admin: StaffPerson | null;
  roles: Record<string, Role>;
  seq?: number;
  source?: string;
};

export type Slot = { day: string; time: string };
export type StatusHistItem = { from: string; to: string; by: string; when: string; how: string };

// One row of GET /patients. Identity fields are here because the list shows them; quotes (purpose, basis, nameNote)
// may hold names, so nothing here is ever logged.
export type PatientRow = {
  file: string;
  id: string;
  name: string;
  nameAsWritten: string | null;
  rc: string | null;
  birth: string | null;
  age: string | null;
  synthetic: boolean;
  warn: string | null;
  nameNote: { text: string; src: unknown } | null;
  diagnosis: string | null;
  diagnosisNote: string | null;
  mkn10: string | null;
  question: string | null;
  purpose: string | null;
  explicit: boolean;
  draft: string | null;
  qkind: string | null;
  basis: unknown;
  summary: string | null;
  pages: number | null;
  referrer: string | null;
  dept: string | null;
  deptExample: boolean;
  owner: string;
  ownerExample: boolean;
  submitted: string | null;
  submittedExample: boolean;
  status: string;
  slot: Slot | null;
  updated: string;
  full: boolean;
  processing: string;
  statusHist: StatusHistItem[];
};
export type PatientList = { patients: PatientRow[]; total: number; page: number };

export type Task = {
  id: number;
  pid: string;
  case_id: string;
  text: string;
  who: string;
  due: string | null;
  done: boolean;
  dueSrc: string | null;
  dueBy: string | null;
  timing: string | null;
  fromSugg: number | null;
  confirmedBy: string | null;
};
export type TaskList = { tasks: Task[] };

// The stored workflow state of one case (store/work.ts caseStates). Sub-objects the shell does not read yet stay loose.
export type CaseState = {
  case_id: string;
  file: string;
  status: Status;
  slot: Slot | null;
  updated: string;
  statusHist: StatusHistItem[];
  protocol: Record<string, unknown>;
  decisions: Record<string, unknown>[];
  tasks: Task[];
  sugg: Record<string, unknown>[];
  edits: Record<string, unknown>;
  editLog: Record<string, unknown>[];
  qConfirm: { text: string; by: string; when: string } | null;
  draft_sha: string | null;
  alertHist: Record<string, unknown>[];
  clinical: boolean;
};
export type AttSet = { key: string; version: number; byName: Record<string, string[]>; byId: Record<string, string[]> };
export type Session = { day: string; started_by: string | null; started_at: string; ended_at: string | null };
export type Mail = Record<string, unknown>;

// The parts of the page state an answer may name; the page replaces exactly the named parts.
export type WorkflowState = {
  cases?: Record<string, Partial<CaseState>>;
  att?: Record<string, AttSet>;
  sessions?: Session[];
  mails?: Mail[];
  patient?: PatientRow;
  staff?: StaffDirectory;
};
// GET /workflow: the stored state of every case this user may read.
export type Workflow = {
  data_epoch: number | null;
  cases: Record<string, CaseState>;
  att: Record<string, AttSet>;
  sessions: Session[];
  mails: Mail[];
};

// GET /cases/:id/extraction: the stored extraction objects without identity; data is null for a case without a run.
// The extraction itself is the largest shape in the app and is typed when its screens are ported.
export type Extraction = { data: { case?: unknown; extra?: unknown; syn?: unknown } | null } & Record<string, unknown>;

// Protocol steps travel in the page's shape.
export type { Step };
