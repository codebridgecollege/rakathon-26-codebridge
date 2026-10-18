// Typed calls for the API routes the page uses (api/src/routes), one function per route. Replies are typed from
// @codebridge/domain/wire where the shape is shared; bodies and replies of screens not ported yet are kept loose
// (Record<string, unknown>) and get their types when their screen is ported. Paths escape every parameter.
import type {
  Extraction,
  Health,
  Me,
  PatientList,
  StaffDirectory,
  TaskList,
  Workflow,
  WriteReply,
} from "@codebridge/domain/wire";
import type { Status } from "@codebridge/domain/status";
import type { Step } from "@codebridge/domain/protocol";
import { ApiError, createTransport, type ClientOptions, type RequestOptions, type Transport } from "./core";

export { ApiError, CLIENT_ERROR_IDS, createTransport } from "./core";
export type { ClientErrorCode, ClientOptions, RequestOptions, Transport } from "./core";
export type * from "@codebridge/domain/wire";

const enc = (v: string | number) => encodeURIComponent(String(v));
type Loose = Record<string, unknown>;

// The prognosis search's shapes, as loose as the tab reads them: the rows are model extractions the tab shows field by
// field (PgRow in @codebridge/domain/prognosis).
export type PrognosisModel = { id: string; label?: string; error?: string | null; warnings?: string[] } & Loose;
export type PrognosisConfig = { configured?: boolean; error?: string | null; models?: PrognosisModel[] } & Loose;
export type PrognosisProfile = { available?: boolean; reason?: string | null; facts?: unknown[]; warnings?: string[] } & Loose;
export type PrognosisResult = {
  rows?: Loose[];
  models?: PrognosisModel[];
  profile?: PrognosisProfile;
  searched_at?: string;
  cache_hit?: boolean;
  warnings?: string[];
} & Loose;
export type SavedPrognosis = { patient_id?: string; scheduled_date?: string; result?: PrognosisResult } & Loose;

// Catalog IDs (i18n/cs/patient-prognosis.ftl) of the errors the prognosis calls raise themselves (pgJson() in
// mocks/src/prognosis.js): the routes live on the local prognosis server, so a host without them says so, and a search
// past its time limit is not restarted on its own.
export const PROGNOSIS_ERROR_IDS = {
  no_api: "patient-pg-error-no-server",
  timeout: "patient-pg-error-timeout",
  fallback: "patient-pg-error-request-failed",
} as const;
// The search runs model calls with web search and may take minutes; the config and the profile are quick reads.
export const PROGNOSIS_TIMEOUTS = { get: 45000, search: 330000 } as const;

// A server's Czech message passes through; the client's own errors get the prognosis wording instead of the general
// one. A lost connection keeps the general message, which already says what happened.
async function prognosisCall<T>(call: () => Promise<T>): Promise<T> {
  try {
    return await call();
  } catch (e) {
    if (!(e instanceof ApiError) || e.message_cs) throw e;
    const id =
      e.code === "no_api" ? PROGNOSIS_ERROR_IDS.no_api : e.code === "timeout" ? PROGNOSIS_ERROR_IDS.timeout : e.code === "network" ? e.message_id : PROGNOSIS_ERROR_IDS.fallback;
    throw new ApiError(e.code, e.status, null, id, e.current, e.fields);
  }
}

export type ApiClient = ReturnType<typeof createApiClient>;

export function createApiClient(opts: ClientOptions = {}) {
  const t: Transport = createTransport(opts);
  const w = <T = Loose>(method: "POST" | "PUT" | "PATCH" | "DELETE", path: string, body?: unknown, o?: RequestOptions) =>
    t.write<WriteReply<T>>(method, path, body, o);

  return {
    transport: t,
    setUser(id: string | null) {
      t.userId = id;
    },
    get userId() {
      return t.userId;
    },
    get epoch() {
      return t.epoch;
    },
    newKey: () => t.newKey(),

    // ---------- reads ----------
    // Short timeout: on a host without the API the page must not wait long to find out.
    async health(o: RequestOptions = { timeout: 1500 }) {
      const h = await t.get<Health>("/health", o);
      if (h.demo?.data_epoch != null) t.epoch = h.demo.data_epoch;
      return h;
    },
    me: () => t.get<Me>("/me"),
    staff: () => t.get<StaffDirectory>("/staff"),
    patients: (q: { q?: string; status?: string; dept?: string; from?: string; to?: string; page?: number; page_size?: number } = {}) =>
      t.get<PatientList>("/patients", { query: q }),
    tasks: (scope: "all" | "mine" = "all") => t.get<TaskList>("/tasks", { query: { scope } }),
    async workflow() {
      const wf = await t.get<Workflow>("/workflow");
      if (wf.data_epoch != null) t.epoch = wf.data_epoch;
      return wf;
    },
    calendar: (q: Loose = {}) => t.get<Loose>("/calendar", { query: q as RequestOptions["query"] }),
    // Opening a case is an audited access on the server ("case.open"); viaLink marks an open from a shared link.
    caseHeader: (caseId: string, viaLink = false) => t.get<Loose>(`/cases/${enc(caseId)}`, { query: viaLink ? { via: "link" } : undefined }),
    // One request per case load; the server writes a "case.data" access-log row, so it is never prefetched.
    extraction: (caseId: string) => t.get<Extraction>(`/cases/${enc(caseId)}/extraction`, { timeout: 20000 }),
    alerts: (caseId: string) => t.get<Loose>(`/cases/${enc(caseId)}/alerts`),
    decisions: (caseId: string) => t.get<Loose>(`/cases/${enc(caseId)}/decisions`),
    history: (caseId: string) => t.get<Loose>(`/cases/${enc(caseId)}/history`),
    guidance: (caseId: string) => t.get<Loose>(`/cases/${enc(caseId)}/guidance`),
    // The saved study searches of a case, for every day; the server writes a "prognosis.view" access-log row.
    prognosis: (caseId: string) => t.get<{ saved: SavedPrognosis[] }>(`/cases/${enc(caseId)}/prognosis`),
    // The local prognosis server's routes (mocks/serve.py). The Worker has none of them, so there they fail and the
    // tab shows the saved search only.
    prognosisConfig: () => prognosisCall(() => t.get<PrognosisConfig>("/prognosis/config", { timeout: PROGNOSIS_TIMEOUTS.get })),
    prognosisProfile: (q: { patient_id: string; scheduled_date: string }) =>
      prognosisCall(() => t.get<{ profile?: PrognosisProfile } & Loose>("/prognosis/profile", { query: q, timeout: PROGNOSIS_TIMEOUTS.get })),
    // One search per click; refresh asks the server not to answer from its cache.
    prognosisSearch: (body: { patient_id: string; scheduled_date: string; refresh: boolean }) =>
      prognosisCall(() => t.write<PrognosisResult>("POST", "/prognosis", body, { timeout: PROGNOSIS_TIMEOUTS.search })),
    documents: (caseId: string) => t.get<Loose>(`/cases/${enc(caseId)}/documents`),
    // Fetched for every view, never cached: each view of a page is an access the server records.
    page: (docId: string, n: number) => t.get<Loose>(`/documents/${enc(docId)}/pages/${enc(n)}`),
    // The image URL for an <img>, which cannot send a header; the demo user then travels in the cb_demo_user cookie.
    pageImageUrl: (docId: string, n: number) => `${opts.base ?? "/api"}/documents/${enc(docId)}/pages/${enc(n)}/image`,
    pipeline: (docId: string) => t.get<Loose>(`/documents/${enc(docId)}/pipeline`),
    intake: (caseId: string) => t.get<Loose>(`/cases/${enc(caseId)}/intake`),
    transcript: (caseId: string) => t.get<Loose>(`/cases/${enc(caseId)}/transcript`),
    job: (jobId: string) => t.get<Loose>(`/jobs/${enc(jobId)}`),
    uploadSession: (id: string) => t.get<Loose>(`/upload-sessions/${enc(id)}`),
    accessLog: () => t.get<Loose>("/admin/access-log"),

    // ---------- case writes ----------
    setStatus: (caseId: string, body: { to: Status; expected_status: Status }) => w<{ slot_released?: boolean }>("POST", `/cases/${enc(caseId)}/status`, body),
    putSlot: (caseId: string, body: { day: string; time: string }) => w<{ warning_cs?: string | null }>("PUT", `/cases/${enc(caseId)}/slot`, body),
    deleteSlot: (caseId: string) => w("DELETE", `/cases/${enc(caseId)}/slot`, {}),
    // version names the protocol version the text was typed against; a newer one on the server is a conflict.
    putProtocol: (caseId: string, body: { version: number; notes?: string; concl?: string; steps?: Step[] }) =>
      w("PUT", `/cases/${enc(caseId)}/protocol`, body),
    // Needs an idempotency key: a retry after a lost answer must not approve twice. The caller keeps the key until
    // the approval is answered (status 0 means the server may have seen it).
    approve: (caseId: string, body: Loose, idem: string) => w("POST", `/cases/${enc(caseId)}/decisions`, body, { idem }),
    newVersion: (caseId: string, body: { expected_decision_id: string | null }) => w("POST", `/cases/${enc(caseId)}/decisions/new-version`, body),
    confirmQuestion: (caseId: string, body: Loose) => w("POST", `/cases/${enc(caseId)}/question/confirm`, body),
    putEdit: (caseId: string, key: string, body: Loose) => w("PUT", `/cases/${enc(caseId)}/edits/${enc(key)}`, body),
    deleteEdit: (caseId: string, key: string, body: Loose) => w("DELETE", `/cases/${enc(caseId)}/edits/${enc(key)}`, body),
    alertEvent: (caseId: string, key: string | number, body: { action: string; expected_state: unknown }) =>
      w("POST", `/cases/${enc(caseId)}/alerts/${enc(key)}/events`, body),
    breakGlass: (caseId: string, body: { reason: string }) => w("POST", `/cases/${enc(caseId)}/break-glass`, body),

    // ---------- tasks, sessions, attendance ----------
    patchTask: (id: number | string, body: { done: boolean; expected_done: boolean }) => w("PATCH", `/tasks/${enc(id)}`, body),
    patchSuggestion: (id: number | string, body: Loose) => w("PATCH", `/suggestions/${enc(id)}`, body),
    confirmSuggestion: (id: number | string, body: Loose = {}) => w("POST", `/suggestions/${enc(id)}/confirm`, body),
    dismissSuggestion: (id: number | string, body: Loose = {}) => w("POST", `/suggestions/${enc(id)}/dismiss`, body),
    sendDigest: (body: Loose = {}) => w("POST", "/notifications/digest", body),
    startSession: (body: { day: string }) => w("POST", "/sessions", body),
    endSession: (day: string) => w("DELETE", `/sessions/${enc(day)}`, {}),
    putAttendance: (key: string, body: Loose) => w("PUT", `/attendance/${enc(key)}`, body),
    // View events the server cannot see; codes and ids only, never free text.
    auditEvent: (body: { code: string; case_id?: string; target?: string }) => w("POST", "/audit/events", body),

    // ---------- new patient and intake ----------
    createCase: (body: Loose, idem: string) => w("POST", "/cases", body, { idem }),
    fhirReferral: (bundle: unknown) => w("POST", "/fhir/referral", bundle),
    completeIntake: (caseId: string) => w("POST", `/cases/${enc(caseId)}/intake/complete`, {}),
    discardIntake: (caseId: string) => w("DELETE", `/cases/${enc(caseId)}/intake`, {}),
    // One file per request, raw body (api/src/routes/documents.ts); the file name travels URI-encoded in X-File-Name,
    // because a header carries ASCII only.
    uploadDocument: (caseId: string, file: Blob, fileName: string) =>
      t.upload<WriteReply<Loose>>("POST", `/cases/${enc(caseId)}/documents`, file, file.type || "application/octet-stream", {
        headers: { "X-File-Name": encodeURIComponent(fileName) },
        timeout: 120000,
      }),
    deleteDocument: (docId: string) => w("DELETE", `/documents/${enc(docId)}`, {}),
    processDocument: (docId: string) => w("POST", `/documents/${enc(docId)}/process`, {}),
    createUploadSession: (body: { case_id: string; target: string }) => w<{ id: string } & Loose>("POST", "/upload-sessions", body),
    deleteUploadSession: (id: string) => w("DELETE", `/upload-sessions/${enc(id)}`, {}),

    // ---------- recording ----------
    startRecording: (body: { session_day: string | null; case_id: string | null }) => w("POST", "/recordings", body),
    endRecording: (id: string, body: { end_reason: string; case_id: string | null }) => w("PATCH", `/recordings/${enc(id)}`, body),
    transcriptLines: (caseId: string, body: { recording_id: string; lines: unknown[] }) => w("POST", `/cases/${enc(caseId)}/transcript/lines`, body),
    // Raw PCM; segments map the part's audio to the cases discussed while it was recorded (X-Audio-Segments).
    audioPart: (caseId: string, n: number, bytes: ArrayBuffer | Uint8Array, p: { recording_id: string; final: boolean; segments: unknown }) =>
      t.upload<WriteReply<Loose>>("PUT", `/cases/${enc(caseId)}/transcript/audio/parts/${enc(n)}`, bytes, "application/octet-stream", {
        query: { recording_id: p.recording_id, final: p.final ? 1 : 0 },
        headers: { "X-Audio-Segments": JSON.stringify(p.segments) },
        timeout: 60000,
      }),
    retryJob: (jobId: string) => w("POST", `/jobs/${enc(jobId)}/retry`, {}),

    // ---------- staff and administration ----------
    addDepartment: (body: { name: string }) => w("POST", "/staff/departments", body),
    deleteDepartment: (id: string) => w("DELETE", `/staff/departments/${enc(id)}`, {}),
    addPerson: (deptId: string, body: Loose) => w("POST", `/staff/departments/${enc(deptId)}/people`, body),
    patchPerson: (id: string, body: Loose) => w("PATCH", `/staff/people/${enc(id)}`, body),
    deletePerson: (id: string) => w("DELETE", `/staff/people/${enc(id)}`, {}),
    resetStaff: () => w("POST", "/staff/reset", {}),
    resetDemo: (body: { confirm: string }) => w("POST", "/admin/reset-demo", body),
  };
}
