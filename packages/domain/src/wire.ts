// The JSON shapes the API sends and the page reads, as types only. The Worker builds these objects in its routes and
// stores; api/src/wire-check.ts asserts at type-check time that what the Worker builds still fits these types, so the
// browser client and the server cannot drift apart silently. Field names are the ones the app reads.
import type { Role } from "./access";
import type { NisCandidate } from "./nis";
export type { NisCandidate } from "./nis";
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

// An organization (AUTH.md): a hospital or another customer; every patient, case and document belongs to one.
export type OrgRef = { id: string; name: string; short_name: string; is_demo: boolean };

// A person's role, function and department in one org.
export type MembershipRef = { id: string; org: OrgRef; role: Role; fn: string; dept: { id: string; name: string } | null };

// GET /me: the person, the membership the request acts with (user keeps the shape the app reads: the person's id and
// name with that membership's role and department), every active membership of the person, and the active org with
// its data epoch.
export type Me = {
  user: { id: string; name: string; role: Role; dept: { id: string; name: string } | null };
  membership_id: string;
  memberships: MembershipRef[];
  org: OrgRef;
  data_epoch: number | null;
  auth_mode: "demo" | "oidc";
  impersonating: boolean;
  // The person logged in, when it is not the one acted as (a role switch in a demo org); null otherwise.
  real_user: { id: string; name: string } | null;
  // OIDC mode in a demo org: the memberships "Přepnout roli" offers (the org's demo accounts, the person's own
  // included). Null where no role switch exists (demo mode, hospital orgs).
  role_switch: RoleSwitchEntry[] | null;
  notice_cs: string | null;
  // The org's NIS (hospital system over FHIR), null when the org has none: the page then shows no "Import z NIS".
  nis: { label_cs: string } | null;
  // What this org may use on this host. pipeline: the document pipeline without an LLM runs for this org (the host
  // offers it and PIPELINE_ORGS lists the org); the page shows processing states and "Přečíst bez AI" only then.
  features: { pipeline: boolean };
};

export type RoleSwitchEntry = { membership_id: string; name: string; role: Role; fn: string; own: boolean };

// GET /demo/memberships (AUTH_MODE=demo only): the picker's entries, grouped by org. An entry is a membership, so a
// person in two orgs appears once in each; its id is what X-Demo-User sends.
export type DemoPicker = {
  orgs: (OrgRef & { people: { id: string; user_id: string; name: string; role: Role; fn: string; dept: string | null }[] })[];
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
  // Where the document names the patient (file, page, the name as quoted). Not in list rows: only the case header
  // (GET /cases/:id) carries it, and the patient page copies it onto the row; absent until then, null when not recorded.
  identitySource?: { file?: string; page: number | string; quote?: string } | null;
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

// Protocol steps travel in the app's shape.
export type { Step };

// ---------- new patient, uploads and the phone upload ----------

// One document as the upload routes and lists send it (docOut() in api/src/routes/documents.ts). A listed file (the
// demo keeps only its name and size) has no content on the server; a registered synthetic fixture carries its title
// (type_cs). identity "conflicts" means the document names another patient; it is flagged, never blocked.
export type UploadDoc = {
  id: string;
  file: string;
  name: string;
  origin: string;
  size: number | null;
  sha256: string | null;
  page_count: number;
  processing: string;
  note: string | null;
  type_cs: string | null;
  doc_type: string | null;
  doc_date: string | null;
  fixture: boolean;
  content_stored: boolean;
  state: string | null;
  state_cs: string | null;
  state_detail_cs: string | null;
  identity: string | null;
  identity_cs: string | null;
  readability: string | null;
  readability_reasons_cs: string[];
  uploaded_by: string | null;
  uploaded_at: string;
  source: string | null;
};
// GET /cases/:id/documents.
export type CaseDocuments = { case_id: string; processing_level: "full" | "partial" | "none"; documents: (UploadDoc & { parts?: unknown[] })[] };

// "Import z NIS" (issue #22): the link a patient row has to a NIS record, and the candidates of a search.
export type NisLink = { nis_patient_id: string; nis_version: string | null; identity_check: string; by_name: string; at: string };
export type NisRegisterStub = { status: "stub"; message_cs: string };
export type NisStatus = { label_cs: string; has_birth_number: boolean; link: NisLink | null; national_register: NisRegisterStub };
export type NisSearch = {
  label_cs: string;
  candidates: NisCandidate[];
  // Records the NIS returned without the searched birth number: counted, never shown.
  other_records_hidden: number;
  duplicates: boolean;
  truncated: boolean;
  link: NisLink | null;
  national_register: NisRegisterStub;
};

// POST /fhir/referral: the referral read into the form. fields uses the form's field names (nf0...), so the page fills
// the form without a mapping of its own; the bundle itself is never stored, only its hash.
export type FhirReferral = {
  form: Record<string, string>;
  fields: Record<string, string>;
  found: string[];
  missing_cs: string[];
  referral_sha256: string;
};
// POST /cases with intake: true opens the case for intake, visible only to its creator until it is completed.
export type CreatedCase = { case_id: string; file: string; intake: boolean };
// GET /cases/:id/intake: the server's verdict on the uploads (it recognises the prepared fixtures by hash).
export type IntakeStatus = {
  case_id: string;
  ready: boolean;
  fixture_id: string | null;
  expected: number;
  present: number;
  missing_cs: string[];
  reason_cs: string;
  documents: UploadDoc[];
};
// POST /cases/:id/intake/complete.
export type IntakeCompleted = { case_id: string; attached: boolean; run_id: string | null; reason_cs: string; documents: number };

export type UploadTarget = "intake" | "discussion" | "documents";
// An upload session as the desktop sees it; the token is only in the answer that created the session.
export type UploadSession = {
  id: string;
  case_id: string;
  target: string;
  state: "open" | "full" | "expired" | "closed";
  expires_at: string;
  file_count: number;
  max_files: number;
};
export type CreatedUploadSession = UploadSession & { token: string };
// GET /upload-sessions/:id (the desktop's poll): the files this session added.
export type UploadSessionPoll = UploadSession & { documents: UploadDoc[] };
