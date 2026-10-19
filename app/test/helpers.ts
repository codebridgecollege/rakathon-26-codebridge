// A mocked API: routes answer from a table, every request is recorded, and a route can be held back to test replies
// that arrive late. Synthetic values only.
import { createApiClient, type PatientRow } from "@codebridge/api-client";
import { loginLost, sessionChanged } from "../app/lib/api";

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
  features: { pipeline: false },
});
