// A mocked API: routes answer from a table, every request is recorded, and a route can be held back to test replies
// that arrive late. Synthetic values only.
import { createApiClient, type EditEntry, type ExtractionDocument, type PatientRow } from "@codebridge/api-client";
import type { ExtractionRun } from "@codebridge/domain/extraction/types";
import { loginLost, sessionChanged } from "../app/lib/api";
import run10 from "../../fixtures/data/runs/NO-010.json";
import runS01 from "../../fixtures/data/runs/NO-S01.json";
import runS02 from "../../fixtures/data/runs/NO-S02.json";
import case10 from "../../fixtures/data/mock-case-10.json";
import extra10 from "../../fixtures/data/mock-case-10-extra.json";
import synS01 from "../../fixtures/data/mock-case-S01.json";
import synS02 from "../../fixtures/data/mock-case-S02.json";

type Handler = (url: string, init: RequestInit) => unknown | Promise<unknown>;

export function mockApi(routes: Record<string, Handler | unknown>) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetch = (async (u: string | URL | Request, init: RequestInit = {}) => {
    const url = String(u);
    calls.push({ url, init });
    const key = Object.keys(routes).find((k) => url.replace(/^\/api/, "").split("?")[0] === k);
    if (!key) return new Response(JSON.stringify({ error: { code: "not_found", message_cs: "Neznámá adresa API." } }), { status: 404, headers: { "content-type": "application/json" } });
    const r = routes[key];
    const body = await (typeof r === "function" ? (r as Handler)(url, init) : r);
    const [status, json] = Array.isArray(body) && typeof body[0] === "number" ? (body as [number, unknown]) : [200, body];
    return new Response(JSON.stringify(json), { status, headers: { "content-type": "application/json" } });
  }) as typeof globalThis.fetch;
  return { api: createApiClient({ fetch, onUnauthenticated: loginLost, onSessionChanged: sessionChanged }), calls };
}

// A promise the test resolves by hand.
export function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

export const row = (n: number, extra: Partial<PatientRow> = {}): PatientRow => ({
  file: `${n}_pacient.pdf`,
  id: `NO-${String(n).padStart(3, "0")}`,
  name: `Pacient ${n}`,
  nameAsWritten: null,
  rc: null,
  birth: null,
  age: null,
  synthetic: true,
  warn: null,
  nameNote: null,
  diagnosis: null,
  diagnosisNote: null,
  mkn10: null,
  question: null,
  purpose: null,
  explicit: false,
  draft: null,
  qkind: null,
  basis: null,
  summary: null,
  pages: 1,
  referrer: null,
  dept: null,
  deptExample: false,
  owner: "MUDr. Svobodová",
  ownerExample: false,
  submitted: null,
  submittedExample: false,
  status: "new",
  slot: null,
  updated: "2026-10-18",
  full: true,
  processing: "full",
  statusHist: [],
  ...extra,
});

// The /me fields every answer carries besides the user: the membership the request acts with (equal to the person's id
// in demo org A), its org and the epoch (null here: tests that need one set it).
export const meOrg = (membership: string) => ({
  membership_id: membership,
  memberships: [],
  org: { id: "org-a", name: "Ukázková nemocnice A", short_name: "A", is_demo: true },
  data_epoch: null,
  real_user: null,
  role_switch: null,
  nis: null,
  features: { pipeline: false, keeps_uploads: false },
});

// A stored edit as the workflow state carries it (CaseState edits); `fact_id` is set for an "f:" key only.
export const edit = (text: string, by = "MUDr. X", more: Partial<EditEntry> = {}): EditEntry => ({ id: 1, text, orig: null, by, when: "", fact_id: null, ...more });

// The converted codebridge.extraction/2 runs of the demo cases (fixtures/data/runs), each a fresh copy so a test that
// changes one does not change the next, and the stored documents D1 sends with them (GET /cases/:id/extraction
// `documents`): the parts as document_parts keeps them, which has no embedded_in_cs.
export type DemoCase = "NO-010" | "NO-S01" | "NO-S02";
type FixtureDoc = { title_cs: string; type?: string | null; date?: string | null; date_note_cs?: string | null; pages: number[]; readability?: string | null; reason_cs?: string | null };
const RUNS: Record<DemoCase, unknown> = { "NO-010": run10, "NO-S01": runS01, "NO-S02": runS02 };
export const runOf = (id: DemoCase): ExtractionRun => JSON.parse(JSON.stringify(RUNS[id]));
const partsOf = (docs: FixtureDoc[]): ExtractionDocument["parts"] =>
  docs.map((d) => ({
    title_cs: d.title_cs,
    type: d.type ?? null,
    date: d.date ?? null,
    date_note_cs: d.date_note_cs ?? null,
    pages: d.pages,
    readability: d.readability ?? null,
    reason_cs: d.reason_cs ?? null,
  }));
const DOCS: Record<DemoCase, () => ExtractionDocument[]> = {
  "NO-010": () => [{ id: "10_pacient", file: "10_pacient.pdf", page_count: case10.page_count, note_cs: extra10.documents_note_cs, parts: partsOf(extra10.documents) }],
  "NO-S01": () => [{ id: "S01_pacient", file: "S01_pacient.pdf", page_count: synS01.list_entry.page_count, note_cs: null, parts: partsOf(synS01.documents) }],
  "NO-S02": () => [{ id: "S02_pacient", file: "S02_pacient.pdf", page_count: synS02.list_entry.page_count, note_cs: null, parts: partsOf(synS02.documents) }],
};
export const docsOf = (id: DemoCase): ExtractionDocument[] => DOCS[id]();
